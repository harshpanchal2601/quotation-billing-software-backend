import { z } from 'zod';
import { escapeHtml } from '../../core/html/escape-html.js';
import { renderEscapedTemplate, type TemplateVariables } from '../../core/templates/placeholders.js';
import { customFieldsSchema, documentTemplateSchema } from './automation.schema.js';
import { automationAvailable, latestDefinition, type AutomationTx } from './automation.persistence.js';

export const presentationSchema = z.object({
  templateVersionId: z.number().int().positive().nullable(), template: documentTemplateSchema.nullable(),
  fields: z.array(z.object({ label: z.string().max(100), value: z.union([z.string().max(4000), z.boolean(), z.null()]) }).strict()).max(50),
}).strict();
export async function resolveDocumentPresentation(tx: AutomationTx, firmId: number, entity: 'QUOTATION' | 'INVOICE', entityId: number) {
  if (!await automationAvailable(tx, firmId)) return { templateVersionId: null, template: null, fields: [] };
  const head = await latestDefinition(tx, firmId, 'TEMPLATE', entity);
  const template = head ? documentTemplateSchema.parse(head.definition) : null;
  const row = entity === 'QUOTATION' ? await tx.customFieldValueVersion.findFirst({ where: { firmId, entity, entityId }, orderBy: { version: 'desc' }, include: { definition: true } }) : null;
  const config = row?.definition ? customFieldsSchema.parse(row.definition.definition) : null;
  const values = row?.values as Record<string, string | boolean | null> | undefined;
  return presentationSchema.parse({ templateVersionId: template?.enabled ? head!.id : null, template: template?.enabled ? template : null,
    fields: config?.enabled ? config.fields.filter((field) => field.visibility === 'DOCUMENT').map((field) => ({ label: field.label, value: values?.[field.key] ?? null })) : [] });
}
export function renderDocumentPresentation(value: unknown, variables: TemplateVariables) {
  const snapshot = presentationSchema.parse(value);
  return {
    heading: snapshot.template ? `<div style="white-space:pre-wrap;color:${snapshot.template.primaryColour}">${renderEscapedTemplate(snapshot.template.heading, variables)}</div>` : '',
    footer: `${snapshot.fields.map((field) => `<p>${escapeHtml(field.label)}: ${escapeHtml(field.value === null ? '' : String(field.value))}</p>`).join('')}${snapshot.template ? `<div style="white-space:pre-wrap">${renderEscapedTemplate(snapshot.template.footer, variables)}</div>` : ''}`,
  };
}
