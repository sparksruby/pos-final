import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Modal,
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
import { refundsRepo, InvalidRefundError } from "../../src/db/refundsRepo";
import { shiftsRepo } from "../../src/db/shiftsRepo";
import { exportSalesExcel } from "../../src/utils/exportSalesExcel";
import { exportReceiptPdf } from "../../src/utils/receiptPdf";
import { isDirectSaveAvailable } from "../../src/utils/directSave";
import { useShopStore } from "@/store/shopStore";
import { useAuthStore } from "../../src/store/authStore";
import { useProductStore } from "../../src/store/productStore";
import { useBranchStore } from "../../src/store/branchStore";
import { usePrinterStore } from "../../src/store/printerStore";
import { useTheme } from "../../src/context/ThemeContext";
import { useLanguage } from "../../src/context/LanguageContext";
import { useAlert } from "@/context/AlertContext";
import { usePrint } from "@/context/PrintContext";
import { useResponsive } from "../../src/hooks/useResponsive";
import { isAdmin } from "../../src/utils/permissions";
import {
  periodBounds,
  periodLabel,
  shiftAnchor,
  isCurrentPeriod,
  type Period,
} from "../../src/utils/reportPeriods";
import { F, R, Shadow, ThemeColors } from "../../src/theme";
import type { Sale } from "../../src/types";

const ANDROID_STATUS_BAR =
  Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) : 0;

const METHOD_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  Cash: "cash-outline",
  Card: "card-outline",
  QR: "qr-code-outline",
};

