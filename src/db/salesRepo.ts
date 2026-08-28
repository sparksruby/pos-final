import * as Crypto from "expo-crypto";
import { getDb } from "./database";
import type { CartItem, SalePayment, SalePaymentMethod, Sale, SaleItem } from "../types";

export class InsufficientStockError extends Error {
  constructor(public productName: string, public available: number) {
    super(`INSUFFICIENT_STOCK:${productName}:${available}`);
  }
}

export class ExpiredProductError extends Error {
  constructor(public productName: string) {
    super(`EXPIRED_PRODUCT:${productName}`);
  }
}

export class InsufficientPointsError extends Error {
  constructor(public available: number) {
    super(`INSUFFICIENT_POINTS:${available}`);
  }
}

interface CheckoutInput {
  items:      CartItem[];
  /** Order-level discount (already resolved to a flat amount, whether the UI took it as % or a fixed number). */
  discount:   number;
  taxPercent: number;
  tendered:   number;
  method:     SalePaymentMethod;
  /** Required (and must sum to the payable total) when method is "Split". */
  payments?:    SalePayment[];
  cashierId?:   number;
  cashierName?: string;
  customerId?:      number;
  /** Loyalty points to redeem against this sale — validated against the customer's live balance. */
  pointsRedeemed?:  number;
  /** The currently-open shift, if any — attributes this sale to it for cash reconciliation. */
  shiftId?:         number;
  /** The branch this sale is rung against — its stock is what gets checked/decremented. */
  branchId:         number;
}

interface SaleRow {
  id:             number;
  subtotal:       number;
  discount:       number;
  tax_percent:    number;
  tax_amount:     number;
  total:          number;
  tendered:       number;
  change_due:     number;
  payment_method: string;
  cashier_name:   string | null;
  customer_id:      number | null;
  customer_name:    string | null;
  customer_phone:   string | null;
  points_earned:    number;
  points_redeemed:  number;
  branch_id:        number | null;
  branch_name:      string | null;
  created_at:     string;
}

interface SaleItemRow {
  id:           number;
  sale_id:      number;
  product_id:   number;
  product_name: string;
  unit_price:   number;
  unit:         string;
  qty:          number;
  subtotal:     number;
  discount:     number;
  refunded_qty: number;
}

interface SalePaymentRow {
  id:      number;
  sale_id: number;
  method:  string;
  amount:  number;
}

const toSaleItem = (r: SaleItemRow): SaleItem => ({
  id:          r.id,
  productId:   r.product_id,
  productName: r.product_name,
  unitPrice:   r.unit_price,
  unit:        r.unit,
  qty:         r.qty,
  subtotal:    r.subtotal,
  discount:    r.discount,
  refundedQty: r.refunded_qty,
});

const toSale = (r: SaleRow, items: SaleItem[], payments: SalePayment[], refundedAmount = 0): Sale => ({
  id:            r.id,
  subtotal:      r.subtotal,
  discount:      r.discount,
  taxPercent:    r.tax_percent,
  taxAmount:     r.tax_amount,
  total:         r.total,
  tendered:      r.tendered,
  changeDue:     r.change_due,
  paymentMethod: r.payment_method as SalePaymentMethod,
  payments:      payments.length > 0 ? payments : undefined,
  cashierName:   r.cashier_name ?? undefined,
  customerId:      r.customer_id ?? undefined,
  customerName:    r.customer_name ?? undefined,
  customerPhone:   r.customer_phone ?? undefined,
  pointsEarned:    r.points_earned,
  pointsRedeemed:  r.points_redeemed,
  refundedAmount:  refundedAmount > 0 ? refundedAmount : undefined,
  branchId:        r.branch_id ?? undefined,
  branchName:      r.branch_name ?? undefined,
  createdAt:     r.created_at,
  items,
});

