import { Prisma } from '@prisma/client';
import { authorizeFirmJobActor } from '../auth/index.js';
import { PERMISSIONS } from '../auth/permissions.js';
import { assertTransactionFeature } from '../entitlements/index.js';

export async function readStockValuation(tx: Prisma.TransactionClient, firmId: number, actorId: number, until: Date, currency?: string) {
  await authorizeFirmJobActor(tx, firmId, actorId, PERMISSIONS.INVENTORY_VIEW);
  await assertTransactionFeature(tx, firmId, 'inventory');
  // Sum immutable movements, never the mutable position cache or unlike item quantities.
  const rows = await tx.$queryRaw<Array<{ currency: string; value: Prisma.Decimal; positions: bigint }>>`
    SELECT p.currency, SUM(m.value) AS value, COUNT(DISTINCT p.id) AS positions
    FROM stock_movements m JOIN stock_positions p ON p.id = m.position_id AND p.firm_id = m.firm_id
    WHERE m.firm_id = ${firmId} AND p.firm_id = ${firmId} AND m.posted_at < ${until}
      ${currency ? Prisma.sql`AND p.currency = ${currency}` : Prisma.empty}
    GROUP BY p.currency ORDER BY p.currency`;
  return rows.map((row) => ({ currency: row.currency, value: row.value.toFixed(6), positions: String(row.positions) }));
}