export default function SalesHistoryScreen() {
  const { colors: C } = useTheme();
  const { t } = useLanguage();
  const { alert } = useAlert();
  const { isTablet } = useResponsive();
  const s = React.useMemo(() => makeStyles(C, isTablet), [C, isTablet]);
  const currency = useShopStore((state) => state.settings?.currency ?? "$");
  const shopSettings = useShopStore((state) => state.settings);
  const loadShopSettings = useShopStore((state) => state.load);
  const { user } = useAuthStore();
  const refreshCatalog = useProductStore((state) => state.load);
  const initPrinter = usePrinterStore((state) => state.init);
  const { printReceipt } = usePrint();
  const branchCount = useBranchStore((state) => state.branches.length);
  const currentBranchId = useBranchStore((state) => state.currentBranchId);

  const PERIODS: { key: Period; label: string }[] = [
    { key: "daily", label: t("salesHistory.period.daily") },
    { key: "weekly", label: t("salesHistory.period.weekly") },
    { key: "monthly", label: t("salesHistory.period.monthly") },
    { key: "yearly", label: t("salesHistory.period.yearly") },
  ];

  const [period, setPeriod] = useState<Period>("daily");
  const [anchor, setAnchor] = useState(() => new Date());
  const [sales, setSales] = useState<Sale[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [openShiftId, setOpenShiftId] = useState<number | undefined>(undefined);
  const [search, setSearch] = useState("");

  useEffect(() => {
    loadShopSettings();
    initPrinter();
    shiftsRepo.getOpenShift().then((shift) => setOpenShiftId(shift?.id));
  }, []);

  const loadSales = () => {
    setIsLoading(true);
    const { from, to } = periodBounds(period, anchor);
    return salesRepo
      .getSales(
        from.toISOString(),
        to.toISOString(),
        currentBranchId ?? undefined,
      )
      .then(setSales)
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    loadSales();
  }, [period, anchor, currentBranchId]);

  // ── Refund ────────────────────────────────────────────────────────────────
  const [refundSale, setRefundSale] = useState<Sale | null>(null);
  const [refundQtys, setRefundQtys] = useState<Record<number, number>>({});
  const [refundReason, setRefundReason] = useState("");
  const [refunding, setRefunding] = useState(false);

  const openRefund = (sale: Sale) => {
    setRefundSale(sale);
    setRefundQtys({});
    setRefundReason("");
  };

  const setRefundQty = (saleItemId: number, remaining: number, qty: number) => {
    setRefundQtys((prev) => ({
      ...prev,
      [saleItemId]: Math.max(0, Math.min(qty, remaining)),
    }));
  };

  const confirmRefund = async () => {
    if (!refundSale) return;
    const items = Object.entries(refundQtys)
      .map(([saleItemId, qty]) => ({ saleItemId: Number(saleItemId), qty }))
      .filter((i) => i.qty > 0);
    if (items.length === 0) return;

    setRefunding(true);
    try {
      const refund = await refundsRepo.createRefund({
        saleId: refundSale.id,
        items,
        reason: refundReason.trim() || undefined,
        actorName: user?.name,
        shiftId: openShiftId,
      });
      setRefundSale(null);
      refreshCatalog();
      await loadSales();
      alert(
        t("salesHistory.refundSuccessTitle"),
        t("salesHistory.refundSuccessMsg", {
          amount: `${currency}${refund.amount.toLocaleString()}`,
        }),
      );
    } catch (e: any) {
      if (
        e instanceof InvalidRefundError &&
        e.message.startsWith("OVER_REFUND")
      ) {
        const [, name, available] = e.message.split(":");
        alert(
          t("common.error"),
          t("salesHistory.refundOverAvailable", { name, available }),
        );
      } else {
        alert(t("common.error"), t("salesHistory.refundFailed"));
      }
    } finally {
      setRefunding(false);
    }
  };

  // ── Reprint / Save PDF ───────────────────────────────────────────────────
  const [printingId, setPrintingId] = useState<number | null>(null);
  const [pdfId, setPdfId] = useState<number | null>(null);

  // Awaited here, unlike at checkout: this screen stays put either way, and
  // the row's spinner is what tells the user which receipt is on its way
  // out. printReceipt reports its own failures (see PrintContext).
  const handleReprint = async (sale: Sale) => {
    setPrintingId(sale.id);
    try {
      await printReceipt(sale);
    } finally {
      setPrintingId(null);
    }
  };

  // Android only — offers a straight-to-folder save alongside the share
  // sheet; iOS has no separate concept (its share sheet's own "Save to
  // Files" destination already covers that), so there this just shares.
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

  const handleSavePdf = (sale: Sale) =>
    chooseExportMethod(async (method) => {
      setPdfId(sale.id);
      try {
        const ok = await exportReceiptPdf(sale, shopSettings, method);
        if (method === "save" && ok)
          alert(t("common.saved"), t("common.savedToFolder"));
      } catch {
        alert(t("common.error"), t("payment.pdfFailed"));
      } finally {
        setPdfId(null);
      }
    });

  const summary = useMemo(() => {
    const refunded = sales.reduce(
      (sum, sale) => sum + (sale.refundedAmount ?? 0),
      0,
    );
    const revenue = sales.reduce((sum, sale) => sum + sale.total, 0) - refunded;
    const productTotals = new Map<string, number>();
    for (const sale of sales) {
      for (const item of sale.items) {
        productTotals.set(
          item.productName,
          (productTotals.get(item.productName) ?? 0) + item.qty,
        );
      }
    }
    const topProducts = Array.from(productTotals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    return { count: sales.length, revenue, refunded, topProducts };
  }, [sales]);

  // Narrows which sales are *shown*, not the period — summary/export totals
  // above still reflect every sale in the selected period regardless of
  // this filter.
  const searchQuery = search.trim().toLowerCase();
  const filteredSales =
    searchQuery.length === 0
      ? sales
      : sales.filter(
          (sale) =>
            (sale.customerName ?? "").toLowerCase().includes(searchQuery) ||
            (sale.cashierName ?? "").toLowerCase().includes(searchQuery) ||
            String(sale.id).includes(searchQuery) ||
            sale.items.some((item) =>
              item.productName.toLowerCase().includes(searchQuery),
            ),
        );

  // Renders only a growing window of filteredSales — a period with
  // hundreds of sales was rendering every single card at once. Query/
  // summary/export are unaffected (those already work off the full
  // `sales` array); this only limits what's actually mounted on screen.
  const PAGE_SIZE = 30;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [period, anchor, search]);
  const visibleSales = filteredSales.slice(0, visibleCount);

  const label = periodLabel(period, anchor);
  const atCurrentPeriod = isCurrentPeriod(period, anchor);

  const changePeriod = (next: Period) => {
    setPeriod(next);
    setAnchor(new Date());
  };

  const handleExport = () =>
    chooseExportMethod(async (method) => {
      setIsExporting(true);
      try {
        const ok = await exportSalesExcel(
          {
            sales,
            periodLabel: label,
            currency,
            totalRevenue: summary.revenue,
            topProducts: summary.topProducts,
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

  // A cashier can see today's sales, and only today's.
  //
  // They need it: it is how they check a sale they just rang up, find a
  // receipt to reprint, and see what the drawer should hold before handing
  // over at the end of a shift. Sending them to the owner every time is
  // what makes a shop keep a paper book alongside the app.
  //
  // What they do not get is every other day, the export, or the period
  // buttons — a month of takings is the owner's business, and a
  // spreadsheet of it walks out of the shop on somebody's phone.
  const canSeeAllPeriods = isAdmin(user);

  return (
    <SafeAreaView style={s.root}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={20} color={C.textSub} />
        </TouchableOpacity>
        <Text style={s.title}>{t("salesHistory.title")}</Text>
        {canSeeAllPeriods && (
          <TouchableOpacity
            style={s.exportBtn}
            onPress={handleExport}
            disabled={isExporting || sales.length === 0}
          >
            {isExporting ? (
              <ActivityIndicator size="small" color={C.accentFg} />
            ) : (
              <Ionicons name="download-outline" size={16} color={C.accentFg} />
            )}
          </TouchableOpacity>
        )}
      </View>

      {canSeeAllPeriods && (
        <>
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
        </>
      )}

      {!canSeeAllPeriods && (
        <View style={s.navRow}>
          <Text style={s.navLabel}>{label}</Text>
        </View>
      )}

      <View style={s.searchRow}>
        <Ionicons name="search" size={16} color={C.muted} />
        <TextInput
          style={s.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder={t("salesHistory.searchPlaceholder")}
          placeholderTextColor={C.muted}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {isLoading ? (
        <ActivityIndicator color={C.accent} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={s.scroll}>
          <View style={s.summaryRow}>
            <View style={s.summaryCard}>
              <Text style={s.summaryValue}>{summary.count}</Text>
              <Text style={s.summaryLabel}>{t("salesHistory.totalSales")}</Text>
            </View>
            <View style={s.summaryCard}>
              <Text style={s.summaryValue}>
                {currency}
                {summary.revenue.toLocaleString()}
              </Text>
              <Text style={s.summaryLabel}>
                {t("salesHistory.totalRevenue")}
              </Text>
            </View>
            {summary.refunded > 0 && (
              <View style={s.summaryCard}>
                <Text style={[s.summaryValue, { color: C.danger }]}>
                  -{currency}
                  {summary.refunded.toLocaleString()}
                </Text>
                <Text style={s.summaryLabel}>
                  {t("salesHistory.totalRefunded")}
                </Text>
              </View>
            )}
          </View>

          {summary.topProducts.length > 0 && (
            <View style={s.card}>
              <Text style={s.section}>{t("salesHistory.topProducts")}</Text>
              {summary.topProducts.map(([name, qty]) => (
                <View key={name} style={s.topRow}>
                  <Text style={s.topName} numberOfLines={1}>
                    {name}
                  </Text>
                  <Text style={s.topQty}>
                    {t("salesHistory.qtySold", { qty })}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {sales.length === 0 ? (
            <Text style={s.emptyText}>{t("salesHistory.noSales")}</Text>
          ) : filteredSales.length === 0 ? (
            <Text style={s.emptyText}>{t("salesHistory.noSearchResults")}</Text>
          ) : (
            visibleSales.map((sale) => {
              const expanded = expandedId === sale.id;
              return (
                <TouchableOpacity
                  key={sale.id}
                  style={s.saleCard}
                  onPress={() => setExpandedId(expanded ? null : sale.id)}
                  activeOpacity={0.8}
                >
                  <View style={s.saleRow}>
                    <View style={s.saleIcon}>
                      <Ionicons
                        name={
                          METHOD_ICONS[sale.paymentMethod] ?? "receipt-outline"
                        }
                        size={16}
                        color={C.accent}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.saleTime}>
                        {new Date(sale.createdAt).toLocaleString()}
                      </Text>
                      <Text style={s.saleSub}>
                        {t("salesHistory.items", { count: sale.items.length })}
                        {branchCount > 1 && sale.branchName
                          ? ` · ${sale.branchName}`
                          : ""}
                        {sale.customerName ? ` · ${sale.customerName}` : ""}
                      </Text>
                    </View>
                    <Text style={s.saleTotal}>
                      {currency}
                      {sale.total.toLocaleString()}
                    </Text>
                    <Ionicons
                      name={expanded ? "chevron-up" : "chevron-down"}
                      size={16}
                      color={C.muted}
                    />
                  </View>
                  {expanded && (
                    <View style={s.saleDetail}>
                      {sale.items.map((item) => (
                        <View key={item.id} style={s.detailRow}>
                          <Text style={s.detailLabel}>
                            {item.productName} × {item.qty}
                            {item.refundedQty > 0 && (
                              <Text style={s.detailReturned}>
                                {" "}
                                (
                                {t("salesHistory.returned", {
                                  qty: item.refundedQty,
                                })}
                                )
                              </Text>
                            )}
                          </Text>
                          <Text style={s.detailAmt}>
                            {currency}
                            {item.subtotal.toLocaleString()}
                          </Text>
                        </View>
                      ))}
                      {!!sale.refundedAmount && (
                        <View style={s.detailRow}>
                          <Text
                            style={[
                              s.detailLabel,
                              { color: C.danger, fontWeight: "700" },
                            ]}
                          >
                            {t("salesHistory.refunded")}
                          </Text>
                          <Text style={[s.detailAmt, { color: C.danger }]}>
                            -{currency}
                            {sale.refundedAmount.toLocaleString()}
                          </Text>
                        </View>
                      )}
                      <View style={s.saleActionsRow}>
                        <TouchableOpacity
                          style={s.saleActionBtn}
                          onPress={() => handleReprint(sale)}
                          disabled={printingId === sale.id}
                        >
                          {printingId === sale.id ? (
                            <ActivityIndicator size="small" color={C.text} />
                          ) : (
                            <Ionicons
                              name="print-outline"
                              size={14}
                              color={C.text}
                            />
                          )}
                          <Text style={s.saleActionText}>
                            {t("salesHistory.reprint")}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={s.saleActionBtn}
                          onPress={() => handleSavePdf(sale)}
                          disabled={pdfId === sale.id}
                        >
                          {pdfId === sale.id ? (
                            <ActivityIndicator size="small" color={C.text} />
                          ) : (
                            <Ionicons
                              name="document-outline"
                              size={14}
                              color={C.text}
                            />
                          )}
                          <Text style={s.saleActionText}>
                            {t("salesHistory.savePdf")}
                          </Text>
                        </TouchableOpacity>
                      </View>
                      {sale.items.some((i) => i.qty > i.refundedQty) && (
                        <TouchableOpacity
                          style={s.refundBtn}
                          onPress={() => openRefund(sale)}
                        >
                          <Ionicons
                            name="return-up-back-outline"
                            size={14}
                            color={C.danger}
                          />
                          <Text style={s.refundBtnText}>
                            {t("salesHistory.refund")}
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                </TouchableOpacity>
              );
            })
          )}
          {filteredSales.length > visibleCount && (
            <TouchableOpacity
              style={s.loadMoreBtn}
              onPress={() => setVisibleCount((c) => c + PAGE_SIZE)}
            >
              <Text style={s.loadMoreBtnText}>
                {t("common.loadMore")} ({filteredSales.length - visibleCount})
              </Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      )}

      {/* Refund */}
      <Modal
        visible={!!refundSale}
        animationType="slide"
        transparent
        onRequestClose={() => setRefundSale(null)}
      >
        <View style={s.modalOverlay}>
          {refundSale && (
            <View style={s.modalSheet}>
              <Text style={s.modalTitle}>{t("salesHistory.refundTitle")}</Text>
              <ScrollView style={s.refundItemsList}>
                {refundSale.items.map((item) => {
                  const remaining = item.qty - item.refundedQty;
                  if (remaining <= 0) return null;
                  const qty = refundQtys[item.id] ?? 0;
                  return (
                    <View key={item.id} style={s.refundItemRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={s.refundItemName} numberOfLines={1}>
                          {item.productName}
                        </Text>
                        <Text style={s.refundItemSub}>
                          {t("salesHistory.refundAvailable", {
                            qty: remaining,
                          })}
                        </Text>
                      </View>
                      <View style={s.qtyRow}>
                        <TouchableOpacity
                          style={s.qtyBtn}
                          onPress={() =>
                            setRefundQty(item.id, remaining, qty - 1)
                          }
                        >
                          <Ionicons name="remove" size={16} color={C.text} />
                        </TouchableOpacity>
                        <Text style={s.qtyNum}>{qty}</Text>
                        <TouchableOpacity
                          style={s.qtyBtn}
                          onPress={() =>
                            setRefundQty(item.id, remaining, qty + 1)
                          }
                        >
                          <Ionicons name="add" size={16} color={C.text} />
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
              </ScrollView>

              <Text style={[s.label, { marginTop: 10 }]}>
                {t("salesHistory.refundReason")}
              </Text>
              <TextInput
                style={s.input}
                value={refundReason}
                onChangeText={setRefundReason}
                placeholder={t("salesHistory.refundReasonPlaceholder")}
                placeholderTextColor={C.muted}
              />

              <View style={s.modalActions}>
                <TouchableOpacity
                  style={s.cancelBtn}
                  onPress={() => setRefundSale(null)}
                >
                  <Text style={s.cancelBtnText}>{t("common.cancel")}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    s.confirmRefundBtn,
                    Object.values(refundQtys).every((q) => q <= 0) &&
                      s.saveBtnOff,
                  ]}
                  onPress={confirmRefund}
                  disabled={
                    Object.values(refundQtys).every((q) => q <= 0) || refunding
                  }
                >
                  {refunding ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={s.confirmRefundText}>
                      {t("salesHistory.refund")}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

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
      borderWidth: 1,
      borderColor: C.border,
    },
    title: { fontSize: F.xxl, fontWeight: "700", color: C.text, flex: 1 },
    exportBtn: {
      backgroundColor: C.accent,
      width: 34,
      height: 34,
      borderRadius: R.md,
      alignItems: "center",
      justifyContent: "center",
    },

    searchRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginHorizontal: 16,
      marginBottom: 8,
      backgroundColor: C.card,
      borderRadius: R.md,
      paddingHorizontal: 12,
      paddingVertical: 9,
      borderWidth: 1,
      borderColor: C.border,
    },
    searchInput: { flex: 1, color: C.text, fontSize: F.md, padding: 0 },

    periodRow: {
      flexDirection: "row",
      gap: 8,
      paddingHorizontal: 16,
      marginBottom: 8,
    },
    periodBtn: {
      flex: 1,
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
      minWidth: 140,
      textAlign: "center",
    },

    scroll: { padding: 16, paddingTop: 8, gap: 12 },

    summaryRow: { flexDirection: "row", gap: 12 },
    summaryCard: {
      flex: 1,
      backgroundColor: C.surface,
      borderRadius: R.lg,
      padding: 16,
      borderWidth: 1,
      borderColor: C.border,
      alignItems: "center",
      ...Shadow.sm,
    },
    summaryValue: { color: C.text, fontSize: F.xl, fontWeight: "800" },
    summaryLabel: { color: C.muted, fontSize: F.xs, marginTop: 4 },

    card: {
      backgroundColor: C.surface,
      borderRadius: R.lg,
      padding: 16,
      borderWidth: 1,
      borderColor: C.border,
      ...Shadow.sm,
    },
    section: {
      color: C.muted,
      fontSize: F.xs,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.8,
      marginBottom: 12,
    },

    topRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingVertical: 5,
    },
    topName: { color: C.text, fontSize: F.sm, flex: 1, marginRight: 8 },
    topQty: { color: C.accent, fontSize: F.sm, fontWeight: "700" },

    emptyText: {
      color: C.muted,
      textAlign: "center",
      marginTop: 40,
      fontSize: F.sm,
    },

    loadMoreBtn: {
      marginTop: 4,
      paddingVertical: 12,
      borderRadius: R.md,
      backgroundColor: C.card,
      alignItems: "center",
      borderWidth: 1,
      borderColor: C.border,
    },
    loadMoreBtnText: { color: C.text, fontSize: F.sm, fontWeight: "700" },

    saleCard: {
      backgroundColor: C.surface,
      borderRadius: R.lg,
      padding: 14,
      borderWidth: 1,
      borderColor: C.border,
      ...Shadow.sm,
    },
    saleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    saleIcon: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: C.accentSoft,
      alignItems: "center",
      justifyContent: "center",
    },
    saleTime: { color: C.text, fontSize: F.sm, fontWeight: "600" },
    saleSub: { color: C.muted, fontSize: F.xs, marginTop: 2 },
    saleTotal: { color: C.accent, fontSize: F.md, fontWeight: "800" },

    saleDetail: {
      marginTop: 10,
      paddingTop: 10,
      borderTopWidth: 1,
      borderTopColor: C.border,
      gap: 4,
    },
    detailRow: { flexDirection: "row", justifyContent: "space-between" },
    detailLabel: { color: C.textSub, fontSize: F.xs, flex: 1, marginRight: 8 },
    detailAmt: { color: C.textSub, fontSize: F.xs, fontWeight: "600" },
    detailReturned: { color: C.danger, fontWeight: "700" },

    refundBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      marginTop: 8,
      paddingVertical: 9,
      borderRadius: R.md,
      backgroundColor: C.card,
      borderWidth: 1,
      borderColor: C.danger,
    },
    refundBtnText: { color: C.danger, fontSize: F.xs, fontWeight: "800" },

    saleActionsRow: { flexDirection: "row", gap: 8, marginTop: 10 },
    saleActionBtn: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      paddingVertical: 9,
      borderRadius: R.md,
      backgroundColor: C.card,
      borderWidth: 1,
      borderColor: C.border,
    },
    saleActionText: { color: C.text, fontSize: F.xs, fontWeight: "800" },

    modalOverlay: {
      flex: 1,
      backgroundColor: C.overlay,
      justifyContent: "flex-end",
    },
    modalSheet: {
      backgroundColor: C.surface,
      borderTopLeftRadius: R.xl,
      borderTopRightRadius: R.xl,
      padding: 20,
      maxHeight: "88%",
      ...Shadow.lg,
    },
    modalTitle: {
      color: C.text,
      fontSize: F.lg,
      fontWeight: "800",
      marginBottom: 14,
    },

    refundItemsList: { maxHeight: 280 },
    refundItemRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: C.border,
    },
    refundItemName: { color: C.text, fontSize: F.sm, fontWeight: "600" },
    refundItemSub: { color: C.muted, fontSize: F.xs, marginTop: 2 },

    qtyRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginLeft: 8,
    },
    qtyBtn: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: C.card,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: C.border,
    },
    qtyNum: {
      color: C.text,
      fontSize: F.md,
      fontWeight: "700",
      minWidth: 22,
      textAlign: "center",
    },

    label: {
      color: C.textSub,
      fontSize: F.sm,
      fontWeight: "600",
      marginBottom: 6,
    },
    input: {
      backgroundColor: C.card,
      borderRadius: R.md,
      padding: 12,
      color: C.text,
      fontSize: F.md,
      borderWidth: 1,
      borderColor: C.border,
    },

    modalActions: {
      flexDirection: "row",
      gap: 10,
      marginTop: 20,
      marginBottom: 20,
    },
    cancelBtn: {
      flex: 1,
      paddingVertical: 13,
      borderRadius: R.md,
      backgroundColor: C.card,
      alignItems: "center",
      borderWidth: 1,
      borderColor: C.border,
    },
    cancelBtnText: { color: C.muted, fontSize: F.sm, fontWeight: "700" },
    confirmRefundBtn: {
      flex: 1,
      paddingVertical: 13,
      borderRadius: R.md,
      backgroundColor: C.danger,
      alignItems: "center",
    },
    saveBtnOff: { opacity: 0.4 },
    confirmRefundText: { color: "#fff", fontSize: F.sm, fontWeight: "800" },
  });
