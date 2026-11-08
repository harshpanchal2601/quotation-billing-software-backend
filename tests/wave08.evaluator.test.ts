import { describe, expect, it } from 'vitest';
import { renderEscapedTemplate, renderTextTemplate, validatePlaceholders } from '../src/core/templates/placeholders.js';
import { automationEventSchema, parseDefinition, workflowSchema, validateFieldValues } from '../src/modules/automation/automation.schema.js';
import { evaluateWorkflow, nextDeliveryTime } from '../src/modules/automation/workflow-evaluator.js';
import { evaluateFeature, type EntitlementContext } from '../src/modules/entitlements/entitlement-evaluator.js';
import { LEGACY_POLICY } from '../src/modules/entitlements/entitlements.schema.js';

const definition = workflowSchema.parse({ enabled: true, name: 'Invoice notice', trigger: 'invoice.issued', delayMinutes: 0, expiresAfterMinutes: 1440, entry: 'check', steps: [
  { id: 'check', type: 'TEST', predicate: { field: 'total', operator: 'GTE', value: '100.01' }, yes: 'notify', no: 'finish' },
  { id: 'notify', type: 'NOTIFY', recipientIds: [1], title: '{{documentNumber}}', body: '{{status}}', next: 'finish' }, { id: 'finish', type: 'STOP' },
] });
const event = automationEventSchema.parse({ trigger: 'invoice.issued', entity: 'INVOICE', entityId: 1, businessName: 'Firm A', documentNumber: 'A-1', status: 'ISSUED', currency: 'INR', total: '100.01', discountPercent: '0' });
describe('Wave 08 deterministic evaluator and template boundary', () => {
  it('selects one bounded branch with Decimal comparisons and produces no effects in preview', () => {
    expect(evaluateWorkflow(definition, event).map((step) => step.id)).toEqual(['check', 'notify', 'finish']);
    expect(evaluateWorkflow(definition, { ...event, total: '100.009999' }).map((step) => step.id)).toEqual(['check', 'finish']);
    expect(evaluateWorkflow({ ...definition, enabled: false }, event)).toEqual([]);
    expect(evaluateWorkflow(definition, { ...event, trigger: 'invoice.voided' })).toEqual([]);
  });
  it('rejects cycles, dangling transitions, duplicate IDs, unreachable steps and unknown actions', () => {
    const bad = [
      { ...definition, steps: definition.steps.map((step) => step.type === 'NOTIFY' ? { ...step, next: 'check' } : step) },
      { ...definition, entry: 'absent' }, { ...definition, steps: [...definition.steps, definition.steps[0]] },
      { ...definition, steps: [...definition.steps, { id: 'unreachable', type: 'STOP' }] },
      { ...definition, steps: [{ id: 'check', type: 'HTTP', url: 'https://example.invalid' }] },
    ];
    for (const input of bad) expect(workflowSchema.safeParse(input).success).toBe(false);
    expect(automationEventSchema.safeParse({ ...event, entity: 'QUOTATION' }).success).toBe(false);
    expect(automationEventSchema.safeParse({ ...event, trigger: 'webhook.arbitrary' }).success).toBe(false);
  });
  it('escapes literal HTML and substituted values while excluding private traversal and code', () => {
    expect(renderEscapedTemplate('<img src=x onerror=alert(1)> {{businessName}}', { businessName: '<script>x</script>' })).not.toContain('<script>');
    expect(renderEscapedTemplate('{{businessName}}', { businessName: '<img>' })).toBe('&lt;img&gt;');
    expect(renderTextTemplate('{{total}} {{currency}}', { total: '10.01', currency: 'INR' })).toBe('10.01 INR');
    for (const input of ['{{company.bankAccount}}', '{{constructor}}', '{{__proto__}}', '{{process.env}}', '{{total + 1}}', '{{{total}}}']) expect(() => validatePlaceholders(input)).toThrow();
    expect(renderTextTemplate('{{businessName}}', {})).toBe('');
  });
  it('keeps date and Decimal custom-field validation shared with invoices', () => {
    const fields = [{ key: 'cf_delivery', label: 'Delivery', type: 'DATE' as const, required: true, searchable: false, visibility: 'INTERNAL' as const, classification: 'BUSINESS' as const, options: [] }];
    expect(validateFieldValues(fields, { cf_delivery: '2028-02-29' })).toEqual({ cf_delivery: '2028-02-29' });
    expect(() => validateFieldValues(fields, { cf_delivery: '2026-02-29' })).toThrow();
    expect(() => validateFieldValues(fields, { cf_delivery: '2028-02-29', bankAccount: 'secret' })).toThrow();
    expect(() => parseDefinition('CUSTOM_FIELDS', 'COMPANY', { enabled: true, entity: 'COMPANY', fields: [{ ...fields[0], classification: 'SECRET' }] })).toThrow();
  });
  it('schedules quiet hours across midnight and offset boundaries without consuming retries', () => {
    const preference = { utcOffsetMinutes: 330, quietStartMinute: 22 * 60, quietEndMinute: 8 * 60 };
    expect(nextDeliveryTime(new Date('2026-11-08T18:30:00Z'), preference).toISOString()).toBe('2026-11-09T02:30:00.000Z');
    expect(nextDeliveryTime(new Date('2026-11-09T02:30:00Z'), preference).toISOString()).toBe('2026-11-09T02:30:00.000Z');
    expect(nextDeliveryTime(new Date('2026-11-08T04:00:00Z'), { utcOffsetMinutes: 0, quietStartMinute: 3 * 60, quietEndMinute: 5 * 60 }).toISOString()).toBe('2026-11-08T05:00:00.000Z');
  });
  it('keeps automation denied for legacy/plan-disabled, role-denied, global-off, suspended and expired-override contexts', () => {
    const now = new Date('2026-11-08T00:00:00Z');
    const context: EntitlementContext = { now, legacy: false, firmActive: true, subscription: { status: 'ACTIVE', effectiveFrom: new Date(0), effectiveUntil: null, trialEndsAt: null, graceEndsAt: null, currentPeriodEndsAt: null, policy: LEGACY_POLICY }, features: new Set(['automation']), hardDisabled: new Set(), overrides: [] };
    expect(evaluateFeature(context, 'automation', true).allowed).toBe(true);
    for (const changes of [{ legacy: true, features: new Set<string>() }, { features: new Set<string>() }, { firmActive: false }, { hardDisabled: new Set(['automation']) }, { features: new Set<string>(), overrides: [{ id: 1, target: 'feature:automation', effect: 'ALLOW', limit: null, startsAt: new Date(0), expiresAt: now, revokedAt: null }] }]) expect(evaluateFeature({ ...context, ...changes } as EntitlementContext, 'automation', true).allowed).toBe(false);
    expect(evaluateFeature(context, 'automation', false).allowed).toBe(false);
  });
});
