import { getDb } from "./database";
import type { Shift, ShiftSummary } from "../types";

export class ShiftAlreadyOpenError extends Error {
  constructor() { super("SHIFT_ALREADY_OPEN"); }
}

export class NoOpenShiftError extends Error {
  constructor() { super("NO_OPEN_SHIFT"); }
}

interface ShiftRow {
  id:            number;
  cashier_id:    number | null;
  cashier_name:  string | null;
  opening_cash:  number;
  closing_cash:  number | null;
  expected_cash: number | null;
  difference:    number | null;
  status:        string;
  notes:         string | null;
  opened_at:     string;
  closed_at:     string | null;
}

const toShift = (r: ShiftRow): Shift => ({
  id:           r.id,
  cashierId:    r.cashier_id ?? undefined,
  cashierName:  r.cashier_name ?? undefined,
  openingCash:  r.opening_cash,
  closingCash:  r.closing_cash ?? undefined,
  expectedCash: r.expected_cash ?? undefined,
  difference:   r.difference ?? undefined,
  status:       r.status as Shift["status"],
  notes:        r.notes ?? undefined,
  openedAt:     r.opened_at,
  closedAt:     r.closed_at ?? undefined,
});

export const shiftsRepo = {
  getOpenShift: async (): Promise<Shift | null> => {
    const db = await getDb();
    const row = await db.getFirstAsync<ShiftRow>(
      "SELECT * FROM shifts WHERE status = 'open' ORDER BY id DESC LIMIT 1"
    );
    return row ? toShift(row) : null;
  },

  getById: async (id: number): Promise<Shift | null> => {
    const db = await getDb();
    const row = await db.getFirstAsync<ShiftRow>("SELECT * FROM shifts WHERE id = ?", [id]);
    return row ? toShift(row) : null;
  },

  // The register is a single shared drawer on this device — only one shift
  // can be open at a time, regardless of who opens or later closes it (staff
  // hand the drawer off during a shift change on the same device).
  openShift: async (openingCash: number, cashierId?: number, cashierName?: string): Promise<Shift> => {
    const db = await getDb();
    const existing = await shiftsRepo.getOpenShift();
    if (existing) throw new ShiftAlreadyOpenError();

    const openedAt = new Date().toISOString();
    const { lastInsertRowId } = await db.runAsync(
      "INSERT INTO shifts (cashier_id, cashier_name, opening_cash, status, opened_at) VALUES (?, ?, ?, 'open', ?)",
      [cashierId ?? null, cashierName ?? null, Math.max(0, openingCash), openedAt]
    );
    return (await shiftsRepo.getById(lastInsertRowId))!;
  },

  // Aggregates sales/refunds attributed to this shift (see sales.shift_id /
  // refunds.shift_id, set at checkout/refund time by whichever shift was
  // open then). Works for an open shift (live preview) or a closed one
  // (historical detail) — the numbers just don't change once it's closed.
  getSummary: async (shiftId: number): Promise<ShiftSummary> => {
    const db = await getDb();
    const shift = await shiftsRepo.getById(shiftId);
    if (!shift) throw new NoOpenShiftError();

    const sales = await db.getAllAsync<{ id: number; payment_method: string; total: number }>(
      "SELECT id, payment_method, total FROM sales WHERE shift_id = ?", [shiftId]
    );

    let cashSales = 0, cardSales = 0, qrSales = 0, totalSales = 0;
    for (const sale of sales) {
      totalSales += sale.total;
      if (sale.payment_method === "Cash") cashSales += sale.total;
      else if (sale.payment_method === "Card") cardSales += sale.total;
      else if (sale.payment_method === "QR") qrSales += sale.total;
    }

    let splitCashSales = 0;
    const saleIds = sales.map(s => s.id);
    if (saleIds.length > 0) {
      const placeholders = saleIds.map(() => "?").join(",");
      const splitCashRows = await db.getAllAsync<{ amount: number }>(
        `SELECT amount FROM sale_payments WHERE method = 'Cash' AND sale_id IN (${placeholders})`, saleIds
      );
      splitCashSales = splitCashRows.reduce((s, r) => s + r.amount, 0);
    }

    // Refunds are assumed paid out in cash — the simplest, most common case
    // for a small shop — so every refund against this shift reduces the
    // drawer regardless of the original sale's payment method.
    const refundRows = await db.getAllAsync<{ amount: number }>(
      "SELECT amount FROM refunds WHERE shift_id = ?", [shiftId]
    );
    const refundsTotal = refundRows.reduce((s, r) => s + r.amount, 0);

    const expectedCash = shift.openingCash + cashSales + splitCashSales - refundsTotal;

    return {
      salesCount: sales.length,
      cashSales, cardSales, qrSales, splitCashSales, totalSales,
      refundsCount: refundRows.length, refundsTotal,
      expectedCash,
    };
  },

  closeShift: async (shiftId: number, closingCash: number, notes?: string): Promise<Shift> => {
    const db = await getDb();
    const summary = await shiftsRepo.getSummary(shiftId);
    const safeClosingCash = Math.max(0, closingCash);
    const difference = Math.round((safeClosingCash - summary.expectedCash) * 100) / 100;
    const closedAt = new Date().toISOString();

    await db.runAsync(
      `UPDATE shifts
       SET closing_cash = ?, expected_cash = ?, difference = ?, status = 'closed', notes = ?, closed_at = ?
       WHERE id = ?`,
      [safeClosingCash, summary.expectedCash, difference, notes ?? null, closedAt, shiftId]
    );
    return (await shiftsRepo.getById(shiftId))!;
  },

  // History list — admins see every shift, cashiers only their own (pass
  // cashierId to scope it).
  getShifts: async (opts?: { cashierId?: number; limit?: number }): Promise<Shift[]> => {
    const db = await getDb();
    const limit = opts?.limit ?? 30;
    const rows = opts?.cashierId
      ? await db.getAllAsync<ShiftRow>(
          "SELECT * FROM shifts WHERE cashier_id = ? ORDER BY opened_at DESC LIMIT ?", [opts.cashierId, limit]
        )
      : await db.getAllAsync<ShiftRow>(
          "SELECT * FROM shifts ORDER BY opened_at DESC LIMIT ?", [limit]
        );
    return rows.map(toShift);
  },
};
