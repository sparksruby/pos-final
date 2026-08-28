import { getDb } from "./database";
import type { Supplier, SupplierProduct } from "../types";

export class SupplierHasPurchasesError extends Error {
  constructor() { super("SUPPLIER_HAS_PURCHASES"); }
}

interface SupplierRow {
  id:         number;
  name:       string;
  phone:      string | null;
  address:    string | null;
  created_at: string;
}

const toSupplier = (r: SupplierRow): Supplier => ({
  id:        r.id,
  name:      r.name,
  phone:     r.phone ?? undefined,
  address:   r.address ?? undefined,
  createdAt: r.created_at,
});

export const suppliersRepo = {
  getAll: async (): Promise<Supplier[]> => {
    const db = await getDb();
    const rows = await db.getAllAsync<SupplierRow>("SELECT * FROM suppliers ORDER BY name COLLATE NOCASE");
    return rows.map(toSupplier);
  },

  getById: async (id: number): Promise<Supplier | null> => {
    const db = await getDb();
    const row = await db.getFirstAsync<SupplierRow>("SELECT * FROM suppliers WHERE id = ?", [id]);
    return row ? toSupplier(row) : null;
  },

  create: async (name: string, phone?: string, address?: string): Promise<Supplier> => {
    const db = await getDb();
    const { lastInsertRowId } = await db.runAsync(
      "INSERT INTO suppliers (name, phone, address) VALUES (?, ?, ?)",
      [name, phone ?? null, address ?? null]
    );
    return (await suppliersRepo.getById(lastInsertRowId))!;
  },

  update: async (id: number, name: string, phone?: string, address?: string): Promise<Supplier> => {
    const db = await getDb();
    await db.runAsync(
      "UPDATE suppliers SET name = ?, phone = ?, address = ? WHERE id = ?",
      [name, phone ?? null, address ?? null, id]
    );
    return (await suppliersRepo.getById(id))!;
  },

  // Purchase history stays intact for reporting, so a supplier with any
  // purchases on record can't be deleted out from under it.
  delete: async (id: number): Promise<void> => {
    const db = await getDb();
    const purchaseCount = await db.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) as count FROM purchases WHERE supplier_id = ?", [id]
    );
    if ((purchaseCount?.count ?? 0) > 0) throw new SupplierHasPurchasesError();
    await db.runAsync("DELETE FROM suppliers WHERE id = ?", [id]);
  },

  // Total unpaid balance across every purchase from this supplier.
  getOutstanding: async (supplierId: number): Promise<number> => {
    const db = await getDb();
    const row = await db.getFirstAsync<{ outstanding: number }>(
      "SELECT COALESCE(SUM(total - paid_amount), 0) as outstanding FROM purchases WHERE supplier_id = ?",
      [supplierId]
    );
    return row?.outstanding ?? 0;
  },

  // Distinct products ever bought from this supplier, derived from purchase
  // history rather than a separately maintained list.
  getProductList: async (supplierId: number): Promise<SupplierProduct[]> => {
    const db = await getDb();
    const rows = await db.getAllAsync<{ product_id: number; product_name: string; total_qty: number }>(
      `SELECT pi.product_id as product_id, pi.product_name as product_name, SUM(pi.qty) as total_qty
       FROM purchase_items pi JOIN purchases p ON p.id = pi.purchase_id
       WHERE p.supplier_id = ?
       GROUP BY pi.product_id, pi.product_name
       ORDER BY pi.product_name COLLATE NOCASE`,
      [supplierId]
    );
    return rows.map(r => ({ productId: r.product_id, productName: r.product_name, totalQty: r.total_qty }));
  },
};
