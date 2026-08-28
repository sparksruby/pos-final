import React, { useEffect, useState } from "react";
import {
  View, Text, TouchableOpacity, TextInput,
  StyleSheet, SafeAreaView, ScrollView, Modal,
  ActivityIndicator, Platform, StatusBar,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Redirect, router } from "expo-router";
import { productsRepo } from "../../src/db/productsRepo";
import { stockRepo, InvalidStockAdjustmentError, InvalidTransferError } from "../../src/db/stockRepo";
import { useProductStore } from "../../src/store/productStore";
import { useAuthStore } from "../../src/store/authStore";
import { useBranchStore } from "../../src/store/branchStore";
import { useSyncStore } from "../../src/store/syncStore";
import { useTheme } from "../../src/context/ThemeContext";
import { useLanguage } from "../../src/context/LanguageContext";
import { useAlert } from "@/context/AlertContext";
import { useResponsive } from "../../src/hooks/useResponsive";
import { isAdmin } from "../../src/utils/permissions";
import { BarcodeScannerModal } from "../../src/components/BarcodeScannerModal";
import { HardwareScannerListener } from "../../src/components/HardwareScannerListener";
import { F, R, Shadow, ThemeColors } from "../../src/theme";
import type { Product, StockMovement, StockMovementReason } from "../../src/types";

type Filter = "all" | "low" | "out";
type AdjustMode = "add" | "remove" | "set";

interface AdjustFormState {
  productId:   number;
  productName: string;
  current:     number;
  mode:        AdjustMode;
  qty:         string;
  reason:      StockMovementReason;
}

interface TransferFormState {
  productId:   number;
  productName: string;
  current:     number;
  toBranchId:  number | null;
  qty:         string;
  notes:       string;
}

const REASONS: StockMovementReason[] = ["Restock", "Damaged", "Correction", "Other"];
const DEFAULT_REASON: Record<AdjustMode, StockMovementReason> = {
  add: "Restock", remove: "Damaged", set: "Correction",
};

const ANDROID_STATUS_BAR =
  Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) : 0;

