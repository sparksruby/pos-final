import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Modal,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Redirect, router } from "expo-router";
import {
  analyticsRepo,
  ALL_BRANCHES,
  type BranchScope,
  type FiguresSource,
  type PeriodFigures,
  type ScopedMonthFigures,
} from "../../src/db/analyticsRepo";
import { useBranchStore } from "../../src/store/branchStore";
import { useShopStore } from "@/store/shopStore";
import { useAuthStore } from "../../src/store/authStore";
import { useTheme } from "../../src/context/ThemeContext";
import { useLanguage } from "../../src/context/LanguageContext";
import { useResponsive } from "../../src/hooks/useResponsive";
import { isAdmin } from "../../src/utils/permissions";
import { F, R, Shadow, ThemeColors, withAlpha } from "../../src/theme";

const ANDROID_STATUS_BAR =
  Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) : 0;

const MONTH_KEYS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
] as const;

const CHART_HEIGHT = 132;

interface TopProduct {
  name: string;
  qty: number;
  revenue: number;
}

const emptyFigures = (): PeriodFigures => ({
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
});

const sum = (rows: PeriodFigures[]): PeriodFigures =>
  rows.reduce<PeriodFigures>(
    (a, m) => ({
      revenue: a.revenue + m.revenue,
      refunds: a.refunds + m.refunds,
      netRevenue: a.netRevenue + m.netRevenue,
      saleCount: a.saleCount + m.saleCount,
      discountGiven: a.discountGiven + m.discountGiven,
      costOfSales: a.costOfSales + m.costOfSales,
      grossProfit: a.grossProfit + m.grossProfit,
      staffCosts: a.staffCosts + m.staffCosts,
      otherExpenses: a.otherExpenses + m.otherExpenses,
      netProfit: a.netProfit + m.netProfit,
      stockPurchased: a.stockPurchased + m.stockPurchased,
    }),
    emptyFigures(),
  );

/**
 * A year of trading, read top to bottom: what the year came to, whether that
 * is better or worse than last year, the shape of it month by month, and
 * then any one month in full.
 *
 * Profit here is takings less the cost of what actually sold — not less what
 * was spent on stock. See the note at the top of analyticsRepo: a shop that
 * buys in bulk would otherwise post a loss every time it restocked, and a
 * profit it never earned in the month that stock finally sold. Money spent
 * on stock is shown, as its own figure, because it is still real money out.
 */
