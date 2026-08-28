import * as Crypto from "expo-crypto";
import { getDb } from "./database";
import type { Expense } from "../types";

interface ExpenseRow {
  id:          number;
  category:    string;
  description: string | null;
  amount:      number;
  branch_id:   number | null;
  branch_name: string | null;
  actor_name:  string | null;
  created_at:  string;
}

const toExpense = (r: ExpenseRow): Expense => ({
  id:          r.id,
  category:    r.category,
  description: r.description ?? undefined,
  amount:      r.amount,
  branchId:    r.branch_id ?? undefined,
  branchName:  r.branch_name ?? undefined,
  actorName:   r.actor_name ?? undefined,
  createdAt:   r.created_at,
});

export const expensesRepo = {
  getAll: async (branchId: number): Promise<Expense[]> => {
    const db = await getDb();
    const rows = await db.getAllAsync<ExpenseRow>(
      "SELECT * FROM expenses WHERE branch_id = ? ORDER BY created_at DESC", [branchId]
    );
    return rows.map(toExpense);
  },

  // sync_uuid is generated here unconditionally (not just when synced) —
  // same pattern productsRepo.createCategory/createProduct and
  // branchesRepo.create already use — so this expense is push-eligible
  // from the moment it exists.
  create: async (branchId: number, branchName: string, body: {
    category: string; description?: string; amount: number; actorName?: string;
  }): Promise<Expense> => {
    const db = await getDb();
    const { lastInsertRowId } = await db.runAsync(
      `INSERT INTO expenses (category, description, amount, branch_id, branch_name, actor_name, sync_uuid)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [body.category, body.description ?? null, body.amount, branchId, branchName, body.actorName ?? null, Crypto.randomUUID()]
    );
    const row = await db.getFirstAsync<ExpenseRow>("SELECT * FROM expenses WHERE id = ?", [lastInsertRowId]);
    return toExpense(row!);
  },

  delete: async (id: number): Promise<void> => {
    const db = await getDb();
    await db.runAsync("DELETE FROM expenses WHERE id = ?", [id]);
  },

  getTotal: async (branchId: number): Promise<number> => {
    const db = await getDb();
    const row = await db.getFirstAsync<{ total: number | null }>(
      "SELECT SUM(amount) as total FROM expenses WHERE branch_id = ?", [branchId]
    );
    return row?.total ?? 0;
  },
};
