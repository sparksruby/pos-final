// ─── Types ────────────────────────────────────────────────────────────────────
// Local retail-POS domain — everything here is backed by expo-sqlite, there is
// no backend to sync with.

// ── Branches ──────────────────────────────────────────────────────────────────
// A single device/install still holds one shared SQLite database (there's no
// backend to sync separate installs) — "branches" are logical partitions
// inside that one database: shared product catalog, but stock is tracked per
// branch, and sales/reports can be scoped to one. Pick the active branch in
// Settings; everything below reads/writes against whichever one is current.

export interface Branch {
  id:        number;
  name:      string;
  address?:  string;
  phone?:    string;
  isActive:  boolean;
  createdAt: string;
  /** True once the server has confirmed this branch (server_id is set). Every branch gets a sync_uuid the moment it's created (see branchesRepo.create), so this only ever reads false transiently — until the next Sync Now push confirms it — never permanently. */
  isSynced:  boolean;
}

// ── Catalog ───────────────────────────────────────────────────────────────────

export interface Category {
  id:        number;
  name:      string;
  sortOrder: number;
  isActive:  boolean;
  products:  Product[];
}

export interface Product {
  id:                number;
  categoryId:        number;
  name:              string;
  sku?:              string;
  barcode?:          string;
  price:             number;
  /** Optional wholesale tier — undefined means this product has no wholesale price, always sells at `price`. */
  wholesalePrice?:   number;
  costPrice:         number;
  /** Free-text label (pcs/kg/box/...), display only — no unit conversion. */
  unit:              string;
  imageUri?:         string;
  stockQty:          number;
  lowStockThreshold: number;
  /** ISO date (YYYY-MM-DD) — perishable goods only, product-level (not per batch). */
  expiryDate?:       string;
  /** Vertical text on this product's barcode label — undefined falls back to shop_settings.labelDefaultText at print time. */
  labelText?:        string;
  isActive:          boolean;
  sortOrder:         number;
}

/** Thermal label printer command language — see src/components/LabelPrinter.tsx. */
export type LabelProtocol = "ESCPOS" | "TSPL" | "CPCL" | "ZPL";

// ── Inventory ─────────────────────────────────────────────────────────────────

export type StockMovementReason =
  "Restock" | "Damaged" | "Correction" | "Sale" | "Return" | "Transfer In" | "Transfer Out" | "Purchase" | "Other";

export interface StockMovement {
  id:                number;
  productId:         number;
  productName:       string;
  changeQty:         number;
  reason:            StockMovementReason;
  resultingStockQty: number;
  branchId?:         number;
  branchName?:       string;
  actorName?:        string;
  createdAt:         string;
}

export interface StockTransfer {
  id:              number;
  productId:       number;
  productName:     string;
  fromBranchId:    number;
  fromBranchName:  string;
  toBranchId:      number;
  toBranchName:    string;
  qty:             number;
  actorName?:      string;
  notes?:          string;
  createdAt:       string;
}

// ── Customers ─────────────────────────────────────────────────────────────────

export interface Customer {
  id:            number;
  name:          string;
  phone?:        string;
  email?:        string;
  loyaltyPoints: number;
  createdAt:     string;
}

// ── Sale ──────────────────────────────────────────────────────────────────────

export type PaymentMethod = "Cash" | "Card" | "QR";

// A sale's overall payment_method is one of the above, or "Split" when paid
// with a mix — the breakdown then lives in `Sale.payments`.
export type SalePaymentMethod = PaymentMethod | "Split";

export interface SalePayment {
  method: PaymentMethod;
  amount: number;
}

export interface SaleItem {
  id:          number;
  productId:   number;
  productName: string;
  unitPrice:   number;
  /** Product's unit label at sale time (pcs/kg/box/...) — snapshotted like productName. */
  unit:        string;
  qty:         number;
  subtotal:    number;
  /** Flat amount knocked off this line only (e.g. a manager discount on one item). */
  discount:    number;
  /** How many of this line's qty have already been returned via a refund. */
  refundedQty: number;
}

export interface Sale {
  id:            number;
  subtotal:      number;
  /** Combined discount actually applied — per-item discounts plus the order-level one. */
  discount:      number;
  taxPercent:    number;
  taxAmount:     number;
  total:         number;
  tendered:      number;
  changeDue:     number;
  paymentMethod: SalePaymentMethod;
  /** Present only when paymentMethod is "Split". */
  payments?:     SalePayment[];
  cashierName?:  string;
  branchId?:        number;
  branchName?:      string;
  customerId?:      number;
  customerName?:    string;
  customerPhone?:   string;
  /** Loyalty points earned on this sale's final total (0 if the shop has loyalty off, or it's a walk-in sale). */
  pointsEarned:      number;
  /** Loyalty points spent to reduce this sale's total. */
  pointsRedeemed:    number;
  /** Total money returned across all refunds against this sale, if any. */
  refundedAmount?: number;
  createdAt:     string;
  items:         SaleItem[];
}

