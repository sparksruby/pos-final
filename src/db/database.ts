import * as SQLite from "expo-sqlite";
import * as Crypto from "expo-crypto";

const DB_NAME = "pos.db";

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export const getDb = (): Promise<SQLite.SQLiteDatabase> => {
  if (!dbPromise) dbPromise = SQLite.openDatabaseAsync(DB_NAME);
  return dbPromise;
};

const SCHEMA = `
PRAGMA foreign_keys = ON;

-- A single install still holds one shared database (there's no backend to
-- sync separate installs) — branches are a logical partition inside it:
-- shared catalog, but stock (branch_stock) and sales are tracked per branch.
-- server_id (a GUID string) is set once this branch has been matched to a
-- row on the optional sync backend (backend/) — NULL means "local only,
-- never synced". See sync_config below and src/db/syncRepo.ts.
CREATE TABLE IF NOT EXISTS branches (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  address    TEXT,
  phone      TEXT,
  is_active  INTEGER NOT NULL DEFAULT 1,
  server_id  TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS branch_stock (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  branch_id           INTEGER NOT NULL REFERENCES branches(id),
  product_id          INTEGER NOT NULL,
  stock_qty           INTEGER NOT NULL DEFAULT 0,
  low_stock_threshold INTEGER NOT NULL DEFAULT 5,
  UNIQUE(branch_id, product_id)
);

CREATE TABLE IF NOT EXISTS stock_transfers (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id        INTEGER NOT NULL,
  product_name      TEXT NOT NULL,
  from_branch_id    INTEGER NOT NULL,
  from_branch_name  TEXT NOT NULL,
  to_branch_id      INTEGER NOT NULL,
  to_branch_name    TEXT NOT NULL,
  qty               INTEGER NOT NULL,
  actor_name        TEXT,
  notes             TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  INTEGER NOT NULL DEFAULT 1,
  server_id  TEXT
);

CREATE TABLE IF NOT EXISTS products (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id        INTEGER NOT NULL REFERENCES categories(id),
  name               TEXT NOT NULL,
  sku                TEXT,
  barcode            TEXT,
  price              REAL NOT NULL,
  cost_price         REAL NOT NULL DEFAULT 0,
  -- wholesale_price is optional: NULL means "no wholesale tier, always sell
  -- at price" — see cartStore's priceMode for how a sale picks one or the
  -- other.
  wholesale_price    REAL,
  -- Free-text label (pcs/kg/box/litre/...), display only — no unit
  -- conversion math, stock_qty is always counted in this unit.
  unit               TEXT NOT NULL DEFAULT 'pcs',
  image_uri          TEXT,
  stock_qty          INTEGER NOT NULL DEFAULT 0,
  low_stock_threshold INTEGER NOT NULL DEFAULT 5,
  expiry_date        TEXT,
  is_active          INTEGER NOT NULL DEFAULT 1,
  sort_order         INTEGER NOT NULL DEFAULT 0,
  server_id          TEXT,
  -- 1 means "deleted on this device, and the server has not been told yet".
  -- The row stays behind as a tombstone rather than going, because a real
  -- DELETE leaves nothing to push and the next pull simply hands the product
  -- back — see productsRepo.deleteProduct and syncRepo's pending_sync = 0
  -- guards.
  pending_sync       INTEGER NOT NULL DEFAULT 0,
  -- updated_at is stamped on every local edit; synced_at when that edit
  -- reached the server. updated_at > synced_at means "this device has an
  -- edit the server has not seen" -- see syncRepo.push().
  updated_at         TEXT,
  synced_at          TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Suppliers a shop buys stock from. Purchase history and outstanding debt
-- both live on 'purchases' below rather than as separate ledgers.
CREATE TABLE IF NOT EXISTS suppliers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  phone      TEXT,
  address    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One purchase = one supplier invoice. 'paid_amount'/'status' track how much
-- of it has been settled; 'supplier_payments' below is the payment log that
-- adds up to 'paid_amount'. Stock and cost_price update immediately when a
-- purchase is created (see purchasesRepo) — there's no separate "receive"
-- step, matching the app's single-shot (no approval workflow) design.
CREATE TABLE IF NOT EXISTS purchases (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id   INTEGER NOT NULL REFERENCES suppliers(id),
  supplier_name TEXT NOT NULL,
  invoice_no    TEXT,
  subtotal      REAL NOT NULL,
  total         REAL NOT NULL,
  paid_amount   REAL NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'Unpaid',
  notes         TEXT,
  branch_id     INTEGER,
  branch_name   TEXT,
  actor_name    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS purchase_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id  INTEGER NOT NULL REFERENCES purchases(id),
  product_id   INTEGER NOT NULL,
  product_name TEXT NOT NULL,
  qty          INTEGER NOT NULL,
  unit_cost    REAL NOT NULL,
  subtotal     REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS supplier_payments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  purchase_id INTEGER NOT NULL REFERENCES purchases(id),
  amount      REAL NOT NULL,
  notes       TEXT,
  actor_name  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sync_uuid identifies this row to the optional sync backend (generated
-- locally at insert time, NOT server-assigned, so two offline devices can
-- never generate a colliding id); synced_at is NULL until it's been pushed
-- successfully. Both stay NULL forever on a device that's never connected
-- to a server — see src/db/syncRepo.ts.
CREATE TABLE IF NOT EXISTS stock_movements (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id          INTEGER NOT NULL,
  product_name        TEXT NOT NULL,
  change_qty          INTEGER NOT NULL,
  reason              TEXT NOT NULL,
  resulting_stock_qty INTEGER NOT NULL,
  branch_id           INTEGER,
  branch_name         TEXT,
  actor_name          TEXT,
  sync_uuid           TEXT,
  synced_at           TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sales (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  subtotal       REAL NOT NULL,
  discount       REAL NOT NULL DEFAULT 0,
  tax_percent    REAL NOT NULL DEFAULT 0,
  tax_amount     REAL NOT NULL DEFAULT 0,
  total          REAL NOT NULL,
  tendered       REAL NOT NULL DEFAULT 0,
  change_due     REAL NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL,
  cashier_id     INTEGER,
  cashier_name   TEXT,
  customer_id    INTEGER,
  customer_name  TEXT,
  customer_phone TEXT,
  points_earned   INTEGER NOT NULL DEFAULT 0,
  points_redeemed INTEGER NOT NULL DEFAULT 0,
  shift_id       INTEGER,
  branch_id      INTEGER,
  branch_name    TEXT,
  sync_uuid      TEXT,
  synced_at      TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sale_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id      INTEGER NOT NULL REFERENCES sales(id),
  product_id   INTEGER NOT NULL,
  product_name TEXT NOT NULL,
  unit_price   REAL NOT NULL,
  -- Snapshot of the product's unit label at sale time (same idea as
  -- product_name) so a later edit to the product doesn't rewrite history.
  unit         TEXT NOT NULL DEFAULT 'pcs',
  qty          INTEGER NOT NULL,
  subtotal     REAL NOT NULL,
  discount     REAL NOT NULL DEFAULT 0,
  refunded_qty INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS refunds (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id    INTEGER NOT NULL REFERENCES sales(id),
  amount     REAL NOT NULL,
  reason     TEXT,
  actor_name TEXT,
  shift_id   INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS refund_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  refund_id     INTEGER NOT NULL REFERENCES refunds(id),
  sale_item_id  INTEGER NOT NULL,
  product_id    INTEGER NOT NULL,
  product_name  TEXT NOT NULL,
  qty           INTEGER NOT NULL,
  unit_price    REAL NOT NULL,
  amount        REAL NOT NULL
);

-- Populated only for sales paid with a mix of methods (sales.payment_method
-- = 'Split'); a plain Cash/Card/QR sale has no rows here.
CREATE TABLE IF NOT EXISTS sale_payments (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id),
  method  TEXT NOT NULL,
  amount  REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  phone          TEXT,
  email          TEXT,
  loyalty_points INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'Admin',
  is_active     INTEGER NOT NULL DEFAULT 1
);

-- At most one row has status = 'open' at a time — the register is a single
-- shared drawer on this device, not per-cashier.
CREATE TABLE IF NOT EXISTS shifts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  cashier_id    INTEGER,
  cashier_name  TEXT,
  opening_cash  REAL NOT NULL DEFAULT 0,
  closing_cash  REAL,
  expected_cash REAL,
  difference    REAL,
  status        TEXT NOT NULL DEFAULT 'open',
  notes         TEXT,
  opened_at     TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at     TEXT
);

CREATE TABLE IF NOT EXISTS shop_settings (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  name           TEXT,
  address        TEXT,
  phone          TEXT,
  tax_percent    REAL NOT NULL DEFAULT 0,
  currency       TEXT DEFAULT '$',
  receipt_header TEXT,
  receipt_footer TEXT,
  loyalty_enabled    INTEGER NOT NULL DEFAULT 0,
  loyalty_earn_rate   REAL NOT NULL DEFAULT 1,
  loyalty_redeem_rate REAL NOT NULL DEFAULT 0.01,

  -- Automatic barcode/SKU numbering for products the shop packs itself,
  -- which have nothing printed to scan. Off by default: a shop stocking
  -- only branded goods should never find codes it did not ask for.
  --
  -- The barcode prefix defaults to '2' because that range is set aside
  -- worldwide for a shop's own internal use, so a generated code cannot
  -- collide with a real manufacturer's barcode on something else on the
  -- same shelf -- which would ring up the wrong product at the till, and
  -- only on the day both happened to be in stock.
  auto_barcode_enabled INTEGER NOT NULL DEFAULT 0,
  auto_barcode_prefix  TEXT NOT NULL DEFAULT '2',
  auto_barcode_next    INTEGER NOT NULL DEFAULT 1,
  auto_sku_enabled     INTEGER NOT NULL DEFAULT 0,
  auto_sku_prefix      TEXT NOT NULL DEFAULT 'SKU',
  auto_sku_next        INTEGER NOT NULL DEFAULT 1,

  -- Which till this is, when a shop has more than one. It goes into the
  -- middle of every generated code, and it is the only thing keeping two
  -- offline devices from handing the same barcode to two different
  -- products: each counts alone, neither can see the other until they
  -- sync, and by then both labels are printed and stuck on. Shops with a
  -- single device never touch this.
  auto_code_till       INTEGER NOT NULL DEFAULT 1
);

-- At most one row (id = 1). Presence of server_url + device_api_key means
-- this device is connected to a sync backend and permanently bound to
-- bound_branch_id — see src/store/syncStore.ts and
-- src/store/branchStore.ts (which locks the branch switcher once this is
-- set). Absent/empty means fully offline, same as before sync existed.
CREATE TABLE IF NOT EXISTS sync_config (
  id                INTEGER PRIMARY KEY CHECK (id = 1),
  server_url        TEXT,
  device_api_key    TEXT,
  bound_branch_id   INTEGER REFERENCES branches(id),
  last_pull_at      TEXT,
  last_push_at      TEXT
);

-- Read-only mirror of every branch's sales/stock-movement history, pulled
-- from the server for the "All Branches Activity" screen. Deliberately
-- separate from sales/sale_items/stock_movements — those tables drive this
-- device's own Sales History/Reports/Inventory feed, and mixing other
-- branches' history into them would make this device's own numbers wrong.
-- Only ever populated on the device holding the admin key (see
-- sync_config.admin_key / "main branch" in src/db/syncRepo.ts) — a regular
-- branch device's pull() never touches these tables.
CREATE TABLE IF NOT EXISTS remote_sales (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  server_sale_id TEXT NOT NULL UNIQUE,
  branch_name    TEXT,
  subtotal       REAL NOT NULL,
  discount       REAL NOT NULL DEFAULT 0,
  tax_percent    REAL NOT NULL DEFAULT 0,
  tax_amount     REAL NOT NULL DEFAULT 0,
  total          REAL NOT NULL,
  tendered       REAL NOT NULL DEFAULT 0,
  change_due     REAL NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL,
  cashier_name   TEXT,
  customer_name  TEXT,
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS remote_sale_items (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  remote_sale_id INTEGER NOT NULL REFERENCES remote_sales(id),
  product_name   TEXT NOT NULL,
  unit_price     REAL NOT NULL,
  qty            INTEGER NOT NULL,
  subtotal       REAL NOT NULL,
  discount       REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS remote_stock_movements (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  server_movement_id  TEXT NOT NULL UNIQUE,
  product_name        TEXT NOT NULL,
  branch_name         TEXT,
  change_qty          INTEGER NOT NULL,
  reason              TEXT NOT NULL,
  resulting_stock_qty INTEGER NOT NULL,
  actor_name          TEXT,
  created_at          TEXT NOT NULL
);

-- Shop expenses (rent, utilities, salary, ...) — branch-scoped like sales/
-- stock_movements, same sync_uuid/synced_at push pattern (generated
-- unconditionally at creation, see expensesRepo.create).
CREATE TABLE IF NOT EXISTS expenses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category    TEXT NOT NULL,
  description TEXT,
  amount      REAL NOT NULL,
  branch_id   INTEGER,
  branch_name TEXT,
  actor_name  TEXT,
  sync_uuid   TEXT,
  synced_at   TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Read-only cross-branch mirror, same admin-only "All Branches Activity"
-- pattern as remote_sales/remote_stock_movements above.
CREATE TABLE IF NOT EXISTS remote_expenses (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  server_expense_id  TEXT NOT NULL UNIQUE,
  category           TEXT NOT NULL,
  description        TEXT,
  amount             REAL NOT NULL,
  branch_name        TEXT,
  actor_name         TEXT,
  created_at         TEXT NOT NULL
);
`;