export default function AnalyticsScreen() {
  const { colors: C } = useTheme();
  const { t } = useLanguage();
  const { isTablet } = useResponsive();
  const s = React.useMemo(() => makeStyles(C, isTablet), [C, isTablet]);
  const { user } = useAuthStore();
  const currency = useShopStore((state) => state.settings?.currency ?? "$");

  const branches = useBranchStore((state) => state.branches);

  const [years, setYears] = useState<number[]>([]);
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [branchFilter, setBranchFilter] = useState<number | "all">("all");
  const [branchPickerOpen, setBranchPickerOpen] = useState(false);
  const [months, setMonths] = useState<ScopedMonthFigures[]>([]);
  const [total, setTotal] = useState<PeriodFigures | null>(null);
  const [previous, setPrevious] = useState<PeriodFigures | null>(null);
  const [top, setTop] = useState<TopProduct[]>([]);
  const [source, setSource] = useState<FiguresSource>("local");
  const [isLoading, setIsLoading] = useState(true);
  // null = the whole year. Tapping a bar narrows everything below it.
  const [openMonth, setOpenMonth] = useState<number | null>(null);

  const selectedBranch = branches.find((b) => b.id === branchFilter);
  const branchLabel = selectedBranch?.name ?? t("reports.allBranches");

  // A branch the picker offers but the store has forgotten between renders
  // falls back to every branch rather than to a silent empty screen.
  const scope: BranchScope = useMemo(
    () =>
      selectedBranch
        ? { kind: "branch", id: selectedBranch.id, name: selectedBranch.name }
        : ALL_BRANCHES,
    [selectedBranch?.id, selectedBranch?.name],
  );

  const [canScope, setCanScope] = useState(false);

  useEffect(() => {
    analyticsRepo.getYearsWithData().then(setYears);
    analyticsRepo.canScopeByBranch().then(setCanScope);
  }, []);

  useEffect(() => {
    setIsLoading(true);
    setOpenMonth(null);
    const from = new Date(Date.UTC(year, 0, 1)).toISOString();
    const to = new Date(Date.UTC(year + 1, 0, 1) - 1).toISOString();
    Promise.all([
      analyticsRepo.getScopedYear(year, scope),
      // Last year over the same twelve months, for the comparison under the
      // headline. A shop's only useful benchmark is its own last year —
      // and, with a branch selected, that branch's own last year.
      analyticsRepo.getScopedFigures(
        new Date(Date.UTC(year - 1, 0, 1)).toISOString(),
        new Date(Date.UTC(year, 0, 1) - 1).toISOString(),
        scope,
      ),
      analyticsRepo.getScopedTopProducts(from, to, 5, scope),
    ])
      .then(([rows, prev, topRows]) => {
        setMonths(rows);
        setTotal(sum(rows));
        setPrevious(prev);
        setTop(topRows);
        setSource(rows[0]?.source ?? "local");
      })
      .finally(() => setIsLoading(false));
  }, [year, scope]);

  if (!isAdmin(user)) return <Redirect href="/(pos)/" />;

  const money = (n: number) => `${currency}${Math.round(n).toLocaleString()}`;
  const compact = (n: number) => {
    const abs = Math.abs(n);
    if (abs >= 1_000_000)
      return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
    if (abs >= 1_000) return `${Math.round(n / 1_000)}K`;
    return String(Math.round(n));
  };

  // Everything below the chart reads the selected month, or the whole year
  // when none is selected — one set of components, one source.
  const shown: PeriodFigures | null =
    openMonth != null ? (months[openMonth - 1] ?? null) : total;
  const shownLabel =
    openMonth != null
      ? `${t(`analytics.month.${MONTH_KEYS[openMonth - 1]}` as never)} ${year}`
      : String(year);

  const margin =
    shown && shown.netRevenue > 0
      ? (shown.netProfit / shown.netRevenue) * 100
      : null;

  // Year on year, on takings. Only when last year actually traded — "+∞%"
  // against a zero is noise, and a shop's first year has nothing to compare.
  const yoy =
    previous && previous.netRevenue > 0 && total
      ? ((total.netRevenue - previous.netRevenue) / previous.netRevenue) * 100
      : null;

  const traded = months.filter((m) => m.saleCount > 0);
  const best = traded.length
    ? traded.reduce((a, b) => (b.netRevenue > a.netRevenue ? b : a))
    : null;
  const worst =
    traded.length > 1
      ? traded.reduce((a, b) => (b.netRevenue < a.netRevenue ? b : a))
      : null;
  const avgSale =
    shown && shown.saleCount > 0 ? shown.netRevenue / shown.saleCount : 0;

  // Bars are scaled to the busiest month so the shape of the year reads. A
  // flat year draws flat bars, which is the truth; scaling each bar to
  // itself would make every month look identical.
  const peak = Math.max(1, ...months.map((m) => m.netRevenue));

  return (
    <SafeAreaView style={s.root}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={20} color={C.textSub} />
        </TouchableOpacity>
        <Text style={s.title}>{t("analytics.title")}</Text>
      </View>

      <ScrollView contentContainerStyle={s.scroll}>
        {/* Year and branch on one line: they are the same kind of control —
            which slice of the shop's history the screen is about — and
            stacking them pushed the headline figure off the first screen. */}
        <View style={s.controlRow}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ flexGrow: 0, flexShrink: 1 }}
          >
            <View style={s.yearRow}>
              {years.map((y) => (
                <TouchableOpacity
                  key={y}
                  style={[s.yearBtn, y === year && s.yearBtnActive]}
                  onPress={() => setYear(y)}
                  activeOpacity={0.8}
                >
                  <Text style={[s.yearText, y === year && s.yearTextActive]}>
                    {y}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          {canScope && branches.length > 1 && (
            <TouchableOpacity
              style={s.branchBtn}
              onPress={() => setBranchPickerOpen(true)}
              activeOpacity={0.8}
            >
              <Ionicons name="business-outline" size={14} color={C.textSub} />
              <Text style={s.branchBtnText} numberOfLines={1}>
                {branchLabel}
              </Text>
              <Ionicons name="chevron-down" size={13} color={C.muted} />
            </TouchableOpacity>
          )}
        </View>

        {isLoading ? (
          <ActivityIndicator color={C.accent} style={{ marginTop: 56 }} />
        ) : !total || !shown ? null : (
          <>
            {/* ── headline ─────────────────────────────────────────── */}
            <View style={s.hero}>
              <View style={s.heroTopRow}>
                <Text style={s.heroLabel}>{t("analytics.totalSales")}</Text>
                <Text style={s.heroPeriod} numberOfLines={1}>
                  {branches.length > 1
                    ? `${branchLabel} · ${shownLabel}`
                    : shownLabel}
                </Text>
              </View>
              <Text
                style={s.heroValue}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.5}
              >
                {money(shown.netRevenue)}
              </Text>

              <View style={s.heroMetaRow}>
                {openMonth == null && yoy !== null && (
                  <View style={[s.chip, yoy >= 0 ? s.chipUp : s.chipDown]}>
                    <Ionicons
                      name={yoy >= 0 ? "trending-up" : "trending-down"}
                      size={13}
                      color={yoy >= 0 ? C.success : C.danger}
                    />
                    <Text
                      style={[
                        s.chipText,
                        { color: yoy >= 0 ? C.success : C.danger },
                      ]}
                    >
                      {Math.abs(yoy).toFixed(1)}% {t("analytics.vsLastYear")}
                    </Text>
                  </View>
                )}
                <Text style={s.heroMeta}>
                  {t("analytics.saleCount", { count: shown.saleCount })}
                  {shown.saleCount > 0
                    ? `  ·  ${t("analytics.avgSale", { value: money(avgSale) })}`
                    : ""}
                </Text>
              </View>
            </View>

            {/* ── the three that matter ────────────────────────────── */}
            <View style={s.statRow}>
              <Stat
                s={s}
                C={C}
                label={t("analytics.costOfSales")}
                value={money(shown.costOfSales)}
              />
              <Stat
                s={s}
                C={C}
                label={t("analytics.netProfit")}
                value={money(shown.netProfit)}
                tone={shown.netProfit < 0 ? "bad" : "good"}
              />
              <Stat
                s={s}
                C={C}
                label={t("analytics.profitMargin")}
                value={margin === null ? "—" : `${margin.toFixed(1)}%`}
                tone={margin === null ? undefined : margin < 0 ? "bad" : "good"}
              />
            </View>

            {/* ── the year, in one picture ─────────────────────────── */}
            <View style={s.card}>
              <View style={s.cardHead}>
                <Text style={s.cardTitle}>{t("analytics.byMonth")}</Text>
                <Text style={s.cardHint}>
                  {openMonth == null
                    ? t("analytics.tapMonth")
                    : t("analytics.tapClear")}
                </Text>
              </View>

              <View style={s.chart}>
                {months.map((m) => {
                  const selected = openMonth === m.monthNumber;
                  const h = Math.round(
                    (m.netRevenue / peak) * (CHART_HEIGHT - 22),
                  );
                  const loss = m.netProfit < 0 && m.saleCount > 0;
                  return (
                    <TouchableOpacity
                      key={m.month}
                      style={s.chartCol}
                      activeOpacity={0.7}
                      onPress={() =>
                        setOpenMonth(selected ? null : m.monthNumber)
                      }
                    >
                      <View style={s.chartBarArea}>
                        {m.netRevenue > 0 && (
                          <Text
                            style={[s.barValue, selected && { color: C.text }]}
                          >
                            {compact(m.netRevenue)}
                          </Text>
                        )}
                        <View
                          style={[
                            s.bar,
                            { height: Math.max(m.netRevenue > 0 ? 3 : 2, h) },
                            loss && s.barLoss,
                            selected && s.barSelected,
                            m.saleCount === 0 && s.barEmpty,
                          ]}
                        />
                      </View>
                      <Text
                        style={[s.chartLabel, selected && s.chartLabelActive]}
                      >
                        {t(
                          `analytics.month.${MONTH_KEYS[m.monthNumber - 1]}` as never,
                        )}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={s.legendRow}>
                <View style={s.legendItem}>
                  <View
                    style={[s.legendSwatch, { backgroundColor: C.accent }]}
                  />
                  <Text style={s.legendText}>
                    {t("analytics.legendProfit")}
                  </Text>
                </View>
                <View style={s.legendItem}>
                  <View
                    style={[s.legendSwatch, { backgroundColor: C.danger }]}
                  />
                  <Text style={s.legendText}>{t("analytics.legendLoss")}</Text>
                </View>
              </View>
            </View>

            {/* ── full breakdown of whatever is selected ───────────── */}
            <View style={s.card}>
              <Text style={s.cardTitle}>{shownLabel}</Text>
              <View style={{ marginTop: 6 }}>
                <Line
                  s={s}
                  label={t("pl.grossSales")}
                  value={money(shown.revenue)}
                />
                {shown.refunds > 0 && (
                  <Line
                    s={s}
                    label={t("pl.refunds")}
                    value={`− ${money(shown.refunds)}`}
                  />
                )}
                {shown.discountGiven > 0 && (
                  <Line
                    s={s}
                    label={t("analytics.discountGiven")}
                    value={`− ${money(shown.discountGiven)}`}
                  />
                )}
                <Line
                  s={s}
                  label={t("pl.costOfSales")}
                  value={`− ${money(shown.costOfSales)}`}
                />
                <Line
                  s={s}
                  strong
                  label={t("pl.grossProfit")}
                  value={money(shown.grossProfit)}
                  color={shown.grossProfit < 0 ? C.danger : C.success}
                />
                <Line
                  s={s}
                  label={t("pl.staffCosts")}
                  value={`− ${money(shown.staffCosts)}`}
                />
                <Line
                  s={s}
                  label={t("pl.otherExpenses")}
                  value={`− ${money(shown.otherExpenses)}`}
                />
                <Line
                  s={s}
                  strong
                  last
                  label={t("pl.netProfit")}
                  value={money(shown.netProfit)}
                  color={shown.netProfit < 0 ? C.danger : C.success}
                />
              </View>
            </View>

            {/* ── best and worst month ─────────────────────────────── */}
            {openMonth == null && best && (
              <View style={s.statRow}>
                <Stat
                  s={s}
                  C={C}
                  tone="good"
                  label={t("analytics.bestMonth")}
                  value={t(
                    `analytics.month.${MONTH_KEYS[best.monthNumber - 1]}` as never,
                  )}
                  meta={money(best.netRevenue)}
                />
                {worst && (
                  <Stat
                    s={s}
                    C={C}
                    label={t("analytics.quietestMonth")}
                    value={t(
                      `analytics.month.${MONTH_KEYS[worst.monthNumber - 1]}` as never,
                    )}
                    meta={money(worst.netRevenue)}
                  />
                )}
              </View>
            )}

            {/* ── what sold ────────────────────────────────────────── */}
            {openMonth == null && top.length > 0 && (
              <View style={s.card}>
                <Text style={s.cardTitle}>{t("analytics.topProducts")}</Text>
                <View style={{ marginTop: 8, gap: 10 }}>
                  {top.map((p, i) => {
                    const share = top[0].qty > 0 ? p.qty / top[0].qty : 0;
                    return (
                      <View key={p.name} style={{ gap: 5 }}>
                        <View style={s.topRow}>
                          <Text style={s.topRank}>{i + 1}</Text>
                          <Text style={s.topName} numberOfLines={1}>
                            {p.name}
                          </Text>
                          <Text style={s.topQty}>{p.qty}</Text>
                          <Text style={s.topRevenue}>{money(p.revenue)}</Text>
                        </View>
                        <View style={s.topTrack}>
                          <View
                            style={[
                              s.topFill,
                              { width: `${Math.max(2, share * 100)}%` },
                            ]}
                          />
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}

            {/* ── money out on stock — outside the profit above ─────── */}
            <View style={s.noteBox}>
              <View style={s.noteRow}>
                <Text style={s.noteLabel}>{t("analytics.stockPurchased")}</Text>
                {/* A branch read through the sync has no stock purchases to
                    report — the sync never carried them. Printing the 0 it
                    would compute to would read as "bought nothing", which
                    is a different and much more interesting claim. */}
                <Text
                  style={[
                    s.noteValue,
                    source === "mirror" && s.noteValueMissing,
                  ]}
                >
                  {source === "mirror"
                    ? t("analytics.notAvailable")
                    : money(shown.stockPurchased)}
                </Text>
              </View>
              <Text style={s.noteText}>
                {source === "mirror"
                  ? t("analytics.mirrorNote", { branch: branchLabel })
                  : t("analytics.stockNote")}
              </Text>
            </View>

            {source === "mixed" && (
              <Text style={s.footnote}>{t("analytics.mixedNote")}</Text>
            )}
            <Text style={s.footnote}>{t("pl.costNote")}</Text>
          </>
        )}
      </ScrollView>

      <Modal
        visible={branchPickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setBranchPickerOpen(false)}
      >
        <TouchableOpacity
          style={s.pickerOverlay}
          activeOpacity={1}
          onPress={() => setBranchPickerOpen(false)}
        >
          <View style={s.pickerSheet}>
            <Text style={s.pickerTitle}>{t("reports.byBranch")}</Text>
            <TouchableOpacity
              style={s.pickerRow}
              onPress={() => {
                setBranchFilter("all");
                setBranchPickerOpen(false);
              }}
            >
              <Text
                style={[
                  s.pickerRowText,
                  branchFilter === "all" && s.pickerRowTextActive,
                ]}
              >
                {t("reports.allBranches")}
              </Text>
              {branchFilter === "all" && (
                <Ionicons name="checkmark" size={16} color={C.accent} />
              )}
            </TouchableOpacity>
            {branches.map((b) => (
              <TouchableOpacity
                key={b.id}
                style={s.pickerRow}
                onPress={() => {
                  setBranchFilter(b.id);
                  setBranchPickerOpen(false);
                }}
              >
                <Text
                  style={[
                    s.pickerRowText,
                    branchFilter === b.id && s.pickerRowTextActive,
                  ]}
                  numberOfLines={1}
                >
                  {b.name}
                </Text>
                {branchFilter === b.id && (
                  <Ionicons name="checkmark" size={16} color={C.accent} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const Stat = ({
  s,
  C,
  label,
  value,
  meta,
  tone,
}: {
  s: ReturnType<typeof makeStyles>;
  C: ThemeColors;
  label: string;
  value: string;
  meta?: string;
  tone?: "good" | "bad";
}) => (
  <View style={s.stat}>
    <Text style={s.statLabel}>{label}</Text>
    <Text
      style={[
        s.statValue,
        tone === "good" && { color: C.success },
        tone === "bad" && { color: C.danger },
      ]}
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={0.55}
    >
      {value}
    </Text>
    {!!meta && <Text style={s.statMeta}>{meta}</Text>}
  </View>
);

const Line = ({
  s,
  label,
  value,
  strong,
  last,
  color,
}: {
  s: ReturnType<typeof makeStyles>;
  label: string;
  value: string;
  strong?: boolean;
  last?: boolean;
  color?: string;
}) => (
  <View style={[s.line, strong && s.lineStrong, last && s.lineLast]}>
    <Text style={strong ? s.lineLabelStrong : s.lineLabel}>{label}</Text>
    <Text
      style={[strong ? s.lineValueStrong : s.lineValue, !!color && { color }]}
    >
      {value}
    </Text>
  </View>
);

const makeStyles = (C: ThemeColors, isTablet: boolean) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      padding: 16,
      paddingBottom: 8,
      paddingTop: ANDROID_STATUS_BAR + (isTablet ? 6 : 10),
    },
    backBtn: {
      width: 34,
      height: 34,
      borderRadius: R.md,
      backgroundColor: C.card,
      alignItems: "center",
      justifyContent: "center",
    },
    title: { color: C.text, fontSize: F.lg, fontWeight: "800" },
    scroll: { padding: 16, paddingTop: 8, gap: 12, paddingBottom: 44 },

    controlRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    yearRow: { flexDirection: "row", gap: 8 },
    yearBtn: {
      paddingHorizontal: 18,
      paddingVertical: 9,
      borderRadius: R.md,
      backgroundColor: C.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: C.border,
    },
    yearBtnActive: { backgroundColor: C.accent, borderColor: C.accent },
    yearText: { color: C.textSub, fontSize: F.sm, fontWeight: "700" },
    yearTextActive: { color: C.accentFg },

    branchBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      maxWidth: 150,
      paddingHorizontal: 11,
      paddingVertical: 9,
      borderRadius: R.md,
      backgroundColor: C.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: C.border,
    },
    branchBtnText: {
      color: C.text,
      fontSize: F.xs,
      fontWeight: "700",
      flexShrink: 1,
    },

    pickerOverlay: {
      flex: 1,
      backgroundColor: C.overlay,
      justifyContent: "center",
      padding: 32,
    },
    pickerSheet: {
      backgroundColor: C.card,
      borderRadius: R.lg,
      padding: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: C.border,
      ...Shadow.lg,
    },
    pickerTitle: {
      color: C.muted,
      fontSize: F.xs,
      fontWeight: "700",
      letterSpacing: 0.6,
      textTransform: "uppercase",
      paddingHorizontal: 12,
      paddingTop: 8,
      paddingBottom: 6,
    },
    pickerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 12,
      paddingVertical: 12,
      borderRadius: R.sm,
    },
    pickerRowText: { color: C.text, fontSize: F.md, flexShrink: 1 },
    pickerRowTextActive: { color: C.accent, fontWeight: "700" },

    hero: {
      backgroundColor: C.card,
      borderRadius: R.xl,
      padding: 18,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: C.border,
      ...Shadow.md,
      gap: 4,
    },
    heroTopRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    heroLabel: {
      color: C.muted,
      fontSize: F.xs,
      fontWeight: "700",
      letterSpacing: 0.7,
      textTransform: "uppercase",
    },
    heroPeriod: { color: C.textSub, fontSize: F.xs, fontWeight: "600" },
    heroValue: {
      color: C.accent,
      fontSize: 34,
      fontWeight: "800",
      letterSpacing: -0.5,
    },
    heroMetaRow: {
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      gap: 10,
      marginTop: 4,
    },
    heroMeta: { color: C.muted, fontSize: F.xs },
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: 9,
      paddingVertical: 4,
      borderRadius: R.full,
    },
    chipUp: { backgroundColor: withAlpha(C.success, 0.14) },
    chipDown: { backgroundColor: C.dangerSoft },
    chipText: { fontSize: F.xs, fontWeight: "700" },

    statRow: { flexDirection: "row", gap: 10 },
    stat: {
      flex: 1,
      backgroundColor: C.card,
      borderRadius: R.lg,
      padding: 13,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: C.border,
      ...Shadow.sm,
    },
    statLabel: {
      color: C.muted,
      fontSize: 10,
      fontWeight: "700",
      letterSpacing: 0.5,
      textTransform: "uppercase",
      marginBottom: 5,
    },
    statValue: { color: C.text, fontSize: F.md, fontWeight: "800" },
    statMeta: { color: C.muted, fontSize: F.xs, marginTop: 2 },

    card: {
      backgroundColor: C.card,
      borderRadius: R.lg,
      padding: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: C.border,
      ...Shadow.sm,
    },
    cardHead: {
      flexDirection: "row",
      alignItems: "baseline",
      justifyContent: "space-between",
    },
    cardTitle: {
      color: C.muted,
      fontSize: F.xs,
      fontWeight: "700",
      letterSpacing: 0.6,
      textTransform: "uppercase",
    },
    cardHint: { color: C.muted, fontSize: F.xs },

    chart: {
      flexDirection: "row",
      alignItems: "flex-end",
      justifyContent: "space-between",
      height: CHART_HEIGHT,
      marginTop: 14,
      gap: 3,
    },
    chartCol: {
      flex: 1,
      alignItems: "center",
      height: "100%",
      justifyContent: "flex-end",
      gap: 5,
    },
    chartBarArea: {
      flex: 1,
      width: "100%",
      justifyContent: "flex-end",
      alignItems: "center",
      gap: 3,
    },
    barValue: { color: C.muted, fontSize: 8, fontWeight: "700" },
    bar: { width: "78%", borderRadius: 3, backgroundColor: C.accent },
    barLoss: { backgroundColor: C.danger },
    barSelected: { backgroundColor: C.text },
    barEmpty: { backgroundColor: C.border },
    chartLabel: { color: C.muted, fontSize: 9, fontWeight: "600" },
    chartLabelActive: { color: C.text, fontWeight: "800" },

    legendRow: {
      flexDirection: "row",
      gap: 16,
      marginTop: 12,
      justifyContent: "center",
    },
    legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
    legendSwatch: { width: 9, height: 9, borderRadius: 2 },
    legendText: { color: C.muted, fontSize: F.xs },

    line: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 9,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: C.border,
    },
    lineStrong: {
      backgroundColor: C.surface,
      borderRadius: R.sm,
      paddingHorizontal: 9,
    },
    lineLast: { borderBottomWidth: 0 },
    lineLabel: { color: C.textSub, fontSize: F.sm },
    lineValue: { color: C.text, fontSize: F.sm },
    lineLabelStrong: { color: C.text, fontSize: F.md, fontWeight: "800" },
    lineValueStrong: { color: C.text, fontSize: F.md, fontWeight: "800" },

    topRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    topRank: {
      color: C.muted,
      fontSize: F.xs,
      fontWeight: "800",
      width: 14,
      textAlign: "center",
    },
    topName: { color: C.text, fontSize: F.sm, fontWeight: "600", flex: 1 },
    topQty: { color: C.textSub, fontSize: F.xs, fontWeight: "700" },
    topRevenue: {
      color: C.text,
      fontSize: F.xs,
      fontWeight: "700",
      minWidth: 74,
      textAlign: "right",
    },
    topTrack: {
      height: 3,
      borderRadius: 2,
      backgroundColor: C.surface,
      marginLeft: 22,
    },
    topFill: { height: 3, borderRadius: 2, backgroundColor: C.accent },

    noteBox: {
      padding: 14,
      borderRadius: R.lg,
      backgroundColor: C.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: C.border,
      gap: 6,
    },
    noteRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    noteLabel: { color: C.text, fontSize: F.md, fontWeight: "700" },
    noteValue: { color: C.warning, fontSize: F.lg, fontWeight: "800" },
    noteValueMissing: { color: C.muted, fontSize: F.sm, fontWeight: "700" },
    noteText: { color: C.muted, fontSize: F.xs, lineHeight: 17 },

    footnote: {
      color: C.muted,
      fontSize: F.xs,
      lineHeight: 17,
      paddingHorizontal: 4,
    },
  });
