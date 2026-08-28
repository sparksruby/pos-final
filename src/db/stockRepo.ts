import * as Crypto from "expo-crypto";
import { getDb } from "./database";
import type { StockMovement, StockMovementReason, StockTransfer } from "../types";

export class InvalidStockAdjustmentError extends Error {
  constructor(public available: number) { super(`INVALID_STOCK_ADJUSTMENT:${available}`); }
}

export class InvalidTransferError extends Error {
  constructor(message: string) { super(message); }
}

interface MovementRow {
  id:                   number;
  product_id:           number;
  product_name:         string;
  change_qty:           number;
  reason:               string;
  resulting_stock_qty:  number;
  branch_id:            number | null;
  branch_name:          string | null;
  actor_name:           string | null;
  created_at:           string;
}

interface TransferRow {
  id:               number;
  product_id:       number;
  product_name:     string;
  from_branch_id:   number;
  from_branch_name: string;
  to_branch_id:     number;
  to_branch_name:   string;
  qty:              number;
  actor_name:       string | null;
  notes:            string | null;
  created_at:       string;
}

const toMovement = (r: MovementRow): StockMovement => ({
  id:                r.id,
  productId:         r.product_id,
  productName:       r.product_name,
  changeQty:         r.change_qty,
  reason:            r.reason as StockMovementReason,
  resultingStockQty: r.resulting_stock_qty,
  branchId:          r.branch_id ?? undefined,
  branchName:        r.branch_name ?? undefined,
  actorName:         r.actor_name ?? undefined,
  createdAt:         r.created_at,
});

const toTransfer = (r: TransferRow): StockTransfer => ({
  id:             r.id,
  productId:      r.product_id,
  productName:    r.product_name,
  fromBranchId:   r.from_branch_id,
  fromBranchName: r.from_branch_name,
  toBranchId:     r.to_branch_id,
  toBranchName:   r.to_branch_name,
  qty:            r.qty,
  actorName:      r.actor_name ?? undefined,
  notes:          r.notes ?? undefined,
  createdAt:      r.created_at,
});

const getBranchStock = async (
  db: Awaited<ReturnType<typeof getDb>>, branchId: number, productId: number
): Promise<number> => {
  const row = await db.getFirstAsync<{ stock_qty: number }>(
    "SELECT stock_qty FROM branch_stock WHERE branch_id = ? AND product_id = ?", [branchId, productId]
  );
  return row?.stock_qty ?? 0;
};

const setBranchStock = async (
  db: Awaited<ReturnType<typeof getDb>>, branchId: number, productId: number, qty: number
) => {
  await db.runAsync(
    `INSERT INTO branch_stock (branch_id, product_id, stock_qty) VALUES (?, ?, ?)
     ON CONFLICT(branch_id, product_id) DO UPDATE SET stock_qty = excluded.stock_qty`,
    [branchId, productId, qty]
  );
};

