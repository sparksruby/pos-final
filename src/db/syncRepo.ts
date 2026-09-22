import * as Crypto from "expo-crypto";
import { getDb } from "./database";

export class SyncError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

// ── Wire format — mirrors backend/RetailPosSync.Api/Dtos/SyncDtos.cs ────────

interface DeviceInfoDto {
  deviceId: string;
  deviceName: string;
  branchId: string;
  branchName: string;
  lastSyncAt: string | null;
}
interface BranchDto {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  isActive: boolean;
  updatedAt: string;
}
interface CategoryDto {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  updatedAt: string;
}
interface ProductDto {
  id: string;
  categoryId: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  // wholesalePrice/unit are optional on the wire: a server that predates
  // them answers without the keys at all, and the pull below must leave the
  // local values alone in that case rather than blanking them.
  price: number;
  wholesalePrice?: number | null;
  costPrice: number;
  unit?: string | null;
  imageUri: string | null;
  lowStockThreshold: number;
  expiryDate: string | null;
  isActive: boolean;
  sortOrder: number;
  updatedAt: string;
}
interface BranchStockDto {
  branchId: string;
  productId: string;
  stockQty: number;
  updatedAt: string;
}
interface SaleItemDto {
  id: string;
  productId: string;
  productName: string;
  unitPrice: number;
  qty: number;
  subtotal: number;
  discount: number;
}
interface SaleDto {
  id: string;
  branchId: string;
  subtotal: number;
  discount: number;
  taxPercent: number;
  taxAmount: number;
  total: number;
  tendered: number;
  changeDue: number;
  paymentMethod: string;
  cashierName: string | null;
  customerName: string | null;
  createdAt: string;
  items: SaleItemDto[];
}
interface StockMovementDto {
  id: string;
  productId: string;
  branchId: string;
  changeQty: number;
  reason: string;
  resultingStockQty: number;
  actorName: string | null;
  createdAt: string;
}
interface ExpenseDto {
  id: string;
  branchId: string;
  category: string;
  description: string | null;
  amount: number;
  actorName: string | null;
  createdAt: string;
}
// Push-direction shapes for catalog rows created offline — no updatedAt
// (meaningless coming from a device; the server always stamps its own on
// create), unlike CategoryDto/ProductDto above which are the pull shape.
interface CategoryPushDto {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
}
interface ProductPushDto {
  id: string;
  categoryId: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  price: number;
  wholesalePrice: number | null;
  costPrice: number;
  unit: string;
  imageUri: string | null;
  lowStockThreshold: number;
  expiryDate: string | null;
  isActive: boolean;
  sortOrder: number;
  /**
   * When this device last edited the product. The server applies an edit
   * only when this is newer than what it holds, so a till that has been
   * offline for a week cannot overwrite a correction made this morning.
   * Absent on a brand-new product, which has nothing to conflict with.
   */
  updatedAt?: string | null;
}
interface PullResponse {
  serverTime: string;
  branches: BranchDto[];
  categories: CategoryDto[];
  products: ProductDto[];
  branchStock: BranchStockDto[];
  sales: SaleDto[];
  stockMovements: StockMovementDto[];
  expenses: ExpenseDto[];
}
// Push-direction shape for a branch created offline — same minimal,
// no-updatedAt idea as CategoryPushDto/ProductPushDto below.
interface BranchPushDto {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  isActive: boolean;
}
// clientId is the sync_uuid this device sent; serverId is what it actually
// landed at — usually the same, but differs when the server deduped this
// row onto an already-existing one (a branch/category matched by name, a
// product matched by barcode — see the backend's SyncController.Push).
interface AcceptedIdDto {
  clientId: string;
  serverId: string;
}
interface PushResponse {
  acceptedBranches: AcceptedIdDto[];
  acceptedCategories: AcceptedIdDto[];
  acceptedProducts: AcceptedIdDto[];
  acceptedSaleIds: string[];
  acceptedMovementIds: string[];
  acceptedExpenseIds: string[];
  updatedStock: BranchStockDto[];
}

// ── All Branches Activity (main-branch-only remote mirror) ──────────────────

export interface RemoteSale {
  id: number;
  branchName: string | null;
  total: number;
  paymentMethod: string;
  cashierName: string | null;
  customerName: string | null;
  createdAt: string;
  items: {
    productName: string;
    unitPrice: number;
    qty: number;
    subtotal: number;
  }[];
}

export interface RemoteStockMovement {
  id: number;
  productName: string;
  branchName: string | null;
  changeQty: number;
  reason: string;
  resultingStockQty: number;
  actorName: string | null;
  createdAt: string;
}

export interface RemoteExpense {
  id: number;
  category: string;
  description: string | null;
  amount: number;
  branchName: string | null;
  actorName: string | null;
  createdAt: string;
}

// ── Local sync_config (id=1 row) ─────────────────────────────────────────────

export interface SyncConfig {
  serverUrl: string;
  deviceApiKey: string;
  boundBranchId: number;
  lastPullAt: string | null;
  lastPushAt: string | null;
  /** Optional — lets this device call the admin-only endpoints (create branch/category/product) directly. Not required for normal pull/push. */
  adminKey: string | null;
}

interface ConfigRow {
  server_url: string | null;
  device_api_key: string | null;
  bound_branch_id: number | null;
  last_pull_at: string | null;
  last_push_at: string | null;
  admin_key: string | null;
}

const getConfig = async (): Promise<SyncConfig | null> => {
  const db = await getDb();
  const row = await db.getFirstAsync<ConfigRow>(
    "SELECT * FROM sync_config WHERE id = 1",
  );
  if (!row || !row.server_url || !row.device_api_key || !row.bound_branch_id)
    return null;
  return {
    serverUrl: row.server_url,
    deviceApiKey: row.device_api_key,
    boundBranchId: row.bound_branch_id,
    lastPullAt: row.last_pull_at,
    lastPushAt: row.last_push_at,
    adminKey: row.admin_key,
  };
};

// Every syncRepo call funnels through fetchJson or fetchJsonAdmin below, so
// logging here covers every API call the app makes (connect, pull, push,
// setAdminKey, createDevice, createBranch, ...) — not just one screen's
// worth. Look for "[sync]" in the Metro/adb log while reproducing an issue.
const logRequest = (method: string, url: string) => {
  console.log(`[sync] → ${method} ${url}`);
};
const logSuccess = (method: string, url: string, status: number) => {
  console.log(`[sync] ← ${status} ${method} ${url}`);
};
const logFailure = (method: string, url: string, detail: string) => {
  console.log(`[sync] ✕ ${method} ${url} — ${detail}`);
};

