import * as Crypto from "expo-crypto";
import { getDb } from "./database";
import type { Category, Product } from "../types";

export interface AdminProductStockRow {
  id:           number;
  name:         string;
  categoryName: string;
  price:        number;
  unit:         string;
  branchStocks: { branchId: number; branchName: string; stockQty: number }[];
}

interface CategoryRow {
  id:         number;
  name:       string;
  sort_order: number;
  is_active:  number;
}

interface ProductRow {
  id:                  number;
  category_id:         number;
  name:                string;
  sku:                 string | null;
  barcode:             string | null;
  price:               number;
  wholesale_price:     number | null;
  cost_price:          number;
  unit:                string;
  image_uri:           string | null;
  stock_qty:           number;
  low_stock_threshold: number;
  expiry_date:         string | null;
  label_text:          string | null;
  is_active:           number;
  sort_order:          number;
}

const toProduct = (r: ProductRow): Product => ({
  id:                r.id,
  categoryId:        r.category_id,
  name:              r.name,
  sku:               r.sku ?? undefined,
  barcode:           r.barcode ?? undefined,
  price:             r.price,
  wholesalePrice:    r.wholesale_price ?? undefined,
  costPrice:         r.cost_price,
  unit:              r.unit,
  imageUri:          r.image_uri ?? undefined,
  stockQty:          r.stock_qty,
  lowStockThreshold: r.low_stock_threshold,
  expiryDate:        r.expiry_date ?? undefined,
  labelText:         r.label_text ?? undefined,
  isActive:          !!r.is_active,
  sortOrder:         r.sort_order,
});

const toCategory = (r: CategoryRow, products: Product[]): Category => ({
  id:        r.id,
  name:      r.name,
  sortOrder: r.sort_order,
  isActive:  !!r.is_active,
  products,
});

// Stock lives in branch_stock, not on the product row — every product query
// that surfaces stockQty/lowStockThreshold needs a branch to read them for.
// COALESCE covers the (should-be-rare) case where a branch_stock row is
// somehow missing, rather than erroring.
const PRODUCT_COLUMNS = `
  p.id as id, p.category_id as category_id, p.name as name, p.sku as sku, p.barcode as barcode,
  p.price as price, p.wholesale_price as wholesale_price, p.cost_price as cost_price, p.unit as unit,
  p.image_uri as image_uri, p.expiry_date as expiry_date, p.label_text as label_text,
  p.is_active as is_active, p.sort_order as sort_order,
  COALESCE(bs.stock_qty, 0) as stock_qty,
  COALESCE(bs.low_stock_threshold, 5) as low_stock_threshold
`;
const PRODUCT_JOIN = `FROM products p LEFT JOIN branch_stock bs ON bs.product_id = p.id AND bs.branch_id = ?`;

const loadCategories = async (activeOnly: boolean, branchId: number): Promise<Category[]> => {
  const db = await getDb();
  const categoryRows = await db.getAllAsync<CategoryRow>(
    activeOnly
      ? "SELECT * FROM categories WHERE is_active = 1 ORDER BY sort_order, id"
      : "SELECT * FROM categories ORDER BY sort_order, id"
  );
  const productRows = await db.getAllAsync<ProductRow>(
    `SELECT ${PRODUCT_COLUMNS} ${PRODUCT_JOIN}
     WHERE ${activeOnly ? "p.is_active = 1" : "1=1"} ORDER BY p.sort_order, p.id`,
    [branchId]
  );
  return categoryRows.map(c =>
    toCategory(c, productRows.filter(p => p.category_id === c.id).map(toProduct))
  );
};

