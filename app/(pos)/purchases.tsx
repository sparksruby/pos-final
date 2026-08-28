import React, { useEffect, useState } from "react";
import {
  View, Text, TouchableOpacity, TextInput,
  StyleSheet, SafeAreaView, ScrollView, Modal,
  ActivityIndicator, Platform, StatusBar,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Redirect, router } from "expo-router";
import { suppliersRepo } from "../../src/db/suppliersRepo";
import { purchasesRepo, InvalidPurchaseError, InvalidPaymentError } from "../../src/db/purchasesRepo";
import { productsRepo } from "../../src/db/productsRepo";
import { useProductStore } from "../../src/store/productStore";
import { useShopStore } from "@/store/shopStore";
import { useAuthStore } from "../../src/store/authStore";
import { useBranchStore } from "../../src/store/branchStore";
import { useTheme } from "../../src/context/ThemeContext";
import { useLanguage } from "../../src/context/LanguageContext";
import { useAlert } from "@/context/AlertContext";
import { useResponsive } from "../../src/hooks/useResponsive";
import { isAdmin } from "../../src/utils/permissions";
import { F, R, Shadow, ThemeColors } from "../../src/theme";
import type { Purchase, PurchaseStatus, Product, Supplier } from "../../src/types";

interface DraftItem {
  productId:   number;
  productName: string;
  qty:         string;
  unitCost:    string;
}

const STATUS_COLOR: Record<PurchaseStatus, "danger" | "warning" | "success"> = {
  Unpaid: "danger", Partial: "warning", Paid: "success",
};

const ANDROID_STATUS_BAR =
  Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) : 0;

