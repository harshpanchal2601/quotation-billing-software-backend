import { AuditAction, ItemSourceType, Prisma, type Item, type PrismaClient } from '@prisma/client';

import { AppError } from '../../core/errors/AppError.js';
import { createAuditLog, type RequestMetadata } from '../../core/audit/audit-log.service.js';
import { prisma } from '../../core/database/prisma.js';
import { formatItemCode, findLatestItemCodeSequence } from './code/item-code.js';
import { removeStoredItemImage, toItemRelativePath } from './images/item-image.policy.js';
import {
  serialiseItemDetail,
  serialiseItemListItem,
  serialiseItemOption,
} from './items.serializer.js';
import type {
  ItemCreateInput,
  ItemListQuery,
  ItemOptionsQuery,
  ItemUpdateInput,
} from './items.schema.js';
import { createPaginationMetadata, type ItemWithRelations } from './items.types.js';

const UNCATEGORISED_SLUG = 'uncategorised';
const MAX_ITEM_CODE_RETRIES = 5;

const itemDetailInclude = {
  category: true,
  measurementUnit: true,
  _count: {
    select: {
      quotationItems: true,
    },
  },
} satisfies Prisma.ItemInclude;

export class ItemsRepository {
  constructor(private readonly db: PrismaClient) {}

  async listItems(query: ItemListQuery) {
    const where: Prisma.ItemWhereInput = {
      deletedAt: null,
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
      ...(query.categoryId === undefined ? {} : { categoryId: query.categoryId }),
      ...(query.measurementUnitId === undefined ? {} : { measurementUnitId: query.measurementUnitId }),
      ...(query.sourceType === undefined ? {} : { sourceType: query.sourceType }),
      ...(query.minRate !== undefined || query.maxRate !== undefined
        ? {
            defaultRate: {
              ...(query.minRate !== undefined ? { gte: new Prisma.Decimal(query.minRate) } : {}),
              ...(query.maxRate !== undefined ? { lte: new Prisma.Decimal(query.maxRate) } : {}),
            },
          }
        : {}),
      ...(query.search === undefined ? {} : createItemSearchFilter(query.search)),
    };

    const [items, total] = await this.db.$transaction([
      this.db.item.findMany({
        where,
        orderBy: { [query.sortBy]: query.sortOrder },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: itemDetailInclude,
      }),
      this.db.item.count({ where }),
    ]);

    return {
      items: items.map(serialiseItemListItem),
      pagination: createPaginationMetadata(query.page, query.limit, total),
    };
  }

  async getItemOptions(query: ItemOptionsQuery) {
    const where: Prisma.ItemWhereInput = {
      deletedAt: null,
      isActive: true,
      category: {
        deletedAt: null,
        isActive: true,
      },
      measurementUnit: {
        deletedAt: null,
        isActive: true,
      },
      ...(query.categoryId === undefined ? {} : { categoryId: query.categoryId }),
      ...(query.search === undefined
        ? {}
        : {
            OR: [
              { itemCode: { contains: query.search } },
              { name: { contains: query.search } },
            ],
          }),
    };

    const items = await this.db.item.findMany({
      where,
      orderBy: { name: 'asc' },
      take: query.limit,
      include: itemDetailInclude,
    });

    return {
      items: items.map(serialiseItemOption),
    };
  }

