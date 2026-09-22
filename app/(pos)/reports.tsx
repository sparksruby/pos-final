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
  Modal,
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
  toDateKey,
  anchorFromDateKey,
  type Period,
} from "../../src/utils/reportPeriods";
import { exportReportExcel } from "../../src/utils/exportReportExcel";
import { syncRepo } from "../../src/db/syncRepo";
import { analyticsRepo } from "../../src/db/analyticsRepo";
import { DatePickerModal } from "../../src/components/DatePickerModal";
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

  // A mirrored sale carries its branch's name, not this device's local id
  // for it, so the filter matches on either.
  const branchFilterName =
    branchFilter === "all"
      ? null
      : branches.find((b) => b.id === branchFilter)?.name;
  const sales =
    branchFilter === "all"
      ? allSales
      : allSales.filter(
          (sale) =>
            sale.branchId === branchFilter ||
            (sale.branchId === undefined &&
              sale.branchName === branchFilterName),
        );

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

  const [productMetaByName, setProductMetaByName] = useState<
    Map<string, { category: string; costPrice: number }>
  >(new Map());
  useEffect(() => {
    productsRepo.getProductMetaByName().then(setProductMetaByName);
  }, []);

  // Stock on hand — a snapshot of right-now inventory, not date-ranged like
  // the sales figures above, so it's loaded independently of period/anchor.
  const [stockOnHand, setStockOnHand] = useState<Product[]>([]);
  const [isExporting, setIsExporting] = useState(false);
  const [branchPickerOpen, setBranchPickerOpen] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [showAllProducts, setShowAllProducts] = useState(false);
  // An ordinary branch device holds one branch's sales and nobody else's,
  // so the picker there could only ever offer an empty report. Hidden
  // rather than offered — see analyticsRepo.canScopeByBranch.
  const [canScope, setCanScope] = useState(false);
  useEffect(() => {
    analyticsRepo.canScopeByBranch().then(setCanScope);
  }, []);
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
    // This branch's own sales, plus every other branch's on the device that
    // mirrors them. Reports read only the local sales table before, so the
    // branch buttons under the header had nothing but this branch to filter
    // — the owner picked "Branch Two" and got an empty report.
    Promise.all([
      salesRepo.getSales(from.toISOString(), to.toISOString()),
      syncRepo.getSalesForReports(from.toISOString(), to.toISOString()),
    ])
      .then(([own, others]) => setAllSales([...own, ...others]))
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
        // A mirrored sale has no product id — see getSalesForReports — so
        // fall back to the name. A product renamed since it sold simply
        // does not match, which costs a cost price rather than inventing one.
        const meta = item.productId
          ? productMeta.get(item.productId)
          : productMetaByName.get(item.productName);
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
  }, [sales, productMeta, productMetaByName, t]);

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

      {/* Three stacked rows of controls pushed the first number below the
          fold. Period and branch share a line now, and the period label
          lives in the arrows rather than on a row of its own. */}
      <View style={s.controlRow}>
        <View style={s.segment}>
          {PERIODS.map((p) => (
            <TouchableOpacity
              key={p.key}
              style={[s.segmentBtn, period === p.key && s.segmentBtnActive]}
              onPress={() => changePeriod(p.key)}
              activeOpacity={0.8}
            >
              <Text
                style={[s.segmentText, period === p.key && s.segmentTextActive]}
              >
                {p.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {canScope && branches.length > 1 && (
          <TouchableOpacity
            style={s.branchBtn}
            onPress={() => setBranchPickerOpen(true)}
            activeOpacity={0.8}
          >
            <Ionicons name="business-outline" size={14} color={C.textSub} />
            <Text style={s.branchBtnText} numberOfLines={1}>
              {branchFilter === "all"
                ? t("reports.allBranches")
                : (branches.find((b) => b.id === branchFilter)?.name ?? "")}
            </Text>
            <Ionicons name="chevron-down" size={13} color={C.muted} />
          </TouchableOpacity>
        )}
      </View>

      <View style={s.navRow}>
        <TouchableOpacity
          style={s.navBtn}
          onPress={() => setAnchor((a) => shiftAnchor(period, a, -1))}
        >
          <Ionicons name="chevron-back" size={18} color={C.text} />
        </TouchableOpacity>
        {/* Tappable for every period, not just Daily: the anchor is a date
            whatever the period is, so picking any day in March while
            Monthly is selected opens March. Stepping back to last year's
            figures took twelve taps on the arrow before this. */}
        <TouchableOpacity
          style={s.navLabelBtn}
          onPress={() => setDatePickerOpen(true)}
          activeOpacity={0.7}
        >
          <Text style={s.navLabel}>{label}</Text>
          <Ionicons name="calendar-outline" size={15} color={C.muted} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.navBtn, atCurrentPeriod && s.navBtnOff]}
          onPress={() => setAnchor((a) => shiftAnchor(period, a, 1))}
          disabled={atCurrentPeriod}
        >
          <Ionicons name="chevron-forward" size={18} color={C.text} />
        </TouchableOpacity>
      </View>

      <DatePickerModal
        visible={datePickerOpen}
        value={toDateKey(anchor)}
        onClose={() => setDatePickerOpen(false)}
        onSelect={(key) => {
          setAnchor(anchorFromDateKey(key));
          setDatePickerOpen(false);
        }}
      />

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

      {isLoading ? (
        <ActivityIndicator color={C.accent} style={{ marginTop: 40 }} />
      ) : sales.length === 0 ? (
        <Text style={s.emptyText}>{t("salesHistory.noSales")}</Text>
      ) : (
        <ScrollView contentContainerStyle={s.scroll}>
          {/* One figure leads, the rest support it. Five equal cards made
              the reader decide which of them mattered. */}
          <View style={s.hero}>
            <Text style={s.heroLabel}>{t("reports.revenue")}</Text>
            <Text
              style={s.heroValue}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.5}
            >
              {currency}
              {report.netRevenue.toLocaleString()}
            </Text>
            <Text style={s.heroMeta}>
              {t("reports.salesCount", { count: report.count })}
              {report.count > 0
                ? `  ·  ${t("analytics.avgSale", { value: `${currency}${Math.round(report.netRevenue / report.count).toLocaleString()}` })}`
                : ""}
            </Text>
          </View>

          <View style={s.statGrid}>
            <StatCard
              s={s}
              C={C}
              label={t("reports.profit")}
              value={`${currency}${report.profitTotal.toLocaleString()}`}
              accent={report.profitTotal >= 0}
              danger={report.profitTotal < 0}
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
          </View>
          <Text style={s.profitHint}>{t("reports.profitHint")}</Text>

          {branchFilter === "all" && canScope && branches.length > 1 && (
            <ReportSection s={s} C={C} title={t("reports.byBranch")}>
              {report.byBranch.map((row) => (
                <BreakdownRow
                  key={row.label}
                  s={s}
                  C={C}
                  icon="business-outline"
                  label={row.label}
                  meta={t("reports.salesCount", { count: row.qty })}
                  value={`${currency}${row.revenue.toLocaleString()}`}
                  share={
                    row.revenue /
                    Math.max(1, ...report.byBranch.map((r) => r.revenue))
                  }
                />
              ))}
            </ReportSection>
          )}

          <ReportSection s={s} C={C} title={t("reports.byPaymentMethod")}>
            {report.byMethod.map((row) => (
              <BreakdownRow
                key={row.label}
                s={s}
                C={C}
                icon={METHOD_ICONS[row.label] ?? "cash-outline"}
                label={row.label}
                meta={t("reports.salesCount", { count: row.qty })}
                value={`${currency}${row.revenue.toLocaleString()}`}
                share={
                  row.revenue /
                  Math.max(1, ...report.byMethod.map((r) => r.revenue))
                }
              />
            ))}
          </ReportSection>

          <ReportSection s={s} C={C} title={t("reports.byCashier")}>
            {report.byCashier.map((row) => (
              <BreakdownRow
                key={row.label}
                s={s}
                C={C}
                icon="person-outline"
                label={row.label}
                meta={t("reports.salesCount", { count: row.qty })}
                value={`${currency}${row.revenue.toLocaleString()}`}
                share={
                  row.revenue /
                  Math.max(1, ...report.byCashier.map((r) => r.revenue))
                }
              />
            ))}
          </ReportSection>

          <ReportSection s={s} C={C} title={t("reports.byCategory")}>
            {report.byCategory.map((row) => (
              <BreakdownRow
                key={row.label}
                s={s}
                C={C}
                label={row.label}
                meta={t("reports.qtySold", { qty: row.qty })}
                value={`${currency}${row.revenue.toLocaleString()}`}
                share={
                  row.revenue /
                  Math.max(1, ...report.byCategory.map((r) => r.revenue))
                }
              />
            ))}
          </ReportSection>

          <ReportSection s={s} C={C} title={t("reports.byProduct")}>
            {/* A shop with 300 products printed 300 rows here, which is
                where the screen stopped being a report and became a dump.
                The top ten answer the question; the rest are one tap away
                for whoever actually needs them. */}
            {(showAllProducts
              ? report.byProduct
              : report.byProduct.slice(0, 10)
            ).map((row) => (
              <BreakdownRow
                key={row.label}
                s={s}
                C={C}
                label={row.label}
                meta={t("reports.qtySold", { qty: row.qty })}
                value={`${currency}${row.revenue.toLocaleString()}`}
                share={
                  row.revenue /
                  Math.max(1, ...report.byProduct.map((r) => r.revenue))
                }
              />
            ))}
            {report.byProduct.length > 10 && (
              <TouchableOpacity
                style={s.showAllBtn}
                onPress={() => setShowAllProducts((v) => !v)}
                activeOpacity={0.7}
              >
                <Text style={s.showAllText}>
                  {showAllProducts
                    ? t("reports.showTopTen")
                    : t("reports.showAllProducts", {
                        count: report.byProduct.length,
                      })}
                </Text>
                <Ionicons
                  name={showAllProducts ? "chevron-up" : "chevron-down"}
                  size={14}
                  color={C.accent}
                />
              </TouchableOpacity>
            )}
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

/**
 * One line of a breakdown, with a bar showing its share of the biggest row.
 *
 * The lists were label / count / amount and nothing else, which makes the
 * reader do the comparing — three similar-looking numbers tell you nothing
 * about whether the first is twice the third or a tenth of it. The bar is
 * scaled to the largest row in that section, so the shape of the section
 * reads before any number does.
 */
const BreakdownRow = ({
  s,
  C,
  label,
  meta,
  value,
  share,
  icon,
}: {
  s: Styles;
  C: ThemeColors;
  label: string;
  meta?: string;
  value: string;
  share: number;
  icon?: keyof typeof Ionicons.glyphMap;
}) => (
  <View style={s.bRow}>
    <View style={s.bRowTop}>
      {!!icon && <Ionicons name={icon} size={13} color={C.textSub} />}
      <Text style={s.bLabel} numberOfLines={1}>
        {label}
      </Text>
      {!!meta && <Text style={s.bMeta}>{meta}</Text>}
      <Text style={s.bValue}>{value}</Text>
    </View>
    <View style={s.bTrack}>
      <View
        style={[
          s.bFill,
          { width: `${Math.max(1.5, Math.min(100, share * 100))}%` },
        ]}
      />
    </View>
  </View>
);

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
    navLabelBtn: { flexDirection: "row", alignItems: "center", gap: 8 },
    navLabel: {
      color: C.text,
      fontSize: F.md,
      fontWeight: "700",
      minWidth: 150,
      textAlign: "center",
    },

    scroll: { padding: 16, paddingTop: 8, gap: 12, paddingBottom: 40 },
    emptyText: {
      color: C.muted,
      textAlign: "center",
      marginTop: 40,
      fontSize: F.sm,
    },

    controlRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 16,
      paddingBottom: 8,
    },
    segment: {
      flex: 1,
      flexDirection: "row",
      borderRadius: R.md,
      padding: 3,
      backgroundColor: C.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: C.border,
    },
    segmentBtn: {
      flex: 1,
      paddingVertical: 7,
      borderRadius: R.sm,
      alignItems: "center",
    },
    segmentBtnActive: { backgroundColor: C.accent },
    segmentText: { color: C.textSub, fontSize: F.xs, fontWeight: "700" },
    segmentTextActive: { color: C.accentFg },
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
      gap: 3,
    },
    heroLabel: {
      color: C.muted,
      fontSize: F.xs,
      fontWeight: "700",
      letterSpacing: 0.7,
      textTransform: "uppercase",
    },
    heroValue: {
      color: C.accent,
      fontSize: 32,
      fontWeight: "800",
      letterSpacing: -0.5,
    },
    heroMeta: { color: C.muted, fontSize: F.xs, marginTop: 2 },

    bRow: { paddingVertical: 9, gap: 6 },
    bRowTop: { flexDirection: "row", alignItems: "center", gap: 8 },
    bLabel: { color: C.text, fontSize: F.sm, fontWeight: "600", flex: 1 },
    bMeta: { color: C.muted, fontSize: F.xs },
    bValue: {
      color: C.text,
      fontSize: F.sm,
      fontWeight: "700",
      minWidth: 78,
      textAlign: "right",
    },
    bTrack: { height: 3, borderRadius: 2, backgroundColor: C.surface },
    bFill: { height: 3, borderRadius: 2, backgroundColor: C.accent },

    showAllBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      paddingVertical: 11,
      marginTop: 4,
    },
    showAllText: { color: C.accent, fontSize: F.sm, fontWeight: "700" },

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