const fetchJson = async <T>(
  url: string,
  apiKey: string,
  init?: RequestInit,
): Promise<T> => {
  const method = init?.method ?? "GET";
  logRequest(method, url);
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        "X-Device-Key": apiKey,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch (e: any) {
    logFailure(method, url, e?.message ?? "network error");
    throw new SyncError("NETWORK_ERROR");
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    logFailure(method, url, `HTTP ${res.status} ${body}`);
    throw new SyncError(body || `HTTP_${res.status}`, res.status);
  }
  logSuccess(method, url, res.status);
  return res.json() as Promise<T>;
};

// Strict — only true once the server has actually confirmed this row (used
// by createDevice() below, which calls a real admin endpoint that needs a
// branch id that genuinely exists server-side already). Everywhere sync
// itself resolves a branch/category/product reference inside push() below,
// use idFor() instead — see its comment for why.
const getServerId = async (
  db: Awaited<ReturnType<typeof getDb>>,
  table: "branches" | "categories" | "products",
  localId: number,
): Promise<string | null> => {
  const row = await db.getFirstAsync<{ server_id: string | null }>(
    `SELECT server_id FROM ${table} WHERE id = ?`,
    [localId],
  );
  return row?.server_id ?? null;
};

// Every branch/category/product gets a sync_uuid the moment it's created
// locally (see branchesRepo.create / productsRepo.createCategory /
// createProduct) — long before it's ever actually reached the server.
// That id is final and stable even if the row hasn't been confirmed yet:
// server_id (set once push() gets a response) is the SAME value normally,
// and only differs in the rare case the server deduped this row onto an
// already-existing one (matched by name/barcode) — so "server_id if we
// have it, else our own sync_uuid" is always a safe, valid id to hand the
// server, including for a row created in this very same push() call. This
// is what lets a brand-new branch/category/product and a sale/movement
// that references it reach the server together in ONE push, instead of
// needing a prior confirmed round-trip first (the old getServerId-based
// gating this replaces required exactly that extra round-trip, which is
// what made freshly-created data sit in "skipped" until a second Sync Now).
const idFor = async (
  db: Awaited<ReturnType<typeof getDb>>,
  table: "branches" | "categories" | "products",
  localId: number,
): Promise<string | null> => {
  const row = await db.getFirstAsync<{
    server_id: string | null;
    sync_uuid: string | null;
  }>(`SELECT server_id, sync_uuid FROM ${table} WHERE id = ?`, [localId]);
  return row?.server_id ?? row?.sync_uuid ?? null;
};

const fetchJsonAdmin = async <T>(
  url: string,
  adminKey: string,
  init?: RequestInit,
): Promise<T> => {
  const method = init?.method ?? "GET";
  logRequest(method, url);
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        "X-Admin-Key": adminKey,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch (e: any) {
    logFailure(method, url, e?.message ?? "network error");
    throw new SyncError("NETWORK_ERROR");
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    logFailure(method, url, `HTTP ${res.status} ${body}`);
    throw new SyncError(body || `HTTP_${res.status}`, res.status);
  }
  logSuccess(method, url, res.status);
  return res.json() as Promise<T>;
};

