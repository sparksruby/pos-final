// Shared Daily/Weekly/Monthly/Yearly period navigation for Sales History and Reports.

export type Period = "daily" | "weekly" | "monthly" | "yearly";

const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const addMonths = (d: Date, n: number) => {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
};
const addYears = (d: Date, n: number) => {
  const x = new Date(d);
  x.setFullYear(x.getFullYear() + n);
  return x;
};

// Monday-start week.
const startOfWeek = (d: Date) => {
  const x = startOfDay(d);
  const day = x.getDay();
  return addDays(x, (day === 0 ? -6 : 1) - day);
};

export const periodBounds = (
  period: Period,
  anchor: Date,
): { from: Date; to: Date } => {
  if (period === "daily") {
    const from = startOfDay(anchor);
    return { from, to: addDays(from, 1) };
  }
  if (period === "weekly") {
    const from = startOfWeek(anchor);
    return { from, to: addDays(from, 7) };
  }
  if (period === "monthly") {
    return {
      from: new Date(anchor.getFullYear(), anchor.getMonth(), 1),
      to: new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1),
    };
  }
  return {
    from: new Date(anchor.getFullYear(), 0, 1),
    to: new Date(anchor.getFullYear() + 1, 0, 1),
  };
};

export const periodLabel = (period: Period, anchor: Date): string => {
  if (period === "daily")
    return anchor.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  if (period === "weekly") {
    const { from, to } = periodBounds("weekly", anchor);
    const last = addDays(to, -1);
    const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
    return `${from.toLocaleDateString(undefined, opts)} – ${last.toLocaleDateString(undefined, opts)}`;
  }
  if (period === "monthly")
    return anchor.toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
    });
  return String(anchor.getFullYear());
};

export const shiftAnchor = (
  period: Period,
  anchor: Date,
  dir: 1 | -1,
): Date => {
  if (period === "daily") return addDays(anchor, dir);
  if (period === "weekly") return addDays(anchor, dir * 7);
  if (period === "monthly") return addMonths(anchor, dir);
  return addYears(anchor, dir);
};

export const isCurrentPeriod = (period: Period, anchor: Date) =>
  periodBounds(period, anchor).from.getTime() >=
  periodBounds(period, new Date()).from.getTime();

/** The anchor as DatePickerModal's "YYYY-MM-DD", in local time. */
export const toDateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * A "YYYY-MM-DD" from the picker, as a local date and never beyond today.
 *
 * Parsed by hand because new Date("2026-09-20") is midnight UTC, not
 * midnight here: in any timezone behind UTC it renders as the day before,
 * and the report would quietly show yesterday. Myanmar being UTC+6:30 it
 * happens to land on the right day there, but only by luck of the offset,
 * and this has to be right wherever the app is sold.
 *
 * Clamped because the forward arrow stops at the current period, and a
 * calendar that did not would leave the screen on a month that has not
 * happened yet.
 */
export const anchorFromDateKey = (key: string): Date => {
  const [y, m, d] = key.split("-").map(Number);
  const picked = new Date(y, m - 1, d);
  const now = new Date();
  return picked > now ? now : picked;
};