export default function PurchasesScreen() {
  const { colors: C } = useTheme();
  const { t } = useLanguage();
  const { alert } = useAlert();
  const { isTablet } = useResponsive();
  const s = React.useMemo(() => makeStyles(C, isTablet), [C, isTablet]);
  const { user } = useAuthStore();
  const { currentBranchId } = useBranchStore();
  const currency = useShopStore(state => state.settings?.currency ?? "$");
  const refreshHomeCatalog = useProductStore(state => state.load);

  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = async () => {
    setIsLoading(true);
    try {
      setPurchases(await purchasesRepo.getRecent(50, currentBranchId ?? undefined));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); }, [currentBranchId]);

  // ── Create purchase ──────────────────────────────────────────────────────
  const [createOpen, setCreateOpen]     = useState(false);
  const [suppliers, setSuppliers]       = useState<Supplier[]>([]);
  const [supplier, setSupplier]         = useState<Supplier | null>(null);
  const [invoiceNo, setInvoiceNo]       = useState("");
  const [items, setItems]               = useState<DraftItem[]>([]);
  const [paidAmount, setPaidAmount]     = useState("0");
  const [notes, setNotes]               = useState("");
  const [saving, setSaving]             = useState(false);

  const [supplierPickerOpen, setSupplierPickerOpen] = useState(false);
  const [productPickerOpen, setProductPickerOpen]   = useState(false);
  const [pickerSearch, setPickerSearch]             = useState("");
  const [catalog, setCatalog]           = useState<Product[]>([]);

  const openCreate = async () => {
    setSupplier(null); setInvoiceNo(""); setItems([]); setPaidAmount("0"); setNotes("");
    setCreateOpen(true);
    const [s1, p1] = await Promise.all([
      suppliersRepo.getAll(),
      currentBranchId ? productsRepo.getAllProducts(currentBranchId) : Promise.resolve([]),
    ]);
    setSuppliers(s1);
    setCatalog(p1);
  };

  const addItem = (p: Product) => {
    setProductPickerOpen(false);
    setPickerSearch("");
    if (items.some(i => i.productId === p.id)) return;
    setItems(prev => [...prev, { productId: p.id, productName: p.name, qty: "1", unitCost: String(p.costPrice || "") }]);
  };

  const removeItem = (productId: number) => setItems(prev => prev.filter(i => i.productId !== productId));

  const updateItem = (productId: number, patch: Partial<DraftItem>) =>
    setItems(prev => prev.map(i => i.productId === productId ? { ...i, ...patch } : i));

  const draftTotal = items.reduce((sum, i) => sum + (Number(i.qty) || 0) * (Number(i.unitCost) || 0), 0);

  const submitCreate = async () => {
    if (!supplier || items.length === 0 || !currentBranchId) return;
    setSaving(true);
    try {
      await purchasesRepo.create({
        supplierId: supplier.id,
        invoiceNo:  invoiceNo.trim() || undefined,
        items: items.map(i => ({
          productId: i.productId, productName: i.productName,
          qty: Number(i.qty) || 0, unitCost: Number(i.unitCost) || 0,
        })),
        paidAmount: Number(paidAmount) || 0,
        notes:      notes.trim() || undefined,
        branchId:   currentBranchId,
        actorName:  user?.name,
      });
      setCreateOpen(false);
      load();
      refreshHomeCatalog();
    } catch (e) {
      const message = e instanceof InvalidPurchaseError ? t("purchases.invalidPurchase") : t("common.error");
      alert(t("common.error"), message);
    } finally {
      setSaving(false);
    }
  };

  // ── Detail / record payment ──────────────────────────────────────────────
  const [detail, setDetail] = useState<Purchase | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [paying, setPaying] = useState(false);

  const openDetail = async (p: Purchase) => {
    const full = await purchasesRepo.getById(p.id);
    setDetail(full);
    setPayAmount("");
  };

  const submitPayment = async () => {
    if (!detail) return;
    const amount = Number(payAmount) || 0;
    if (amount <= 0) return;
    setPaying(true);
    try {
      const updated = await purchasesRepo.recordPayment(detail.id, amount, user?.name);
      setDetail(updated);
      setPayAmount("");
      load();
    } catch (e) {
      const message = e instanceof InvalidPaymentError ? t("purchases.invalidPayment") : t("common.error");
      alert(t("common.error"), message);
    } finally {
      setPaying(false);
    }
  };

  if (!isAdmin(user)) return <Redirect href="/(pos)/" />;

  const supplierResults = suppliers.filter(sup =>
    sup.name.toLowerCase().includes(pickerSearch.trim().toLowerCase())
  );
  const productResults = catalog.filter(p =>
    p.name.toLowerCase().includes(pickerSearch.trim().toLowerCase())
  );

  return (
    <SafeAreaView style={s.root}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={20} color={C.textSub} />
        </TouchableOpacity>
        <Ionicons name="receipt-outline" size={18} color={C.text} />
        <Text style={s.title}>{t("purchases.title")}</Text>
        <TouchableOpacity style={s.addBtn} onPress={openCreate}>
          <Ionicons name="add" size={16} color={C.accentFg} />
          <Text style={s.addBtnText}>{t("purchases.addNew")}</Text>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <ActivityIndicator color={C.accent} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={s.scroll}>
          {purchases.length === 0 && <Text style={s.emptyText}>{t("purchases.empty")}</Text>}
          {purchases.map(p => (
            <TouchableOpacity key={p.id} style={s.purchaseCard} onPress={() => openDetail(p)} activeOpacity={0.8}>
              <View style={{ flex: 1 }}>
                <Text style={s.purchaseSupplier}>{p.supplierName}</Text>
                <Text style={s.purchaseMeta}>{new Date(p.createdAt).toLocaleDateString()}{p.invoiceNo ? ` · ${p.invoiceNo}` : ""}</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={s.purchaseTotal}>{currency}{p.total.toLocaleString()}</Text>
                <Text style={[s.statusBadge, s[`status_${STATUS_COLOR[p.status]}` as "status_danger"]]}>
                  {t(`purchases.status.${p.status}` as any)}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Create purchase */}
      <Modal visible={createOpen} animationType="slide" transparent onRequestClose={() => setCreateOpen(false)}>
        <View style={s.modalOverlay}>
          <ScrollView style={s.modalSheet} keyboardShouldPersistTaps="handled">
            <Text style={s.modalTitle}>{t("purchases.newPurchase")}</Text>

            <Text style={s.label}>{t("purchases.supplier")}</Text>
            <TouchableOpacity style={s.pickerBtn} onPress={() => setSupplierPickerOpen(true)}>
              <Ionicons name="cart-outline" size={15} color={C.accent} />
              <Text style={s.pickerBtnText}>{supplier?.name ?? t("purchases.selectSupplier")}</Text>
            </TouchableOpacity>

            <Text style={[s.label, { marginTop: 12 }]}>{t("purchases.invoiceNo")}</Text>
            <TextInput
              style={s.input}
              value={invoiceNo}
              onChangeText={setInvoiceNo}
              placeholder={t("purchases.invoiceNoPlaceholder")}
              placeholderTextColor={C.muted}
            />

            <View style={s.itemsHeader}>
              <Text style={s.label}>{t("purchases.items")}</Text>
              <TouchableOpacity style={s.addItemBtn} onPress={() => setProductPickerOpen(true)}>
                <Ionicons name="add" size={13} color={C.muted} />
                <Text style={s.addItemBtnText}>{t("purchases.addItem")}</Text>
              </TouchableOpacity>
            </View>

            {items.length === 0 ? (
              <Text style={s.detailEmpty}>{t("purchases.noItemsYet")}</Text>
            ) : items.map(item => (
              <View key={item.productId} style={s.itemRow}>
                <Text style={s.itemName} numberOfLines={1}>{item.productName}</Text>
                <TextInput
                  style={s.itemInput}
                  value={item.qty}
                  onChangeText={v => updateItem(item.productId, { qty: v })}
                  keyboardType="numeric"
                  placeholder={t("purchases.qty")}
                  placeholderTextColor={C.muted}
                />
                <TextInput
                  style={s.itemInput}
                  value={item.unitCost}
                  onChangeText={v => updateItem(item.productId, { unitCost: v })}
                  keyboardType="numeric"
                  placeholder={t("purchases.unitCost")}
                  placeholderTextColor={C.muted}
                />
                <TouchableOpacity onPress={() => removeItem(item.productId)}>
                  <Ionicons name="close-circle" size={18} color={C.danger} />
                </TouchableOpacity>
              </View>
            ))}

            {items.length > 0 && (
              <Text style={s.draftTotal}>{t("purchases.total")}: {currency}{draftTotal.toLocaleString()}</Text>
            )}

            <Text style={[s.label, { marginTop: 12 }]}>{t("purchases.paidAmount")}</Text>
            <TextInput
              style={s.input}
              value={paidAmount}
              onChangeText={setPaidAmount}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={C.muted}
            />

            <Text style={[s.label, { marginTop: 12 }]}>{t("purchases.notes")}</Text>
            <TextInput
              style={s.input}
              value={notes}
              onChangeText={setNotes}
              placeholder={t("purchases.notesPlaceholder")}
              placeholderTextColor={C.muted}
            />

            <View style={s.modalActions}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setCreateOpen(false)}>
                <Text style={s.cancelBtnText}>{t("common.cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.saveBtn, (!supplier || items.length === 0) && s.saveBtnOff]}
                onPress={submitCreate}
                disabled={!supplier || items.length === 0 || saving}
              >
                {saving
                  ? <ActivityIndicator color={C.accentFg} />
                  : <Text style={s.saveBtnText}>{t("common.save")}</Text>
                }
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* Supplier picker */}
      <Modal visible={supplierPickerOpen} animationType="fade" transparent onRequestClose={() => setSupplierPickerOpen(false)}>
        <View style={s.sheetOverlay}>
          <View style={s.sheet}>
            <Text style={s.modalTitle}>{t("purchases.selectSupplier")}</Text>
            <TextInput
              style={s.input}
              value={pickerSearch}
              onChangeText={setPickerSearch}
              placeholder={t("suppliers.searchPlaceholder")}
              placeholderTextColor={C.muted}
              autoFocus
            />
            <ScrollView style={s.pickerList}>
              {supplierResults.map(sup => (
                <TouchableOpacity
                  key={sup.id}
                  style={s.pickerRow}
                  onPress={() => { setSupplier(sup); setSupplierPickerOpen(false); setPickerSearch(""); }}
                >
                  <Text style={s.pickerRowText}>{sup.name}</Text>
                </TouchableOpacity>
              ))}
              {supplierResults.length === 0 && (
                <Text style={s.detailEmpty}>{t("suppliers.empty")}</Text>
              )}
            </ScrollView>
            <TouchableOpacity style={s.cancelBtn} onPress={() => { setSupplierPickerOpen(false); setPickerSearch(""); }}>
              <Text style={s.cancelBtnText}>{t("common.cancel")}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Product picker */}
      <Modal visible={productPickerOpen} animationType="fade" transparent onRequestClose={() => setProductPickerOpen(false)}>
        <View style={s.sheetOverlay}>
          <View style={s.sheet}>
            <Text style={s.modalTitle}>{t("purchases.addItem")}</Text>
            <TextInput
              style={s.input}
              value={pickerSearch}
              onChangeText={setPickerSearch}
              placeholder={t("pos.searchPlaceholder")}
              placeholderTextColor={C.muted}
              autoFocus
            />
            <ScrollView style={s.pickerList}>
              {productResults.map(p => (
                <TouchableOpacity key={p.id} style={s.pickerRow} onPress={() => addItem(p)}>
                  <Text style={s.pickerRowText}>{p.name}</Text>
                </TouchableOpacity>
              ))}
              {productResults.length === 0 && (
                <Text style={s.detailEmpty}>{t("pos.noProducts")}</Text>
              )}
            </ScrollView>
            <TouchableOpacity style={s.cancelBtn} onPress={() => { setProductPickerOpen(false); setPickerSearch(""); }}>
              <Text style={s.cancelBtnText}>{t("common.cancel")}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Purchase detail / record payment */}
      <Modal visible={!!detail} animationType="slide" transparent onRequestClose={() => setDetail(null)}>
        <View style={s.modalOverlay}>
          {detail && (
            <ScrollView style={s.modalSheet}>
              <Text style={s.modalTitle}>{detail.supplierName}</Text>
              <Text style={s.detailEmpty}>
                {new Date(detail.createdAt).toLocaleString()}{detail.invoiceNo ? ` · ${detail.invoiceNo}` : ""}
              </Text>

              {detail.items.map(item => (
                <View key={item.id} style={s.detailItemRow}>
                  <Text style={s.itemName} numberOfLines={1}>{item.productName} × {item.qty}</Text>
                  <Text style={s.detailAmt}>{currency}{item.subtotal.toLocaleString()}</Text>
                </View>
              ))}

              <View style={s.divider} />
              <View style={s.sumRow}>
                <Text style={s.sumLabel}>{t("purchases.total")}</Text>
                <Text style={s.sumValue}>{currency}{detail.total.toLocaleString()}</Text>
              </View>
              <View style={s.sumRow}>
                <Text style={s.sumLabel}>{t("purchases.paidAmount")}</Text>
                <Text style={s.sumValue}>{currency}{detail.paidAmount.toLocaleString()}</Text>
              </View>
              <View style={s.sumRow}>
                <Text style={s.sumLabel}>{t("purchases.balance")}</Text>
                <Text style={[s.sumValue, { color: C.danger }]}>
                  {currency}{(detail.total - detail.paidAmount).toLocaleString()}
                </Text>
              </View>

              {detail.status !== "Paid" && (
                <View style={{ marginTop: 16 }}>
                  <Text style={s.label}>{t("purchases.recordPayment")}</Text>
                  <View style={s.payRow}>
                    <TextInput
                      style={[s.input, { flex: 1 }]}
                      value={payAmount}
                      onChangeText={setPayAmount}
                      keyboardType="numeric"
                      placeholder="0"
                      placeholderTextColor={C.muted}
                    />
                    <TouchableOpacity
                      style={[s.saveBtn, { flex: 0, paddingHorizontal: 20 }, !payAmount && s.saveBtnOff]}
                      onPress={submitPayment}
                      disabled={!payAmount || paying}
                    >
                      {paying
                        ? <ActivityIndicator color={C.accentFg} />
                        : <Text style={s.saveBtnText}>{t("purchases.pay")}</Text>
                      }
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              <TouchableOpacity style={[s.cancelBtn, { marginTop: 20, marginBottom: 20 }]} onPress={() => setDetail(null)}>
                <Text style={s.cancelBtnText}>{t("common.close")}</Text>
              </TouchableOpacity>
            </ScrollView>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (C: ThemeColors, isTablet: boolean) => StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  header:  { flexDirection: "row", alignItems: "center", gap: 8, padding: 16, paddingBottom: 8, paddingTop: ANDROID_STATUS_BAR + (isTablet ? 6 : 10) },
  backBtn: { width: 34, height: 34, borderRadius: R.md, backgroundColor: C.card,
             alignItems: "center", justifyContent: "center",
             borderWidth: 1, borderColor: C.border },
  title:   { fontSize: F.lg, fontWeight: "700", color: C.text, flex: 1 },
  addBtn:  { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: C.accent,
             paddingHorizontal: 12, paddingVertical: 8, borderRadius: R.md },
  addBtnText: { color: C.accentFg, fontSize: F.xs, fontWeight: "800" },

  scroll: { padding: 16, paddingTop: 8, gap: 10 },
  emptyText: { color: C.muted, textAlign: "center", marginTop: 60, fontSize: F.sm },

  purchaseCard: { flexDirection: "row", alignItems: "center", gap: 10,
                  backgroundColor: C.surface, borderRadius: R.lg, padding: 14,
                  borderWidth: 1, borderColor: C.border, ...Shadow.sm },
  purchaseSupplier: { color: C.text, fontSize: F.sm, fontWeight: "700" },
  purchaseMeta: { color: C.muted, fontSize: F.xs, marginTop: 2 },
  purchaseTotal: { color: C.text, fontSize: F.sm, fontWeight: "800" },
  statusBadge: { fontSize: F.xs, fontWeight: "700", marginTop: 4, borderRadius: R.full,
                 paddingHorizontal: 8, paddingVertical: 2, overflow: "hidden" },
  status_danger:  { color: C.danger,  backgroundColor: C.danger  + "22" },
  status_warning: { color: C.warning, backgroundColor: C.warning + "22" },
  status_success: { color: C.success, backgroundColor: C.success + "22" },

  modalOverlay: { flex: 1, backgroundColor: C.overlay, justifyContent: "flex-end" },
  modalSheet:   { backgroundColor: C.surface, borderTopLeftRadius: R.xl,
                  borderTopRightRadius: R.xl, padding: 20, maxHeight: "88%", ...Shadow.lg },
  modalTitle: { color: C.text, fontSize: F.lg, fontWeight: "800", marginBottom: 8 },

  label: { color: C.textSub, fontSize: F.sm, fontWeight: "600", marginBottom: 6 },
  input: { backgroundColor: C.card, borderRadius: R.md, padding: 12,
           color: C.text, fontSize: F.md, borderWidth: 1, borderColor: C.border },

  pickerBtn: { flexDirection: "row", alignItems: "center", gap: 8,
               backgroundColor: C.card, borderRadius: R.md, padding: 12,
               borderWidth: 1, borderColor: C.border },
  pickerBtnText: { color: C.text, fontSize: F.md, fontWeight: "600" },

  itemsHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 14 },
  addItemBtn: { flexDirection: "row", alignItems: "center", gap: 3,
                backgroundColor: C.card, paddingHorizontal: 10, paddingVertical: 6,
                borderRadius: R.md, borderWidth: 1, borderColor: C.border },
  addItemBtnText: { color: C.muted, fontSize: F.xs, fontWeight: "700" },

  detailEmpty: { color: C.muted, fontSize: F.xs, paddingVertical: 6 },

  itemRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6,
             borderBottomWidth: 1, borderBottomColor: C.border },
  itemName: { flex: 1, color: C.text, fontSize: F.sm, fontWeight: "600" },
  itemInput: { width: 64, backgroundColor: C.card, borderRadius: R.md, paddingHorizontal: 8, paddingVertical: 7,
               color: C.text, fontSize: F.sm, borderWidth: 1, borderColor: C.border, textAlign: "center" },
  draftTotal: { color: C.accent, fontSize: F.md, fontWeight: "800", textAlign: "right", marginTop: 8 },

  detailItemRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6,
                    borderBottomWidth: 1, borderBottomColor: C.border },
  detailAmt: { color: C.textSub, fontSize: F.sm, fontWeight: "700" },

  divider: { height: 1, backgroundColor: C.border, marginVertical: 10 },
  sumRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  sumLabel: { color: C.muted, fontSize: F.sm },
  sumValue: { color: C.text, fontSize: F.sm, fontWeight: "700" },
  payRow: { flexDirection: "row", gap: 10 },

  sheetOverlay: { flex: 1, backgroundColor: C.overlay, alignItems: "center", justifyContent: "center", padding: 24 },
  sheet: { backgroundColor: C.surface, borderRadius: R.lg, padding: 16, width: "100%", maxWidth: 400,
           maxHeight: "80%", gap: 10, borderWidth: 1, borderColor: C.border, ...Shadow.lg },
  pickerList: { maxHeight: 300 },
  pickerRow: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  pickerRowText: { color: C.text, fontSize: F.md, fontWeight: "600" },

  modalActions: { flexDirection: "row", gap: 10, marginTop: 20, marginBottom: 20 },
  cancelBtn: { flex: 1, paddingVertical: 13, borderRadius: R.md, backgroundColor: C.card,
               alignItems: "center", borderWidth: 1, borderColor: C.border },
  cancelBtnText: { color: C.muted, fontSize: F.sm, fontWeight: "700" },
  saveBtn: { flex: 1, paddingVertical: 13, borderRadius: R.md, backgroundColor: C.accent,
             alignItems: "center", justifyContent: "center" },
  saveBtnOff: { opacity: 0.4 },
  saveBtnText: { color: C.accentFg, fontSize: F.sm, fontWeight: "800" },
});