export const hashPassword = (password: string) =>
  Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, password);

const DEFAULT_ADMIN_NAME = "admin";
const DEFAULT_ADMIN_PASSWORD = "admin123";

const seed = async (db: SQLite.SQLiteDatabase) => {
  const userCount = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM users",
  );
  if ((userCount?.count ?? 0) === 0) {
    const hash = await hashPassword(DEFAULT_ADMIN_PASSWORD);
    await db.runAsync(
      "INSERT INTO users (name, password_hash, role, is_active) VALUES (?, ?, 'Admin', 1)",
      [DEFAULT_ADMIN_NAME, hash],
    );
  }

  const shopRow = await db.getFirstAsync<{ id: number }>(
    "SELECT id FROM shop_settings WHERE id = 1",
  );
  if (!shopRow) {
    await db.runAsync(
      "INSERT INTO shop_settings (id, name, tax_percent, currency) VALUES (1, 'My Shop', 0, '$')",
    );
  }

  const categoryCount = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM categories",
  );
  if ((categoryCount?.count ?? 0) === 0) {
    await db.runAsync(
      "INSERT INTO categories (name, sort_order, is_active, sync_uuid) VALUES ('General', 0, 1, ?)",
      [Crypto.randomUUID()],
    );
  }
};

// Lightweight migration for columns added after a device's database already
// existed — CREATE TABLE IF NOT EXISTS above only helps fresh installs.
const ensureColumn = async (
  db: SQLite.SQLiteDatabase,
  table: string,
  column: string,
  definition: string,
) => {
  const columns = await db.getAllAsync<{ name: string }>(
    `PRAGMA table_info(${table})`,
  );
  if (!columns.some((c) => c.name === column)) {
    await db.execAsync(
      `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`,
    );
  }
};