// ── Refunds ───────────────────────────────────────────────────────────────────

export interface RefundItem {
  id:          number;
  saleItemId:  number;
  productId:   number;
  productName: string;
  qty:         number;
  unitPrice:   number;
  /** This line's share of the refund, after the original sale's per-item and order-level discounts. */
  amount:      number;
}

export interface Refund {
  id:         number;
  saleId:     number;
  /** Total money returned, including its share of tax. */
  amount:     number;
  reason?:    string;
  actorName?: string;
  createdAt:  string;
  items:      RefundItem[];
}

// ── Cashier shifts ────────────────────────────────────────────────────────────

export type ShiftStatus = "open" | "closed";

export interface Shift {
  id:            number;
  cashierId?:    number;
  cashierName?:  string;
  openingCash:   number;
  /** Set only once the shift is closed. */
  closingCash?:  number;
  /** What the drawer should hold at close, computed from opening cash + cash collected - cash refunded. */
  expectedCash?: number;
  /** closingCash - expectedCash. Positive = over, negative = short. */
  difference?:   number;
  status:        ShiftStatus;
  notes?:        string;
  openedAt:      string;
  closedAt?:     string;
}

export interface ShiftSummary {
  salesCount:     number;
  cashSales:      number;
  cardSales:      number;
  qrSales:        number;
  /** The Cash portion of Split-method sales — card/QR portions of a split aren't broken out here. */
  splitCashSales: number;
  totalSales:     number;
  refundsCount:   number;
  refundsTotal:   number;
  expectedCash:   number;
}

// ── Cart (in-memory only — not persisted until checkout) ──────────────────────

export type PriceMode = "retail" | "wholesale";

export interface CartItem {
  productId: number;
  name:      string;
  unit:      string;
  /** The line's active unit price — whichever of retailPrice/wholesalePrice the cart's current PriceMode resolves to. Everything that totals the cart (checkout, receipts) reads this field. */
  price:     number;
  retailPrice:     number;
  /** Undefined if this product has no wholesale tier — the wholesale toggle then falls back to retailPrice for this line. */
  wholesalePrice?: number;
  qty:       number;
  /** Flat amount off this line, set via the per-item discount on Checkout. */
  discount?: number;
}

// ── Suppliers & purchases ─────────────────────────────────────────────────────

export interface Supplier {
  id:        number;
  name:      string;
  phone?:    string;
  address?:  string;
  createdAt: string;
}

/** Products this supplier has ever been bought from, derived from purchase history. */
export interface SupplierProduct {
  productId:   number;
  productName: string;
  totalQty:    number;
}

export type PurchaseStatus = "Unpaid" | "Partial" | "Paid";

export interface PurchaseItem {
  id:          number;
  productId:   number;
  productName: string;
  qty:         number;
  unitCost:    number;
  subtotal:    number;
}

export interface Purchase {
  id:          number;
  supplierId:  number;
  supplierName: string;
  invoiceNo?:  string;
  subtotal:    number;
  total:       number;
  paidAmount:  number;
  status:      PurchaseStatus;
  notes?:      string;
  branchId?:   number;
  branchName?: string;
  actorName?:  string;
  createdAt:   string;
  items:       PurchaseItem[];
}

export interface SupplierPayment {
  id:          number;
  supplierId:  number;
  purchaseId:  number;
  amount:      number;
  notes?:      string;
  actorName?:  string;
  createdAt:   string;
}

// Shop expenses (rent, utilities, salary, ...) — branch-scoped, synced like
// sales/stock_movements (see src/db/expensesRepo.ts / syncRepo.ts).
export interface Expense {
  id:          number;
  category:    string;
  description?: string;
  amount:      number;
  branchId?:   number;
  branchName?: string;
  actorName?:  string;
  createdAt:   string;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export type Role = "Admin" | "Cashier";

export interface SessionUser {
  id:   number;
  name: string;
  role: Role;
}

export interface UserAccount {
  id:       number;
  name:     string;
  role:     Role;
  isActive: boolean;
}

// ── Shop settings ─────────────────────────────────────────────────────────────

export interface ShopSettings {
  id:             number;
  name?:          string;
  address?:       string;
  phone?:         string;
  taxPercent:     number;
  currency?:      string;
  receiptHeader?: string;
  receiptFooter?: string;
  loyaltyEnabled:    boolean;
  /** Points earned per 1 unit of currency spent (of the sale's final total). */
  loyaltyEarnRate:   number;
  /** Currency value of 1 redeemed point. */
  loyaltyRedeemRate: number;
  /** Default vertical label text (e.g. shop name) — used when a product has no labelText of its own. */
  labelDefaultText?: string;
}

export interface UpdateShopSettingsRequest {
  name?:          string;
  address?:       string;
  phone?:         string;
  taxPercent:     number;
  currency?:      string;
  receiptHeader?: string;
  receiptFooter?: string;
  loyaltyEnabled:    boolean;
  loyaltyEarnRate:   number;
  loyaltyRedeemRate: number;
  labelDefaultText?: string;
}