export const productsRepo = {
  // POS screen — active categories/products only, stock for the given branch.
  getCategories: (branchId: number) => loadCategories(true, branchId),

  // Management screen — everything, including inactive.
  getAllCategories: (branchId: number) => loadCategories(false, branchId),

  // Barcode scan lookup — only matches active (sellable) products.
  getByBarcode: async (barcode: string, branchId: number): Promise<Product | null> => {
    const db = await getDb();
    const row = await db.getFirstAsync<ProductRow>(
      `SELECT ${PRODUCT_COLUMNS} ${PRODUCT_JOIN} WHERE p.barcode = ? AND p.is_active = 1`,
      [branchId, barcode]
    );
    return row ? toProduct(row) : null;
  },

  // Inventory screen — every active product's stock at the given branch.
  getAllProducts: async (branchId: number): Promise<Product[]> => {
    const db = await getDb();
    const rows = await db.getAllAsync<ProductRow>(
      `SELECT ${PRODUCT_COLUMNS} ${PRODUCT_JOIN} WHERE p.is_active = 1 ORDER BY p.name`,
      [branchId]
    );
    return rows.map(toProduct);
  },

  // Reports — cost/category are catalog-wide (not branch-specific), so this
  // skips branch_stock entirely rather than making the caller pick a branch.
  getAllProductMeta: async (): Promise<{ id: number; categoryName: string; costPrice: number }[]> => {
    const db = await getDb();
    const rows = await db.getAllAsync<{ id: number; category_name: string; cost_price: number }>(
      `SELECT p.id as id, c.name as category_name, p.cost_price as cost_price
       FROM products p JOIN categories c ON c.id = p.category_id`
    );
    return rows.map(r => ({ id: r.id, categoryName: r.category_name, costPrice: r.cost_price }));
  },

  // All Branches Activity's Products tab — every branch's own stock for
  // every product, not just the admin device's own branch (getAllProducts/
  // getAllCategories above are always scoped to one branchId). Joined in JS
  // rather than SQL since branch counts are small and it keeps the query
  // simple; a branch with no branch_stock row for a product (never stocked,
  // never received a transfer) reads as 0 rather than being omitted.
  getAllProductsWithBranchStock: async (): Promise<AdminProductStockRow[]> => {
    const db = await getDb();
    const products = await db.getAllAsync<{ id: number; name: string; category_name: string; price: number; unit: string }>(
      `SELECT p.id as id, p.name as name, c.name as category_name, p.price as price, p.unit as unit
       FROM products p JOIN categories c ON c.id = p.category_id
       ORDER BY c.sort_order, c.id, p.sort_order, p.id`
    );
    const branches = await db.getAllAsync<{ id: number; name: string }>(
      "SELECT id, name FROM branches WHERE is_active = 1 ORDER BY id"
    );
    const stockRows = await db.getAllAsync<{ branch_id: number; product_id: number; stock_qty: number }>(
      "SELECT branch_id, product_id, stock_qty FROM branch_stock"
    );

    return products.map(p => ({
      id: p.id, name: p.name, categoryName: p.category_name, price: p.price, unit: p.unit,
      branchStocks: branches.map(b => ({
        branchId: b.id,
        branchName: b.name,
        stockQty: stockRows.find(r => r.branch_id === b.id && r.product_id === p.id)?.stock_qty ?? 0,
      })),
    }));
  },

  // sync_uuid is generated here unconditionally (not just when synced) —
  // it's what a later syncRepo.push() uses to send this category up to the
  // server if this device ever connects, same as sales/stock_movements.
  createCategory: async (name: string): Promise<Category> => {
    const db = await getDb();
    const { lastInsertRowId } = await db.runAsync(
      "INSERT INTO categories (name, sort_order, is_active, sync_uuid) VALUES (?, 0, 1, ?)",
      [name, Crypto.randomUUID()]
    );
    return { id: lastInsertRowId, name, sortOrder: 0, isActive: true, products: [] };
  },

  updateCategory: async (
    id: number,
    body: { name: string; sortOrder: number; isActive: boolean }
  ) => {
    const db = await getDb();
    await db.runAsync(
      "UPDATE categories SET name = ?, sort_order = ?, is_active = ? WHERE id = ?",
      [body.name, body.sortOrder, body.isActive ? 1 : 0, id]
    );
  },

  deleteCategory: async (id: number) => {
    const db = await getDb();
    await db.withTransactionAsync(async () => {
      const products = await db.getAllAsync<{ id: number }>("SELECT id FROM products WHERE category_id = ?", [id]);
      for (const p of products) {
        await db.runAsync("DELETE FROM branch_stock WHERE product_id = ?", [p.id]);
      }
      await db.runAsync("DELETE FROM products WHERE category_id = ?", [id]);
      await db.runAsync("DELETE FROM categories WHERE id = ?", [id]);
    });
  },

  // stockQty/lowStockThreshold here apply to `branchId` only — every other
  // existing branch starts this product at 0 stock until it's stocked or
  // receives a transfer.
  createProduct: async (branchId: number, body: {
    categoryId:        number;
    name:              string;
    sku?:              string;
    barcode?:          string;
    price:             number;
    wholesalePrice?:   number;
    costPrice:         number;
    unit:              string;
    imageUri?:         string;
    stockQty:          number;
    lowStockThreshold: number;
    expiryDate?:       string;
    labelText?:        string;
    sortOrder:         number;
  }, actorName?: string): Promise<Product> => {
    const db = await getDb();
    let productId = 0;
    await db.withTransactionAsync(async () => {
      const { lastInsertRowId } = await db.runAsync(
        `INSERT INTO products (category_id, name, sku, barcode, price, wholesale_price, cost_price, unit, image_uri, stock_qty, low_stock_threshold, expiry_date, label_text, is_active, sort_order, sync_uuid)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 5, ?, ?, 1, ?, ?)`,
        [body.categoryId, body.name, body.sku ?? null, body.barcode ?? null, body.price,
         body.wholesalePrice ?? null, body.costPrice, body.unit, body.imageUri ?? null,
         body.expiryDate ?? null, body.labelText ?? null, body.sortOrder, Crypto.randomUUID()]
      );
      productId = lastInsertRowId;

      const branches = await db.getAllAsync<{ id: number }>("SELECT id FROM branches");
      for (const b of branches) {
        const isTarget = b.id === branchId;
        await db.runAsync(
          "INSERT INTO branch_stock (branch_id, product_id, stock_qty, low_stock_threshold) VALUES (?, ?, ?, ?)",
          [b.id, productId, isTarget ? body.stockQty : 0, isTarget ? body.lowStockThreshold : 5]
        );
      }

      // Setting branch_stock directly above (rather than through
      // stockRepo.adjustStock) skips its stock_movements record — fine
      // locally, but syncRepo.push() only ever sends stock_movements
      // (deltas) for a product's stock, never a snapshot. Without a
      // movement here, a starting quantity given at creation is invisible
      // to the server: the very first movement pushed afterward (e.g. a
      // sale) gets applied on top of an assumed 0, landing the server's
      // branch_stock on the wrong number — which then overwrites this
      // device's own correct value on the next pull.
      if (body.stockQty !== 0) {
        const branch = await db.getFirstAsync<{ name: string }>("SELECT name FROM branches WHERE id = ?", [branchId]);
        await db.runAsync(
          `INSERT INTO stock_movements (product_id, product_name, change_qty, reason, resulting_stock_qty, branch_id, branch_name, actor_name, sync_uuid, created_at)
           VALUES (?, ?, ?, 'Restock', ?, ?, ?, ?, ?, ?)`,
          [productId, body.name, body.stockQty, body.stockQty, branchId, branch?.name ?? null,
           actorName ?? null, Crypto.randomUUID(), new Date().toISOString()]
        );
      }
    });
    return {
      id: productId, categoryId: body.categoryId, name: body.name,
      sku: body.sku, barcode: body.barcode, price: body.price, wholesalePrice: body.wholesalePrice,
      costPrice: body.costPrice, unit: body.unit,
      imageUri: body.imageUri, stockQty: body.stockQty, lowStockThreshold: body.lowStockThreshold,
      expiryDate: body.expiryDate, labelText: body.labelText, isActive: true, sortOrder: body.sortOrder,
    };
  },

  // stockQty/lowStockThreshold here apply to `branchId` only — other
  // branches' stock is untouched (adjust those via Inventory/Transfer).
  updateProduct: async (id: number, branchId: number, body: {
    name:              string;
    sku?:              string;
    barcode?:          string;
    price:             number;
    wholesalePrice?:   number;
    costPrice:         number;
    unit:              string;
    imageUri?:         string;
    stockQty:          number;
    lowStockThreshold: number;
    expiryDate?:       string;
    labelText?:        string;
    isActive:          boolean;
    sortOrder:         number;
  }, actorName?: string) => {
    const db = await getDb();
    await db.withTransactionAsync(async () => {
      await db.runAsync(
        `UPDATE products SET name = ?, sku = ?, barcode = ?, price = ?, wholesale_price = ?, cost_price = ?, unit = ?, image_uri = ?, expiry_date = ?, label_text = ?,
           is_active = ?, sort_order = ?
         WHERE id = ?`,
        [body.name, body.sku ?? null, body.barcode ?? null, body.price, body.wholesalePrice ?? null, body.costPrice,
         body.unit, body.imageUri ?? null, body.expiryDate ?? null, body.labelText ?? null, body.isActive ? 1 : 0, body.sortOrder, id]
      );

      // Editing the stock field here bypasses stockRepo.adjustStock, same
      // gap as createProduct's initial quantity above — record the delta
      // as a movement so it isn't invisible to the server on next push.
      const before = await db.getFirstAsync<{ stock_qty: number }>(
        "SELECT stock_qty FROM branch_stock WHERE branch_id = ? AND product_id = ?", [branchId, id]
      );
      const delta = body.stockQty - (before?.stock_qty ?? 0);

      await db.runAsync(
        `INSERT INTO branch_stock (branch_id, product_id, stock_qty, low_stock_threshold) VALUES (?, ?, ?, ?)
         ON CONFLICT(branch_id, product_id) DO UPDATE SET stock_qty = excluded.stock_qty, low_stock_threshold = excluded.low_stock_threshold`,
        [branchId, id, body.stockQty, body.lowStockThreshold]
      );

      if (delta !== 0) {
        const branch = await db.getFirstAsync<{ name: string }>("SELECT name FROM branches WHERE id = ?", [branchId]);
        await db.runAsync(
          `INSERT INTO stock_movements (product_id, product_name, change_qty, reason, resulting_stock_qty, branch_id, branch_name, actor_name, sync_uuid, created_at)
           VALUES (?, ?, ?, 'Correction', ?, ?, ?, ?, ?, ?)`,
          [id, body.name, delta, body.stockQty, branchId, branch?.name ?? null,
           actorName ?? null, Crypto.randomUUID(), new Date().toISOString()]
        );
      }
    });
  },

  deleteProduct: async (id: number) => {
    const db = await getDb();
    await db.withTransactionAsync(async () => {
      await db.runAsync("DELETE FROM branch_stock WHERE product_id = ?", [id]);
      await db.runAsync("DELETE FROM products WHERE id = ?", [id]);
    });
  },
};