const migrate = async (db: SQLite.SQLiteDatabase) => {
  await ensureColumn(db, "products", "cost_price", "REAL NOT NULL DEFAULT 0");
  await ensureColumn(db, "products", "image_uri", "TEXT");
  await ensureColumn(
    db,
    "products",
    "low_stock_threshold",
    "INTEGER NOT NULL DEFAULT 5",
  );
  await ensureColumn(db, "sale_items", "discount", "REAL NOT NULL DEFAULT 0");
  await ensureColumn(
    db,
    "sale_items",
    "refunded_qty",
    "INTEGER NOT NULL DEFAULT 0",
  );
  await ensureColumn(db, "sales", "customer_id", "INTEGER");
  await ensureColumn(db, "sales", "customer_name", "TEXT");
  await ensureColumn(db, "sales", "customer_phone", "TEXT");
  await ensureColumn(
    db,
    "sales",
    "points_earned",
    "INTEGER NOT NULL DEFAULT 0",
  );
  await ensureColumn(
    db,
    "sales",
    "points_redeemed",
    "INTEGER NOT NULL DEFAULT 0",
  );
  await ensureColumn(
    db,
    "shop_settings",
    "loyalty_enabled",
    "INTEGER NOT NULL DEFAULT 0",
  );
  await ensureColumn(
    db,
    "shop_settings",
    "loyalty_earn_rate",
    "REAL NOT NULL DEFAULT 1",
  );
  await ensureColumn(
    db,
    "shop_settings",
    "loyalty_redeem_rate",
    "REAL NOT NULL DEFAULT 0.01",
  );
  await ensureColumn(db, "sales", "shift_id", "INTEGER");
  await ensureColumn(db, "refunds", "shift_id", "INTEGER");
  await ensureColumn(db, "stock_movements", "branch_id", "INTEGER");
  await ensureColumn(db, "stock_movements", "branch_name", "TEXT");
  await ensureColumn(db, "sales", "branch_id", "INTEGER");
  await ensureColumn(db, "sales", "branch_name", "TEXT");
  await ensureColumn(db, "products", "expiry_date", "TEXT");
  await ensureColumn(db, "products", "unit", "TEXT NOT NULL DEFAULT 'pcs'");
  await ensureColumn(db, "products", "wholesale_price", "REAL");
  await ensureColumn(db, "sale_items", "unit", "TEXT NOT NULL DEFAULT 'pcs'");

  // Vertical text printed on the product's barcode label (see LabelView) —
  // NULL means "fall back to shop_settings.label_default_text at print
  // time", not "print nothing", so most shops only ever set the shop-wide
  // default once.
  await ensureColumn(db, "products", "label_text", "TEXT");
  await ensureColumn(db, "shop_settings", "label_default_text", "TEXT");

  await ensureColumn(db, "branches", "server_id", "TEXT");
  await ensureColumn(db, "categories", "server_id", "TEXT");
  await ensureColumn(db, "products", "server_id", "TEXT");
  // Nine queries in syncRepo read or write this and nothing ever created it,
  // so every device — fresh install or upgrade — failed the moment sync
  // touched it: "no such column: pending_sync", which reached the shopkeeper
  // as CONNECT_FAILED. Existing rows default to 0, which is correct — a
  // product sitting on the device has not been deleted.
  await ensureColumn(
    db,
    "products",
    "pending_sync",
    "INTEGER NOT NULL DEFAULT 0",
  );

  // When this device last edited a product, and when that edit last reached
  // the server. push() sends a product whose updated_at is newer than its
  // synced_at -- which is how an EDIT gets pushed at all. Before these
  // existed push() only ever looked at products with no server_id, so
  // creating a product synced and editing one silently did not.
  await ensureColumn(db, "products", "updated_at", "TEXT");
  await ensureColumn(db, "products", "synced_at", "TEXT");

  await ensureColumn(
    db,
    "shop_settings",
    "auto_barcode_enabled",
    "INTEGER NOT NULL DEFAULT 0",
  );
  await ensureColumn(
    db,
    "shop_settings",
    "auto_barcode_prefix",
    "TEXT NOT NULL DEFAULT '2'",
  );
  await ensureColumn(
    db,
    "shop_settings",
    "auto_barcode_next",
    "INTEGER NOT NULL DEFAULT 1",
  );
  await ensureColumn(
    db,
    "shop_settings",
    "auto_sku_enabled",
    "INTEGER NOT NULL DEFAULT 0",
  );
  await ensureColumn(
    db,
    "shop_settings",
    "auto_sku_prefix",
    "TEXT NOT NULL DEFAULT 'SKU'",
  );
  await ensureColumn(
    db,
    "shop_settings",
    "auto_sku_next",
    "INTEGER NOT NULL DEFAULT 1",
  );
  await ensureColumn(
    db,
    "shop_settings",
    "auto_code_till",
    "INTEGER NOT NULL DEFAULT 1",
  );
  await ensureColumn(db, "sales", "sync_uuid", "TEXT");
  await ensureColumn(db, "sales", "synced_at", "TEXT");
  await ensureColumn(db, "stock_movements", "sync_uuid", "TEXT");
  await ensureColumn(db, "stock_movements", "synced_at", "TEXT");
  await ensureColumn(db, "sync_config", "admin_key", "TEXT");
  // Set at local creation time (see productsRepo), regardless of sync
  // state — cheap, harmless if never synced. server_id stays NULL until
  // this device's push() has this row accepted, at which point it's set
  // to the same value as sync_uuid (same client-generates-the-id pattern
  // sales/stock_movements already use) — see syncRepo.push().
  await ensureColumn(db, "categories", "sync_uuid", "TEXT");
  await ensureColumn(db, "products", "sync_uuid", "TEXT");

  // Branches get the exact same sync_uuid-generated-at-creation-time
  // pattern categories/products already use (see productsRepo.createCategory/
  // createProduct) — see backfillBranchSyncUuids() below for why the
  // one-time backfill for THIS column is special-cased rather than folded
  // into backfillSyncUuids().
  await ensureColumn(db, "branches", "sync_uuid", "TEXT");

  // Partial unique indexes — created here rather than in SCHEMA because on
  // an upgrading install SCHEMA runs before the ensureColumn calls above
  // add these columns, and CREATE INDEX on a not-yet-existing column fails.
  await db.execAsync(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_branches_server_id ON branches(server_id) WHERE server_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_server_id ON categories(server_id) WHERE server_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_products_server_id ON products(server_id) WHERE server_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_sync_uuid ON sales(sync_uuid) WHERE sync_uuid IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_movements_sync_uuid ON stock_movements(sync_uuid) WHERE sync_uuid IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_sync_uuid ON categories(sync_uuid) WHERE sync_uuid IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_products_sync_uuid ON products(sync_uuid) WHERE sync_uuid IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_branches_sync_uuid ON branches(sync_uuid) WHERE sync_uuid IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_sync_uuid ON expenses(sync_uuid) WHERE sync_uuid IS NOT NULL;
  `);

  // Regular (non-sync) indexes — none of these existed before, so every
  // Sales History / Inventory / category-delete query was a full table
  // scan, getting slower every month as sales/stock_movements grow (they
  // only ever grow, nothing is pruned). Matches the actual WHERE/ORDER BY
  // columns each screen's repo queries use — see salesRepo.ts (date-range
  // + customer_id lookups, sale_id joins for items/payments/refunds) and
  // stockRepo.ts's getRecentMovements (branch_id/product_id filter,
  // created_at sort).
  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at);
    CREATE INDEX IF NOT EXISTS idx_sales_branch_id ON sales(branch_id);
    CREATE INDEX IF NOT EXISTS idx_sales_customer_id ON sales(customer_id);
    CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id);
    CREATE INDEX IF NOT EXISTS idx_sale_payments_sale_id ON sale_payments(sale_id);
    CREATE INDEX IF NOT EXISTS idx_refunds_sale_id ON refunds(sale_id);
    CREATE INDEX IF NOT EXISTS idx_stock_movements_branch_created ON stock_movements(branch_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_stock_movements_product_id ON stock_movements(product_id);
    CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);
  `);
};

