import React, { useEffect, useState } from "react";
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
import {
  syncRepo,
  type RemoteSale,
  type RemoteStockMovement,
  type RemoteExpense,
} from "../../src/db/syncRepo";
import {
  productsRepo,
  type AdminProductStockRow,
} from "../../src/db/productsRepo";
import { useSyncStore } from "../../src/store/syncStore";
import { useAuthStore } from "../../src/store/authStore";
import { useBranchStore } from "../../src/store/branchStore";
import { useTheme } from "../../src/context/ThemeContext";
import { useLanguage } from "../../src/context/LanguageContext";
import { useAlert } from "@/context/AlertContext";
import { useResponsive } from "../../src/hooks/useResponsive";
import { isAdmin } from "../../src/utils/permissions";
import { F, R, Shadow, ThemeColors } from "../../src/theme";

const ANDROID_STATUS_BAR =
  Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) : 0;

type Tab = "sales" | "movements" | "products" | "expenses";

export default function SyncOverviewScreen() {
  const { colors: C } = useTheme();
  const { t } = useLanguage();
  const { isTablet } = useResponsive();
  const s = React.useMemo(() => makeStyles(C, isTablet), [C, isTablet]);
  const { user } = useAuthStore();
  const { config, isSyncing, syncNow } = useSyncStore();
  const { currentBranchId, branches } = useBranchStore();
  const isMainBranch = !!(config && config.adminKey);

  const [tab, setTab] = useState<Tab>("sales");
  const [sales, setSales] = useState<RemoteSale[]>([]);
  const [movements, setMovements] = useState<RemoteStockMovement[]>([]);
  const [productRows, setProductRows] = useState<AdminProductStockRow[]>([]);
  const [expenses, setExpenses] = useState<RemoteExpense[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // null = no filter (show every branch). Sales/movements only carry the
  // *name* the server had for their branch at pull time (see RemoteSale/
  // RemoteStockMovement), not a local branch id, so filtering compares
  // names; products' branchStocks do carry the real local branchId.
  const [branchFilter, setBranchFilter] = useState<number | null>(null);
  const branchFilterName =
    branchFilter != null
      ? branches.find((b) => b.id === branchFilter)?.name
      : null;
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const [tabPickerOpen, setTabPickerOpen] = useState(false);
  const [branchPickerOpen, setBranchPickerOpen] = useState(false);

  const branchScopedSales =
    branchFilterName == null
      ? sales
      : sales.filter((s) => s.branchName === branchFilterName);
  const filteredSales =
    query.length === 0
      ? branchScopedSales
      : branchScopedSales.filter(
          (sale) =>
            sale.items.some((item) =>
              item.productName.toLowerCase().includes(query),
            ) ||
            (sale.cashierName ?? "").toLowerCase().includes(query) ||
            (sale.customerName ?? "").toLowerCase().includes(query),
        );

  const branchScopedMovements =
    branchFilterName == null
      ? movements
      : movements.filter((m) => m.branchName === branchFilterName);
  const filteredMovements =
    query.length === 0
      ? branchScopedMovements
      : branchScopedMovements.filter(
          (m) =>
            m.productName.toLowerCase().includes(query) ||
            m.reason.toLowerCase().includes(query) ||
            (m.actorName ?? "").toLowerCase().includes(query),
        );

  const branchScopedProductRows =
    branchFilter == null
      ? productRows
      : productRows.map((p) => ({
          ...p,
          branchStocks: p.branchStocks.filter(
            (bs) => bs.branchId === branchFilter,
          ),
        }));
  const filteredProductRows =
    query.length === 0
      ? branchScopedProductRows
      : branchScopedProductRows.filter(
          (p) =>
            p.name.toLowerCase().includes(query) ||
            p.categoryName.toLowerCase().includes(query),
        );

  const branchScopedExpenses =
    branchFilterName == null
      ? expenses
      : expenses.filter((e) => e.branchName === branchFilterName);
  const filteredExpenses =
    query.length === 0
      ? branchScopedExpenses
      : branchScopedExpenses.filter(
          (e) =>
            e.category.toLowerCase().includes(query) ||
            (e.description ?? "").toLowerCase().includes(query) ||
            (e.actorName ?? "").toLowerCase().includes(query),
        );

  // Render only a growing window of whichever list is on-screen — the
  // active tab's own filtered array can already run into the hundreds.
  const PAGE_SIZE = 30;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [tab, branchFilter, query]);
  const visibleSales = filteredSales.slice(0, visibleCount);
  const visibleMovements = filteredMovements.slice(0, visibleCount);
  const visibleProductRows = filteredProductRows.slice(0, visibleCount);
  const visibleExpenses = filteredExpenses.slice(0, visibleCount);
  // Branch roll-up for the "All Branches" view.
  //
  // Three branches used to mean one flat run of every sale, movement and
  // expense from all of them interleaved, which is unreadable the moment a
  // shop does any volume. The totals come first now, and picking a branch
  // drills into just that branch's rows.
  const branchSummaries = React.useMemo(() => {
    const rows = new Map<
      string,
      {
        name: string;
        branchId: number | null;
        salesTotal: number;
        salesCount: number;
        itemCount: number;
        movementCount: number;
        expenseTotal: number;
      }
    >();
    const row = (name: string | null) => {
      const key = name ?? "—";
      if (!rows.has(key)) {
        rows.set(key, {
          name: key,
          branchId: branches.find((b) => b.name === key)?.id ?? null,
          salesTotal: 0,
          salesCount: 0,
          itemCount: 0,
          movementCount: 0,
          expenseTotal: 0,
        });
      }
      return rows.get(key)!;
    };
    for (const sale of sales) {
      const r = row(sale.branchName);
      r.salesTotal += sale.total;
      r.salesCount += 1;
      r.itemCount += sale.items.reduce((n, i) => n + i.qty, 0);
    }
    for (const m of movements) row(m.branchName).movementCount += 1;
    for (const e of expenses) row(e.branchName).expenseTotal += e.amount;
    return Array.from(rows.values()).sort(
      (a, b) => b.salesTotal - a.salesTotal,
    );
  }, [sales, movements, expenses, branches]);

  const showBranchSummary = branchFilter == null && branchSummaries.length > 1;

  // Which sale's lines are open. Collapsed, a sale is one line — its total
  // and how many items — so a day's trading can be read at a glance instead
  // of scrolled past.
  const [openSaleId, setOpenSaleId] = useState<number | null>(null);
  const [openProductId, setOpenProductId] = useState<number | null>(null);

  const activeTotal =
    tab === "sales"
      ? filteredSales.length
      : tab === "movements"
        ? filteredMovements.length
        : tab === "products"
          ? filteredProductRows.length
          : filteredExpenses.length;

  const tabLabels: Record<Tab, string> = {
    sales: t("syncOverview.sales"),
    movements: t("syncOverview.movements"),
    products: t("syncOverview.products"),
    expenses: t("expenses.title"),
  };
  const branchFilterLabel =
    branchFilter == null
      ? t("reports.allBranches")
      : (branchFilterName ?? t("reports.allBranches"));

  // One row per branch, tappable to drill into it. Shown on whichever tab
  // is open, with that tab's own figure on the right — the totals are the
  // point of "All Branches", and the rows behind them are what you go and
  // look at afterwards.
  const BranchSummary = ({
    rows,
    kind,
  }: {
    rows: typeof branchSummaries;
    kind: "sales" | "movements" | "expenses";
  }) => (
    <>
      {rows.map((b) => (
        <TouchableOpacity
          key={b.name}
          style={s.card}
          activeOpacity={0.7}
          onPress={() => b.branchId != null && setBranchFilter(b.branchId)}
        >
          <View style={s.cardHeaderRow}>
            <Text style={s.branchTag}>{b.name}</Text>
            <Ionicons name="chevron-forward" size={15} color={C.muted} />
          </View>
          <View style={s.cardFooterRow}>
            <Text style={s.metaText}>
              {kind === "sales"
                ? `${t("syncOverview.saleCount", { count: b.salesCount })}  ·  ${t("syncOverview.itemCount", { count: b.itemCount })}`
                : kind === "movements"
                  ? t("syncOverview.movementCount", { count: b.movementCount })
                  : t("syncOverview.saleCount", { count: b.salesCount })}
            </Text>
            <Text style={s.totalText}>
              {kind === "sales"
                ? `$${b.salesTotal.toLocaleString()}`
                : kind === "movements"
                  ? String(b.movementCount)
                  : `$${b.expenseTotal.toLocaleString()}`}
            </Text>
          </View>
        </TouchableOpacity>
      ))}
      <Text style={s.summaryHint}>{t("syncOverview.tapBranch")}</Text>
    </>
  );

  const load = async () => {
    if (!currentBranchId) return;
    setIsLoading(true);
    try {
      // 1000 rather than the getRemoteSales/getRemoteStockMovements/
      // getRemoteExpenses default of 200 — Load More below only pages
      // through what's already fetched, so the fetch itself needs enough
      // headroom for that to mean anything past the old hard cap.
      const [s1, s2, s3, s4] = await Promise.all([
        syncRepo.getRemoteSales(1000),
        syncRepo.getRemoteStockMovements(1000),
        productsRepo.getAllProductsWithBranchStock(),
        syncRepo.getRemoteExpenses(1000),
      ]);
      setSales(s1);
      setMovements(s2);
      setProductRows(s3);
      setExpenses(s4);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [currentBranchId]);

  const handleRefresh = async () => {
    await syncNow();
    await load();
  };

  // For when the history is missing rather than merely stale — see
  // syncRepo.rebuildRemoteHistory. An ordinary refresh cannot recover it,
  // because the server is only ever asked for what changed since last time.
  const { alert } = useAlert();
  const [isRebuilding, setIsRebuilding] = useState(false);
  const handleRebuild = () => {
    alert(t("syncOverview.rebuildTitle"), t("syncOverview.rebuildBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("syncOverview.rebuildAction"),
        onPress: async () => {
          setIsRebuilding(true);
          try {
            const received = await syncRepo.rebuildRemoteHistory();
            await load();
            alert(t("syncOverview.rebuildDone", { count: received }));
          } catch (e: any) {
            alert(t("common.error"), e?.message ?? "");
          } finally {
            setIsRebuilding(false);
          }
        },
      },
    ]);
  };

  if (!isAdmin(user)) return <Redirect href="/(pos)/" />;

  return (
    <SafeAreaView style={s.root}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={20} color={C.textSub} />
        </TouchableOpacity>
        <Ionicons name="albums-outline" size={17} color={C.text} />
        <Text style={s.title}>{t("syncOverview.title")}</Text>
        {isMainBranch && (
          <TouchableOpacity
            style={s.refreshBtn}
            onPress={handleRefresh}
            disabled={isSyncing}
          >
            {isSyncing ? (
              <ActivityIndicator color={C.accent} size="small" />
            ) : (
              <Ionicons name="sync-outline" size={16} color={C.accent} />
            )}
          </TouchableOpacity>
        )}
        {isMainBranch && (
          <TouchableOpacity
            style={s.refreshBtn}
            onPress={handleRebuild}
            disabled={isRebuilding || isSyncing}
          >
            {isRebuilding ? (
              <ActivityIndicator color={C.accent} size="small" />
            ) : (
              <Ionicons
                name="cloud-download-outline"
                size={16}
                color={C.accent}
              />
            )}
          </TouchableOpacity>
        )}
      </View>

      {!isMainBranch ? (
        <View style={s.center}>
          <Ionicons name="lock-closed-outline" size={30} color={C.muted} />
          <Text style={s.centerText}>{t("syncOverview.mainBranchOnly")}</Text>
        </View>
      ) : (
        <>
          <View style={s.selectorRow}>
            <TouchableOpacity
              style={s.selectorBtn}
              onPress={() => setTabPickerOpen(true)}
            >
              <Text style={s.selectorBtnText} numberOfLines={1}>
                {tabLabels[tab]}
              </Text>
              <Ionicons name="chevron-down" size={14} color={C.muted} />
            </TouchableOpacity>
            <TouchableOpacity
              style={s.selectorBtn}
              onPress={() => setBranchPickerOpen(true)}
            >
              <Text style={s.selectorBtnText} numberOfLines={1}>
                {branchFilterLabel}
              </Text>
              <Ionicons name="chevron-down" size={14} color={C.muted} />
            </TouchableOpacity>
          </View>

          {/* Tab picker */}
          <Modal
            visible={tabPickerOpen}
            animationType="fade"
            transparent
            onRequestClose={() => setTabPickerOpen(false)}
          >
            <TouchableOpacity
              style={s.pickerOverlay}
              activeOpacity={1}
              onPress={() => setTabPickerOpen(false)}
            >
              <View style={s.pickerSheet}>
                {(Object.keys(tabLabels) as Tab[]).map((key) => (
                  <TouchableOpacity
                    key={key}
                    style={s.pickerRow}
                    onPress={() => {
                      setTab(key);
                      setTabPickerOpen(false);
                    }}
                  >
                    <Text
                      style={[
                        s.pickerRowText,
                        tab === key && s.pickerRowTextActive,
                      ]}
                    >
                      {tabLabels[key]}
                    </Text>
                    {tab === key && (
                      <Ionicons name="checkmark" size={16} color={C.accent} />
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            </TouchableOpacity>
          </Modal>

          {/* Branch picker */}
          <Modal
            visible={branchPickerOpen}
            animationType="fade"
            transparent
            onRequestClose={() => setBranchPickerOpen(false)}
          >
            <TouchableOpacity
              style={s.pickerOverlay}
              activeOpacity={1}
              onPress={() => setBranchPickerOpen(false)}
            >
              <View style={s.pickerSheet}>
                <TouchableOpacity
                  style={s.pickerRow}
                  onPress={() => {
                    setBranchFilter(null);
                    setBranchPickerOpen(false);
                  }}
                >
                  <Text
                    style={[
                      s.pickerRowText,
                      branchFilter == null && s.pickerRowTextActive,
                    ]}
                  >
                    {t("reports.allBranches")}
                  </Text>
                  {branchFilter == null && (
                    <Ionicons name="checkmark" size={16} color={C.accent} />
                  )}
                </TouchableOpacity>
                <ScrollView style={s.pickerScroll}>
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
                </ScrollView>
              </View>
            </TouchableOpacity>
          </Modal>

          <View style={s.searchRow}>
            <Ionicons name="search" size={16} color={C.muted} />
            <TextInput
              style={s.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder={t("syncOverview.searchPlaceholder")}
              placeholderTextColor={C.muted}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          {isLoading ? (
            <ActivityIndicator color={C.accent} style={{ marginTop: 40 }} />
          ) : tab === "sales" ? (
            <ScrollView contentContainerStyle={s.scroll}>
              {showBranchSummary ? (
                <BranchSummary rows={branchSummaries} kind="sales" />
              ) : (
                <>
                  {filteredSales.length === 0 && (
                    <Text style={s.emptyText}>{t("syncOverview.noSales")}</Text>
                  )}
                  {visibleSales.map((sale) => {
                    const open = openSaleId === sale.id;
                    const itemCount = sale.items.reduce((n, i) => n + i.qty, 0);
                    return (
                      <TouchableOpacity
                        key={sale.id}
                        style={s.card}
                        activeOpacity={0.7}
                        onPress={() => setOpenSaleId(open ? null : sale.id)}
                      >
                        <View style={s.cardHeaderRow}>
                          <Text style={s.branchTag}>
                            {sale.branchName ?? "—"}
                          </Text>
                          <Text style={s.dateText}>
                            {new Date(sale.createdAt).toLocaleString()}
                          </Text>
                        </View>
                        {open &&
                          sale.items.map((item, idx) => (
                            <Text
                              key={idx}
                              style={s.itemLine}
                              numberOfLines={1}
                            >
                              {item.productName} × {item.qty}
                            </Text>
                          ))}
                        <View style={s.cardFooterRow}>
                          <Text style={s.metaText}>
                            {open
                              ? `${sale.paymentMethod}${sale.cashierName ? ` · ${sale.cashierName}` : ""}`
                              : t("syncOverview.itemCount", {
                                  count: itemCount,
                                })}
                          </Text>
                          <Text style={s.totalText}>
                            ${sale.total.toLocaleString()}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </>
              )}
              {!showBranchSummary && activeTotal > visibleCount && (
                <TouchableOpacity
                  style={s.loadMoreBtn}
                  onPress={() => setVisibleCount((c) => c + PAGE_SIZE)}
                >
                  <Text style={s.loadMoreBtnText}>
                    {t("common.loadMore")} ({activeTotal - visibleCount})
                  </Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          ) : tab === "movements" ? (
            <ScrollView contentContainerStyle={s.scroll}>
              {showBranchSummary && (
                <BranchSummary rows={branchSummaries} kind="movements" />
              )}
              {!showBranchSummary && filteredMovements.length === 0 && (
                <Text style={s.emptyText}>{t("syncOverview.noMovements")}</Text>
              )}
              {!showBranchSummary &&
                visibleMovements.map((m) => (
                  <View key={m.id} style={s.card}>
                    <View style={s.cardHeaderRow}>
                      <Text style={s.branchTag}>{m.branchName ?? "—"}</Text>
                      <Text style={s.dateText}>
                        {new Date(m.createdAt).toLocaleString()}
                      </Text>
                    </View>
                    <Text style={s.itemLine} numberOfLines={1}>
                      {m.productName}
                    </Text>
                    <View style={s.cardFooterRow}>
                      <Text style={s.metaText}>
                        {m.reason}
                        {m.actorName ? ` · ${m.actorName}` : ""}
                      </Text>
                      <Text
                        style={[
                          s.totalText,
                          m.changeQty < 0 ? s.negative : s.positive,
                        ]}
                      >
                        {m.changeQty > 0 ? `+${m.changeQty}` : m.changeQty}
                      </Text>
                    </View>
                  </View>
                ))}
              {!showBranchSummary && activeTotal > visibleCount && (
                <TouchableOpacity
                  style={s.loadMoreBtn}
                  onPress={() => setVisibleCount((c) => c + PAGE_SIZE)}
                >
                  <Text style={s.loadMoreBtnText}>
                    {t("common.loadMore")} ({activeTotal - visibleCount})
                  </Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          ) : tab === "products" ? (
            <ScrollView contentContainerStyle={s.scroll}>
              {filteredProductRows.length === 0 && (
                <Text style={s.emptyText}>{t("syncOverview.noProducts")}</Text>
              )}
              {visibleProductRows.map((p) => {
                // Collapsed, a product is its name, its price and what the
                // shop holds altogether. Open, it breaks down by branch.
                // Printing a chip per branch on every row turned a 200-line
                // catalogue across three branches into 600 numbers nobody
                // reads.
                const open = openProductId === p.id;
                const totalStock = p.branchStocks.reduce(
                  (n, bs) => n + bs.stockQty,
                  0,
                );
                const emptyBranches = p.branchStocks.filter(
                  (bs) => bs.stockQty <= 0,
                ).length;
                return (
                  <TouchableOpacity
                    key={p.id}
                    style={s.card}
                    activeOpacity={0.7}
                    onPress={() => setOpenProductId(open ? null : p.id)}
                  >
                    <View style={s.cardHeaderRow}>
                      <Text
                        style={[s.itemLine, { flex: 1, marginRight: 8 }]}
                        numberOfLines={1}
                      >
                        {p.name}
                      </Text>
                      <Text style={s.totalText}>
                        ${p.price.toLocaleString()} / {p.unit}
                      </Text>
                    </View>
                    <View style={s.cardFooterRow}>
                      <Text style={s.metaText}>
                        {p.categoryName}
                        {!open && emptyBranches > 0
                          ? `  ·  ${t("syncOverview.emptyAt", { count: emptyBranches })}`
                          : ""}
                      </Text>
                      {!open && (
                        <Text
                          style={[s.totalText, totalStock <= 0 && s.negative]}
                        >
                          {t("syncOverview.totalStock", {
                            count: totalStock,
                            unit: p.unit,
                          })}
                        </Text>
                      )}
                    </View>
                    {open && (
                      <View style={s.branchStockGrid}>
                        {p.branchStocks.map((bs) => (
                          <View key={bs.branchId} style={s.branchStockChip}>
                            <Text style={s.branchStockName} numberOfLines={1}>
                              {bs.branchName}
                            </Text>
                            <Text
                              style={[
                                s.branchStockQty,
                                bs.stockQty <= 0 && s.negative,
                              ]}
                            >
                              {bs.stockQty}
                            </Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
              {!showBranchSummary && activeTotal > visibleCount && (
                <TouchableOpacity
                  style={s.loadMoreBtn}
                  onPress={() => setVisibleCount((c) => c + PAGE_SIZE)}
                >
                  <Text style={s.loadMoreBtnText}>
                    {t("common.loadMore")} ({activeTotal - visibleCount})
                  </Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          ) : (
            <ScrollView contentContainerStyle={s.scroll}>
              {showBranchSummary && (
                <BranchSummary rows={branchSummaries} kind="expenses" />
              )}
              {!showBranchSummary && filteredExpenses.length === 0 && (
                <Text style={s.emptyText}>{t("expenses.empty")}</Text>
              )}
              {!showBranchSummary &&
                visibleExpenses.map((e) => (
                  <View key={e.id} style={s.card}>
                    <View style={s.cardHeaderRow}>
                      <Text style={s.branchTag}>{e.branchName ?? "—"}</Text>
                      <Text style={s.dateText}>
                        {new Date(e.createdAt).toLocaleString()}
                      </Text>
                    </View>
                    <Text style={s.itemLine} numberOfLines={1}>
                      {e.category}
                    </Text>
                    <View style={s.cardFooterRow}>
                      <Text style={s.metaText}>{e.actorName ?? ""}</Text>
                      <Text style={s.totalText}>
                        ${e.amount.toLocaleString()}
                      </Text>
                    </View>
                  </View>
                ))}
              {!showBranchSummary && activeTotal > visibleCount && (
                <TouchableOpacity
                  style={s.loadMoreBtn}
                  onPress={() => setVisibleCount((c) => c + PAGE_SIZE)}
                >
                  <Text style={s.loadMoreBtnText}>
                    {t("common.loadMore")} ({activeTotal - visibleCount})
                  </Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          )}
        </>
      )}
    </SafeAreaView>
  );
}

const makeStyles = (C: ThemeColors, isTablet: boolean) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },

    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
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
    title: { fontSize: F.lg, fontWeight: "700", color: C.text, flex: 1 },
    refreshBtn: {
      width: 32,
      height: 32,
      borderRadius: R.md,
      backgroundColor: C.card,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: C.border,
    },

    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
      padding: 24,
    },
    centerText: {
      color: C.muted,
      fontSize: F.sm,
      textAlign: "center",
      lineHeight: 20,
    },

    selectorRow: {
      flexDirection: "row",
      gap: 8,
      paddingHorizontal: 16,
      marginTop: 6,
      marginBottom: 4,
    },
    selectorBtn: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 6,
      backgroundColor: C.card,
      borderRadius: R.md,
      paddingHorizontal: 12,
      paddingVertical: 9,
      borderWidth: 1,
      borderColor: C.border,
    },
    selectorBtnText: {
      color: C.text,
      fontSize: F.sm,
      fontWeight: "700",
      flexShrink: 1,
    },

    pickerOverlay: {
      flex: 1,
      backgroundColor: C.overlay,
      justifyContent: "center",
      alignItems: "center",
      padding: 24,
    },
    pickerSheet: {
      backgroundColor: C.surface,
      borderRadius: R.lg,
      width: "100%",
      maxWidth: 360,
      maxHeight: "70%",
      paddingVertical: 6,
      borderWidth: 1,
      borderColor: C.border,
      ...Shadow.lg,
    },
    pickerScroll: { maxHeight: 320 },
    pickerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingVertical: 13,
      borderBottomWidth: 1,
      borderBottomColor: C.border,
    },
    pickerRowText: {
      color: C.text,
      fontSize: F.md,
      fontWeight: "600",
      flexShrink: 1,
      marginRight: 8,
    },
    pickerRowTextActive: { color: C.accent, fontWeight: "800" },

    searchRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginHorizontal: 16,
      marginTop: 4,
      marginBottom: 8,
      backgroundColor: C.card,
      borderRadius: R.md,
      paddingHorizontal: 12,
      paddingVertical: 9,
      borderWidth: 1,
      borderColor: C.border,
    },
    searchInput: { flex: 1, color: C.text, fontSize: F.md, padding: 0 },

    scroll: { padding: 16, gap: 10 },
    emptyText: {
      color: C.muted,
      textAlign: "center",
      marginTop: 40,
      fontSize: F.sm,
    },

    summaryHint: {
      color: C.muted,
      fontSize: F.xs,
      textAlign: "center",
      marginTop: 8,
      marginBottom: 4,
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

    card: {
      backgroundColor: C.surface,
      borderRadius: R.lg,
      padding: 14,
      borderWidth: 1,
      borderColor: C.border,
      ...Shadow.sm,
    },
    cardHeaderRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 6,
    },
    branchTag: {
      color: C.accent,
      fontSize: F.xs,
      fontWeight: "800",
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    dateText: { color: C.muted, fontSize: F.xs },
    itemLine: { color: C.text, fontSize: F.sm, marginTop: 2 },
    cardFooterRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginTop: 8,
    },
    metaText: { color: C.muted, fontSize: F.xs, flexShrink: 1 },
    totalText: { color: C.text, fontSize: F.sm, fontWeight: "800" },
    positive: { color: C.success },
    negative: { color: C.danger },

    branchStockGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
      marginTop: 8,
    },
    branchStockChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      backgroundColor: C.card,
      borderRadius: R.full,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderWidth: 1,
      borderColor: C.border,
      maxWidth: "100%",
    },
    branchStockName: {
      color: C.muted,
      fontSize: F.xs,
      fontWeight: "600",
      flexShrink: 1,
    },
    branchStockQty: { color: C.text, fontSize: F.xs, fontWeight: "800" },
  });