export const salesRepo = {
  checkout: async (input: CheckoutInput): Promise<Sale> => {
    const db = await getDb();

    const subtotal          = input.items.reduce((s, i) => s + i.price * i.qty, 0);
    const itemDiscountTotal = input.items.reduce((s, i) => s + Math.max(0, i.discount ?? 0), 0);
    const orderDiscount     = Math.max(0, input.discount);
    const pointsRequested   = Math.max(0, Math.floor(input.pointsRedeemed ?? 0));

    let saleId = 0;
    let pointsEarned = 0;
    let pointsRedeemed = 0;
    let customerName: string | undefined;
    let customerPhone: string | undefined;
    let totalDiscount = 0, total = 0, taxAmount = 0, changeDue = 0;
    let createdAt = "";
    let branchName = "";

    await db.withTransactionAsync(async () => {
      const branch = await db.getFirstAsync<{ name: string }>(
        "SELECT name FROM branches WHERE id = ?", [input.branchId]
      );
      if (!branch) throw new Error("BRANCH_NOT_FOUND");
      branchName = branch.name;

      const today = new Date().toISOString().slice(0, 10);
      for (const item of input.items) {
        const product = await db.getFirstAsync<{ expiry_date: string | null }>(
          "SELECT expiry_date FROM products WHERE id = ?", [item.productId]
        );
        if (product?.expiry_date && product.expiry_date < today) {
          throw new ExpiredProductError(item.name);
        }

        const row = await db.getFirstAsync<{ stock_qty: number }>(
          "SELECT stock_qty FROM branch_stock WHERE branch_id = ? AND product_id = ?",
          [input.branchId, item.productId]
        );
        const available = row?.stock_qty ?? 0;
        if (available < item.qty) {
          throw new InsufficientStockError(item.name, available);
        }
      }

      // Loyalty settings and the customer's live points balance are read
      // fresh inside the transaction — the front-end preview uses the same
      // cached settings, so this matches as long as nothing else changed
      // them mid-checkout.
      const shopSettings = await db.getFirstAsync<{ loyalty_enabled: number; loyalty_earn_rate: number; loyalty_redeem_rate: number }>(
        "SELECT loyalty_enabled, loyalty_earn_rate, loyalty_redeem_rate FROM shop_settings WHERE id = 1"
      );
      const loyaltyEnabled = !!shopSettings?.loyalty_enabled;

      let redeemValue = 0;
      let customerPoints = 0;
      if (loyaltyEnabled && input.customerId) {
        const customer = await db.getFirstAsync<{ name: string; phone: string | null; loyalty_points: number }>(
          "SELECT name, phone, loyalty_points FROM customers WHERE id = ?", [input.customerId]
        );
        if (customer) {
          customerName = customer.name;
          customerPhone = customer.phone ?? undefined;
          customerPoints = customer.loyalty_points;
          if (pointsRequested > 0) {
            if (pointsRequested > customerPoints) {
              throw new InsufficientPointsError(customerPoints);
            }
            pointsRedeemed = pointsRequested;
            redeemValue = pointsRedeemed * (shopSettings?.loyalty_redeem_rate ?? 0);
          }
        }
      }

      totalDiscount = itemDiscountTotal + orderDiscount + redeemValue;
      const afterDiscount = Math.max(0, subtotal - totalDiscount);
      // Rounded the same way the Checkout screen previews it, so a Split
      // payment's entered amounts (which must sum to that preview) still add
      // up to what gets stored here.
      taxAmount = Math.round(afterDiscount * input.taxPercent / 100 * 100) / 100;
      total     = afterDiscount + taxAmount;
      changeDue = Math.max(0, input.tendered - total);

      if (input.method === "Split") {
        const paid = (input.payments ?? []).reduce((s, p) => s + p.amount, 0);
        if (Math.abs(paid - total) > 0.01) {
          throw new Error("SPLIT_PAYMENT_MISMATCH");
        }
      }

      if (loyaltyEnabled && input.customerId && customerName !== undefined) {
        pointsEarned = Math.floor(total * (shopSettings?.loyalty_earn_rate ?? 0));
        const newBalance = customerPoints - pointsRedeemed + pointsEarned;
        await db.runAsync("UPDATE customers SET loyalty_points = ? WHERE id = ?", [newBalance, input.customerId]);
      }

      createdAt = new Date().toISOString();
      const { lastInsertRowId } = await db.runAsync(
        `INSERT INTO sales
           (subtotal, discount, tax_percent, tax_amount, total, tendered, change_due, payment_method,
            cashier_id, cashier_name, customer_id, customer_name, customer_phone, points_earned, points_redeemed,
            shift_id, branch_id, branch_name, sync_uuid, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [subtotal, totalDiscount, input.taxPercent, taxAmount, total, input.tendered, changeDue,
         input.method, input.cashierId ?? null, input.cashierName ?? null,
         input.customerId ?? null, customerName ?? null, customerPhone ?? null,
         pointsEarned, pointsRedeemed, input.shiftId ?? null, input.branchId, branch.name, Crypto.randomUUID(), createdAt]
      );
      saleId = lastInsertRowId;

      if (input.method === "Split") {
        for (const p of input.payments ?? []) {
          if (p.amount <= 0) continue;
          await db.runAsync(
            "INSERT INTO sale_payments (sale_id, method, amount) VALUES (?, ?, ?)",
            [lastInsertRowId, p.method, p.amount]
          );
        }
      }

      for (const item of input.items) {
        const itemDiscount = Math.max(0, item.discount ?? 0);
        await db.runAsync(
          `INSERT INTO sale_items (sale_id, product_id, product_name, unit_price, unit, qty, subtotal, discount)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [lastInsertRowId, item.productId, item.name, item.price, item.unit, item.qty, item.price * item.qty, itemDiscount]
        );

        const beforeQty = await db.getFirstAsync<{ stock_qty: number }>(
          "SELECT stock_qty FROM branch_stock WHERE branch_id = ? AND product_id = ?",
          [input.branchId, item.productId]
        );
        const resultingQty = (beforeQty?.stock_qty ?? 0) - item.qty;
        await db.runAsync(
          `INSERT INTO branch_stock (branch_id, product_id, stock_qty) VALUES (?, ?, ?)
           ON CONFLICT(branch_id, product_id) DO UPDATE SET stock_qty = excluded.stock_qty`,
          [input.branchId, item.productId, resultingQty]
        );

        // Every stock change is logged here too, not just manual
        // adjustments, so the movement history is a complete audit trail.
        await db.runAsync(
          `INSERT INTO stock_movements (product_id, product_name, change_qty, reason, resulting_stock_qty, branch_id, branch_name, actor_name, sync_uuid, created_at)
           VALUES (?, ?, ?, 'Sale', ?, ?, ?, ?, ?, ?)`,
          [item.productId, item.name, -item.qty, resultingQty, input.branchId, branch.name, input.cashierName ?? null, Crypto.randomUUID(), createdAt]
        );
      }
    });

    const saleItems: SaleItem[] = input.items.map((item, idx) => ({
      id:          idx,
      productId:   item.productId,
      productName: item.name,
      unitPrice:   item.price,
      unit:        item.unit,
      qty:         item.qty,
      subtotal:    item.price * item.qty,
      discount:    Math.max(0, item.discount ?? 0),
      refundedQty: 0,
    }));

    const payments = input.method === "Split"
      ? (input.payments ?? []).filter(p => p.amount > 0)
      : undefined;

    return {
      id: saleId, subtotal, discount: totalDiscount, taxPercent: input.taxPercent,
      taxAmount, total, tendered: input.tendered, changeDue,
      paymentMethod: input.method, payments, cashierName: input.cashierName,
      customerId: input.customerId, customerName, customerPhone,
      pointsEarned, pointsRedeemed,
      branchId: input.branchId, branchName,
      createdAt, items: saleItems,
    };
  },

  // Recent purchases for a given customer, most recent first — used by the
  // customer detail screen. Not date-bounded like getSales() since a
  // customer's whole history is usually small.
  getSalesByCustomer: async (customerId: number, limit = 50): Promise<Sale[]> => {
    const db = await getDb();
    const saleRows = await db.getAllAsync<SaleRow>(
      "SELECT * FROM sales WHERE customer_id = ? ORDER BY created_at DESC LIMIT ?",
      [customerId, limit]
    );
    if (saleRows.length === 0) return [];

    const ids = saleRows.map(r => r.id);
    const placeholders = ids.map(() => "?").join(",");
    const [itemRows, refundTotals] = await Promise.all([
      db.getAllAsync<SaleItemRow>(`SELECT * FROM sale_items WHERE sale_id IN (${placeholders})`, ids),
      db.getAllAsync<{ sale_id: number; total: number }>(
        `SELECT sale_id, SUM(amount) as total FROM refunds WHERE sale_id IN (${placeholders}) GROUP BY sale_id`, ids
      ),
    ]);

    return saleRows.map(r => toSale(
      r,
      itemRows.filter(i => i.sale_id === r.id).map(toSaleItem),
      [],
      refundTotals.find(t => t.sale_id === r.id)?.total ?? 0
    ));
  },

  // fromISO/toISO are half-open — [fromISO, toISO) — against the same
  // Date#toISOString() format `created_at` is stored in, so plain string
  // comparison sorts correctly. branchId is optional — Reports wants every
  // branch by default (it has its own "All Branches"/per-branch filter
  // chips), Sales History wants only the current branch's own sales.
  getSales: async (fromISO: string, toISO: string, branchId?: number): Promise<Sale[]> => {
    const db = await getDb();
    const branchClause = branchId != null ? " AND branch_id = ?" : "";
    const branchParams = branchId != null ? [branchId] : [];
    const saleRows = await db.getAllAsync<SaleRow>(
      `SELECT * FROM sales WHERE created_at >= ? AND created_at < ?${branchClause} ORDER BY created_at DESC`,
      [fromISO, toISO, ...branchParams]
    );
    if (saleRows.length === 0) return [];

    const ids = saleRows.map(r => r.id);
    const placeholders = ids.map(() => "?").join(",");
    const [itemRows, paymentRows, refundTotals] = await Promise.all([
      db.getAllAsync<SaleItemRow>(
        `SELECT * FROM sale_items WHERE sale_id IN (${placeholders})`, ids
      ),
      db.getAllAsync<SalePaymentRow>(
        `SELECT * FROM sale_payments WHERE sale_id IN (${placeholders})`, ids
      ),
      db.getAllAsync<{ sale_id: number; total: number }>(
        `SELECT sale_id, SUM(amount) as total FROM refunds WHERE sale_id IN (${placeholders}) GROUP BY sale_id`, ids
      ),
    ]);

    return saleRows.map(r =>
      toSale(
        r,
        itemRows.filter(i => i.sale_id === r.id).map(toSaleItem),
        paymentRows.filter(p => p.sale_id === r.id).map(p => ({ method: p.method as any, amount: p.amount })),
        refundTotals.find(t => t.sale_id === r.id)?.total ?? 0
      )
    );
  },

  // Lightweight aggregate for the POS header's "today's sales" display — a
  // plain SUM/COUNT rather than routing through getSales(), which also
  // pulls every sale's items/payments just to get a total nobody asked for
  // here. Net of refunds, same as Reports' revenue figures (sale.total -
  // refundedAmount), so the two screens never disagree about what "today's
  // sales" means.
  getTodayTotal: async (branchId?: number): Promise<{ total: number; count: number }> => {
    const db = await getDb();
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const fromISO = start.toISOString();
    const branchClause = branchId != null ? " AND branch_id = ?" : "";
    const branchParams = branchId != null ? [branchId] : [];

    const salesRow = await db.getFirstAsync<{ gross: number | null; count: number }>(
      `SELECT COALESCE(SUM(total), 0) as gross, COUNT(*) as count FROM sales WHERE created_at >= ?${branchClause}`,
      [fromISO, ...branchParams]
    );
    const count = salesRow?.count ?? 0;
    if (count === 0) return { total: 0, count: 0 };

    const idRows = await db.getAllAsync<{ id: number }>(
      `SELECT id FROM sales WHERE created_at >= ?${branchClause}`,
      [fromISO, ...branchParams]
    );
    const placeholders = idRows.map(() => "?").join(",");
    const refundRow = await db.getFirstAsync<{ total: number | null }>(
      `SELECT COALESCE(SUM(amount), 0) as total FROM refunds WHERE sale_id IN (${placeholders})`,
      idRows.map(r => r.id)
    );

    return { total: (salesRow?.gross ?? 0) - (refundRow?.total ?? 0), count };
  },
};
