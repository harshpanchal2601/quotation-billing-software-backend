import bcrypt from 'bcrypt';
import {
  AccountType,
  AuditAction,
  Prisma,
  UserRole,
  UserStatus,
  type FirmRole,
  type PrismaClient,
} from '@prisma/client';

import { env } from '../../config/env.js';
import { createAuditLog, pickChangedFields, type RequestMetadata } from '../../core/audit/audit-log.service.js';
import { prisma } from '../../core/database/prisma.js';
import { AppError } from '../../core/errors/AppError.js';
import type {
  FirmUserCreateInput,
  FirmUserUpdateInput,
  RoleCreateInput,
  RoleUpdateInput,
} from './administration.schema.js';

const userListSelect = {
  id: true,
  name: true,
  email: true,
  username: true,
  accountType: true,
  status: true,
  mustChangePassword: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  firmRole: { select: { id: true, name: true } },
} satisfies Prisma.UserSelect;

export class AdministrationRepository {
  constructor(private readonly db: PrismaClient) {}

  listRoles(firmId: number) {
    return this.db.firmRole.findMany({
      where: { firmId, deletedAt: null },
      include: { _count: { select: { users: { where: { deletedAt: null } } } } },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  }

  async createRole(firmId: number, input: RoleCreateInput, metadata: RequestMetadata) {
    const existing = await this.db.firmRole.findFirst({ where: { firmId, name: input.name } });
    if (existing?.deletedAt === null) throw new AppError('Role name already exists', 409);

    const role = existing === null
      ? await this.db.firmRole.create({
          data: { firmId, name: input.name, description: input.description, permissions: input.permissions },
        })
      : await this.db.firmRole.update({
          where: { id: existing.id },
          data: {
            description: input.description,
            permissions: input.permissions,
            deletedAt: null,
          },
        });

    await this.auditRole(role, AuditAction.CREATE, metadata);
    return role;
  }

  async updateRole(firmId: number, id: number, input: RoleUpdateInput, metadata: RequestMetadata) {
    const existing = await this.findRole(firmId, id);
    if (existing.isSystem) throw new AppError('System roles cannot be modified', 409);
    if (input.name !== undefined && input.name !== existing.name) {
      const conflict = await this.db.firmRole.findFirst({
        where: { firmId, name: input.name, deletedAt: null, NOT: { id } },
      });
      if (conflict !== null) throw new AppError('Role name already exists', 409);
    }

    const updated = await this.db.$transaction(async (tx) => {
      const role = await tx.firmRole.update({
        where: { id },
        data: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.description === undefined ? {} : { description: input.description }),
          ...(input.permissions === undefined ? {} : { permissions: input.permissions }),
        },
      });
      if (input.permissions !== undefined) {
        await tx.authSession.updateMany({
          where: { user: { firmId, firmRoleId: id }, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      return role;
    });
    const changes = pickChangedFields(existing, updated, ['name', 'description', 'permissions']);
    await this.auditRole(updated, AuditAction.UPDATE, metadata, changes);
    return updated;
  }

  async deleteRole(firmId: number, id: number, metadata: RequestMetadata) {
    const existing = await this.findRole(firmId, id);
    if (existing.isSystem) throw new AppError('System roles cannot be deleted', 409);
    const assignedUsers = await this.db.user.count({ where: { firmId, firmRoleId: id, deletedAt: null } });
    if (assignedUsers > 0) throw new AppError('Role cannot be deleted while users are assigned to it', 409);
    await this.db.firmRole.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.auditRole(existing, AuditAction.DELETE, metadata);
  }

  async listUsers(firmId: number) {
    const firm = await this.db.firm.findFirst({ where: { id: firmId, deletedAt: null } });
    if (firm === null) throw new AppError('Firm not found', 404);
    const users = await this.db.user.findMany({
      where: { firmId, deletedAt: null },
      select: userListSelect,
      orderBy: [{ accountType: 'asc' }, { createdAt: 'asc' }],
    });
    return { users, userLimit: firm.userLimit, userCount: users.length };
  }

  async createUser(firmId: number, input: FirmUserCreateInput, metadata: RequestMetadata) {
    const passwordHash = await bcrypt.hash(input.temporaryPassword, env.BCRYPT_SALT_ROUNDS);

    let userId: number;
    try {
      userId = await this.db.$transaction(
        async (tx) => {
          const firm = await tx.firm.findFirst({ where: { id: firmId, deletedAt: null } });
          if (firm === null) throw new AppError('Firm not found', 404);
          const userCount = await tx.user.count({ where: { firmId, deletedAt: null } });
          if (userCount >= firm.userLimit) {
            throw new AppError(`Firm user limit of ${firm.userLimit} has been reached`, 409);
          }
          await this.assertRole(tx, firmId, input.roleId);
          const user = await tx.user.create({
            data: {
              firmId,
              firmRoleId: input.roleId,
              name: input.name,
              email: input.email,
              username: input.username,
              passwordHash,
              role: UserRole.ADMIN,
              accountType: AccountType.FIRM_USER,
              status: UserStatus.ACTIVE,
              mustChangePassword: true,
            },
          });
          return user.id;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (isUniqueConflict(error)) throw new AppError('Email or username already exists', 409);
      if (isWriteConflict(error)) throw new AppError('User could not be created due to a concurrent change. Please retry.', 409);
      throw error;
    }

    await createAuditLog(this.db, {
      metadata,
      entityType: 'User',
      entityId: String(userId),
      action: AuditAction.CREATE,
      newValues: { name: input.name, email: input.email, username: input.username, roleId: input.roleId },
    });
    return this.findUser(firmId, userId);
  }

  async updateUser(firmId: number, id: number, input: FirmUserUpdateInput, metadata: RequestMetadata) {
    const existing = await this.findUser(firmId, id);
    if (input.roleId !== undefined) await this.assertRole(this.db, firmId, input.roleId);

    let updated;
    try {
      updated = await this.db.$transaction(async (tx) => {
        const user = await tx.user.update({
          where: { id },
          data: {
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.email === undefined ? {} : { email: input.email }),
            ...(input.username === undefined ? {} : { username: input.username }),
            ...(input.roleId === undefined ? {} : { firmRoleId: input.roleId }),
            ...(input.status === undefined ? {} : { status: input.status }),
          },
          select: userListSelect,
        });
        if (
          (input.roleId !== undefined && input.roleId !== existing.firmRole?.id) ||
          (input.status !== undefined && input.status !== existing.status)
        ) {
          await tx.authSession.updateMany({
            where: { userId: id, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        }
        return user;
      });
    } catch (error) {
      if (isUniqueConflict(error)) throw new AppError('Email or username already exists', 409);
      throw error;
    }

    const changes = pickChangedFields(existing, updated, ['name', 'email', 'username', 'status']);
    await createAuditLog(this.db, {
      metadata,
      entityType: 'User',
      entityId: String(id),
      action: input.status === undefined ? AuditAction.UPDATE : AuditAction.STATUS_CHANGE,
      ...changes,
    });
    return updated;
  }

  async resetUserPassword(firmId: number, id: number, temporaryPassword: string, metadata: RequestMetadata) {
    await this.findUser(firmId, id);
    const passwordHash = await bcrypt.hash(temporaryPassword, env.BCRYPT_SALT_ROUNDS);
    await this.db.$transaction([
      this.db.user.update({ where: { id }, data: { passwordHash, mustChangePassword: true, passwordChangedAt: new Date() } }),
      this.db.authSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await createAuditLog(this.db, {
      metadata,
      entityType: 'User',
      entityId: String(id),
      action: AuditAction.PASSWORD_CHANGE,
      newValues: { passwordResetByAdministrator: true },
    });
  }

  async deleteUser(firmId: number, id: number, metadata: RequestMetadata) {
    const existing = await this.findUser(firmId, id);
    await this.db.$transaction([
      this.db.user.update({
        where: { id },
        data: { deletedAt: new Date(), status: UserStatus.INACTIVE },
      }),
      this.db.authSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await createAuditLog(this.db, {
      metadata,
      entityType: 'User',
      entityId: String(id),
      action: AuditAction.DELETE,
      oldValues: { name: existing.name, email: existing.email, username: existing.username },
    });
  }

  private async findRole(firmId: number, id: number) {
    const role = await this.db.firmRole.findFirst({ where: { id, firmId, deletedAt: null } });
    if (role === null) throw new AppError('Role not found', 404);
    return role;
  }

  private async findUser(firmId: number, id: number) {
    const user = await this.db.user.findFirst({
      where: { id, firmId, accountType: AccountType.FIRM_USER, deletedAt: null },
      select: userListSelect,
    });
    if (user === null) throw new AppError('Firm user not found', 404);
    return user;
  }

  private async assertRole(db: PrismaClient | Prisma.TransactionClient, firmId: number, roleId: number) {
    const role = await db.firmRole.findFirst({ where: { id: roleId, firmId, deletedAt: null } });
    if (role === null) throw new AppError('Role not found', 404);
  }

  private auditRole(
    role: FirmRole,
    action: AuditAction,
    metadata: RequestMetadata,
    changes?: { oldValues: Prisma.InputJsonObject; newValues: Prisma.InputJsonObject },
  ) {
    return createAuditLog(this.db, {
      metadata,
      entityType: 'FirmRole',
      entityId: String(role.id),
      action,
      ...(changes ?? { newValues: { name: role.name, permissions: role.permissions } as Prisma.InputJsonObject }),
    });
  }
}

function isUniqueConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function isWriteConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
}

export const administrationRepository = new AdministrationRepository(prisma);
