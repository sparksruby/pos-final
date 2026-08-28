import * as Crypto from "expo-crypto";
import { getDb } from "./database";
import type { Refund, RefundItem } from "../types";

export class InvalidRefundError extends Error {
  constructor(message: string) { super(message); }
}

interface RefundLineInput {
  saleItemId: number;
  qty:        number;
}

interface CreateRefundInput {
  saleId:      number;
  items:       RefundLineInput[];
  reason?:     string;
  actorName?:  string;
  /** The currently-open shift, if any — attributes this refund's cash impact to it. */
  shiftId?:    number;
}

interface RefundRow {
  id:         number;
  sale_id:    number;
  amount:     number;
  reason:     string | null;
  actor_name: string | null;
  created_at: string;
}

interface RefundItemRow {
  id:            number;
  refund_id:     number;
  sale_item_id:  number;
  product_id:    number;
  product_name:  string;
  qty:           number;
  unit_price:    number;
  amount:        number;
}

const toRefundItem = (r: RefundItemRow): RefundItem => ({
  id:          r.id,
  saleItemId:  r.sale_item_id,
  productId:   r.product_id,
  productName: r.product_name,
  qty:         r.qty,
  unitPrice:   r.unit_price,
  amount:      r.amount,
});

const toRefund = (r: RefundRow, items: RefundItem[]): Refund => ({
  id:         r.id,
  saleId:     r.sale_id,
  amount:     r.amount,
  reason:     r.reason ?? undefined,
  actorName:  r.actor_name ?? undefined,
  createdAt:  r.created_at,
  items,
});