  async createItem(input: ItemCreateInput, metadata: RequestMetadata) {
    const categoryId = await this.resolveAndValidateCategory(input.categoryId);
    await this.validateMeasurementUnit(input.measurementUnitId);

    const itemCode = await this.generateUniqueItemCodeWithRetry();

    const item = await this.db.item.create({
      data: {
        itemCode,
        categoryId,
        name: input.name,
        shortDescription: input.shortDescription ?? null,
        detailedDescription: input.detailedDescription ?? null,
        specifications: input.specifications as unknown as Prisma.InputJsonValue,
        measurementUnitId: input.measurementUnitId,
        defaultRate: new Prisma.Decimal(input.defaultRate ?? '0.00'),
        hsnCode: input.hsnCode ?? null,
        gstRate: new Prisma.Decimal(input.gstRate ?? '18.00'),
        sourceType: ItemSourceType.MANUAL,
        sourceUrl: null,
        sourceExternalId: null,
        isActive: input.isActive ?? true,
        createdById: metadata.userId ?? null,
        updatedById: metadata.userId ?? null,
      },
      include: itemDetailInclude,
    });

    await this.auditItem(AuditAction.CREATE, item, metadata);
    return serialiseItemDetail(item);
  }

  async getItem(id: number) {
    const item = await this.getExistingItemRecord(id);
    return serialiseItemDetail(item);
  }

  async updateItem(id: number, input: ItemUpdateInput, metadata: RequestMetadata) {
    const existing = await this.getExistingItemRecord(id);

    let targetCategoryId = existing.categoryId;
    if (input.categoryId !== undefined) {
      targetCategoryId = await this.resolveAndValidateCategory(input.categoryId);
    }

    if (input.measurementUnitId !== undefined && input.measurementUnitId !== existing.measurementUnitId) {
      await this.validateMeasurementUnit(input.measurementUnitId);
    }

    const updateData: Prisma.ItemUpdateInput = {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.categoryId === undefined ? {} : { category: { connect: { id: targetCategoryId ?? undefined } } }),
      ...(input.shortDescription === undefined ? {} : { shortDescription: input.shortDescription ?? null }),
      ...(input.detailedDescription === undefined ? {} : { detailedDescription: input.detailedDescription ?? null }),
      ...(input.specifications === undefined ? {} : { specifications: input.specifications as unknown as Prisma.InputJsonValue }),
      ...(input.measurementUnitId === undefined ? {} : { measurementUnit: { connect: { id: input.measurementUnitId } } }),
      ...(input.defaultRate === undefined ? {} : { defaultRate: new Prisma.Decimal(input.defaultRate) }),
      ...(input.hsnCode === undefined ? {} : { hsnCode: input.hsnCode ?? null }),
      ...(input.gstRate === undefined ? {} : { gstRate: new Prisma.Decimal(input.gstRate) }),
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      updatedBy: metadata.userId ? { connect: { id: metadata.userId } } : undefined,
    };

    const updated = await this.db.item.update({
      where: { id },
      data: updateData,
      include: itemDetailInclude,
    });