export const syncRepo = {
  getConfig,
  isConnected: async (): Promise<boolean> => (await getConfig()) !== null,

  // Clears the connection (server_url/device_api_key/bound_branch_id) and
  // the pull/push cursors, but deliberately leaves admin_key alone — it's
  // a separate, device-scoped credential (see setAdminKey's comment), not
  // part of "am I connected", and wiping it on every disconnect meant
  // reconnecting silently dropped this device out of "main branch" status
  // until someone remembered to re-paste it — a real, previously-hit trap.
  disconnect: async (): Promise<void> => {
    const db = await getDb();
    await db.runAsync(
      `UPDATE sync_config SET server_url = NULL, device_api_key = NULL, bound_branch_id = NULL,
         last_pull_at = NULL, last_push_at = NULL WHERE id = 1`,
    );
  },

  // How many rows haven't reached the server yet — checked before
  // disconnecting so the app can warn that they'll never sync once the
  // device key/server URL is gone (see sync-settings.tsx's handleDisconnect).
  getUnsyncedCount: async (): Promise<number> => {
    const db = await getDb();
    const row = await db.getFirstAsync<{ total: number }>(`
      SELECT
        (SELECT COUNT(*) FROM branches WHERE server_id IS NULL AND sync_uuid IS NOT NULL) +
        (SELECT COUNT(*) FROM categories WHERE server_id IS NULL AND sync_uuid IS NOT NULL) +
        (SELECT COUNT(*) FROM products WHERE server_id IS NULL AND sync_uuid IS NOT NULL) +
        (SELECT COUNT(*) FROM products WHERE pending_sync = 1 AND server_id IS NOT NULL) +
        (SELECT COUNT(*) FROM sales WHERE synced_at IS NULL AND sync_uuid IS NOT NULL) +
        (SELECT COUNT(*) FROM stock_movements WHERE synced_at IS NULL AND sync_uuid IS NOT NULL) +
        (SELECT COUNT(*) FROM expenses WHERE synced_at IS NULL AND sync_uuid IS NOT NULL)
        AS total
    `);
    return row?.total ?? 0;
  },

  // First call after the admin hands over a device API key — asks the
  // server which branch this device is permanently bound to (see backend
  // README's "Two kinds of caller"), creates/matches a local branch row for
  // it (matched by server_id so re-connecting the same device is a no-op),
  // and stores the connection. Doesn't pull products/stock yet — call
  // pull() right after this for that.
  //
  // adoptLocalBranchId — this device's currentBranchId right before
  // connecting (branchStore.currentBranchId), i.e. whichever local branch
  // it had been recording sales/stock against while still offline. A
  // device is one branch's worth of local data for its whole life (see
  // branchStore's "one device = one branch, permanently" comment) — the
  // branch the server hands back in `me` isn't a NEW, separate branch,
  // it's this same device's branch finally getting its real identity. So
  // when there's no existing row for server_id yet, this local row is
  // adopted in place (renamed, server_id/sync_uuid stamped onto it)
  // instead of creating a second branch row alongside it. Without this,
  // every sale/expense/stock movement made before the first-ever connect
  // stays attached to the old local-only branch id forever, invisible to
  // every branch-scoped screen from then on — the server ends up with the
  // right data (push()'s name-based dedup papers over it there), but this
  // device's own local copy silently splits in two.
  connect: async (
    serverUrlInput: string,
    deviceApiKey: string,
    adoptLocalBranchId?: number | null,
  ): Promise<{ branchId: number; branchName: string }> => {
    const serverUrl = serverUrlInput.trim().replace(/\/+$/, "");
    if (!serverUrl || !deviceApiKey.trim())
      throw new SyncError("MISSING_CONFIG");

    const me = await fetchJson<DeviceInfoDto>(
      `${serverUrl}/api/sync/me`,
      deviceApiKey,
    );

    const db = await getDb();
    let branchId = 0;
    await db.withTransactionAsync(async () => {
      const existing = await db.getFirstAsync<{ id: number }>(
        "SELECT id FROM branches WHERE server_id = ?",
        [me.branchId],
      );
      if (existing) {
        branchId = existing.id;
        // COALESCE keeps whatever sync_uuid this row already has — it
        // should already equal me.branchId (set by backfillBranchSyncUuids
        // or a prior connect()/push()) — only ever filling in a genuinely
        // missing one, never overwriting.
        await db.runAsync(
          "UPDATE branches SET name = ?, sync_uuid = COALESCE(sync_uuid, ?) WHERE id = ?",
          [me.branchName, me.branchId, branchId],
        );
      } else {
        // Only adopt a local branch that isn't already bound to some OTHER
        // server branch (a device reassigned to a different branch than
        // last time) — that case falls through to a fresh row instead, so
        // its old branch's data is left exactly where it is rather than
        // getting relabeled into the new binding.
        const adoptee =
          adoptLocalBranchId != null
            ? await db.getFirstAsync<{ id: number; server_id: string | null }>(
                "SELECT id, server_id FROM branches WHERE id = ?",
                [adoptLocalBranchId],
              )
            : null;

        if (adoptee && adoptee.server_id == null) {
          await db.runAsync(
            "UPDATE branches SET name = ?, server_id = ?, sync_uuid = ? WHERE id = ?",
            [me.branchName, me.branchId, me.branchId, adoptee.id],
          );
          branchId = adoptee.id;
        } else {
          const { lastInsertRowId } = await db.runAsync(
            "INSERT INTO branches (name, is_active, server_id, sync_uuid) VALUES (?, 1, ?, ?)",
            [me.branchName, me.branchId, me.branchId],
          );
          branchId = lastInsertRowId;
        }
      }

      // last_pull_at/last_push_at MUST reset to NULL here, not carry over —
      // they're pull/push cursors ("give me everything since this
      // timestamp"), and a stale one inherited from a PREVIOUS connect()
      // (this same device rebinding to a different branch, e.g. while
      // testing) silently hides any server data whose received_at/
      // updated_at falls before that old cursor, forever — pull() only
      // ever moves the cursor forward, never back. A fresh connect() is a
      // new identity as far as this device's sync history goes; starting
      // from "pull everything" is always safe, just possibly one larger
      // first pull.
      await db.runAsync(
        `INSERT INTO sync_config (id, server_url, device_api_key, bound_branch_id) VALUES (1, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET server_url = excluded.server_url, device_api_key = excluded.device_api_key,
           bound_branch_id = excluded.bound_branch_id, last_pull_at = NULL, last_push_at = NULL`,
        [serverUrl, deviceApiKey, branchId],
      );
    });

    return { branchId, branchName: me.branchName };
  },

  // Pulls branches/categories/products/branch-stock changed since the last
  // pull and upserts them locally, matched by server_id. Existing
  // local-only rows (server_id NULL — created on-device before this
  // connected, or never synced) are left untouched, not merged or deleted.
  // On the device holding the admin key ("main branch"), also mirrors
  // every branch's sales/stockMovements into remote_sales/
  // remote_stock_movements for the All Branches Activity screen — see the
  // comment further down for why those stay out of sales/stock_movements.
  pull: async (): Promise<{
    branches: number;
    categories: number;
    products: number;
    stockRows: number;
    salesReceived: number;
    movementsReceived: number;
    expensesReceived: number;
  }> => {
    const config = await getConfig();
    if (!config) throw new SyncError("NOT_CONNECTED");

    const since = config.lastPullAt ?? "0001-01-01T00:00:00Z";
    const resp = await fetchJson<PullResponse>(
      `${config.serverUrl}/api/sync/pull?since=${encodeURIComponent(since)}`,
      config.deviceApiKey,
    );

    const db = await getDb();
    let salesReceived = 0;
    let movementsReceived = 0;
    let expensesReceived = 0;
    await db.withTransactionAsync(async () => {
      for (const b of resp.branches) {
        // sync_uuid is only set on INSERT (a branch this device is seeing
        // for the first time via pull, never created locally) — ON
        // CONFLICT deliberately leaves an existing row's sync_uuid alone,
        // same COALESCE-not-overwrite spirit as connect() above.
        await db.runAsync(
          `INSERT INTO branches (name, address, phone, is_active, server_id, sync_uuid) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(server_id) WHERE server_id IS NOT NULL DO UPDATE SET
             name = excluded.name, address = excluded.address, phone = excluded.phone, is_active = excluded.is_active`,
          [b.name, b.address, b.phone, b.isActive ? 1 : 0, b.id, b.id],
        );
      }
      for (const c of resp.categories) {
        await db.runAsync(
          `INSERT INTO categories (name, sort_order, is_active, server_id) VALUES (?, ?, ?, ?)
           ON CONFLICT(server_id) WHERE server_id IS NOT NULL DO UPDATE SET
             name = excluded.name, sort_order = excluded.sort_order, is_active = excluded.is_active`,
          [c.name, c.sortOrder, c.isActive ? 1 : 0, c.id],
        );
      }
      // The trailing `WHERE products.pending_sync = 0` on the upsert below
      // is what keeps a delete from being undone. A full sync pushes before
      // it pulls, so the server already knows by the time the pull answers
      // — but pull() also runs on its own (on connect), and without the
      // guard that lone pull would hand the server's still-active copy back
      // over a row this device has deleted and not yet sent.
      // Thresholds come down on the product, but live on branch_stock
      // locally — see the long note in push() below. Collected here so the
      // branchStock loop underneath can seed a brand-new row with the right
      // value instead of the schema default of 5.
      const thresholdByServerId = new Map<string, number>();
      for (const p of resp.products) {
        const category = await db.getFirstAsync<{ id: number }>(
          "SELECT id FROM categories WHERE server_id = ?",
          [p.categoryId],
        );
        if (!category) continue; // shouldn't happen — categories are applied first, above
        thresholdByServerId.set(p.id, p.lowStockThreshold);
        // wholesale_price and unit are deliberately absent from the ON
        // CONFLICT list and applied by their own statements below instead.
        // Neither can be folded in here: `excluded.unit` is the value this
        // statement is inserting, which COALESCE(?, 'pcs') has already
        // turned into 'pcs', so an update keyed on it would overwrite a
        // real unit with 'pcs' every time an older server answered without
        // the field; and for wholesale_price NULL is a meaningful value
        // ("no wholesale tier"), so COALESCE would make it impossible to
        // clear. The INSERT branch is safe either way — a brand-new row has
        // nothing to preserve.
        await db.runAsync(
          `INSERT INTO products
             (category_id, name, sku, barcode, price, wholesale_price, cost_price, unit, image_uri,
              low_stock_threshold, expiry_date, is_active, sort_order, server_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, 'pcs'), ?, ?, ?, ?, ?, ?)
           ON CONFLICT(server_id) WHERE server_id IS NOT NULL DO UPDATE SET
             category_id = excluded.category_id, name = excluded.name, sku = excluded.sku, barcode = excluded.barcode,
             price = excluded.price, cost_price = excluded.cost_price, image_uri = excluded.image_uri,
             low_stock_threshold = excluded.low_stock_threshold, expiry_date = excluded.expiry_date,
             is_active = excluded.is_active, sort_order = excluded.sort_order
           WHERE products.pending_sync = 0`,
          [
            category.id,
            p.name,
            p.sku,
            p.barcode,
            p.price,
            p.wholesalePrice ?? null,
            p.costPrice,
            p.unit ?? null,
            p.imageUri,
            p.lowStockThreshold,
            p.expiryDate,
            p.isActive ? 1 : 0,
            p.sortOrder,
            p.id,
          ],
        );
        // Each applied only when the server actually carried the field, so
        // an older server leaves this device's values as they were rather
        // than wiping them. `in` rather than a null check for
        // wholesalePrice: null is a real value there, absent is not.
        if ("wholesalePrice" in p) {
          await db.runAsync(
            "UPDATE products SET wholesale_price = ? WHERE server_id = ? AND pending_sync = 0",
            [p.wholesalePrice ?? null, p.id],
          );
        }
        if (p.unit != null) {
          await db.runAsync(
            "UPDATE products SET unit = ? WHERE server_id = ? AND pending_sync = 0",
            [p.unit, p.id],
          );
        }
        // Existing branch_stock rows for this product, on every branch this
        // device knows about — the catalogue is shared, so the threshold is
        // too. Scoped through products so the pending_sync guard above still
        // holds: a product this device has deleted keeps its own values.
        await db.runAsync(
          `UPDATE branch_stock SET low_stock_threshold = ?
           WHERE product_id IN (SELECT id FROM products WHERE server_id = ? AND pending_sync = 0)`,
          [p.lowStockThreshold, p.id],
        );
      }
      for (const bs of resp.branchStock) {
        const branch = await db.getFirstAsync<{ id: number }>(
          "SELECT id FROM branches WHERE server_id = ?",
          [bs.branchId],
        );
        const product = await db.getFirstAsync<{ id: number }>(
          "SELECT id FROM products WHERE server_id = ?",
          [bs.productId],
        );
        if (!branch || !product) continue;
        await db.runAsync(
          `INSERT INTO branch_stock (branch_id, product_id, stock_qty, low_stock_threshold) VALUES (?, ?, ?, COALESCE(?, 5))
           ON CONFLICT(branch_id, product_id) DO UPDATE SET stock_qty = excluded.stock_qty`,
          [
            branch.id,
            product.id,
            bs.stockQty,
            thresholdByServerId.get(bs.productId) ?? null,
          ],
        );
      }

      // Cross-branch sales/stock-movement history — mirrored into
      // remote_sales/remote_stock_movements (never into sales/stock_movements,
      // which drive this device's OWN Sales History/Reports/Inventory feed)
      // and only on the device holding the admin key ("main branch" — see
      // setAdminKey below). A regular branch device's pull() skips this
      // section entirely and only ever sees its own branch's own history.
      if (config.adminKey) {
        for (const saleDto of resp.sales) {
          const existingSale = await db.getFirstAsync<{ id: number }>(
            "SELECT id FROM remote_sales WHERE server_sale_id = ?",
            [saleDto.id],
          );
          if (existingSale) continue;

          const branch = await db.getFirstAsync<{ name: string }>(
            "SELECT name FROM branches WHERE server_id = ?",
            [saleDto.branchId],
          );

          const { lastInsertRowId: remoteSaleId } = await db.runAsync(
            `INSERT INTO remote_sales
               (server_sale_id, branch_name, subtotal, discount, tax_percent, tax_amount, total, tendered,
                change_due, payment_method, cashier_name, customer_name, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              saleDto.id,
              branch?.name ?? saleDto.branchId,
              saleDto.subtotal,
              saleDto.discount,
              saleDto.taxPercent,
              saleDto.taxAmount,
              saleDto.total,
              saleDto.tendered,
              saleDto.changeDue,
              saleDto.paymentMethod,
              saleDto.cashierName,
              saleDto.customerName,
              saleDto.createdAt,
            ],
          );
          for (const item of saleDto.items) {
            await db.runAsync(
              `INSERT INTO remote_sale_items (remote_sale_id, product_name, unit_price, qty, subtotal, discount)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [
                remoteSaleId,
                item.productName,
                item.unitPrice,
                item.qty,
                item.subtotal,
                item.discount,
              ],
            );
          }
          salesReceived++;
        }

        for (const m of resp.stockMovements) {
          const existingMovement = await db.getFirstAsync<{ id: number }>(
            "SELECT id FROM remote_stock_movements WHERE server_movement_id = ?",
            [m.id],
          );
          if (existingMovement) continue;

          const branch = await db.getFirstAsync<{ name: string }>(
            "SELECT name FROM branches WHERE server_id = ?",
            [m.branchId],
          );
          const product = await db.getFirstAsync<{ name: string }>(
            "SELECT name FROM products WHERE server_id = ?",
            [m.productId],
          );

          await db.runAsync(
            `INSERT INTO remote_stock_movements
               (server_movement_id, product_name, branch_name, change_qty, reason, resulting_stock_qty, actor_name, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              m.id,
              product?.name ?? m.productId,
              branch?.name ?? m.branchId,
              m.changeQty,
              m.reason,
              m.resultingStockQty,
              m.actorName,
              m.createdAt,
            ],
          );
          movementsReceived++;
        }

        for (const e of resp.expenses) {
          const existingExpense = await db.getFirstAsync<{ id: number }>(
            "SELECT id FROM remote_expenses WHERE server_expense_id = ?",
            [e.id],
          );
          if (existingExpense) continue;

          const branch = await db.getFirstAsync<{ name: string }>(
            "SELECT name FROM branches WHERE server_id = ?",
            [e.branchId],
          );

          await db.runAsync(
            `INSERT INTO remote_expenses
               (server_expense_id, category, description, amount, branch_name, actor_name, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              e.id,
              e.category,
              e.description,
              e.amount,
              branch?.name ?? e.branchId,
              e.actorName,
              e.createdAt,
            ],
          );
          expensesReceived++;
        }
      }

      await db.runAsync(
        "UPDATE sync_config SET last_pull_at = ? WHERE id = 1",
        [resp.serverTime],
      );
    });

    return {
      branches: resp.branches.length,
      categories: resp.categories.length,
      products: resp.products.length,
      stockRows: resp.branchStock.length,
      salesReceived,
      movementsReceived,
      expensesReceived,
    };
  },

  // Pushes every not-yet-synced branch/category/product/sale/stock
  // movement in ONE request, in dependency order (branches, then
  // categories, then products, then sales/movements) — every id a later
  // section needs from an earlier one is resolved via idFor() above, which
  // is valid immediately (sync_uuid, generated at local creation time),
  // not just once a prior push has been confirmed. That's what lets a
  // branch/category/product created offline and a sale/movement that
  // references it reach the server together in the SAME push — "skipped"
  // below is now only a genuine data-integrity signal (a reference to a
  // local row with no id at all, which backfillBranchSyncUuids/
  // backfillSyncUuids in database.ts should already have ruled out), not
  // the routine "wait for the next Sync Now" outcome it used to be.
  push: async (): Promise<{
    salesPushed: number;
    movementsPushed: number;
    skipped: number;
  }> => {
    const config = await getConfig();
    if (!config) throw new SyncError("NOT_CONNECTED");

    const db = await getDb();
    let skipped = 0;

    const branchRows = await db.getAllAsync<{
      id: number;
      name: string;
      address: string | null;
      phone: string | null;
      is_active: number;
      sync_uuid: string;
    }>(
      "SELECT id, name, address, phone, is_active, sync_uuid FROM branches WHERE server_id IS NULL AND sync_uuid IS NOT NULL",
    );
    const branches: BranchPushDto[] = branchRows.map((b) => ({
      id: b.sync_uuid,
      name: b.name,
      address: b.address,
      phone: b.phone,
      isActive: !!b.is_active,
    }));

    const categoryRows = await db.getAllAsync<{
      id: number;
      name: string;
      sort_order: number;
      is_active: number;
      sync_uuid: string;
    }>(
      "SELECT id, name, sort_order, is_active, sync_uuid FROM categories WHERE server_id IS NULL AND sync_uuid IS NOT NULL",
    );
    const categories: CategoryPushDto[] = categoryRows.map((c) => ({
      id: c.sync_uuid,
      name: c.name,
      sortOrder: c.sort_order,
      isActive: !!c.is_active,
    }));

    // low_stock_threshold is read from branch_stock, NOT from the products
    // column of the same name. The products column exists but nothing in the
    // app ever writes it: every screen that edits a threshold writes the
    // branch_stock row (productsRepo's PRODUCT_COLUMNS reads
    // `COALESCE(bs.low_stock_threshold, 5)`, and createProduct/adjustStock
    // write it there), because a threshold is per-branch locally. Pushing
    // the products column instead sent the schema default of 5 for every
    // product no matter what the shop had set, which is exactly what made
    // the low-stock alerts come back wrong on a second device.
    //
    // The bound branch's row is the one that speaks for this device; any
    // other branch's row is the fallback for the case where the bound
    // branch somehow has none.
    const localBranch = await db.getFirstAsync<{ id: number }>(
      "SELECT id FROM branches WHERE server_id = ?",
      [config.boundBranchId],
    );
    const productRows = await db.getAllAsync<{
      id: number;
      category_id: number;
      name: string;
      sku: string | null;
      barcode: string | null;
      price: number;
      wholesale_price: number | null;
      cost_price: number;
      unit: string;
      image_uri: string | null;
      low_stock_threshold: number;
      expiry_date: string | null;
      is_active: number;
      sort_order: number;
      sync_uuid: string;
      server_id: string | null;
      updated_at: string | null;
    }>(
      `SELECT p.id, p.category_id, p.name, p.sku, p.barcode, p.price, p.wholesale_price,
               p.cost_price, p.unit, p.image_uri,
               COALESCE(
                 (SELECT low_stock_threshold FROM branch_stock WHERE product_id = p.id AND branch_id = ?),
                 (SELECT low_stock_threshold FROM branch_stock WHERE product_id = p.id ORDER BY branch_id LIMIT 1),
                 p.low_stock_threshold
               ) AS low_stock_threshold,
               p.expiry_date, p.is_active, p.sort_order, p.sync_uuid, p.server_id, p.updated_at
        FROM products p
        WHERE (p.server_id IS NULL AND p.sync_uuid IS NOT NULL)
           -- Edits. Without this line a product that had already reached the
           -- server was never looked at again, so correcting a price or a
           -- name on one till stayed on that till forever while creating a
           -- product synced normally -- which is exactly how a shop ends up
           -- with two branches ringing up different prices for one item.
           OR (p.server_id IS NOT NULL AND p.pending_sync = 0
               AND p.updated_at IS NOT NULL
               AND (p.synced_at IS NULL OR p.updated_at > p.synced_at))`,
      [localBranch?.id ?? -1],
    );
    const products: ProductPushDto[] = [];
    // The ids of the edits in this push, so their synced_at can be stamped
    // once the server has actually taken them.
    const editedLocalIds: number[] = [];
    for (const p of productRows) {
      const categoryId = await idFor(db, "categories", p.category_id);
      if (!categoryId) {
        skipped++;
        continue;
      } // its category has no id at all yet — shouldn't happen, see comment above
      if (p.server_id) editedLocalIds.push(p.id);
      products.push({
        // A new product is announced under the id this device invented for
        // it; an edit under the id the server already files it as, or the
        // server would treat the edit as a second product.
        id: p.server_id ?? p.sync_uuid,
        updatedAt: p.server_id ? p.updated_at : null,
        categoryId,
        name: p.name,
        sku: p.sku,
        barcode: p.barcode,
        price: p.price,
        wholesalePrice: p.wholesale_price,
        costPrice: p.cost_price,
        unit: p.unit,
        imageUri: p.image_uri,
        lowStockThreshold: p.low_stock_threshold,
        expiryDate: p.expiry_date,
        isActive: !!p.is_active,
        sortOrder: p.sort_order,
      });
    }

    // Products deleted here that the server still has. Sent as ids only —
    // the server's copy is the one being retired, and nothing else about
    // the row matters once it is.
    const deletedRows = await db.getAllAsync<{ server_id: string }>(
      "SELECT server_id FROM products WHERE pending_sync = 1 AND server_id IS NOT NULL",
    );
    const deletedProducts = deletedRows.map((r) => r.server_id);

    const saleRows = await db.getAllAsync<{
      id: number;
      subtotal: number;
      discount: number;
      tax_percent: number;
      tax_amount: number;
      total: number;
      tendered: number;
      change_due: number;
      payment_method: string;
      cashier_name: string | null;
      customer_name: string | null;
      branch_id: number;
      sync_uuid: string;
      created_at: string;
    }>(
      "SELECT * FROM sales WHERE synced_at IS NULL AND sync_uuid IS NOT NULL ORDER BY id",
    );

    const sales: SaleDto[] = [];
    for (const s of saleRows) {
      const branchId = await idFor(db, "branches", s.branch_id);
      if (!branchId) {
        skipped++;
        continue;
      }

      const itemRows = await db.getAllAsync<{
        product_id: number;
        product_name: string;
        unit_price: number;
        qty: number;
        subtotal: number;
        discount: number;
      }>(
        "SELECT product_id, product_name, unit_price, qty, subtotal, discount FROM sale_items WHERE sale_id = ?",
        [s.id],
      );
      const items: SaleItemDto[] = [];
      let itemsOk = true;
      for (const i of itemRows) {
        const productId = await idFor(db, "products", i.product_id);
        if (!productId) {
          itemsOk = false;
          break;
        }
        items.push({
          id: Crypto.randomUUID(),
          productId,
          productName: i.product_name,
          unitPrice: i.unit_price,
          qty: i.qty,
          subtotal: i.subtotal,
          discount: i.discount,
        });
      }
      if (!itemsOk) {
        skipped++;
        continue;
      }

      sales.push({
        id: s.sync_uuid,
        branchId,
        subtotal: s.subtotal,
        discount: s.discount,
        taxPercent: s.tax_percent,
        taxAmount: s.tax_amount,
        total: s.total,
        tendered: s.tendered,
        changeDue: s.change_due,
        paymentMethod: s.payment_method,
        cashierName: s.cashier_name,
        customerName: s.customer_name,
        createdAt: s.created_at,
        items,
      });
    }

    const movementRows = await db.getAllAsync<{
      id: number;
      product_id: number;
      branch_id: number;
      change_qty: number;
      reason: string;
      resulting_stock_qty: number;
      actor_name: string | null;
      sync_uuid: string;
      created_at: string;
    }>(
      "SELECT * FROM stock_movements WHERE synced_at IS NULL AND sync_uuid IS NOT NULL ORDER BY id",
    );

    const movements: StockMovementDto[] = [];
    for (const m of movementRows) {
      const branchId = await idFor(db, "branches", m.branch_id);
      const productId = await idFor(db, "products", m.product_id);
      if (!branchId || !productId) {
        skipped++;
        continue;
      }
      movements.push({
        id: m.sync_uuid,
        productId,
        branchId,
        changeQty: m.change_qty,
        reason: m.reason,
        resultingStockQty: m.resulting_stock_qty,
        actorName: m.actor_name,
        createdAt: m.created_at,
      });
    }

    const expenseRows = await db.getAllAsync<{
      id: number;
      category: string;
      description: string | null;
      amount: number;
      branch_id: number;
      actor_name: string | null;
      sync_uuid: string;
      created_at: string;
    }>(
      "SELECT * FROM expenses WHERE synced_at IS NULL AND sync_uuid IS NOT NULL ORDER BY id",
    );

    const expenses: ExpenseDto[] = [];
    for (const e of expenseRows) {
      const branchId = await idFor(db, "branches", e.branch_id);
      if (!branchId) {
        skipped++;
        continue;
      }
      expenses.push({
        id: e.sync_uuid,
        branchId,
        category: e.category,
        description: e.description,
        amount: e.amount,
        actorName: e.actor_name,
        createdAt: e.created_at,
      });
    }

    if (
      branches.length === 0 &&
      categories.length === 0 &&
      products.length === 0 &&
      sales.length === 0 &&
      movements.length === 0 &&
      expenses.length === 0 &&
      deletedProducts.length === 0
    ) {
      return { salesPushed: 0, movementsPushed: 0, skipped };
    }

    const resp = await fetchJson<PushResponse>(
      `${config.serverUrl}/api/sync/push`,
      config.deviceApiKey,
      {
        method: "POST",
        body: JSON.stringify({
          branches,
          categories,
          products,
          deletedProducts,
          sales,
          stockMovements: movements,
          expenses,
        }),
      },
    );

    const now = new Date().toISOString();

    // Edits the server has now taken. Stamped only after the push succeeded
    // — a failed push throws above, leaving updated_at ahead of synced_at so
    // the edit is picked up again next time rather than quietly lost.
    for (const localId of editedLocalIds) {
      await db.runAsync("UPDATE products SET synced_at = ? WHERE id = ?", [
        now,
        localId,
      ]);
    }

    // The server has retired them; stop resending. Cleared only after the
    // push succeeds — a failed push throws above, and the flag survives to
    // be retried on the next one.
    for (const serverId of deletedProducts) {
      await db.runAsync(
        "UPDATE products SET pending_sync = 0 WHERE server_id = ?",
        [serverId],
      );
    }

    // Setting server_id on the row identified by clientId (sync_uuid) is
    // only safe when no OTHER local row already owns that server_id.
    // That collision is real, not theoretical: this device can independently
    // pull down a canonical row (server_id already set locally) AND, later,
    // push an offline-created row that the server deduped onto that exact
    // same canonical row (by branch/category name, or product barcode) —
    // two local rows would then both want the same server_id, which the
    // partial UNIQUE index on server_id rejects outright (this is the
    // "UNIQUE constraint failed: products.server_id" crash). The correct
    // resolution isn't to skip the update (that would just re-trigger the
    // exact same dedup, and the exact same collision, on every future
    // push, forever) — it's to recognize the local row being updated IS a
    // duplicate of the row that already owns that server_id, merge
    // whatever it references onto the canonical row, and delete it.
    const mergeDuplicate = async (
      table: "branches" | "categories" | "products",
      clientId: string,
      serverId: string,
    ) => {
      const canonical = await db.getFirstAsync<{ id: number }>(
        `SELECT id FROM ${table} WHERE server_id = ?`,
        [serverId],
      );
      const dup = await db.getFirstAsync<{ id: number }>(
        `SELECT id FROM ${table} WHERE sync_uuid = ?`,
        [clientId],
      );
      if (!dup) return; // shouldn't happen — we just pushed this row by its own sync_uuid
      if (!canonical || canonical.id === dup.id) {
        await db.runAsync(`UPDATE ${table} SET server_id = ? WHERE id = ?`, [
          serverId,
          dup.id,
        ]);
        return;
      }

      if (table === "categories") {
        await db.runAsync(
          "UPDATE products SET category_id = ? WHERE category_id = ?",
          [canonical.id, dup.id],
        );
      } else if (table === "products") {
        // branch_stock has a UNIQUE(branch_id, product_id) constraint, so a
        // plain repoint could collide too — merge quantities instead of
        // overwriting either side's count.
        const dupStock = await db.getAllAsync<{
          branch_id: number;
          stock_qty: number;
          low_stock_threshold: number;
        }>(
          "SELECT branch_id, stock_qty, low_stock_threshold FROM branch_stock WHERE product_id = ?",
          [dup.id],
        );
        for (const s of dupStock) {
          const existing = await db.getFirstAsync<{
            id: number;
            stock_qty: number;
          }>(
            "SELECT id, stock_qty FROM branch_stock WHERE branch_id = ? AND product_id = ?",
            [s.branch_id, canonical.id],
          );
          if (existing) {
            await db.runAsync(
              "UPDATE branch_stock SET stock_qty = ? WHERE id = ?",
              [existing.stock_qty + s.stock_qty, existing.id],
            );
          } else {
            await db.runAsync(
              "INSERT INTO branch_stock (branch_id, product_id, stock_qty, low_stock_threshold) VALUES (?, ?, ?, ?)",
              [s.branch_id, canonical.id, s.stock_qty, s.low_stock_threshold],
            );
          }
        }
        await db.runAsync("DELETE FROM branch_stock WHERE product_id = ?", [
          dup.id,
        ]);
        // These have no uniqueness tied to product_id — a plain repoint
        // preserves history instead of losing it.
        for (const t of [
          "sale_items",
          "stock_movements",
          "purchase_items",
          "refund_items",
        ] as const) {
          await db.runAsync(
            `UPDATE ${t} SET product_id = ? WHERE product_id = ?`,
            [canonical.id, dup.id],
          );
        }
      } else {
        // table === "branches" — same additive-merge idea for branch_stock,
        // plain repoint for everything else branch-scoped.
        const dupStock = await db.getAllAsync<{
          product_id: number;
          stock_qty: number;
          low_stock_threshold: number;
        }>(
          "SELECT product_id, stock_qty, low_stock_threshold FROM branch_stock WHERE branch_id = ?",
          [dup.id],
        );
        for (const s of dupStock) {
          const existing = await db.getFirstAsync<{
            id: number;
            stock_qty: number;
          }>(
            "SELECT id, stock_qty FROM branch_stock WHERE branch_id = ? AND product_id = ?",
            [canonical.id, s.product_id],
          );
          if (existing) {
            await db.runAsync(
              "UPDATE branch_stock SET stock_qty = ? WHERE id = ?",
              [existing.stock_qty + s.stock_qty, existing.id],
            );
          } else {
            await db.runAsync(
              "INSERT INTO branch_stock (branch_id, product_id, stock_qty, low_stock_threshold) VALUES (?, ?, ?, ?)",
              [canonical.id, s.product_id, s.stock_qty, s.low_stock_threshold],
            );
          }
        }
        await db.runAsync("DELETE FROM branch_stock WHERE branch_id = ?", [
          dup.id,
        ]);
        for (const t of [
          "sales",
          "stock_movements",
          "expenses",
          "purchases",
        ] as const) {
          await db.runAsync(
            `UPDATE ${t} SET branch_id = ? WHERE branch_id = ?`,
            [canonical.id, dup.id],
          );
        }
        // This device's own bound branch (sync_config) should never be the
        // one being deleted here — connect() always matches or creates by
        // server_id up front — but repoint defensively rather than leave a
        // dangling reference in the impossible case it somehow was.
        await db.runAsync(
          "UPDATE sync_config SET bound_branch_id = ? WHERE bound_branch_id = ?",
          [canonical.id, dup.id],
        );
      }
      await db.runAsync(`DELETE FROM ${table} WHERE id = ?`, [dup.id]);
    };

    await db.withTransactionAsync(async () => {
      // Accepted means the server now has a row for this — usually at the
      // id this device proposed, but serverId differs from clientId when
      // the server deduped it onto an already-existing branch/category/
      // product (matched by name/barcode) — see mergeDuplicate above for
      // why that needs more than a plain UPDATE.
      for (const { clientId, serverId } of resp.acceptedBranches) {
        await mergeDuplicate("branches", clientId, serverId);
      }
      for (const { clientId, serverId } of resp.acceptedCategories) {
        await mergeDuplicate("categories", clientId, serverId);
      }
      for (const { clientId, serverId } of resp.acceptedProducts) {
        await mergeDuplicate("products", clientId, serverId);
      }
      for (const uuid of resp.acceptedSaleIds) {
        await db.runAsync(
          "UPDATE sales SET synced_at = ? WHERE sync_uuid = ?",
          [now, uuid],
        );
      }
      for (const uuid of resp.acceptedMovementIds) {
        await db.runAsync(
          "UPDATE stock_movements SET synced_at = ? WHERE sync_uuid = ?",
          [now, uuid],
        );
      }
      for (const uuid of resp.acceptedExpenseIds) {
        await db.runAsync(
          "UPDATE expenses SET synced_at = ? WHERE sync_uuid = ?",
          [now, uuid],
        );
      }
      for (const bs of resp.updatedStock) {
        const branch = await db.getFirstAsync<{ id: number }>(
          "SELECT id FROM branches WHERE server_id = ?",
          [bs.branchId],
        );
        const product = await db.getFirstAsync<{ id: number }>(
          "SELECT id FROM products WHERE server_id = ?",
          [bs.productId],
        );
        if (!branch || !product) continue;
        await db.runAsync(
          `INSERT INTO branch_stock (branch_id, product_id, stock_qty) VALUES (?, ?, ?)
           ON CONFLICT(branch_id, product_id) DO UPDATE SET stock_qty = excluded.stock_qty`,
          [branch.id, product.id, bs.stockQty],
        );
      }
      await db.runAsync(
        "UPDATE sync_config SET last_push_at = ? WHERE id = 1",
        [now],
      );
    });

    return {
      salesPushed: resp.acceptedSaleIds.length,
      movementsPushed: resp.acceptedMovementIds.length,
      skipped,
    };
  },

  // Convenience for the "Sync Now" button — push first (so this device's
  // own changes are on the server before pulling), then pull.
  /**
   * Re-fetches every branch's history from the beginning and rebuilds the
   * All Branches mirror.
   *
   * The mirror is filled by the ordinary pull, which only ever asks for what
   * changed since the last one — so any sale it missed is missed for good.
   * Two ways that happens: this device pulled before its admin key was set
   * (the mirror is skipped entirely without one, while the watermark still
   * moves), or a restored backup cleared the mirror tables. Either way the
   * history is simply absent and no amount of ordinary syncing brings it
   * back.
   *
   * Winding the watermark back to the beginning is what does. Everything
   * else the pull touches is an upsert keyed on server_id, so re-reading
   * from the start rewrites the same rows with the same values rather than
   * duplicating them; the mirror inserts skip anything already held.
   */
  rebuildRemoteHistory: async (): Promise<number> => {
    const db = await getDb();
    await db.runAsync(
      "UPDATE sync_config SET last_pull_at = NULL WHERE id = 1",
    );
    const result = await syncRepo.pull();
    return (
      result.salesReceived + result.movementsReceived + result.expensesReceived
    );
  },

  syncNow: async (): Promise<{
    salesPushed: number;
    movementsPushed: number;
    skipped: number;
    pulled: number;
  }> => {
    const pushResult = await syncRepo.push();
    const pullResult = await syncRepo.pull();
    return {
      ...pushResult,
      pulled:
        pullResult.branches +
        pullResult.categories +
        pullResult.products +
        pullResult.stockRows +
        pullResult.salesReceived +
        pullResult.movementsReceived +
        pullResult.expensesReceived,
    };
  },

  // Optional — lets this device call the admin-only endpoints below
  // directly instead of only Bruno/curl. Separate from deviceApiKey:
  // losing this key only matters to this one device, not the whole shop's
  // data (unlike deviceApiKey which is scoped to one branch by design).
  setAdminKey: async (adminKey: string): Promise<void> => {
    const config = await getConfig();
    if (!config) throw new SyncError("NOT_CONNECTED");
    const db = await getDb();
    await db.runAsync("UPDATE sync_config SET admin_key = ? WHERE id = 1", [
      adminKey.trim() || null,
    ]);
  },

  // Registers a new phone/tablet for a branch — the same call Bruno/curl's
  // POST /api/devices makes. The branch must already have a server_id
  // (created via createBranch() above or pulled from the server). Returns
  // the freshly-issued device key to hand to that phone's Settings >
  // Server Sync > Connect screen — nothing to pull() afterward, devices
  // aren't part of the mobile app's own local schema.
  createDevice: async (
    name: string,
    branchId: number,
  ): Promise<{ apiKey: string }> => {
    const config = await getConfig();
    if (!config) throw new SyncError("NOT_CONNECTED");
    if (!config.adminKey) throw new SyncError("NO_ADMIN_KEY");

    const db = await getDb();
    const branchServerId = await getServerId(db, "branches", branchId);
    if (!branchServerId) throw new SyncError("BRANCH_NOT_SYNCED");

    const created = await fetchJsonAdmin<{ deviceId: string; apiKey: string }>(
      `${config.serverUrl}/api/devices`,
      config.adminKey,
      {
        method: "POST",
        body: JSON.stringify({ name, branchId: branchServerId }),
      },
    );
    return { apiKey: created.apiKey };
  },

  // Admin-only convenience: create master data directly on the server (so
  // every connected branch eventually sees it, not just this device) via
  // the same admin endpoints Bruno/curl uses, then immediately pull() so
  // it shows up locally without waiting for the next Sync Now.
  createBranch: async (
    name: string,
    address?: string,
    phone?: string,
  ): Promise<void> => {
    const config = await getConfig();
    if (!config) throw new SyncError("NOT_CONNECTED");
    if (!config.adminKey) throw new SyncError("NO_ADMIN_KEY");
    await fetchJsonAdmin(`${config.serverUrl}/api/branches`, config.adminKey, {
      method: "POST",
      body: JSON.stringify({
        name,
        address: address ?? null,
        phone: phone ?? null,
      }),
    });
    await syncRepo.pull();
  },

  // All Branches Activity screen — only ever has rows on the device
  // holding the admin key (see pull()'s remote_sales/remote_stock_movements
  // mirroring above); empty on every other device.
  getRemoteSales: async (limit = 200): Promise<RemoteSale[]> => {
    const db = await getDb();
    const rows = await db.getAllAsync<{
      id: number;
      branch_name: string | null;
      total: number;
      payment_method: string;
      cashier_name: string | null;
      customer_name: string | null;
      created_at: string;
    }>(
      "SELECT id, branch_name, total, payment_method, cashier_name, customer_name, created_at FROM remote_sales ORDER BY created_at DESC LIMIT ?",
      [limit],
    );
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    const placeholders = ids.map(() => "?").join(",");
    const itemRows = await db.getAllAsync<{
      remote_sale_id: number;
      product_name: string;
      unit_price: number;
      qty: number;
      subtotal: number;
    }>(
      `SELECT remote_sale_id, product_name, unit_price, qty, subtotal FROM remote_sale_items WHERE remote_sale_id IN (${placeholders})`,
      ids,
    );

    return rows.map((r) => ({
      id: r.id,
      branchName: r.branch_name,
      total: r.total,
      paymentMethod: r.payment_method,
      cashierName: r.cashier_name,
      customerName: r.customer_name,
      createdAt: r.created_at,
      items: itemRows
        .filter((i) => i.remote_sale_id === r.id)
        .map((i) => ({
          productName: i.product_name,
          unitPrice: i.unit_price,
          qty: i.qty,
          subtotal: i.subtotal,
        })),
    }));
  },

  getRemoteStockMovements: async (
    limit = 200,
  ): Promise<RemoteStockMovement[]> => {
    const db = await getDb();
    const rows = await db.getAllAsync<{
      id: number;
      product_name: string;
      branch_name: string | null;
      change_qty: number;
      reason: string;
      resulting_stock_qty: number;
      actor_name: string | null;
      created_at: string;
    }>(
      "SELECT * FROM remote_stock_movements ORDER BY created_at DESC LIMIT ?",
      [limit],
    );
    return rows.map((r) => ({
      id: r.id,
      productName: r.product_name,
      branchName: r.branch_name,
      changeQty: r.change_qty,
      reason: r.reason,
      resultingStockQty: r.resulting_stock_qty,
      actorName: r.actor_name,
      createdAt: r.created_at,
    }));
  },

  getRemoteExpenses: async (limit = 200): Promise<RemoteExpense[]> => {
    const db = await getDb();
    const rows = await db.getAllAsync<{
      id: number;
      category: string;
      description: string | null;
      amount: number;
      branch_name: string | null;
      actor_name: string | null;
      created_at: string;
    }>("SELECT * FROM remote_expenses ORDER BY created_at DESC LIMIT ?", [
      limit,
    ]);
    return rows.map((r) => ({
      id: r.id,
      category: r.category,
      description: r.description,
      amount: r.amount,
      branchName: r.branch_name,
      actorName: r.actor_name,
      createdAt: r.created_at,
    }));
  },
};
