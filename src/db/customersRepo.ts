import { getDb } from "./database";
import type { Customer } from "../types";

export class DuplicatePhoneError extends Error {
  constructor() { super("DUPLICATE_PHONE"); }
}

interface CustomerRow {
  id:             number;
  name:           string;
  phone:          string | null;
  email:          string | null;
  loyalty_points: number;
  created_at:     string;
}

const toCustomer = (r: CustomerRow): Customer => ({
  id:            r.id,
  name:          r.name,
  phone:         r.phone ?? undefined,
  email:         r.email ?? undefined,
  loyaltyPoints: r.loyalty_points,
  createdAt:     r.created_at,
});

export const customersRepo = {
  getAll: async (): Promise<Customer[]> => {
    const db = await getDb();
    const rows = await db.getAllAsync<CustomerRow>("SELECT * FROM customers ORDER BY name COLLATE NOCASE");
    return rows.map(toCustomer);
  },

  getById: async (id: number): Promise<Customer | null> => {
    const db = await getDb();
    const row = await db.getFirstAsync<CustomerRow>("SELECT * FROM customers WHERE id = ?", [id]);
    return row ? toCustomer(row) : null;
  },

  // Used by the Checkout screen's customer picker — matches name or phone.
  search: async (query: string): Promise<Customer[]> => {
    const db = await getDb();
    const like = `%${query}%`;
    const rows = await db.getAllAsync<CustomerRow>(
      "SELECT * FROM customers WHERE name LIKE ? OR phone LIKE ? ORDER BY name COLLATE NOCASE LIMIT 20",
      [like, like]
    );
    return rows.map(toCustomer);
  },

  create: async (name: string, phone?: string, email?: string): Promise<Customer> => {
    const db = await getDb();
    if (phone) {
      const dup = await db.getFirstAsync<{ id: number }>("SELECT id FROM customers WHERE phone = ?", [phone]);
      if (dup) throw new DuplicatePhoneError();
    }
    const { lastInsertRowId } = await db.runAsync(
      "INSERT INTO customers (name, phone, email, loyalty_points) VALUES (?, ?, ?, 0)",
      [name, phone ?? null, email ?? null]
    );
    return (await customersRepo.getById(lastInsertRowId))!;
  },

  update: async (id: number, name: string, phone?: string, email?: string): Promise<Customer> => {
    const db = await getDb();
    if (phone) {
      const dup = await db.getFirstAsync<{ id: number }>(
        "SELECT id FROM customers WHERE phone = ? AND id != ?", [phone, id]
      );
      if (dup) throw new DuplicatePhoneError();
    }
    await db.runAsync(
      "UPDATE customers SET name = ?, phone = ?, email = ? WHERE id = ?",
      [name, phone ?? null, email ?? null, id]
    );
    return (await customersRepo.getById(id))!;
  },

  delete: async (id: number): Promise<void> => {
    const db = await getDb();
    await db.runAsync("DELETE FROM customers WHERE id = ?", [id]);
  },
};