    await this.auditItem(AuditAction.UPDATE, updated, metadata, existing);
    return serialiseItemDetail(updated);
  }

  async updateItemStatus(id: number, isActive: boolean, metadata: RequestMetadata) {
    const existing = await this.getExistingItemRecord(id);

    if (existing.isActive === isActive) {
      return serialiseItemDetail(existing);
    }

    if (isActive) {
      if (!existing.measurementUnit || existing.measurementUnit.deletedAt !== null || !existing.measurementUnit.isActive) {
        throw new AppError('Item cannot be activated because its measurement unit is inactive or unavailable.', 409);
      }
      if (existing.category && (existing.category.deletedAt !== null || !existing.category.isActive)) {
        throw new AppError('Item cannot be activated because its category is inactive or unavailable.', 409);
      }
    }

    const updated = await this.db.item.update({
      where: { id },
      data: {
        isActive,
        updatedById: metadata.userId ?? null,
      },
      include: itemDetailInclude,
    });

    await this.auditItem(AuditAction.STATUS_CHANGE, updated, metadata, existing);
    return serialiseItemDetail(updated);
  }

  async deleteItem(id: number, metadata: RequestMetadata) {
    const existing = await this.getExistingItemRecord(id);

    await this.db.item.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        isActive: false,
        updatedById: metadata.userId ?? null,
      },
    });

    await this.auditItem(AuditAction.DELETE, existing, metadata);
  }

  async restoreItem(id: number, metadata: RequestMetadata) {
    const existing = await this.db.item.findFirst({
      where: { id, deletedAt: { not: null } },
      include: itemDetailInclude,
    });

    if (existing === null) {
      throw new AppError('Item not found', 404);
    }

    if (!existing.measurementUnit || existing.measurementUnit.deletedAt !== null) {
      throw new AppError('Cannot restore item because its measurement unit is deleted.', 409);
    }

    if (existing.category && existing.category.deletedAt !== null) {
      throw new AppError('Cannot restore item because its category is deleted.', 409);
    }

    const categoryIsActive = existing.category ? existing.category.isActive : true;
    const unitIsActive = existing.measurementUnit.isActive;
    const targetIsActive = categoryIsActive && unitIsActive;

    const restored = await this.db.item.update({
      where: { id },
      data: {
        deletedAt: null,
        isActive: targetIsActive,
        updatedById: metadata.userId ?? null,
      },
      include: itemDetailInclude,
    });

    await this.auditItem(AuditAction.RESTORE, restored, metadata, existing);
    return serialiseItemDetail(restored);
  }

  async uploadItemImage(id: number, file: Express.Multer.File, metadata: RequestMetadata) {
    const existing = await this.db.item.findFirst({
      where: { id, deletedAt: null },
      include: itemDetailInclude,
    });

    if (existing === null) {
      await removeStoredItemImage(toItemRelativePath(file.filename));
      throw new AppError('Item not found', 404);
    }

    const newRelativePath = toItemRelativePath(file.filename);
    const oldRelativePath = existing.imagePath;

    try {
      const updated = await this.db.item.update({
        where: { id },
        data: {
          imagePath: newRelativePath,
          updatedById: metadata.userId ?? null,
        },
        include: itemDetailInclude,
      });

      if (oldRelativePath) {
        await removeStoredItemImage(oldRelativePath);
      }

      await createAuditLog(this.db, {
        metadata,
        entityType: 'Item',
        entityId: String(id),
        action: AuditAction.UPDATE,
        newValues: { imageChanged: true, imagePath: newRelativePath },
      });

      return serialiseItemDetail(updated);
    } catch (error) {
      await removeStoredItemImage(newRelativePath);
      throw error;
    }
  }

  async deleteItemImage(id: number, metadata: RequestMetadata) {
    const existing = await this.getExistingItemRecord(id);

    if (existing.imagePath === null) {
      return serialiseItemDetail(existing);
    }

    const oldRelativePath = existing.imagePath;

    const updated = await this.db.item.update({
      where: { id },
      data: {
        imagePath: null,
        updatedById: metadata.userId ?? null,
      },
      include: itemDetailInclude,
    });

    await removeStoredItemImage(oldRelativePath);

    await createAuditLog(this.db, {
      metadata,
      entityType: 'Item',
      entityId: String(id),
      action: AuditAction.UPDATE,
      oldValues: { imagePath: oldRelativePath },
      newValues: { imagePath: null },
    });

    return serialiseItemDetail(updated);
  }

  private async generateNextItemCode(db: PrismaClient | Prisma.TransactionClient): Promise<string> {
    const latestItem = await db.item.findFirst({
      select: { itemCode: true },
      orderBy: { id: 'desc' },
    });

    let maxNum = 0;

    if (latestItem !== null) {
      const sequence = parseItemCodeFromMatch(latestItem.itemCode);
      if (sequence !== null) {
        maxNum = sequence;
      }
    }

    const recentItems = await db.item.findMany({
      select: { itemCode: true },
      take: 1000,
      orderBy: { id: 'desc' },
    });

    maxNum = Math.max(maxNum, findLatestItemCodeSequence(recentItems));

    return formatItemCode(maxNum + 1);
  }

  private async generateUniqueItemCodeWithRetry(): Promise<string> {
    let currentNum: number | null = null;

    for (let attempt = 0; attempt < MAX_ITEM_CODE_RETRIES; attempt += 1) {
      let candidate: string;

      if (currentNum === null) {
        candidate = await this.generateNextItemCode(this.db);
        currentNum = parseItemCodeFromMatch(candidate) ?? 1;
      } else {
        currentNum += 1;
        candidate = formatItemCode(currentNum);
      }

      const existing = await this.db.item.findFirst({
        where: { itemCode: candidate },
        select: { id: true },
      });

      if (!existing) {
        return candidate;
      }
    }

    throw new AppError('Unable to generate a unique item code due to high concurrency. Please retry.', 409);
  }

  private async getExistingItemRecord(id: number): Promise<ItemWithRelations> {
    const item = await this.db.item.findFirst({
      where: { id, deletedAt: null },
      include: itemDetailInclude,
    });

    if (item === null) {
      throw new AppError('Item not found', 404);
    }

    return item;
  }

  private async resolveAndValidateCategory(categoryId?: number): Promise<number> {
    if (categoryId !== undefined) {
      const category = await this.db.itemCategory.findFirst({
        where: { id: categoryId, deletedAt: null },
      });

      if (category === null || !category.isActive) {
        throw new AppError('Category is inactive or unavailable.', 409);
      }

      return category.id;
    }

    const defaultCategory = await this.db.itemCategory.findFirst({
      where: { slug: UNCATEGORISED_SLUG, deletedAt: null },
    });

    if (defaultCategory === null || !defaultCategory.isActive) {
      throw new AppError('Protected uncategorised category is unavailable or inactive.', 409);
    }

    return defaultCategory.id;
  }

  private async validateMeasurementUnit(measurementUnitId: number): Promise<void> {
    const unit = await this.db.measurementUnit.findFirst({
      where: { id: measurementUnitId, deletedAt: null },
    });

    if (unit === null || !unit.isActive) {
      throw new AppError('Measurement unit is inactive or unavailable.', 409);
    }
  }

  private async auditItem(
    action: AuditAction,
    item: Item,
    metadata: RequestMetadata,
    previous?: Item,
  ) {
    const newSummary: Record<string, unknown> = {
      itemCode: item.itemCode,
      name: item.name,
      categoryId: item.categoryId,
      measurementUnitId: item.measurementUnitId,
      defaultRate: item.defaultRate.toString(),
      gstRate: item.gstRate.toString(),
      isActive: item.isActive,
    };

    let oldSummary: Record<string, unknown> | undefined;
    if (previous) {
      oldSummary = {
        itemCode: previous.itemCode,
        name: previous.name,
        categoryId: previous.categoryId,
        measurementUnitId: previous.measurementUnitId,
        defaultRate: previous.defaultRate.toString(),
        gstRate: previous.gstRate.toString(),
        isActive: previous.isActive,
      };
    }

    await createAuditLog(this.db, {
      metadata,
      entityType: 'Item',
      entityId: String(item.id),
      action,
      oldValues: oldSummary as Prisma.InputJsonObject | undefined,
      newValues: newSummary as Prisma.InputJsonObject,
    });
  }
}

function parseItemCodeFromMatch(itemCode: string) {
  const match = /^ITEM-(\d+)$/.exec(itemCode);
  if (match === null || !match[1]) return null;
  return Number.parseInt(match[1], 10);
}

function createItemSearchFilter(search: string): Prisma.ItemWhereInput {
  return {
    OR: [
      { itemCode: { contains: search } },
      { name: { contains: search } },
      { shortDescription: { contains: search } },
      { detailedDescription: { contains: search } },
      { hsnCode: { contains: search } },
      { category: { name: { contains: search } } },
      { measurementUnit: { name: { contains: search } } },
      { measurementUnit: { symbol: { contains: search } } },
    ],
  };
}

export const itemsRepository = new ItemsRepository(prisma);