// One-time backfill for devices that already had products/sales before
// branches existed: creates a default branch, gives it a branch_stock row
// per existing product seeded from that product's old global stock_qty/
// low_stock_threshold, and stamps any branch-less sale/movement with it —
// so multi-branch turns on without losing or hiding any existing data.
const backfillBranches = async (db: SQLite.SQLiteDatabase) => {
  const branchCount = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM branches",
  );
  if ((branchCount?.count ?? 0) === 0) {
    await db.runAsync(
      "INSERT INTO branches (name, is_active, sync_uuid) VALUES ('Main Branch', 1, ?)",
      [Crypto.randomUUID()],
    );
  }

  const defaultBranch = await db.getFirstAsync<{ id: number; name: string }>(
    "SELECT id, name FROM branches ORDER BY id LIMIT 1",
  );
  if (!defaultBranch) return;

  const products = await db.getAllAsync<{
    id: number;
    stock_qty: number;
    low_stock_threshold: number;
  }>("SELECT id, stock_qty, low_stock_threshold FROM products");
  for (const p of products) {
    const existing = await db.getFirstAsync<{ id: number }>(
      "SELECT id FROM branch_stock WHERE branch_id = ? AND product_id = ?",
      [defaultBranch.id, p.id],
    );
    if (!existing) {
      await db.runAsync(
        "INSERT INTO branch_stock (branch_id, product_id, stock_qty, low_stock_threshold) VALUES (?, ?, ?, ?)",
        [defaultBranch.id, p.id, p.stock_qty, p.low_stock_threshold],
      );
    }
  }

  await db.runAsync(
    "UPDATE sales SET branch_id = ?, branch_name = ? WHERE branch_id IS NULL",
    [defaultBranch.id, defaultBranch.name],
  );
  await db.runAsync(
    "UPDATE stock_movements SET branch_id = ?, branch_name = ? WHERE branch_id IS NULL",
    [defaultBranch.id, defaultBranch.name],
  );
};

