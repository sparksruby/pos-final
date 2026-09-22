import { getDb } from "./database";

/**
 * The figures behind the Analytics and Profit & Loss screens.
 *
 * Aggregated in SQL rather than by loading every sale into memory: a shop
 * three years in has tens of thousands of them, and the yearly screen asks
 * for twelve months at once.
 *
 * ── Why profit here is not "sales minus purchases" ──────────────────────
 *
 * That is the obvious formula and it is wrong, in a way that makes a good
 * month look like a disaster. A shop that buys 103 lakh of stock and sells
 * 70 lakh has not lost 33 lakh — most of that stock is still on the shelf,
 * waiting to be sold next month. Buying in bulk would show up as a loss
 * every time, and the month it finally sold would show a profit nobody
 * earned that month.
 *
 * So the cost side is the cost of what actually *sold*: each line's
 * quantity, less anything refunded, at that product's cost price. Money
 * spent on stock is still worth seeing — it is real money out of the
 * bank — so it is reported alongside as `stockPurchased`, clearly its own
 * figure rather than folded into profit.
 *
 * The one caveat, the same one the Reports screen carries: cost price is
 * read as it stands today, not as it was on the day of the sale. A shop
 * that has just repriced its costs will see older months shift a little.
 */

export interface PeriodFigures {
  /** Everything rung up, before refunds. */
  revenue: number;
  refunds: number;
  /** revenue − refunds. What the shop actually took. */
  netRevenue: number;
  saleCount: number;
  discountGiven: number;

  /** Cost of what sold, at today's cost prices. */
  costOfSales: number;
  /** netRevenue − costOfSales. */
  grossProfit: number;

  /** Expenses in the "salary" category, separated because staff is the line a shop watches. */
  staffCosts: number;
  /** Every other expense. */
  otherExpenses: number;
  /** grossProfit − staffCosts − otherExpenses. */
  netProfit: number;

  /**
   * Money spent on stock in this period. Deliberately NOT part of the
   * profit above — see the note at the top of this file.
   */
  stockPurchased: number;
}

export interface MonthFigures extends PeriodFigures {
  /** "2026-03" */
  month: string;
  /** 1-12 */
  monthNumber: number;
}

const EMPTY: PeriodFigures = {
  revenue: 0,
  refunds: 0,
  netRevenue: 0,
  saleCount: 0,
  discountGiven: 0,
  costOfSales: 0,
  grossProfit: 0,
  staffCosts: 0,
  otherExpenses: 0,
  netProfit: 0,
  stockPurchased: 0,
};

// Expenses are free text in the UI but the picker writes one of a fixed set
// of keys; "salary" is the one that means staff. Matched case-insensitively
// because an expense typed in before the picker existed may be "Salary".
const STAFF_CATEGORY = "salary";

const derive = (f: PeriodFigures): PeriodFigures => {
  const netRevenue = round(f.revenue - f.refunds);
  const grossProfit = round(netRevenue - f.costOfSales);
  return {
    ...f,
    netRevenue,
    grossProfit,
    netProfit: round(grossProfit - f.staffCosts - f.otherExpenses),
  };
};

const round = (n: number) => Math.round(n * 100) / 100;

/** `branchId` undefined means every branch this device knows about. */
const branchClause = (column: string, branchId?: number) =>
  branchId == null ? "" : ` AND ${column} = ${Number(branchId)}`;

// ── Reading one branch at a time ─────────────────────────────────────────
//
// Which table a branch's figures live in depends on the device.
//
// In a shop with no server, every branch is in the local tables under its
// own branch_id, and `branchClause` above is the whole story.
//
// Once the shop syncs, it is not: a device only ever records its OWN
// branch's sales locally (one device, one branch, permanently — see
// branchStore). The other branches reach the main-branch device through
// remote_sales/remote_sale_items/remote_expenses, the read-only mirror
// syncRepo.pull fills. That mirror is thinner than the real thing, and the
// two gaps are worth naming because the screens have to say so out loud:
//
//   · no refunds — the server's pull never sent them, so a branch that
//     handed money back looks like it did not;
//   · no stock purchases — same;
//   · no product id on a line, only the name it sold under, so cost has to
//     be matched by name.
//
// Presenting those as 0 next to a real 0 would be a lie of omission, so
// every scoped figure carries where it came from and the screens print the
// caveat when it is not purely local.

