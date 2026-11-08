import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '../../core/database/prisma.js';
import { AppError } from '../../core/errors/AppError.js';
import { withFirmEntitlementTransaction } from '../entitlements/index.js';
import { auditAutomation, automationAccess, entityAccess, latestDefinition, ownedAutomationEntity } from './automation.persistence.js';
import { customFieldsSchema, customValuesSchema, validateFieldValues } from './automation.schema.js';

type Entity = 'COMPANY' | 'ITEM' | 'QUOTATION';
export class CustomFieldsRepository {
  constructor(readonly db: PrismaClient) {}
  async read(firmId: number, actorId: number, entity: Entity, entityId: number, page = 1) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await automationAccess(tx, firmId, actorId);
      await entityAccess(tx, firmId, actorId, entity);
      await ownedAutomationEntity(tx, firmId, entity, entityId);
      const definition = await latestDefinition(tx, firmId, 'CUSTOM_FIELDS', entity);
      const current = await tx.customFieldValueVersion.findFirst({ where: { firmId, entity, entityId }, orderBy: { version: 'desc' }, include: { definition: true } });
      const history = await tx.customFieldValueVersion.findMany({ where: { firmId, entity, entityId }, orderBy: { version: 'desc' }, include: { definition: true }, take: 50, skip: (page - 1) * 50 });
      const writable = entity !== 'QUOTATION' || await tx.quotation.count({ where: { id: entityId, firmId, status: 'DRAFT', isLatestRevision: true, automationPresentationSnapshot: { equals: Prisma.DbNull } } }) === 1;
      return { definition, current, history, writable };
    });
  }
  async write(firmId: number, actorId: number, entity: Entity, entityId: number, expectedVersion: number, definitionId: number, input: unknown) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await automationAccess(tx, firmId, actorId);
      await entityAccess(tx, firmId, actorId, entity, true);
      await ownedAutomationEntity(tx, firmId, entity, entityId);
      if (entity === 'QUOTATION' && !await tx.quotation.findFirst({ where: { id: entityId, firmId, status: 'DRAFT', isLatestRevision: true, automationPresentationSnapshot: { equals: Prisma.DbNull } } })) throw new AppError('Only an unrendered current draft can change additional fields', 409);
      const definition = await latestDefinition(tx, firmId, 'CUSTOM_FIELDS', entity);
      if (!definition || definition.id !== definitionId) throw new AppError('Field definitions changed; reload', 409);
      const config = customFieldsSchema.parse(definition.definition);
      if (!config.enabled) throw new AppError('Additional fields are disabled', 403);
      const previous = await tx.customFieldValueVersion.findFirst({ where: { firmId, entity, entityId }, orderBy: { version: 'desc' } });
      if ((previous?.version ?? 0) !== expectedVersion) throw new AppError('Field values changed; reload', 409);
      const values = validateFieldValues(config.fields, customValuesSchema.parse(input));
      const row = await tx.customFieldValueVersion.create({ data: { firmId, entity, entityId, actorId, definitionId, version: expectedVersion + 1, values } });
      await auditAutomation(tx, firmId, actorId, 'CustomFieldValueVersion', row.id, { entity, entityId, version: row.version, definitionId });
      return row;
    });
  }
  async search(firmId: number, actorId: number, entity: Entity, fieldKey: string, value: string) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await automationAccess(tx, firmId, actorId);
      await entityAccess(tx, firmId, actorId, entity);
      const head = await latestDefinition(tx, firmId, 'CUSTOM_FIELDS', entity);
      const config = head ? customFieldsSchema.parse(head.definition) : null;
      if (!config?.enabled || !config.fields.some((field) => field.key === fieldKey && field.searchable && field.visibility === 'INTERNAL')) throw new AppError('Searchable field not found', 404);
      const path = `$.${fieldKey}`;
      const matches = await tx.$queryRaw<Array<{ entityId: number }>>`
        SELECT v.entity_id AS entityId FROM custom_field_value_versions v
        WHERE v.firm_id = ${firmId} AND v.entity = ${entity} AND v.definition_id = ${head!.id}
          AND JSON_UNQUOTE(JSON_EXTRACT(v.\`values\`, ${path})) = ${value}
          AND NOT EXISTS (SELECT 1 FROM custom_field_value_versions newer
            WHERE newer.firm_id = v.firm_id AND newer.entity = v.entity AND newer.entity_id = v.entity_id AND newer.version > v.version)
        ORDER BY v.entity_id LIMIT 50`;
      const visible: number[] = [];
      for (const match of matches) {
        try { await ownedAutomationEntity(tx, firmId, entity, match.entityId); visible.push(match.entityId); }
        catch (error) { if (!(error instanceof AppError) || error.statusCode !== 404) throw error; }
      }
      return visible;
    });
  }
}
export const customFieldsRepository = new CustomFieldsRepository(prisma);
