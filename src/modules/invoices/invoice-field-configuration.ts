import type { Prisma } from '@prisma/client';
import { readInvoiceSettings } from './invoice-settings.repository.js';
import { customFieldDefinitionsSchema } from './invoices.schema.js';
import { mapInvoiceFieldConfiguration } from '../automation/runtime.js';
import { requestHash } from '../../core/idempotency/request-hash.js';

// Narrow command for Wave 08. Fiscal settings never come from an automation payload.
export async function applyInvoiceFieldDefinitions(tx: Prisma.TransactionClient, firmId: number, fields: unknown) {
  const previous = await readInvoiceSettings(tx, firmId);
  const customFields = customFieldDefinitionsSchema.parse(fields);
  const config = { ...previous.config, customFields };
  const version = previous.version + 1;
  await tx.invoiceSetting.upsert({ where: { firmId }, create: { firmId, version, config }, update: { version, config } });
  return { version, config };
}

export async function recordInvoiceFieldHistory(tx: Prisma.TransactionClient, firmId: number, actorId: number, entityId: number, version: number) {
  const row = await tx.invoice.findFirstOrThrow({ where: { id: entityId, firmId }, select: { customFieldSchema: true, customFieldValues: true } });
  const head = await tx.automationDefinitionVersion.findFirst({ where: { firmId, kind: 'CUSTOM_FIELDS', key: 'INVOICE' }, orderBy: { version: 'desc' } });
  const fields = customFieldDefinitionsSchema.parse(row.customFieldSchema);
  const definitionId = head && requestHash(mapInvoiceFieldConfiguration(head.definition)) === requestHash(fields) ? head.id : null;
  await tx.customFieldValueVersion.create({ data: { firmId, actorId, entity: 'INVOICE', entityId, version, definitionId, schemaSnapshot: fields, values: row.customFieldValues as Prisma.InputJsonValue } });
}