export const stockRepo = {
  // changeQty is signed — positive to add stock, negative to remove — applied
  // to `productId`'s stock at `branchId` specifically.
  adjustStock: async (
    productId: number, branchId: number, changeQty: number, reason: StockMovementReason, actorName?: string
  ): Promise<StockMovement> => {
    const db = await getDb();
    let movement: StockMovement | null = null;

    await db.withTransactionAsync(async () => {
      const product = await db.getFirstAsync<{ name: string }>("SELECT name FROM products WHERE id = ?", [productId]);
      if (!product) throw new Error("PRODUCT_NOT_FOUND");
      const branch = await db.getFirstAsync<{ name: string }>("SELECT name FROM branches WHERE id = ?", [branchId]);
      if (!branch) throw new Error("BRANCH_NOT_FOUND");

      const current = await getBranchStock(db, branchId, productId);
      const resultingQty = current + changeQty;
      if (resultingQty < 0) throw new InvalidStockAdjustmentError(current);

      await setBranchStock(db, branchId, productId, resultingQty);

      const createdAt = new Date().toISOString();
      const { lastInsertRowId } = await db.runAsync(
        `INSERT INTO stock_movements (product_id, product_name, change_qty, reason, resulting_stock_qty, branch_id, branch_name, actor_name, sync_uuid, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [productId, product.name, changeQty, reason, resultingQty, branchId, branch.name, actorName ?? null, Crypto.randomUUID(), createdAt]
      );

      movement = {
        id: lastInsertRowId, productId, productName: product.name, changeQty, reason,
        resultingStockQty: resultingQty, branchId, branchName: branch.name, actorName, createdAt,
      };
    });

    return movement!;
  },

  // Moves stock from one branch to another for the same product — logged as
  // a linked pair of stock_movements ('Transfer Out' / 'Transfer In') plus
  // one stock_transfers row for the transfer history view.
  transferStock: async (
    productId: number, fromBranchId: number, toBranchId: number, qty: number, actorName?: string, notes?: string
  ): Promise<StockTransfer> => {
    if (fromBranchId === toBranchId) throw new InvalidTransferError("SAME_BRANCH");
    if (qty <= 0) throw new InvalidTransferError("INVALID_QTY");

    const db = await getDb();
    let transferId = 0;
    let createdAt = "";

    await db.withTransactionAsync(async () => {
      const product = await db.getFirstAsync<{ name: string }>("SELECT name FROM products WHERE id = ?", [productId]);
      if (!product) throw new InvalidTransferError("PRODUCT_NOT_FOUND");
      const fromBranch = await db.getFirstAsync<{ name: string }>("SELECT name FROM branches WHERE id = ?", [fromBranchId]);
      const toBranch = await db.getFirstAsync<{ name: string }>("SELECT name FROM branches WHERE id = ?", [toBranchId]);
      if (!fromBranch || !toBranch) throw new InvalidTransferError("BRANCH_NOT_FOUND");

      const fromStock = await getBranchStock(db, fromBranchId, productId);
      if (qty > fromStock) throw new InvalidStockAdjustmentError(fromStock);
      const toStock = await getBranchStock(db, toBranchId, productId);

      const fromResulting = fromStock - qty;
      const toResulting = toStock + qty;
      await setBranchStock(db, fromBranchId, productId, fromResulting);
      await setBranchStock(db, toBranchId, productId, toResulting);

      createdAt = new Date().toISOString();
      await db.runAsync(
        `INSERT INTO stock_movements (product_id, product_name, change_qty, reason, resulting_stock_qty, branch_id, branch_name, actor_name, sync_uuid, created_at)
         VALUES (?, ?, ?, 'Transfer Out', ?, ?, ?, ?, ?, ?)`,
        [productId, product.name, -qty, fromResulting, fromBranchId, fromBranch.name, actorName ?? null, Crypto.randomUUID(), createdAt]
      );
      await db.runAsync(
        `INSERT INTO stock_movements (product_id, product_name, change_qty, reason, resulting_stock_qty, branch_id, branch_name, actor_name, sync_uuid, created_at)
         VALUES (?, ?, ?, 'Transfer In', ?, ?, ?, ?, ?, ?)`,
        [productId, product.name, qty, toResulting, toBranchId, toBranch.name, actorName ?? null, Crypto.randomUUID(), createdAt]
      );

      const { lastInsertRowId } = await db.runAsync(
        `INSERT INTO stock_transfers (product_id, product_name, from_branch_id, from_branch_name, to_branch_id, to_branch_name, qty, actor_name, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [productId, product.name, fromBranchId, fromBranch.name, toBranchId, toBranch.name, qty, actorName ?? null, notes ?? null, createdAt]
      );
      transferId = lastInsertRowId;
    });

    const row = await db.getFirstAsync<TransferRow>("SELECT * FROM stock_transfers WHERE id = ?", [transferId]);
    return toTransfer(row!);
  },

  getRecentTransfers: async (limit = 30): Promise<StockTransfer[]> => {
    const db = await getDb();
    const rows = await db.getAllAsync<TransferRow>(
      "SELECT * FROM stock_transfers ORDER BY created_at DESC, id DESC LIMIT ?", [limit]
    );
    return rows.map(toTransfer);
  },

  // Most recent movements — optionally scoped to a branch and/or one product.
  getRecentMovements: async (opts?: { branchId?: number; productId?: number; limit?: number }): Promise<StockMovement[]> => {
    const db = await getDb();
    const limit = opts?.limit ?? 30;
    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (opts?.branchId)  { clauses.push("branch_id = ?");  params.push(opts.branchId); }
    if (opts?.productId) { clauses.push("product_id = ?"); params.push(opts.productId); }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    params.push(limit);

    const rows = await db.getAllAsync<MovementRow>(
      `SELECT * FROM stock_movements ${where} ORDER BY created_at DESC, id DESC LIMIT ?`, params
    );
    return rows.map(toMovement);
  },
};
