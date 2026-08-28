import * as Crypto from "expo-crypto";
import { getDb } from "./database";
import type { Purchase, PurchaseItem, PurchaseStatus } from "../types";

export class InvalidPurchaseError extends Error {
  constructor(message: string) { super(message); }
}

export class InvalidPaymentError extends Error {
  constructor(message: string) { super(message); }
}

interface PurchaseRow {
  id:            number;
  supplier_id:   number;
  supplier_name: string;
  invoice_no:    string | null;
  subtotal:      number;
  total:         number;
  paid_amount:   number;
  status:        string;
  notes:         string | null;
  branch_id:     number | null;
  branch_name:   string | null;
  actor_name:    string | null;
  created_at:    string;
}

interface PurchaseItemRow {
  id:           number;
  purchase_id:  number;
  product_id:   number;
  product_name: string;
  qty:          number;
  unit_cost:    number;
  subtotal:     number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const statusFor = (total: number, paid: number): PurchaseStatus =>
  paid <= 0 ? "Unpaid" : paid >= total ? "Paid" : "Partial";

const toPurchaseItem = (r: PurchaseItemRow): PurchaseItem => ({
  id:          r.id,
  productId:   r.product_id,
  productName: r.product_name,
  qty:         r.qty,
  unitCost:    r.unit_cost,
  subtotal:    r.subtotal,
});

const toPurchase = (r: PurchaseRow, items: PurchaseItem[]): Purchase => ({
  id:           r.id,
  supplierId:   r.supplier_id,
  supplierName: r.supplier_name,
  invoiceNo:    r.invoice_no ?? undefined,
  subtotal:     r.subtotal,
  total:        r.total,
  paidAmount:   r.paid_amount,
  status:       r.status as PurchaseStatus,
  notes:        r.notes ?? undefined,
  branchId:     r.branch_id ?? undefined,
  branchName:   r.branch_name ?? undefined,
  actorName:    r.actor_name ?? undefined,
  createdAt:    r.created_at,
  items,
});

interface CreatePurchaseInput {
  supplierId:  number;
  invoiceNo?:  string;
  items:       { productId: number; productName: string; qty: number; unitCost: number }[];
  /** How much of the total was paid up front — clamped to [0, total]; the rest is left as the outstanding balance. */
  paidAmount:  number;
  notes?:      string;
  branchId:    number;
  actorName?:  string;
}

export const purchasesRepo = {
  // Stock increases and each product's cost_price (weighted-average across
  // all branches, since cost_price is catalog-wide) update immediately —
  // there's no separate "receive stock" step. Every line is also logged to
  // stock_movements with reason 'Purchase' so it shows in the Inventory
  // activity feed like every other stock change.
  create: async (input: CreatePurchaseInput): Promise<Purchase> => {
    if (input.items.length === 0) throw new InvalidPurchaseError("NO_ITEMS");
    for (const item of input.items) {
      if (item.qty <= 0 || item.unitCost < 0) throw new InvalidPurchaseError("INVALID_ITEM");
    }

    const db = await getDb();
    const subtotal = round2(input.items.reduce((s, i) => s + i.qty * i.unitCost, 0));
    const total = subtotal;
    const paidAmount = round2(Math.max(0, Math.min(input.paidAmount, total)));
    const status = statusFor(total, paidAmount);

    let purchaseId = 0;
    let createdAt = "";

    await db.withTransactionAsync(async () => {
      const supplier = await db.getFirstAsync<{ name: string }>(
        "SELECT name FROM suppliers WHERE id = ?", [input.supplierId]
      );
      if (!supplier) throw new InvalidPurchaseError("SUPPLIER_NOT_FOUND");
      const branch = await db.getFirstAsync<{ name: string }>(
        "SELECT name FROM branches WHERE id = ?", [input.branchId]
      );
      if (!branch) throw new InvalidPurchaseError("BRANCH_NOT_FOUND");

      createdAt = new Date().toISOString();
      const { lastInsertRowId } = await db.runAsync(
        `INSERT INTO purchases (supplier_id, supplier_name, invoice_no, subtotal, total, paid_amount, status, notes, branch_id, branch_name, actor_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [input.supplierId, supplier.name, input.invoiceNo ?? null, subtotal, total, paidAmount, status,
         input.notes ?? null, input.branchId, branch.name, input.actorName ?? null, createdAt]
      );
      purchaseId = lastInsertRowId;

      for (const item of input.items) {
        await db.runAsync(
          `INSERT INTO purchase_items (purchase_id, product_id, product_name, qty, unit_cost, subtotal)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [purchaseId, item.productId, item.productName, item.qty, item.unitCost, round2(item.qty * item.unitCost)]
        );

        // Weighted-average cost_price across this product's stock in every
        // branch, computed from totals *before* this purchase's stock lands.
        const totalStockRow = await db.getFirstAsync<{ total: number }>(
          "SELECT COALESCE(SUM(stock_qty), 0) as total FROM branch_stock WHERE product_id = ?", [item.productId]
        );
        const priorStock = totalStockRow?.total ?? 0;
        const productRow = await db.getFirstAsync<{ cost_price: number }>(
          "SELECT cost_price FROM products WHERE id = ?", [item.productId]
        );
        const priorCost = productRow?.cost_price ?? 0;
        const newCost = priorStock + item.qty > 0
          ? (priorCost * priorStock + item.unitCost * item.qty) / (priorStock + item.qty)
          : item.unitCost;
        await db.runAsync("UPDATE products SET cost_price = ? WHERE id = ?", [round2(newCost), item.productId]);

        const branchStockRow = await db.getFirstAsync<{ stock_qty: number }>(
          "SELECT stock_qty FROM branch_stock WHERE branch_id = ? AND product_id = ?",
          [input.branchId, item.productId]
        );
        const resultingQty = (branchStockRow?.stock_qty ?? 0) + item.qty;
        await db.runAsync(
          `INSERT INTO branch_stock (branch_id, product_id, stock_qty) VALUES (?, ?, ?)
           ON CONFLICT(branch_id, product_id) DO UPDATE SET stock_qty = excluded.stock_qty`,
          [input.branchId, item.productId, resultingQty]
        );

        await db.runAsync(
          `INSERT INTO stock_movements (product_id, product_name, change_qty, reason, resulting_stock_qty, branch_id, branch_name, actor_name, sync_uuid, created_at)
           VALUES (?, ?, ?, 'Purchase', ?, ?, ?, ?, ?, ?)`,
          [item.productId, item.productName, item.qty, resultingQty, input.branchId, branch.name, input.actorName ?? null, Crypto.randomUUID(), createdAt]
        );
      }

      if (paidAmount > 0) {
        await db.runAsync(
          "INSERT INTO supplier_payments (supplier_id, purchase_id, amount, actor_name, created_at) VALUES (?, ?, ?, ?, ?)",
          [input.supplierId, purchaseId, paidAmount, input.actorName ?? null, createdAt]
        );
      }
    });

    return (await purchasesRepo.getById(purchaseId))!;
  },