// One-time backfill for rows that existed before their table's sync_uuid
// column did — ensureColumn() above only adds the column, it can't give
// existing rows a value, so anything created before that update has
// sync_uuid = NULL. syncRepo.push() only ever looks at rows where
// sync_uuid IS NOT NULL (it's the id the push protocol keys off of), so a
// pre-existing category/product/sale/movement with no sync_uuid could
// never be pushed — not even counted in Sync Now's "skipped" total, since
// the WHERE clause excludes it before skip-counting ever sees it. This
// stamps every remaining NULL with a fresh uuid so those rows become
// eligible starting with the very next Sync Now.
//
// sales/stock_movements never carry a server_id — pull() only ever mirrors
// OTHER branches' history into remote_sales/remote_stock_movements, never
// into these tables (see syncRepo.pull()'s comment) — so every local row
// here is genuinely this device's own, and a fresh random id is always
// correct. categories/products are different: pull() upserts them
// directly into these tables by server_id, so a row can already be
// server-confirmed (server_id set) the first time this backfill ever sees
// it. Same reasoning as backfillBranchSyncUuids below — reusing server_id
// as sync_uuid there keeps the two in sync; a fresh random one would only
// matter once something clears server_id again (e.g. a backup restore),
// at which point push() would send this row under an id the server has
// never heard of, relying entirely on name/barcode dedup to avoid a
// duplicate instead of being recognized outright.
const backfillSyncUuids = async (db: SQLite.SQLiteDatabase) => {
  for (const table of ["categories", "products"] as const) {
    const rows = await db.getAllAsync<{ id: number; server_id: string | null }>(
      `SELECT id, server_id FROM ${table} WHERE sync_uuid IS NULL`,
    );
    for (const r of rows) {
      await db.runAsync(`UPDATE ${table} SET sync_uuid = ? WHERE id = ?`, [
        r.server_id ?? Crypto.randomUUID(),
        r.id,
      ]);
    }
  }
  for (const table of ["sales", "stock_movements"] as const) {
    const rows = await db.getAllAsync<{ id: number }>(
      `SELECT id FROM ${table} WHERE sync_uuid IS NULL`,
    );
    for (const r of rows) {
      await db.runAsync(`UPDATE ${table} SET sync_uuid = ? WHERE id = ?`, [
        Crypto.randomUUID(),
        r.id,
      ]);
    }
  }
};