export const refundsRepo = {
  // Refunds the requested quantities against a past sale. The amount returned
  // is proportional to what the customer actually paid for those units: each
  // line is valued net of its own per-item discount, then the sale's
  // order-level discount/loyalty-redemption and tax are re-applied to that
  // slice in the same proportion they applied to the original sale — so a
  // partial return of a discounted sale doesn't refund more than was paid.
  createRefund: async (input: CreateRefundInput): Promise<Refund> => {
    const db = await getDb();
    const lines = input.items.filter(i => i.qty > 0);
    if (lines.length === 0) throw new InvalidRefundError("NOTHING_TO_REFUND");

    let refundId = 0;
    let totalRefundAmount = 0;
    const refundLineAmounts = new Map<number, number>();
    let createdAt = "";

    await db.withTransactionAsync(async () => {
      const sale = await db.getFirstAsync<{
        subtotal: number; discount: number; tax_percent: number;
        customer_id: number | null; points_earned: number; points_redeemed: number;
        branch_id: number | null; branch_name: string | null;
      }>(
        "SELECT subtotal, discount, tax_percent, customer_id, points_earned, points_redeemed, branch_id, branch_name FROM sales WHERE id = ?",
        [input.saleId]
      );
      if (!sale) throw new InvalidRefundError("SALE_NOT_FOUND");

      const saleItems = await db.getAllAsync<{
        id: number; product_id: number; product_name: string;
        unit_price: number; qty: number; subtotal: number; discount: number; refunded_qty: number;
      }>("SELECT * FROM sale_items WHERE sale_id = ?", [input.saleId]);

      const itemDiscountTotal = saleItems.reduce((s, i) => s + i.discount, 0);
      const saleAfterItemDiscount = sale.subtotal - itemDiscountTotal;
      // sale.discount is item + order + redeemed-points combined (see salesRepo.checkout) —
      // subtracting the item-level share leaves the "other" (order/redeem) share.
      const otherDiscountTotal = Math.max(0, sale.discount - itemDiscountTotal);

      let totalLineAmount = 0;
      for (const line of lines) {
        const item = saleItems.find(i => i.id === line.saleItemId);
        if (!item) throw new InvalidRefundError("SALE_ITEM_NOT_FOUND");
        const remaining = item.qty - item.refunded_qty;
        if (line.qty > remaining) {
          throw new InvalidRefundError(`OVER_REFUND:${item.product_name}:${remaining}`);
        }
        const netUnitRate = (item.subtotal - item.discount) / item.qty;
        const lineAmount = netUnitRate * line.qty;
        refundLineAmounts.set(line.saleItemId, lineAmount);
        totalLineAmount += lineAmount;
      }

      const proportion = saleAfterItemDiscount > 0 ? totalLineAmount / saleAfterItemDiscount : 0;
      const otherDiscountRefund = otherDiscountTotal * proportion;
      const refundBeforeTax = Math.max(0, totalLineAmount - otherDiscountRefund);
      const taxRefund = Math.round(refundBeforeTax * sale.tax_percent / 100 * 100) / 100;
      totalRefundAmount = Math.round((refundBeforeTax + taxRefund) * 100) / 100;

      createdAt = new Date().toISOString();
      const { lastInsertRowId } = await db.runAsync(
        "INSERT INTO refunds (sale_id, amount, reason, actor_name, shift_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        [input.saleId, totalRefundAmount, input.reason ?? null, input.actorName ?? null, input.shiftId ?? null, createdAt]
      );
      refundId = lastInsertRowId;

      for (const line of lines) {
        const item = saleItems.find(i => i.id === line.saleItemId)!;
        const lineAmount = refundLineAmounts.get(line.saleItemId) ?? 0;

        await db.runAsync(
          `INSERT INTO refund_items (refund_id, sale_item_id, product_id, product_name, qty, unit_price, amount)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [refundId, item.id, item.product_id, item.product_name, line.qty, item.unit_price, lineAmount]
        );
        await db.runAsync(
          "UPDATE sale_items SET refunded_qty = refunded_qty + ? WHERE id = ?",
          [line.qty, item.id]
        );

        // Restocked back into whichever branch the sale was originally rung
        // against — sales made before branches existed were backfilled to
        // the default branch, so this is always set.
        if (sale.branch_id) {
          const beforeQty = await db.getFirstAsync<{ stock_qty: number }>(
            "SELECT stock_qty FROM branch_stock WHERE branch_id = ? AND product_id = ?",
            [sale.branch_id, item.product_id]
          );
          const resultingQty = (beforeQty?.stock_qty ?? 0) + line.qty;
          await db.runAsync(
            `INSERT INTO branch_stock (branch_id, product_id, stock_qty) VALUES (?, ?, ?)
             ON CONFLICT(branch_id, product_id) DO UPDATE SET stock_qty = excluded.stock_qty`,
            [sale.branch_id, item.product_id, resultingQty]
          );
          await db.runAsync(
            `INSERT INTO stock_movements (product_id, product_name, change_qty, reason, resulting_stock_qty, branch_id, branch_name, actor_name, sync_uuid, created_at)
             VALUES (?, ?, ?, 'Return', ?, ?, ?, ?, ?, ?)`,
            [item.product_id, item.product_name, line.qty, resultingQty, sale.branch_id, sale.branch_name, input.actorName ?? null, Crypto.randomUUID(), createdAt]
          );
        }
      }

      // Loyalty: claw back this refund's share of points earned (capped so
      // the balance never goes negative from a return spent elsewhere) and
      // hand back this share of any points redeemed on the original sale.
      if (sale.customer_id) {
        const customer = await db.getFirstAsync<{ loyalty_points: number }>(
          "SELECT loyalty_points FROM customers WHERE id = ?", [sale.customer_id]
        );
        if (customer) {
          const earnedShare = Math.floor(sale.points_earned * proportion);
          const redeemedShare = Math.floor(sale.points_redeemed * proportion);
          const clawback = Math.min(earnedShare, customer.loyalty_points);
          const newBalance = customer.loyalty_points - clawback + redeemedShare;
          await db.runAsync("UPDATE customers SET loyalty_points = ? WHERE id = ?", [newBalance, sale.customer_id]);
        }
      }
    });

    // Re-read what was actually stored so the returned Refund's item rows are accurate.
    const itemRows = await db.getAllAsync<RefundItemRow>(
      "SELECT * FROM refund_items WHERE refund_id = ?", [refundId]
    );

    return toRefund(
      { id: refundId, sale_id: input.saleId, amount: totalRefundAmount, reason: input.reason ?? null, actor_name: input.actorName ?? null, created_at: createdAt },
      itemRows.map(toRefundItem)
    );
  },

  getRefundsForSale: async (saleId: number): Promise<Refund[]> => {
    const db = await getDb();
    const refundRows = await db.getAllAsync<RefundRow>(
      "SELECT * FROM refunds WHERE sale_id = ? ORDER BY created_at DESC", [saleId]
    );
    if (refundRows.length === 0) return [];

    const ids = refundRows.map(r => r.id);
    const placeholders = ids.map(() => "?").join(",");
    const itemRows = await db.getAllAsync<RefundItemRow>(
      `SELECT * FROM refund_items WHERE refund_id IN (${placeholders})`, ids
    );

    return refundRows.map(r => toRefund(r, itemRows.filter(i => i.refund_id === r.id).map(toRefundItem)));
  },
};
