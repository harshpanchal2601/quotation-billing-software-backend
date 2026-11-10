import { Prisma, type PrismaClient } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiKeysRepository } from '../src/modules/connections/api-keys.repository.js';
import { AppError } from '../src/core/errors/AppError.js';
const access = vi.hoisted(() => ({ actor: vi.fn(), feature: vi.fn() }));
vi.mock('../src/core/database/prisma.js', () => ({ prisma: {} }));
vi.mock('../src/modules/auth/index.js', () => ({ authorizeFirmJobActor: access.actor }));
vi.mock('../src/modules/entitlements/index.js', () => ({ assertTransactionFeature: access.feature, withFirmEntitlementTransaction: (db: PrismaClient, _firm: number, work: (tx: Prisma.TransactionClient) => Promise<unknown>) => db.$transaction(work) }));
const token = `bnx_${'a'.repeat(64)}`;
function fixture() {
  const tx = { apiKey: { findUnique: vi.fn(), findFirst: vi.fn(), count: vi.fn().mockResolvedValue(0), create: vi.fn(), update: vi.fn() }, auditLog: { create: vi.fn() } };
  const db = { $transaction: async (work: (client: typeof tx) => unknown) => work(tx) } as unknown as PrismaClient;
  return { tx, repository: new ApiKeysRepository(db) };
}
const key = () => ({ id: 'fixture-key', firmId: 1, actorId: 10, scopes: ['reports.read'], revokedAt: null, expiresAt: new Date(Date.now() + 100000) });
beforeEach(() => vi.resetAllMocks());
describe('Wave 10 scoped credential authorization', () => {
  it('rejects malformed, expired, revoked, missing and incorrectly scoped keys', async () => {
    const { tx, repository } = fixture();
    await expect(repository.authenticate('cookie-or-arbitrary-token', 'reports.read')).rejects.toMatchObject({ statusCode: 401 });
    for (const row of [null, { ...key(), revokedAt: new Date() }, { ...key(), expiresAt: new Date(0) }]) { tx.apiKey.findUnique.mockResolvedValueOnce(row); await expect(repository.authenticate(token, 'reports.read')).rejects.toMatchObject({ statusCode: 401 }); }
    tx.apiKey.findUnique.mockResolvedValueOnce(key());
    await expect(repository.authenticate(token, 'reports.export')).rejects.toMatchObject({ statusCode: 403 });
    expect(access.actor).not.toHaveBeenCalled();
  });
  it('loads the fixed tenant from the credential and checks current role and plan', async () => {
    const { tx, repository } = fixture(); tx.apiKey.findUnique.mockResolvedValue(key());
    await expect(repository.authenticate(token, 'reports.read')).resolves.toEqual({ id: 'fixture-key', firmId: 1, actorId: 10 });
    expect(access.actor).toHaveBeenCalledWith(tx, 1, 10, 'api-keys.manage');
    expect(access.actor).toHaveBeenCalledWith(tx, 1, 10, 'reports.view');
    expect(access.feature).toHaveBeenCalledWith(tx, 1, 'integrations.api');
    expect(access.feature).toHaveBeenCalledWith(tx, 1, 'reports');
    access.feature.mockRejectedValueOnce(new AppError('Hard disabled', 403));
    await expect(repository.authenticate(token, 'reports.read')).rejects.toMatchObject({ statusCode: 403 });
  });
  it('does not revoke a foreign credential or issue a replacement after authorization denial', async () => {
    const { tx, repository } = fixture(); tx.apiKey.findFirst.mockResolvedValue(null);
    await expect(repository.revoke(1, 10, 'foreign-key', {})).rejects.toMatchObject({ statusCode: 404 });
    expect(tx.apiKey.findFirst).toHaveBeenCalledWith({ where: { id: 'foreign-key', firmId: 1, actorId: 10 } });
    expect(tx.apiKey.update).not.toHaveBeenCalled();
    access.actor.mockRejectedValueOnce(new AppError('Revoked role', 403));
    await expect(repository.create(1, 10, { name: 'Test', lifetimeDays: 1, scopes: ['reports.read'] }, {}, 'foreign-key')).rejects.toMatchObject({ statusCode: 403 });
    expect(tx.apiKey.create).not.toHaveBeenCalled();
  });
});
