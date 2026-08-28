import * as Crypto from "expo-crypto";
import { getDb } from "./database";
import type { Branch } from "../types";

export class LastBranchError extends Error {
  constructor() { super("LAST_BRANCH"); }
}

interface BranchRow {
  id:         number;
  name:       string;
  address:    string | null;
  phone:      string | null;
  is_active:  number;
  created_at: string;
  server_id:  string | null;
}

const toBranch = (r: BranchRow): Branch => ({
  id:        r.id,
  name:      r.name,
  address:   r.address ?? undefined,
  phone:     r.phone ?? undefined,
  isActive:  !!r.is_active,
  createdAt: r.created_at,
  isSynced:  !!r.server_id,
});

export const branchesRepo = {
  getAll: async (activeOnly = false): Promise<Branch[]> => {
    const db = await getDb();
    const rows = await db.getAllAsync<BranchRow>(
      activeOnly
        ? "SELECT * FROM branches WHERE is_active = 1 ORDER BY name COLLATE NOCASE"
        : "SELECT * FROM branches ORDER BY name COLLATE NOCASE"
    );
    return rows.map(toBranch);
  },

  getById: async (id: number): Promise<Branch | null> => {
    const db = await getDb();
    const row = await db.getFirstAsync<BranchRow>("SELECT * FROM branches WHERE id = ?", [id]);
    return row ? toBranch(row) : null;
  },

  // A new branch starts stocking every existing product at 0 — the catalog
  // (name/price/category) is shared across branches, only stock differs.
  // sync_uuid is generated here unconditionally (not just when synced) —
  // same pattern productsRepo.createCategory/createProduct already use —
  // so this branch is push-eligible from the moment it exists, with no
  // separate "attach to server" step needed later.
  create: async (name: string, address?: string, phone?: string): Promise<Branch> => {
    const db = await getDb();
    let branchId = 0;
    await db.withTransactionAsync(async () => {
      const { lastInsertRowId } = await db.runAsync(
        "INSERT INTO branches (name, address, phone, is_active, sync_uuid) VALUES (?, ?, ?, 1, ?)",
        [name, address ?? null, phone ?? null, Crypto.randomUUID()]
      );
      branchId = lastInsertRowId;

      const products = await db.getAllAsync<{ id: number }>("SELECT id FROM products");
      for (const p of products) {
        await db.runAsync(
          "INSERT INTO branch_stock (branch_id, product_id, stock_qty, low_stock_threshold) VALUES (?, ?, 0, 5)",
          [branchId, p.id]
        );
      }
    });
    return (await branchesRepo.getById(branchId))!;
  },

  update: async (id: number, body: { name: string; address?: string; phone?: string; isActive: boolean }): Promise<Branch> => {
    const db = await getDb();
    await db.runAsync(
      "UPDATE branches SET name = ?, address = ?, phone = ?, is_active = ? WHERE id = ?",
      [body.name, body.address ?? null, body.phone ?? null, body.isActive ? 1 : 0, id]
    );
    return (await branchesRepo.getById(id))!;
  },

  delete: async (id: number): Promise<void> => {
    const db = await getDb();
    const count = await db.getFirstAsync<{ count: number }>("SELECT COUNT(*) as count FROM branches");
    if ((count?.count ?? 0) <= 1) throw new LastBranchError();

    await db.withTransactionAsync(async () => {
      await db.runAsync("DELETE FROM branch_stock WHERE branch_id = ?", [id]);
      await db.runAsync("DELETE FROM branches WHERE id = ?", [id]);
    });
  },
};