/** Which branch to read, and — since the answer decides which table — who it is. */
export type BranchScope =
  | { kind: "all" }
  | { kind: "branch"; id: number; name: string };

export const ALL_BRANCHES: BranchScope = { kind: "all" };

/**
 * "local" — this device's own tables, complete.
 * "mirror" — another branch, via the synced copy, missing refunds and stock bought.
 * "mixed" — this branch's local figures plus every other branch's mirror.
 */
export type FiguresSource = "local" | "mirror" | "mixed";

export interface ScopedFigures extends PeriodFigures {
  source: FiguresSource;
}

export interface ScopedMonthFigures extends MonthFigures {
  source: FiguresSource;
}

interface MirrorContext {
  ownBranchId: number;
  /** Mirror rows key on the branch NAME; no server id ever came down with them. */
  ownBranchName: string | null;
}

/**
 * Non-null only on the main-branch device. The mirror tables are filled
 * nowhere else (syncRepo.pull writes them only when an admin key is set),
 * so everywhere else every branch the shop has is a local branch and the
 * local tables are the whole truth.
 */
const mirrorContext = async (): Promise<MirrorContext | null> => {
  const db = await getDb();
  const row = await db.getFirstAsync<{
    bound_branch_id: number | null;
    admin_key: string | null;
  }>("SELECT bound_branch_id, admin_key FROM sync_config WHERE id = 1");
  if (!row?.bound_branch_id || !row.admin_key) return null;
  // bound_branch_id is the LOCAL branch id — connect() stores the local
  // row's id, and branchStore reads it that way.
  const branch = await db.getFirstAsync<{ name: string }>(
    "SELECT name FROM branches WHERE id = ?",
    [row.bound_branch_id],
  );
  return {
    ownBranchId: row.bound_branch_id,
    ownBranchName: branch?.name ?? null,
  };
};

/**
 * The server's pull carries no branch filter, so the mirror holds this
 * device's own branch alongside everyone else's. Every read of it therefore
 * says which branch it wants, or excludes the one the local tables already
 * cover — otherwise the main branch counts its own takings twice, on the
 * one device the owner actually reads.
 *
 * `exclude` null (the own branch's name could not be resolved) keeps every
 * row: showing a branch twice is bad, dropping one silently is worse.
 */
const mirrorWhere = (
  column: string,
  want: { only?: string; exclude?: string | null },
): { sql: string; params: string[] } => {
  if (want.only != null)
    return { sql: ` AND ${column} = ?`, params: [want.only] };
  if (want.exclude)
    return {
      sql: ` AND (${column} IS NULL OR ${column} <> ?)`,
      params: [want.exclude],
    };
  return { sql: "", params: [] };
};

type MirrorWant = { only?: string; exclude?: string | null };

const mirrorFigures = async (
  fromISO: string,
  toISO: string,
  want: MirrorWant,
): Promise<PeriodFigures> => {
  const db = await getDb();
  const w = mirrorWhere("branch_name", want);
  const ws = mirrorWhere("rs.branch_name", want);

  const sales = await db.getFirstAsync<{
    revenue: number;
    discount: number;
    count: number;
  }>(
    `SELECT COALESCE(SUM(total), 0) AS revenue,
            COALESCE(SUM(discount), 0) AS discount,
            COUNT(*) AS count
     FROM remote_sales WHERE created_at >= ? AND created_at <= ?${w.sql}`,
    [fromISO, toISO, ...w.params],
  );

  // Cost matched on the product name, the only identifier a mirrored line
  // has. A scalar subquery rather than a JOIN on purpose: two products
  // sharing a name would make a JOIN emit the line twice and double its
  // cost, where this takes one of them.
  const cost = await db.getFirstAsync<{ cogs: number }>(
    `SELECT COALESCE(SUM(ri.qty * COALESCE(
              (SELECT cost_price FROM products WHERE name = ri.product_name LIMIT 1), 0)), 0) AS cogs
     FROM remote_sale_items ri JOIN remote_sales rs ON rs.id = ri.remote_sale_id
     WHERE rs.created_at >= ? AND rs.created_at <= ?${ws.sql}`,
    [fromISO, toISO, ...ws.params],
  );

  const expenses = await db.getAllAsync<{ category: string; amount: number }>(
    `SELECT LOWER(category) AS category, COALESCE(SUM(amount), 0) AS amount
     FROM remote_expenses WHERE created_at >= ? AND created_at <= ?${w.sql}
     GROUP BY LOWER(category)`,
    [fromISO, toISO, ...w.params],
  );
  let staffCosts = 0;
  let otherExpenses = 0;
  for (const e of expenses) {
    if (e.category === STAFF_CATEGORY) staffCosts += e.amount;
    else otherExpenses += e.amount;
  }

  // refunds and stockPurchased stay at 0 — see the note above; the screens
  // are told, via `source`, not to read them as measurements.
  return derive({
    ...EMPTY,
    revenue: round(sales?.revenue ?? 0),
    discountGiven: round(sales?.discount ?? 0),
    saleCount: sales?.count ?? 0,
    costOfSales: round(cost?.cogs ?? 0),
    staffCosts: round(staffCosts),
    otherExpenses: round(otherExpenses),
  });
};