export default function InventoryScreen() {
  const { colors: C } = useTheme();
  const { t } = useLanguage();
  const { alert } = useAlert();
  const { isTablet } = useResponsive();
  const s = React.useMemo(() => makeStyles(C, isTablet), [C, isTablet]);
  const { user } = useAuthStore();
  const refreshHomeCatalog = useProductStore(state => state.load);
  const { branches, currentBranchId } = useBranchStore();
  const currentBranch = branches.find(b => b.id === currentBranchId);
  const otherBranches = branches.filter(b => b.id !== currentBranchId);
  const syncConfig = useSyncStore(state => state.config);
  // Transfers stay unrestricted when this device isn't synced at all (the
  // original single-device, multi-branch setup) — once synced, only the
  // device holding the admin key ("main branch") can move stock between
  // branches, so a branch's own cashier can't quietly drain its stock.
  const canTransfer = !syncConfig || !!syncConfig.adminKey;

  const [products, setProducts] = useState<Product[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  const load = async () => {
    if (!currentBranchId) return;
    setIsLoading(true);
    try {
      const [p, m] = await Promise.all([
        productsRepo.getAllProducts(currentBranchId),
        stockRepo.getRecentMovements({ branchId: currentBranchId }),
      ]);
      setProducts(p);
      setMovements(m);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); }, [currentBranchId]);

  const FILTERS: { key: Filter; label: string }[] = [
    { key: "all", label: t("inventory.filter.all") },
    { key: "low", label: t("inventory.filter.low") },
    { key: "out", label: t("inventory.filter.out") },
  ];

  const searchQuery = search.trim().toLowerCase();
  const filteredProducts = products.filter(p => {
    if (filter === "low" && !(p.stockQty > 0 && p.stockQty <= p.lowStockThreshold)) return false;
    if (filter === "out" && !(p.stockQty <= 0)) return false;
    if (searchQuery.length === 0) return true;
    return p.name.toLowerCase().includes(searchQuery) ||
      (p.sku ?? "").toLowerCase().includes(searchQuery) ||
      (p.barcode ?? "").toLowerCase().includes(searchQuery);
  });

  // Render only a growing window of filteredProducts.
  const PAGE_SIZE = 30;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [filter, search, currentBranchId]);
  const visibleProducts = filteredProducts.slice(0, visibleCount);

  // ── Adjust stock ─────────────────────────────────────────────────────────
  const [adjustForm, setAdjustForm] = useState<AdjustFormState | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const openAdjust = (product: Product) => {
    setAdjustForm({
      productId: product.id, productName: product.name, current: product.stockQty,
      mode: "add", qty: "", reason: DEFAULT_REASON.add,
    });
  };

  const setMode = (mode: AdjustMode) =>
    setAdjustForm(f => f && { ...f, mode, reason: DEFAULT_REASON[mode] });

  // ── Barcode scan — jumps straight to Adjust Stock instead of making the
  // user find the product in the list below. Same two scan paths (camera +
  // HID hardware scanner) the POS screen already uses.
  const [scannerOpen, setScannerOpen] = useState(false);

  const handleBarcodeScanned = async (barcode: string) => {
    setScannerOpen(false);
    if (!currentBranchId) return;
    const product = await productsRepo.getByBarcode(barcode, currentBranchId);
    if (product) {
      openAdjust(product);
    } else {
      alert(t("inventory.scanNotFoundTitle"), t("inventory.scanNotFoundBody"));
    }
  };

  const submitAdjust = async () => {
    if (!adjustForm) return;
    const qty = Number(adjustForm.qty);
    if (!qty || qty < 0 || Number.isNaN(qty)) return;

    const changeQty =
      adjustForm.mode === "add"    ? qty :
      adjustForm.mode === "remove" ? -qty :
      qty - adjustForm.current; // "set" — target absolute value

    if (!currentBranchId) return;
    setSubmitting(true);
    try {
      await stockRepo.adjustStock(adjustForm.productId, currentBranchId, changeQty, adjustForm.reason, user?.name);
      setAdjustForm(null);
      await load();
      refreshHomeCatalog();
    } catch (e) {
      if (e instanceof InvalidStockAdjustmentError) {
        alert(t("common.error"), t("inventory.invalidAdjustment", { available: e.available }));
      } else {
        alert(t("common.error"), "");
      }
    } finally {
      setSubmitting(false);
    }
  };

  // ── Transfer to another branch ───────────────────────────────────────────
  const [transferForm, setTransferForm] = useState<TransferFormState | null>(null);
  const [transferring, setTransferring] = useState(false);

  const openTransfer = (product: Product) => {
    setTransferForm({
      productId: product.id, productName: product.name, current: product.stockQty,
      toBranchId: otherBranches[0]?.id ?? null, qty: "", notes: "",
    });
  };

  const submitTransfer = async () => {
    if (!transferForm || !transferForm.toBranchId || !currentBranchId || !canTransfer) return;
    const qty = Number(transferForm.qty);
    if (!qty || qty <= 0 || Number.isNaN(qty)) return;

    setTransferring(true);
    try {
      await stockRepo.transferStock(
        transferForm.productId, currentBranchId, transferForm.toBranchId, qty,
        user?.name, transferForm.notes.trim() || undefined
      );
      setTransferForm(null);
      await load();
      refreshHomeCatalog();
    } catch (e) {
      if (e instanceof InvalidStockAdjustmentError) {
        alert(t("common.error"), t("inventory.invalidAdjustment", { available: e.available }));
      } else if (e instanceof InvalidTransferError) {
        alert(t("common.error"), t("inventory.transferFailed"));
      } else {
        alert(t("common.error"), "");
      }
    } finally {
      setTransferring(false);
    }
  };

  if (!isAdmin(user)) return <Redirect href="/(pos)/" />;

  return (
    <SafeAreaView style={s.root}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={20} color={C.textSub} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>{t("inventory.title")}</Text>
          {!!currentBranch && branches.length > 1 && (
            <Text style={s.branchSubtitle}>{currentBranch.name}</Text>
          )}
        </View>
        <TouchableOpacity style={s.scanBtn} onPress={() => setScannerOpen(true)}>
          <Ionicons name="barcode-outline" size={19} color={C.text} />
        </TouchableOpacity>
      </View>

      <View style={s.searchRow}>
        <Ionicons name="search" size={16} color={C.muted} />
        <TextInput
          style={s.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder={t("inventory.searchPlaceholder")}
          placeholderTextColor={C.muted}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      <View style={s.filterRow}>
        {FILTERS.map(f => (
          <TouchableOpacity
            key={f.key}
            style={[s.filterBtn, filter === f.key && s.filterBtnActive]}
            onPress={() => setFilter(f.key)}
            activeOpacity={0.8}
          >
            <Text style={[s.filterText, filter === f.key && s.filterTextActive]}>{f.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {isLoading ? (
        <ActivityIndicator color={C.accent} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={s.scroll}>
          {filteredProducts.length === 0 ? (
            <Text style={s.emptyText}>{t("inventory.noProducts")}</Text>
          ) : visibleProducts.map(p => {
            const outOfStock = p.stockQty <= 0;
            const lowStock = !outOfStock && p.stockQty <= p.lowStockThreshold;
            return (
              <TouchableOpacity key={p.id} style={s.productRow} onPress={() => openAdjust(p)} activeOpacity={0.8}>
                <View style={{ flex: 1 }}>
                  <Text style={s.productName}>{p.name}</Text>
                  <Text style={s.productStock}>
                    {t("inventory.currentStock")}: {p.stockQty}
                    {outOfStock && <Text style={s.badgeDanger}>  · {t("inventory.outOfStock")}</Text>}
                    {lowStock && <Text style={s.badgeWarning}>  · {t("inventory.lowStock")}</Text>}
                  </Text>
                </View>
                {otherBranches.length > 0 && canTransfer && (
                  <TouchableOpacity
                    style={s.transferBtn}
                    onPress={(e) => { e.stopPropagation(); openTransfer(p); }}
                    disabled={p.stockQty <= 0}
                  >
                    <Ionicons name="git-branch-outline" size={15} color={p.stockQty > 0 ? C.text : C.muted} />
                  </TouchableOpacity>
                )}
                <View style={s.adjustBtn}>
                  <Ionicons name="swap-vertical-outline" size={16} color={C.accent} />
                </View>
              </TouchableOpacity>
            );
          })}
          {filteredProducts.length > visibleCount && (
            <TouchableOpacity style={s.loadMoreBtn} onPress={() => setVisibleCount(c => c + PAGE_SIZE)}>
              <Text style={s.loadMoreBtnText}>
                {t("common.loadMore")} ({filteredProducts.length - visibleCount})
              </Text>
            </TouchableOpacity>
          )}

          <Text style={s.sectionHeading}>{t("inventory.recentActivity")}</Text>
          {movements.length === 0 ? (
            <Text style={s.emptyText}>{t("inventory.noMovements")}</Text>
          ) : movements.map(m => (
            <View key={m.id} style={s.movementRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.movementProduct}>{m.productName}</Text>
                <Text style={s.movementMeta}>
                  {t(`inventory.reason.${m.reason}` as any)} · {new Date(m.createdAt).toLocaleString()}
                  {m.actorName ? ` · ${m.actorName}` : ""}
                </Text>
              </View>
              <Text style={[s.movementQty, m.changeQty < 0 ? s.movementQtyNeg : s.movementQtyPos]}>
                {m.changeQty > 0 ? `+${m.changeQty}` : m.changeQty}
              </Text>
            </View>
          ))}
        </ScrollView>
      )}

      {/* Adjust stock modal */}
      <Modal visible={!!adjustForm} animationType="slide" transparent onRequestClose={() => setAdjustForm(null)}>
        <View style={s.modalOverlay}>
          {adjustForm && (
            <View style={s.modalSheet}>
              <Text style={s.modalTitle}>{t("inventory.adjustStock")}</Text>
              <Text style={s.hintText}>{adjustForm.productName} — {t("inventory.currentStock")}: {adjustForm.current}</Text>

              <View style={s.modeRow}>
                {(["add", "remove", "set"] as AdjustMode[]).map(mode => (
                  <TouchableOpacity
                    key={mode}
                    style={[s.modeBtn, adjustForm.mode === mode && s.modeBtnActive]}
                    onPress={() => setMode(mode)}
                  >
                    <Text style={[s.modeBtnText, adjustForm.mode === mode && s.modeBtnTextActive]}>
                      {t(`inventory.mode.${mode}`)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={[s.label, { marginTop: 12 }]}>{t("inventory.quantity")}</Text>
              <TextInput
                style={s.input}
                value={adjustForm.qty}
                onChangeText={v => setAdjustForm(f => f && { ...f, qty: v })}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor={C.muted}
              />

              <Text style={[s.label, { marginTop: 12 }]}>{t("inventory.reason")}</Text>
              <View style={s.reasonRow}>
                {REASONS.map(reason => (
                  <TouchableOpacity
                    key={reason}
                    style={[s.reasonBtn, adjustForm.reason === reason && s.reasonBtnActive]}
                    onPress={() => setAdjustForm(f => f && { ...f, reason })}
                  >
                    <Text style={[s.reasonBtnText, adjustForm.reason === reason && s.reasonBtnTextActive]}>
                      {t(`inventory.reason.${reason}` as any)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={s.modalActions}>
                <TouchableOpacity style={s.cancelBtn} onPress={() => setAdjustForm(null)}>
                  <Text style={s.cancelBtnText}>{t("common.cancel")}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.saveBtn, !adjustForm.qty && s.saveBtnOff]}
                  onPress={submitAdjust}
                  disabled={!adjustForm.qty || submitting}
                >
                  {submitting
                    ? <ActivityIndicator color={C.accentFg} />
                    : <Text style={s.saveBtnText}>{t("inventory.apply")}</Text>
                  }
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </Modal>

      {/* Transfer modal */}
      <Modal visible={!!transferForm} animationType="slide" transparent onRequestClose={() => setTransferForm(null)}>
        <View style={s.modalOverlay}>
          {transferForm && (
            <View style={s.modalSheet}>
              <Text style={s.modalTitle}>{t("inventory.transferStock")}</Text>
              <Text style={s.hintText}>
                {transferForm.productName} — {t("inventory.currentStock")}: {transferForm.current}
              </Text>

              <Text style={s.label}>{t("inventory.transferTo")}</Text>
              <View style={s.reasonRow}>
                {otherBranches.map(b => (
                  <TouchableOpacity
                    key={b.id}
                    style={[s.reasonBtn, transferForm.toBranchId === b.id && s.reasonBtnActive]}
                    onPress={() => setTransferForm(f => f && { ...f, toBranchId: b.id })}
                  >
                    <Text style={[s.reasonBtnText, transferForm.toBranchId === b.id && s.reasonBtnTextActive]}>
                      {b.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={[s.label, { marginTop: 12 }]}>{t("inventory.quantity")}</Text>
              <TextInput
                style={s.input}
                value={transferForm.qty}
                onChangeText={v => setTransferForm(f => f && { ...f, qty: v })}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor={C.muted}
              />

              <Text style={[s.label, { marginTop: 12 }]}>{t("inventory.transferNotes")}</Text>
              <TextInput
                style={s.input}
                value={transferForm.notes}
                onChangeText={v => setTransferForm(f => f && { ...f, notes: v })}
                placeholder={t("inventory.transferNotesPlaceholder")}
                placeholderTextColor={C.muted}
              />

              <View style={s.modalActions}>
                <TouchableOpacity style={s.cancelBtn} onPress={() => setTransferForm(null)}>
                  <Text style={s.cancelBtnText}>{t("common.cancel")}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.saveBtn, (!transferForm.qty || !transferForm.toBranchId) && s.saveBtnOff]}
                  onPress={submitTransfer}
                  disabled={!transferForm.qty || !transferForm.toBranchId || transferring}
                >
                  {transferring
                    ? <ActivityIndicator color={C.accentFg} />
                    : <Text style={s.saveBtnText}>{t("inventory.transferStock")}</Text>
                  }
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </Modal>

      <BarcodeScannerModal
        visible={scannerOpen}
        onScanned={handleBarcodeScanned}
        onClose={() => setScannerOpen(false)}
      />
      <HardwareScannerListener enabled={!scannerOpen && !adjustForm && !transferForm} onScan={handleBarcodeScanned} />
    </SafeAreaView>
  );
}

const makeStyles = (C: ThemeColors, isTablet: boolean) => StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  header:  { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, paddingBottom: 8, paddingTop: ANDROID_STATUS_BAR + (isTablet ? 6 : 10) },
  backBtn: { width: 34, height: 34, borderRadius: R.md, backgroundColor: C.card,
             alignItems: "center", justifyContent: "center",
             borderWidth: 1, borderColor: C.border },
  title:   { fontSize: F.xxl, fontWeight: "700", color: C.text },
  branchSubtitle: { color: C.accent, fontSize: F.xs, fontWeight: "700", marginTop: 2 },
  scanBtn: { width: 34, height: 34, borderRadius: R.md, backgroundColor: C.card,
             alignItems: "center", justifyContent: "center",
             borderWidth: 1, borderColor: C.border },

  searchRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: 16, marginBottom: 8,
    backgroundColor: C.card, borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 9,
    borderWidth: 1, borderColor: C.border,
  },
  searchInput: { flex: 1, color: C.text, fontSize: F.md, padding: 0 },

  filterRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, marginBottom: 8 },
  filterBtn: { flex: 1, paddingVertical: 10, borderRadius: R.md, backgroundColor: C.card,
               alignItems: "center", borderWidth: 1, borderColor: C.border },
  filterBtnActive: { backgroundColor: C.accent, borderColor: C.accent },
  filterText: { color: C.muted, fontSize: F.sm, fontWeight: "700" },
  filterTextActive: { color: C.accentFg },

  scroll: { padding: 16, paddingTop: 8, gap: 10 },
  emptyText: { color: C.muted, textAlign: "center", marginVertical: 20, fontSize: F.sm },

  loadMoreBtn: { marginTop: 4, marginBottom: 4, paddingVertical: 12, borderRadius: R.md, backgroundColor: C.card,
                 alignItems: "center", borderWidth: 1, borderColor: C.border },
  loadMoreBtnText: { color: C.text, fontSize: F.sm, fontWeight: "700" },

  productRow: { flexDirection: "row", alignItems: "center", gap: 10,
                backgroundColor: C.surface, borderRadius: R.lg, padding: 14,
                borderWidth: 1, borderColor: C.border, ...Shadow.sm },
  productName: { color: C.text, fontSize: F.sm, fontWeight: "700" },
  productStock: { color: C.muted, fontSize: F.xs, marginTop: 2 },
  badgeDanger: { color: C.danger, fontWeight: "700" },
  badgeWarning: { color: C.warning, fontWeight: "700" },
  adjustBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: C.accentSoft,
               alignItems: "center", justifyContent: "center" },
  transferBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: C.card,
                 alignItems: "center", justifyContent: "center",
                 borderWidth: 1, borderColor: C.border },

  sectionHeading: { color: C.muted, fontSize: F.xs, fontWeight: "700",
                    textTransform: "uppercase", letterSpacing: 0.8, marginTop: 12 },

  movementRow: { flexDirection: "row", alignItems: "center", gap: 10,
                 paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border },
  movementProduct: { color: C.text, fontSize: F.sm, fontWeight: "600" },
  movementMeta: { color: C.muted, fontSize: F.xs, marginTop: 2 },
  movementQty: { fontSize: F.md, fontWeight: "800" },
  movementQtyPos: { color: C.success },
  movementQtyNeg: { color: C.danger },

  modalOverlay: { flex: 1, backgroundColor: C.overlay, justifyContent: "flex-end" },
  modalSheet:   { backgroundColor: C.surface, borderTopLeftRadius: R.xl,
                  borderTopRightRadius: R.xl, padding: 20, maxHeight: "88%", ...Shadow.lg },
  modalTitle: { color: C.text, fontSize: F.lg, fontWeight: "800", marginBottom: 4 },
  hintText: { color: C.muted, fontSize: F.xs, marginBottom: 14 },

  modeRow: { flexDirection: "row", gap: 8 },
  modeBtn: { flex: 1, paddingVertical: 10, borderRadius: R.md, backgroundColor: C.card,
             alignItems: "center", borderWidth: 1, borderColor: C.border },
  modeBtnActive: { backgroundColor: C.accent, borderColor: C.accent },
  modeBtnText: { color: C.muted, fontSize: F.sm, fontWeight: "700" },
  modeBtnTextActive: { color: C.accentFg },

  label: { color: C.textSub, fontSize: F.sm, fontWeight: "600", marginBottom: 6 },
  input: { backgroundColor: C.card, borderRadius: R.md, padding: 12,
           color: C.text, fontSize: F.md, borderWidth: 1, borderColor: C.border },

  reasonRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  reasonBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: R.full,
               backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  reasonBtnActive: { backgroundColor: C.accent, borderColor: C.accent },
  reasonBtnText: { color: C.muted, fontSize: F.xs, fontWeight: "700" },
  reasonBtnTextActive: { color: C.accentFg },

  modalActions: { flexDirection: "row", gap: 10, marginTop: 20, marginBottom: 20 },
  cancelBtn: { flex: 1, paddingVertical: 13, borderRadius: R.md, backgroundColor: C.card,
               alignItems: "center", borderWidth: 1, borderColor: C.border },
  cancelBtnText: { color: C.muted, fontSize: F.sm, fontWeight: "700" },
  saveBtn: { flex: 1, paddingVertical: 13, borderRadius: R.md, backgroundColor: C.accent,
             alignItems: "center" },
  saveBtnOff: { opacity: 0.4 },
  saveBtnText: { color: C.accentFg, fontSize: F.sm, fontWeight: "800" },
});
