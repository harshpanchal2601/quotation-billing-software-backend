import { Prisma } from '@prisma/client';
import { AppError } from '../../core/errors/AppError.js';
import { workflowSchema, type AutomationEvent, type WorkflowDefinition } from './automation.schema.js';

export function evaluateWorkflow(input: WorkflowDefinition, event: AutomationEvent) {
  const definition = workflowSchema.parse(input);
  if (!definition.enabled || definition.trigger !== event.trigger) return [];
  const steps = new Map(definition.steps.map((step) => [step.id, step]));
  const result: WorkflowDefinition['steps'] = [];
  const visited = new Set<string>();
  let current = definition.entry;
  for (let budget = 0; budget < 32; budget++) {
    const step = steps.get(current);
    if (!step || visited.has(current)) throw new AppError('Workflow execution bound exceeded', 400);
    visited.add(current); result.push(step);
    if (step.type === 'STOP') return result;
    if (step.type === 'NOTIFY') { current = step.next; continue; }
    const { field, operator, value } = step.predicate;
    const actual = event[field];
    const numeric = field === 'total' || field === 'discountPercent';
    const comparison = numeric ? new Prisma.Decimal(actual).cmp(value) : actual === value ? 0 : 1;
    const matches = operator === 'EQ' ? comparison === 0 : operator === 'NE' ? comparison !== 0 : operator === 'GTE' ? comparison >= 0 : comparison <= 0;
    current = matches ? step.yes : step.no;
  }
  throw new AppError('Workflow execution bound exceeded', 400);
}

// Offset and local boundaries are explicitly chosen by the recipient, never inferred.
export function nextDeliveryTime(now: Date, preference: { utcOffsetMinutes: number; quietStartMinute: number | null; quietEndMinute: number | null }) {
  const { quietStartMinute: start, quietEndMinute: end, utcOffsetMinutes: offset } = preference;
  if (start === null || end === null) return now;
  const local = new Date(now.getTime() + offset * 60000);
  const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
  const quiet = start < end ? minute >= start && minute < end : minute >= start || minute < end;
  if (!quiet) return now;
  let difference = (end - minute + 1440) % 1440;
  if (difference === 0) difference = 1440;
  return new Date(now.getTime() + difference * 60000 - local.getUTCSeconds() * 1000 - local.getUTCMilliseconds());
}