const add = (a: PeriodFigures, b: PeriodFigures): PeriodFigures =>
  derive({
    ...EMPTY,
    revenue: round(a.revenue + b.revenue),
    refunds: round(a.refunds + b.refunds),
    saleCount: a.saleCount + b.saleCount,
    discountGiven: round(a.discountGiven + b.discountGiven),
    costOfSales: round(a.costOfSales + b.costOfSales),
    staffCosts: round(a.staffCosts + b.staffCosts),
    otherExpenses: round(a.otherExpenses + b.otherExpenses),
    stockPurchased: round(a.stockPurchased + b.stockPurchased),
  });

/**
 * Decided by the scope and the device, never by whether rows happened to
 * come back. A month with no mirrored sales in it is still a month being
 * read the mirror's way, and a caveat that blinks on and off as you tap
 * through the year teaches nobody anything.
 */
const sourceFor = (
  scope: BranchScope,
  mirror: MirrorContext | null,
): FiguresSource => {
  if (!mirror) return "local";
  if (scope.kind === "all") return "mixed";
  return scope.id === mirror.ownBranchId ? "local" : "mirror";
};

export const analyticsRepo = {
  /**
   * Years this shop has sales in, newest first, so the year picker offers
   * only years there is something to look at. Always includes this year,
   * even before the first sale of it — an empty current year is a real
   * answer, an absent one looks broken.
   */
  getYearsWithData: async (): Promise<number[]> => {
    const db = await getDb();
    // The mirror counts too, and deliberately without a branch filter: the
    // year chips should not appear and disappear as the branch picker
    // moves, or a branch with a longer history than this device's own
    // would have years you could see only after selecting it.
    const rows = await db.getAllAsync<{ year: string }>(
      `SELECT DISTINCT strftime('%Y', created_at) AS year FROM sales
       UNION
       SELECT DISTINCT strftime('%Y', created_at) AS year FROM remote_sales
       ORDER BY year DESC`,
    );
    const years = rows
      .map((r) => Number(r.year))
      .filter((y) => Number.isFinite(y));
    const thisYear = new Date().getFullYear();
    if (!years.includes(thisYear)) years.unshift(thisYear);
    return years.sort((a, b) => b - a);
  },

  getFigures: async (
    fromISO: string,
    toISO: string,
    branchId?: number,
  ): Promise<PeriodFigures> => {
    const db = await getDb();
    const range = [fromISO, toISO];

    const sales = await db.getFirstAsync<{
      revenue: number;
      discount: number;
      count: number;
    }>(
      `SELECT COALESCE(SUM(total), 0) AS revenue,
              COALESCE(SUM(discount), 0) AS discount,
              COUNT(*) AS count
       FROM sales WHERE created_at >= ? AND created_at <= ?${branchClause("branch_id", branchId)}`,
      range,
    );

    // Joined through sales so the refund lands in the period the sale was
    // made in, and under that sale's branch. A refund handled in April
    // against a March sale belongs to March's figures, or March's profit
    // would never stop looking better than it was.
    const refunds = await db.getFirstAsync<{ amount: number }>(
      `SELECT COALESCE(SUM(r.amount), 0) AS amount
       FROM refunds r JOIN sales s ON s.id = r.sale_id
       WHERE s.created_at >= ? AND s.created_at <= ?${branchClause("s.branch_id", branchId)}`,
      range,
    );

    // LEFT JOIN, so a line whose product has since been deleted still counts
    // its revenue; COALESCE gives it no cost rather than dropping the sale.
    const cost = await db.getFirstAsync<{ cogs: number }>(
      `SELECT COALESCE(SUM((si.qty - si.refunded_qty) * COALESCE(p.cost_price, 0)), 0) AS cogs
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       LEFT JOIN products p ON p.id = si.product_id
       WHERE s.created_at >= ? AND s.created_at <= ?${branchClause("s.branch_id", branchId)}`,
      range,
    );

    const expenses = await db.getAllAsync<{ category: string; amount: number }>(
      `SELECT LOWER(category) AS category, COALESCE(SUM(amount), 0) AS amount
       FROM expenses WHERE created_at >= ? AND created_at <= ?${branchClause("branch_id", branchId)}
       GROUP BY LOWER(category)`,
      range,
    );
    let staffCosts = 0;
    let otherExpenses = 0;
    for (const e of expenses) {
      if (e.category === STAFF_CATEGORY) staffCosts += e.amount;
      else otherExpenses += e.amount;
    }

    const purchases = await db.getFirstAsync<{ total: number }>(
      `SELECT COALESCE(SUM(total), 0) AS total
       FROM purchases WHERE created_at >= ? AND created_at <= ?${branchClause("branch_id", branchId)}`,
      range,
    );

    return derive({
      ...EMPTY,
      revenue: round(sales?.revenue ?? 0),
      discountGiven: round(sales?.discount ?? 0),
      saleCount: sales?.count ?? 0,
      refunds: round(refunds?.amount ?? 0),
      costOfSales: round(cost?.cogs ?? 0),
      staffCosts: round(staffCosts),
      otherExpenses: round(otherExpenses),
      stockPurchased: round(purchases?.total ?? 0),
    });
  },

  /**
   * What sold most over a range, by quantity that stayed sold.
   *
   * Net of refunds on purpose: this is the list a shop reorders from, and
   * counting a returned item would send someone out to buy stock for a sale
   * that was handed back over the counter.
   */
  getTopProducts: async (
    fromISO: string,
    toISO: string,
    limit = 5,
    branchId?: number,
  ): Promise<{ name: string; qty: number; revenue: number }[]> => {
    const db = await getDb();
    const rows = await db.getAllAsync<{
      name: string;
      qty: number;
      revenue: number;
    }>(
      `SELECT si.product_name AS name,
              SUM(si.qty - si.refunded_qty) AS qty,
              SUM(si.subtotal - si.discount) AS revenue
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
       WHERE s.created_at >= ? AND s.created_at <= ?${branchClause("s.branch_id", branchId)}
       GROUP BY si.product_name
       HAVING qty > 0
       ORDER BY qty DESC
       LIMIT ?`,
      [fromISO, toISO, limit],
    );
    return rows.map((r) => ({
      name: r.name,
      qty: r.qty,
      revenue: round(r.revenue),
    }));
  },

  // ── Branch-scoped reads ────────────────────────────────────────────────
  //
  // The same figures as above, but answering "and for the Mandalay branch?"
  // — which, once a shop syncs, means reading a different table. See the
  // long note further up for what the mirror can and cannot tell you.

  /**
   * Whether this device can answer for a branch other than its own, i.e.
   * whether the branch picker is worth showing at all.
   *
   * A shop with no server keeps every branch in its local tables, so yes.
   * The main-branch device has the mirror, so yes. An ordinary branch
   * device has neither: it records one branch's sales and pulls no other
   * branch's history, so every other branch would read as a shop that took
   * nothing all year. Offering the choice there only invites the wrong
   * conclusion.
   */
  canScopeByBranch: async (): Promise<boolean> => {
    const db = await getDb();
    const row = await db.getFirstAsync<{
      bound_branch_id: number | null;
      admin_key: string | null;
    }>("SELECT bound_branch_id, admin_key FROM sync_config WHERE id = 1");
    if (!row?.bound_branch_id) return true;
    return !!row.admin_key;
  },

  getScopedFigures: async (
    fromISO: string,
    toISO: string,
    scope: BranchScope,
  ): Promise<ScopedFigures> => {
    const mirror = await mirrorContext();
    const source = sourceFor(scope, mirror);

    if (source === "mirror" && scope.kind === "branch") {
      return {
        ...(await mirrorFigures(fromISO, toISO, { only: scope.name })),
        source,
      };
    }
    if (source === "mixed" && mirror) {
      const local = await analyticsRepo.getFigures(fromISO, toISO);
      const other = await mirrorFigures(fromISO, toISO, {
        exclude: mirror.ownBranchName,
      });
      return { ...add(local, other), source };
    }
    // Local, either because this device holds no mirror at all — in which
    // case a branch id filters the local tables exactly as it always did —
    // or because the branch asked for is this device's own.
    const local = await analyticsRepo.getFigures(
      fromISO,
      toISO,
      scope.kind === "branch" ? scope.id : undefined,
    );
    return { ...local, source };
  },

  /**
   * Twelve rows for one year, including the months with nothing in them —
   * a year that skips from March to June reads as missing data rather than
   * as a shop that was closed.
   */
  getScopedYear: async (
    year: number,
    scope: BranchScope,
  ): Promise<ScopedMonthFigures[]> => {
    const months: ScopedMonthFigures[] = [];
    for (let m = 1; m <= 12; m++) {
      const from = new Date(Date.UTC(year, m - 1, 1)).toISOString();
      // The instant before the next month begins, so nothing is counted
      // twice and a sale at 23:59 on the last day is not lost.
      const to = new Date(Date.UTC(year, m, 1) - 1).toISOString();
      const figures = await analyticsRepo.getScopedFigures(from, to, scope);
      months.push({
        ...figures,
        month: `${year}-${String(m).padStart(2, "0")}`,
        monthNumber: m,
      });
    }
    return months;
  },

  getScopedTopProducts: async (
    fromISO: string,
    toISO: string,
    limit: number,
    scope: BranchScope,
  ): Promise<{ name: string; qty: number; revenue: number }[]> => {
    const db = await getDb();
    const mirror = await mirrorContext();
    const source = sourceFor(scope, mirror);

    if (source === "local") {
      return analyticsRepo.getTopProducts(
        fromISO,
        toISO,
        limit,
        scope.kind === "branch" ? scope.id : undefined,
      );
    }

    if (source === "mirror" && scope.kind === "branch") {
      const w = mirrorWhere("rs.branch_name", { only: scope.name });
      const rows = await db.getAllAsync<{
        name: string;
        qty: number;
        revenue: number;
      }>(
        `SELECT ri.product_name AS name,
                SUM(ri.qty) AS qty,
                SUM(ri.subtotal - ri.discount) AS revenue
         FROM remote_sale_items ri JOIN remote_sales rs ON rs.id = ri.remote_sale_id
         WHERE rs.created_at >= ? AND rs.created_at <= ?${w.sql}
         GROUP BY ri.product_name
         HAVING qty > 0
         ORDER BY qty DESC
         LIMIT ?`,
        [fromISO, toISO, ...w.params, limit],
      );
      return rows.map((r) => ({
        name: r.name,
        qty: r.qty,
        revenue: round(r.revenue),
      }));
    }

    // Every branch at once. Summed inside SQL rather than by merging two
    // top-N lists in JS: a product that is sixth on both sides but second
    // overall belongs in the list, and merging pre-truncated lists would
    // never see it.
    const w = mirrorWhere("rs.branch_name", {
      exclude: mirror?.ownBranchName ?? null,
    });
    const rows = await db.getAllAsync<{
      name: string;
      qty: number;
      revenue: number;
    }>(
      `SELECT name, SUM(qty) AS qty, SUM(revenue) AS revenue FROM (
         SELECT si.product_name AS name,
                SUM(si.qty - si.refunded_qty) AS qty,
                SUM(si.subtotal - si.discount) AS revenue
         FROM sale_items si JOIN sales s ON s.id = si.sale_id
         WHERE s.created_at >= ? AND s.created_at <= ?
         GROUP BY si.product_name
         UNION ALL
         SELECT ri.product_name AS name,
                SUM(ri.qty) AS qty,
                SUM(ri.subtotal - ri.discount) AS revenue
         FROM remote_sale_items ri JOIN remote_sales rs ON rs.id = ri.remote_sale_id
         WHERE rs.created_at >= ? AND rs.created_at <= ?${w.sql}
         GROUP BY ri.product_name
       )
       GROUP BY name
       HAVING qty > 0
       ORDER BY qty DESC
       LIMIT ?`,
      [fromISO, toISO, fromISO, toISO, ...w.params, limit],
    );
    return rows.map((r) => ({
      name: r.name,
      qty: r.qty,
      revenue: round(r.revenue),
    }));
  },
};