  // Applies a payment toward a purchase's outstanding balance — rejects
  // amounts <= 0 or that would overpay it.
  recordPayment: async (purchaseId: number, amount: number, actorName?: string, notes?: string): Promise<Purchase> => {
    if (amount <= 0) throw new InvalidPaymentError("INVALID_AMOUNT");
    const db = await getDb();

    await db.withTransactionAsync(async () => {
      const purchase = await db.getFirstAsync<{ supplier_id: number; total: number; paid_amount: number }>(
        "SELECT supplier_id, total, paid_amount FROM purchases WHERE id = ?", [purchaseId]
      );
      if (!purchase) throw new InvalidPaymentError("PURCHASE_NOT_FOUND");
      const remaining = round2(purchase.total - purchase.paid_amount);
      if (amount > remaining + 0.01) throw new InvalidPaymentError("EXCEEDS_BALANCE");

      const newPaid = round2(Math.min(purchase.total, purchase.paid_amount + amount));
      await db.runAsync(
        "UPDATE purchases SET paid_amount = ?, status = ? WHERE id = ?",
        [newPaid, statusFor(purchase.total, newPaid), purchaseId]
      );
      await db.runAsync(
        "INSERT INTO supplier_payments (supplier_id, purchase_id, amount, notes, actor_name) VALUES (?, ?, ?, ?, ?)",
        [purchase.supplier_id, purchaseId, amount, notes ?? null, actorName ?? null]
      );
    });

    return (await purchasesRepo.getById(purchaseId))!;
  },

  getById: async (id: number): Promise<Purchase | null> => {
    const db = await getDb();
    const row = await db.getFirstAsync<PurchaseRow>("SELECT * FROM purchases WHERE id = ?", [id]);
    if (!row) return null;
    const items = await db.getAllAsync<PurchaseItemRow>(
      "SELECT * FROM purchase_items WHERE purchase_id = ?", [id]
    );
    return toPurchase(row, items.map(toPurchaseItem));
  },

  // Header rows only (no items) — used for list/history views where the
  // full line-item breakdown isn't shown until a purchase is opened.
  getRecent: async (limit = 30, branchId?: number): Promise<Purchase[]> => {
    const db = await getDb();
    const branchClause = branchId != null ? " WHERE branch_id = ?" : "";
    const branchParams = branchId != null ? [branchId] : [];
    const rows = await db.getAllAsync<PurchaseRow>(
      `SELECT * FROM purchases${branchClause} ORDER BY created_at DESC, id DESC LIMIT ?`,
      [...branchParams, limit]
    );
    return rows.map(r => toPurchase(r, []));
  },

  getBySupplier: async (supplierId: number, limit = 50): Promise<Purchase[]> => {
    const db = await getDb();
    const rows = await db.getAllAsync<PurchaseRow>(
      "SELECT * FROM purchases WHERE supplier_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
      [supplierId, limit]
    );
    return rows.map(r => toPurchase(r, []));
  },
};
