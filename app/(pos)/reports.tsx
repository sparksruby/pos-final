import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  ActivityIndicator,
  Platform,
  StatusBar,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Redirect, router } from "expo-router";
import { salesRepo } from "../../src/db/salesRepo";
import { productsRepo } from "../../src/db/productsRepo";
import { useShopStore } from "@/store/shopStore";
import { useAuthStore } from "../../src/store/authStore";
import { useBranchStore } from "../../src/store/branchStore";
import { useTheme } from "../../src/context/ThemeContext";
import { useLanguage } from "../../src/context/LanguageContext";
import { useResponsive } from "../../src/hooks/useResponsive";
import { isAdmin } from "../../src/utils/permissions";
import {
  periodBounds,
  periodLabel,
  shiftAnchor,
  isCurrentPeriod,
  type Period,
} from "../../src/utils/reportPeriods";
import { exportReportExcel } from "@/utils/exportReportExcel";
import { useAlert } from "@/context/AlertContext";
import { isDirectSaveAvailable } from "../../src/utils/directSave";
import { F, R, Shadow, ThemeColors } from "../../src/theme";
import type { Sale, SalePaymentMethod, Product } from "../../src/types";

const ANDROID_STATUS_BAR =
  Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) : 0;

const METHOD_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  Cash: "cash-outline",
  Card: "card-outline",
  QR: "qr-code-outline",
  Split: "layers-outline",
};

interface Row {
  label: string;
  qty: number;
  revenue: number;
  profit?: number;
}

const addRow = (
  map: Map<string, Row>,
  key: string,
  qty: number,
  revenue: number,
  profit?: number,
) => {
  const existing = map.get(key) ?? {
    label: key,
    qty: 0,
    revenue: 0,
    profit: 0,
  };
  existing.qty += qty;
  existing.revenue += revenue;
  if (profit !== undefined) existing.profit = (existing.profit ?? 0) + profit;
  map.set(key, existing);
};