// Same idea as backfillSyncUuids above, but branches need their own pass:
// a branch that was already synced (has a server_id, from connect() or the
// old manual "attach" flow this replaces) must adopt that EXACT value as its
// sync_uuid rather than a fresh random one — the server already has this
// branch under server_id, so a fresh uuid would make syncRepo.push() think
// it's a brand new, never-seen branch and create a duplicate row on the
// server. Only a branch with no server_id at all (created offline, never
// synced) gets a genuinely fresh uuid — which is exactly what makes it
// push-eligible starting with the very next Sync Now, the same outcome the
// old manual "attach" button used to require a tap for.
const backfillBranchSyncUuids = async (db: SQLite.SQLiteDatabase) => {
  const rows = await db.getAllAsync<{ id: number; server_id: string | null }>(
    "SELECT id, server_id FROM branches WHERE sync_uuid IS NULL",
  );
  for (const r of rows) {
    await db.runAsync("UPDATE branches SET sync_uuid = ? WHERE id = ?", [
      r.server_id ?? Crypto.randomUUID(),
      r.id,
    ]);
  }
};

export const initDatabase = async () => {
  const db = await getDb();
  await db.execAsync(SCHEMA);
  await migrate(db);
  await seed(db);
  await backfillBranches(db);
  await backfillSyncUuids(db);
  await backfillBranchSyncUuids(db);
};