export default function ReportsScreen() {
  const { colors: C } = useTheme();
  const { t } = useLanguage();
  const { isTablet } = useResponsive();
  const s = React.useMemo(() => makeStyles(C, isTablet), [C, isTablet]);
  const currency = useShopStore((state) => state.settings?.currency ?? "$");
  const { user } = useAuthStore();
  const branches = useBranchStore((state) => state.branches);
  const currentBranchId = useBranchStore((state) => state.currentBranchId);

  const PERIODS: { key: Period; label: string }[] = [
    { key: "daily", label: t("salesHistory.period.daily") },
    { key: "weekly", label: t("salesHistory.period.weekly") },
    { key: "monthly", label: t("salesHistory.period.monthly") },
    { key: "yearly", label: t("salesHistory.period.yearly") },
  ];

  const [period, setPeriod] = useState<Period>("monthly");
  const [anchor, setAnchor] = useState(() => new Date());
  const [branchFilter, setBranchFilter] = useState<number | "all">("all");
  const [allSales, setAllSales] = useState<Sale[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const sales =
    branchFilter === "all"
      ? allSales
      : allSales.filter((sale) => sale.branchId === branchFilter);

  // productId -> category name / cost price, built once from every
  // category+product (including inactive/deactivated ones, so historical
  // sales of a since-retired product still resolve).
  const [productMeta, setProductMeta] = useState<
    Map<number, { category: string; costPrice: number }>
  >(new Map());

  useEffect(() => {
    productsRepo.getAllProductMeta().then((rows) => {
      const map = new Map<number, { category: string; costPrice: number }>();
      for (const r of rows) {
        map.set(r.id, { category: r.categoryName, costPrice: r.costPrice });
      }
      setProductMeta(map);
    });
  }, []);

  // Stock on hand — a snapshot of right-now inventory, not date-ranged like
  // the sales figures above, so it's loaded independently of period/anchor.
  const [stockOnHand, setStockOnHand] = useState<Product[]>([]);
  const [isExporting, setIsExporting] = useState(false);
  const { alert } = useAlert();
  useEffect(() => {
    if (!currentBranchId) return;
    productsRepo.getAllProducts(currentBranchId).then((products) => {
      setStockOnHand([...products].sort((a, b) => a.stockQty - b.stockQty));
    });
  }, [currentBranchId]);

  useEffect(() => {
    setIsLoading(true);
    const { from, to } = periodBounds(period, anchor);
    salesRepo
      .getSales(from.toISOString(), to.toISOString())
      .then(setAllSales)
      .finally(() => setIsLoading(false));
  }, [period, anchor]);

  const label = periodLabel(period, anchor);
  const atCurrentPeriod = isCurrentPeriod(period, anchor);

  const changePeriod = (next: Period) => {
    setPeriod(next);
    setAnchor(new Date());
  };

  const report = useMemo(() => {
    let itemDiscountTotal = 0;
    let refundedTotal = 0;
    let grossRevenue = 0;
    let profitTotal = 0;

    const byProduct = new Map<string, Row>();
    const byCategory = new Map<string, Row>();
    const byCashier = new Map<string, Row>();
    const byMethod = new Map<string, Row>();
    const byBranch = new Map<string, Row>();

    for (const sale of sales) {
      const refunded = sale.refundedAmount ?? 0;
      refundedTotal += refunded;
      grossRevenue += sale.total;

      const cashierName = sale.cashierName || t("reports.unknownCashier");
      addRow(byCashier, cashierName, 1, sale.total - refunded);

      if (sale.branchName)
        addRow(byBranch, sale.branchName, 1, sale.total - refunded);

      if (sale.paymentMethod === "Split" && sale.payments?.length) {
        for (const p of sale.payments) addRow(byMethod, p.method, 1, p.amount);
      } else {
        addRow(byMethod, sale.paymentMethod, 1, sale.total);
      }

      for (const item of sale.items) {
        itemDiscountTotal += item.discount;
        const netQty = item.qty - item.refundedQty;
        if (netQty <= 0) continue;

        const netUnitRevenue = (item.subtotal - item.discount) / item.qty;
        const netRevenue = netUnitRevenue * netQty;
        const meta = productMeta.get(item.productId);
        const cost = (meta?.costPrice ?? 0) * netQty;
        const profit = netRevenue - cost;
        profitTotal += profit;

        addRow(byProduct, item.productName, netQty, netRevenue, profit);
        addRow(
          byCategory,
          meta?.category ?? t("reports.uncategorized"),
          netQty,
          netRevenue,
          profit,
        );
      }
    }

    const netRevenue = grossRevenue - refundedTotal;
    const otherDiscountTotal = Math.max(
      0,
      sales.reduce((s, sale) => s + sale.discount, 0) - itemDiscountTotal,
    );
    const totalDiscount = itemDiscountTotal + otherDiscountTotal;

    const sortDesc = (m: Map<string, Row>) =>
      Array.from(m.values()).sort((a, b) => b.revenue - a.revenue);

    return {
      count: sales.length,
      netRevenue,
      refundedTotal,
      profitTotal,
      itemDiscountTotal,
      otherDiscountTotal,
      totalDiscount,
      byProduct: sortDesc(byProduct),
      byCategory: sortDesc(byCategory),
      byCashier: sortDesc(byCashier),
      byMethod: sortDesc(byMethod),
      byBranch: sortDesc(byBranch),
    };
  }, [sales, productMeta, t]);

  // Android only — offers a straight-to-folder save alongside the share
  // sheet, same as Sales History. iOS's share sheet already has "Save to
  // Files", so there this just shares.
  const chooseExportMethod = (onChoose: (method: "share" | "save") => void) => {
    if (!isDirectSaveAvailable) {
      onChoose("share");
      return;
    }
    alert(t("common.exportTitle"), "", [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("common.share"), onPress: () => onChoose("share") },
      { text: t("common.saveToDevice"), onPress: () => onChoose("save") },
    ]);
  };

  const handleExport = () =>
    chooseExportMethod(async (method) => {
      setIsExporting(true);
      try {
        const ok = await exportReportExcel(
          {
            periodLabel: label,
            branchLabel:
              branchFilter === "all"
                ? t("reports.allBranches")
                : (branches.find((b) => b.id === branchFilter)?.name ?? ""),
            currency,
            count: report.count,
            netRevenue: report.netRevenue,
            refundedTotal: report.refundedTotal,
            profitTotal: report.profitTotal,
            totalDiscount: report.totalDiscount,
            byProduct: report.byProduct,
            byCategory: report.byCategory,
            byCashier: report.byCashier,
            byMethod: report.byMethod,
            byBranch: report.byBranch,
          },
          method,
        );
        if (method === "save" && ok)
          alert(t("common.saved"), t("common.savedToFolder"));
      } catch {
        alert(t("common.error"), t("salesHistory.exportFailed"));
      } finally {
        setIsExporting(false);
      }
    });

  if (!isAdmin(user)) return <Redirect href="/(pos)/" />;

  return (
    <SafeAreaView style={s.root}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={20} color={C.textSub} />
        </TouchableOpacity>
        <Text style={s.title}>{t("reports.title")}</Text>
        <TouchableOpacity
          style={s.exportBtn}
          onPress={handleExport}
          disabled={isExporting || report.count === 0}
          activeOpacity={0.85}
        >
          {isExporting ? (
            <ActivityIndicator size="small" color={C.accentFg} />
          ) : (
            <Ionicons name="download-outline" size={18} color={C.accentFg} />
          )}
        </TouchableOpacity>
      </View>

      <View style={s.periodRow}>
        {PERIODS.map((p) => (
          <TouchableOpacity
            key={p.key}
            style={[s.periodBtn, period === p.key && s.periodBtnActive]}
            onPress={() => changePeriod(p.key)}
            activeOpacity={0.8}
          >
            <Text
              style={[s.periodText, period === p.key && s.periodTextActive]}
            >
              {p.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {branches.length > 1 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0 }}
          contentContainerStyle={s.branchFilterRow}
        >
          <TouchableOpacity
            style={[
              s.branchFilterBtn,
              branchFilter === "all" && s.branchFilterBtnActive,
            ]}
            onPress={() => setBranchFilter("all")}
          >
            <Text
              style={[
                s.branchFilterText,
                branchFilter === "all" && s.branchFilterTextActive,
              ]}
            >
              {t("reports.allBranches")}
            </Text>
          </TouchableOpacity>
          {branches.map((b) => (
            <TouchableOpacity
              key={b.id}
              style={[
                s.branchFilterBtn,
                branchFilter === b.id && s.branchFilterBtnActive,
              ]}
              onPress={() => setBranchFilter(b.id)}
            >
              <Text
                style={[
                  s.branchFilterText,
                  branchFilter === b.id && s.branchFilterTextActive,
                ]}
                numberOfLines={1}
              >
                {b.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      <View style={s.navRow}>
        <TouchableOpacity
          style={s.navBtn}
          onPress={() => setAnchor((a) => shiftAnchor(period, a, -1))}
        >
          <Ionicons name="chevron-back" size={18} color={C.text} />
        </TouchableOpacity>
        <Text style={s.navLabel}>{label}</Text>
        <TouchableOpacity
          style={[s.navBtn, atCurrentPeriod && s.navBtnOff]}
          onPress={() => setAnchor((a) => shiftAnchor(period, a, 1))}
          disabled={atCurrentPeriod}
        >
          <Ionicons name="chevron-forward" size={18} color={C.text} />
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <ActivityIndicator color={C.accent} style={{ marginTop: 40 }} />
      ) : sales.length === 0 ? (
        <Text style={s.emptyText}>{t("salesHistory.noSales")}</Text>
      ) : (
        <ScrollView contentContainerStyle={s.scroll}>
          <View style={s.statGrid}>
            <StatCard
              s={s}
              C={C}
              label={t("reports.sales")}
              value={String(report.count)}
            />
            <StatCard
              s={s}
              label={t("reports.revenue")}
              value={`${currency}${report.netRevenue.toLocaleString()}`}
              accent
              C={C}
            />
            {report.refundedTotal > 0 && (
              <StatCard
                s={s}
                label={t("reports.refunded")}
                value={`-${currency}${report.refundedTotal.toLocaleString()}`}
                danger
                C={C}
              />
            )}
            {report.totalDiscount > 0 && (
              <StatCard
                s={s}
                label={t("reports.discountsGiven")}
                value={`-${currency}${report.totalDiscount.toLocaleString()}`}
                danger
                C={C}
              />
            )}
            <StatCard
              s={s}
              label={t("reports.profit")}
              value={`${currency}${report.profitTotal.toLocaleString()}`}
              accent
              C={C}
            />
          </View>
          <Text style={s.profitHint}>{t("reports.profitHint")}</Text>

          {branchFilter === "all" && branches.length > 1 && (
            <ReportSection s={s} C={C} title={t("reports.byBranch")}>
              {report.byBranch.map((row) => (
                <View key={row.label} style={s.row}>
                  <View style={s.rowLeft}>
                    <Ionicons
                      name="business-outline"
                      size={14}
                      color={C.textSub}
                    />
                    <Text style={s.rowLabel}>{row.label}</Text>
                  </View>
                  <Text style={s.rowSub}>
                    {t("reports.salesCount", { count: row.qty })}
                  </Text>
                  <Text style={s.rowValue}>
                    {currency}
                    {row.revenue.toLocaleString()}
                  </Text>
                </View>
              ))}
            </ReportSection>
          )}

          <ReportSection s={s} C={C} title={t("reports.byPaymentMethod")}>
            {report.byMethod.map((row) => (
              <View key={row.label} style={s.row}>
                <View style={s.rowLeft}>
                  <Ionicons
                    name={METHOD_ICONS[row.label] ?? "cash-outline"}
                    size={14}
                    color={C.textSub}
                  />
                  <Text style={s.rowLabel}>{row.label}</Text>
                </View>
                <Text style={s.rowSub}>
                  {t("reports.salesCount", { count: row.qty })}
                </Text>
                <Text style={s.rowValue}>
                  {currency}
                  {row.revenue.toLocaleString()}
                </Text>
              </View>
            ))}
          </ReportSection>

          <ReportSection s={s} C={C} title={t("reports.byCashier")}>
            {report.byCashier.map((row) => (
              <View key={row.label} style={s.row}>
                <Text style={[s.rowLabel, { flex: 1 }]} numberOfLines={1}>
                  {row.label}
                </Text>
                <Text style={s.rowSub}>
                  {t("reports.salesCount", { count: row.qty })}
                </Text>
                <Text style={s.rowValue}>
                  {currency}
                  {row.revenue.toLocaleString()}
                </Text>
              </View>
            ))}
          </ReportSection>

          <ReportSection s={s} C={C} title={t("reports.byCategory")}>
            {report.byCategory.map((row) => (
              <View key={row.label} style={s.row}>
                <Text style={[s.rowLabel, { flex: 1 }]} numberOfLines={1}>
                  {row.label}
                </Text>
                <Text style={s.rowSub}>
                  {t("reports.qtySold", { qty: row.qty })}
                </Text>
                <Text style={s.rowValue}>
                  {currency}
                  {row.revenue.toLocaleString()}
                </Text>
              </View>
            ))}
          </ReportSection>

          <ReportSection s={s} C={C} title={t("reports.byProduct")}>
            {report.byProduct.map((row) => (
              <View key={row.label} style={s.row}>
                <Text style={[s.rowLabel, { flex: 1 }]} numberOfLines={1}>
                  {row.label}
                </Text>
                <Text style={s.rowSub}>
                  {t("reports.qtySold", { qty: row.qty })}
                </Text>
                <Text style={s.rowValue}>
                  {currency}
                  {row.revenue.toLocaleString()}
                </Text>
              </View>
            ))}
          </ReportSection>

          <ReportSection s={s} C={C} title={t("reports.discountBreakdown")}>
            <View style={s.row}>
              <Text style={[s.rowLabel, { flex: 1 }]}>
                {t("reports.itemDiscounts")}
              </Text>
              <Text style={s.rowValue}>
                {currency}
                {report.itemDiscountTotal.toLocaleString()}
              </Text>
            </View>
            <View style={s.row}>
              <Text style={[s.rowLabel, { flex: 1 }]}>
                {t("reports.orderDiscounts")}
              </Text>
              <Text style={s.rowValue}>
                {currency}
                {report.otherDiscountTotal.toLocaleString()}
              </Text>
            </View>
          </ReportSection>

          <ReportSection s={s} C={C} title={t("reports.stockOnHand")}>
            {stockOnHand.length === 0 ? (
              <Text style={s.rowSub}>{t("reports.stockOnHandEmpty")}</Text>
            ) : (
              stockOnHand.map((p) => {
                const outOfStock = p.stockQty <= 0;
                const lowStock =
                  !outOfStock && p.stockQty <= p.lowStockThreshold;
                return (
                  <View key={p.id} style={s.row}>
                    <Text style={[s.rowLabel, { flex: 1 }]} numberOfLines={1}>
                      {p.name}
                    </Text>
                    {outOfStock && (
                      <Text style={s.stockBadgeDanger}>
                        {t("inventory.outOfStock")}
                      </Text>
                    )}
                    {lowStock && (
                      <Text style={s.stockBadgeWarning}>
                        {t("inventory.lowStock")}
                      </Text>
                    )}
                    <Text
                      style={[s.rowValue, outOfStock && s.stockBadgeDanger]}
                    >
                      {p.stockQty} {p.unit}
                    </Text>
                  </View>
                );
              })
            )}
          </ReportSection>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ─── Small pieces ───────────────────────────────────────────────────────────

const StatCard = ({
  s,
  C,
  label,
  value,
  accent,
  danger,
}: {
  s: Styles;
  C: ThemeColors;
  label: string;
  value: string;
  accent?: boolean;
  danger?: boolean;
}) => (
  <View style={s.statCard}>
    <Text
      style={[
        s.statValue,
        accent && { color: C.accent },
        danger && { color: C.danger },
      ]}
      numberOfLines={1}
    >
      {value}
    </Text>
    <Text style={s.statLabel}>{label}</Text>
  </View>
);

const ReportSection = ({
  s,
  C,
  title,
  children,
}: {
  s: Styles;
  C: ThemeColors;
  title: string;
  children: React.ReactNode;
}) => {
  const items = React.Children.toArray(children);
  if (items.length === 0) return null;
  return (
    <View style={s.card}>
      <Text style={s.section}>{title}</Text>
      {items}
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

type Styles = ReturnType<typeof makeStyles>;

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
    exportBtn: {
      backgroundColor: C.accent,
      width: 34,
      height: 34,
      borderRadius: R.md,
      alignItems: "center",
      justifyContent: "center",
      marginLeft: "auto",
    },
    backBtn: {
      width: 34,
      height: 34,
      borderRadius: R.md,
      backgroundColor: C.card,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: C.border,
    },
    title: { fontSize: F.xxl, fontWeight: "700", color: C.text, flex: 1 },

    periodRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      paddingHorizontal: 16,
      marginBottom: 8,
    },
    periodBtn: {
      flexGrow: 1,
      flexBasis: "22%",
      paddingVertical: 10,
      borderRadius: R.md,
      backgroundColor: C.card,
      alignItems: "center",
      borderWidth: 1,
      borderColor: C.border,
    },
    periodBtnActive: { backgroundColor: C.accent, borderColor: C.accent },
    periodText: { color: C.muted, fontSize: F.sm, fontWeight: "700" },
    periodTextActive: { color: C.accentFg },

    branchFilterRow: {
      paddingHorizontal: 16,
      marginBottom: 8,
      gap: 8,
      flexDirection: "row",
    },
    branchFilterBtn: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: R.full,
      backgroundColor: C.card,
      borderWidth: 1,
      borderColor: C.border,
    },
    branchFilterBtnActive: { backgroundColor: C.accent, borderColor: C.accent },
    branchFilterText: { color: C.muted, fontSize: F.sm, fontWeight: "700" },
    branchFilterTextActive: { color: C.accentFg },

    navRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 16,
      paddingHorizontal: 16,
      marginBottom: 8,
    },
    navBtn: {
      width: 32,
      height: 32,
      borderRadius: R.md,
      backgroundColor: C.card,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: C.border,
    },
    navBtnOff: { opacity: 0.3 },
    navLabel: {
      color: C.text,
      fontSize: F.md,
      fontWeight: "700",
      minWidth: 160,
      textAlign: "center",
    },

    scroll: { padding: 16, paddingTop: 8, gap: 12, paddingBottom: 40 },
    emptyText: {
      color: C.muted,
      textAlign: "center",
      marginTop: 40,
      fontSize: F.sm,
    },

    statGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    statCard: {
      flexGrow: 1,
      flexBasis: "31%",
      backgroundColor: C.surface,
      borderRadius: R.lg,
      padding: 14,
      borderWidth: 1,
      borderColor: C.border,
      alignItems: "center",
      ...Shadow.sm,
    },
    statValue: { color: C.text, fontSize: F.lg, fontWeight: "800" },
    statLabel: {
      color: C.muted,
      fontSize: F.xs,
      marginTop: 4,
      textAlign: "center",
    },
    profitHint: {
      color: C.muted,
      fontSize: F.xs,
      marginTop: -2,
      marginBottom: 2,
    },

    card: {
      backgroundColor: C.surface,
      borderRadius: R.lg,
      padding: 16,
      borderWidth: 1,
      borderColor: C.border,
      gap: 2,
      ...Shadow.sm,
    },
    section: {
      color: C.muted,
      fontSize: F.xs,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.8,
      marginBottom: 10,
    },

    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingVertical: 6,
    },
    rowLeft: { flexDirection: "row", alignItems: "center", gap: 6 },
    rowLabel: { color: C.text, fontSize: F.sm, fontWeight: "600" },
    rowSub: { color: C.muted, fontSize: F.xs },
    rowValue: {
      color: C.accent,
      fontSize: F.sm,
      fontWeight: "700",
      marginLeft: "auto",
    },
    stockBadgeDanger: { color: C.danger, fontSize: F.xs, fontWeight: "700" },
    stockBadgeWarning: { color: C.warning, fontSize: F.xs, fontWeight: "700" },
  });
