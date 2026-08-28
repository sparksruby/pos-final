import React, { useEffect, useState } from "react";
import {
  View, Text, TouchableOpacity, TextInput,
  StyleSheet, SafeAreaView, ScrollView, Modal,
  ActivityIndicator, Platform, StatusBar,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Redirect, router } from "expo-router";
import { suppliersRepo, SupplierHasPurchasesError } from "../../src/db/suppliersRepo";
import { purchasesRepo } from "../../src/db/purchasesRepo";
import { useShopStore } from "@/store/shopStore";
import { useAuthStore } from "../../src/store/authStore";
import { useTheme } from "../../src/context/ThemeContext";
import { useLanguage } from "../../src/context/LanguageContext";
import { useAlert } from "@/context/AlertContext";
import { useResponsive } from "../../src/hooks/useResponsive";
import { isAdmin } from "../../src/utils/permissions";
import { F, R, Shadow, ThemeColors } from "../../src/theme";
import type { Supplier, SupplierProduct, Purchase } from "../../src/types";

interface FormState {
  id?:      number;
  name:     string;
  phone:    string;
  address:  string;
}

const ANDROID_STATUS_BAR =
  Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) : 0;

export default function SuppliersManageScreen() {
  const { colors: C } = useTheme();
  const { t } = useLanguage();
  const { alert } = useAlert();
  const { isTablet } = useResponsive();
  const s = React.useMemo(() => makeStyles(C, isTablet), [C, isTablet]);
  const { user } = useAuthStore();
  const currency = useShopStore(state => state.settings?.currency ?? "$");

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [outstanding, setOutstanding] = useState<Record<number, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");

  const load = async () => {
    setIsLoading(true);
    try {
      const all = await suppliersRepo.getAll();
      setSuppliers(all);
      const balances: Record<number, number> = {};
      await Promise.all(all.map(async sup => { balances[sup.id] = await suppliersRepo.getOutstanding(sup.id); }));
      setOutstanding(balances);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const query = search.trim().toLowerCase();
  const filtered = query.length === 0
    ? suppliers
    : suppliers.filter(sup =>
        sup.name.toLowerCase().includes(query) || (sup.phone ?? "").includes(query)
      );

  // ── Create / edit ────────────────────────────────────────────────────────
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);

  const submitForm = async () => {
    if (!form || !form.name.trim()) return;
    setSaving(true);
    try {
      if (form.id) {
        await suppliersRepo.update(form.id, form.name.trim(), form.phone.trim() || undefined, form.address.trim() || undefined);
      } else {
        await suppliersRepo.create(form.name.trim(), form.phone.trim() || undefined, form.address.trim() || undefined);
      }
      setForm(null);
      load();
    } catch {
      alert(t("common.error"), "");
    } finally {
      setSaving(false);
    }
  };

  const deleteSupplier = (sup: Supplier) => {
    alert(t("suppliers.deleteConfirm"), "", [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.confirm"), style: "destructive",
        onPress: async () => {
          try {
            await suppliersRepo.delete(sup.id);
            load();
          } catch (e) {
            const message = e instanceof SupplierHasPurchasesError ? t("suppliers.hasPurchases") : t("common.error");
            alert(t("common.error"), message);
          }
        },
      },
    ]);
  };

  // ── Detail (expand to show product list + purchase history) ─────────────
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [products, setProducts] = useState<SupplierProduct[]>([]);
  const [history, setHistory] = useState<Purchase[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const toggleExpand = async (sup: Supplier) => {
    if (expandedId === sup.id) { setExpandedId(null); return; }
    setExpandedId(sup.id);
    setDetailLoading(true);
    try {
      const [p, h] = await Promise.all([
        suppliersRepo.getProductList(sup.id),
        purchasesRepo.getBySupplier(sup.id, 10),
      ]);
      setProducts(p);
      setHistory(h);
    } finally {
      setDetailLoading(false);
    }
  };

  if (!isAdmin(user)) return <Redirect href="/(pos)/" />;

  return (
    <SafeAreaView style={s.root}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={20} color={C.textSub} />
        </TouchableOpacity>
        <Ionicons name="cart-outline" size={18} color={C.text} />
        <Text style={s.title}>{t("suppliers.title")}</Text>
        <TouchableOpacity
          style={s.addBtn}
          onPress={() => setForm({ name: "", phone: "", address: "" })}
        >
          <Ionicons name="add" size={16} color={C.accentFg} />
          <Text style={s.addBtnText}>{t("suppliers.addNew")}</Text>
        </TouchableOpacity>
      </View>

      <View style={s.searchRow}>
        <Ionicons name="search" size={16} color={C.muted} />
        <TextInput
          style={s.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder={t("suppliers.searchPlaceholder")}
          placeholderTextColor={C.muted}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {isLoading ? (
        <ActivityIndicator color={C.accent} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={s.scroll}>
          {filtered.length === 0 && <Text style={s.emptyText}>{t("suppliers.empty")}</Text>}

          {filtered.map(sup => {
            const expanded = expandedId === sup.id;
            const balance = outstanding[sup.id] ?? 0;
            return (
              <TouchableOpacity
                key={sup.id}
                style={s.supplierCard}
                onPress={() => toggleExpand(sup)}
                activeOpacity={0.8}
              >
                <View style={s.supplierRow}>
                  <View style={s.avatar}>
                    <Ionicons name="cart" size={16} color={C.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.supplierName}>{sup.name}</Text>
                    <Text style={s.supplierSub}>{sup.phone || t("suppliers.noPhone")}</Text>
                  </View>
                  {balance > 0 && (
                    <View style={s.debtBadge}>
                      <Text style={s.debtBadgeText}>{currency}{balance.toLocaleString()}</Text>
                    </View>
                  )}
                  <TouchableOpacity
                    style={s.iconBtn}
                    onPress={() => setForm({ id: sup.id, name: sup.name, phone: sup.phone ?? "", address: sup.address ?? "" })}
                  >
                    <Ionicons name="create-outline" size={15} color={C.textSub} />
                  </TouchableOpacity>
                  <TouchableOpacity style={s.iconBtn} onPress={() => deleteSupplier(sup)}>
                    <Ionicons name="trash-outline" size={15} color={C.danger} />
                  </TouchableOpacity>
                </View>

                {expanded && (
                  <View style={s.detailBox}>
                    {detailLoading ? (
                      <ActivityIndicator size="small" color={C.accent} />
                    ) : (
                      <>
                        <Text style={s.detailHeading}>{t("suppliers.outstanding")}</Text>
                        <Text style={balance > 0 ? s.debtAmount : s.detailEmpty}>
                          {currency}{balance.toLocaleString()}
                        </Text>

                        <Text style={[s.detailHeading, { marginTop: 10 }]}>{t("suppliers.productList")}</Text>
                        {products.length === 0 ? (
                          <Text style={s.detailEmpty}>{t("suppliers.noProducts")}</Text>
                        ) : products.map(p => (
                          <View key={p.productId} style={s.detailRow}>
                            <Text style={s.detailDate}>{p.productName}</Text>
                            <Text style={s.detailAmt}>{t("suppliers.totalQty", { qty: p.totalQty })}</Text>
                          </View>
                        ))}

                        <Text style={[s.detailHeading, { marginTop: 10 }]}>{t("suppliers.purchaseHistory")}</Text>
                        {history.length === 0 ? (
                          <Text style={s.detailEmpty}>{t("suppliers.noPurchases")}</Text>
                        ) : history.map(p => (
                          <View key={p.id} style={s.detailRow}>
                            <Text style={s.detailDate}>{new Date(p.createdAt).toLocaleDateString()} · {t(`purchases.status.${p.status}` as any)}</Text>
                            <Text style={s.detailAmt}>{currency}{p.total.toLocaleString()}</Text>
                          </View>
                        ))}
                      </>
                    )}
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {/* Create / edit modal */}
      <Modal visible={!!form} animationType="slide" transparent onRequestClose={() => setForm(null)}>
        <View style={s.modalOverlay}>
          {form && (
            <View style={s.modalSheet}>
              <Text style={s.modalTitle}>{form.id ? t("suppliers.editTitle") : t("suppliers.addNew")}</Text>

              <Text style={s.label}>{t("suppliers.name")}</Text>
              <TextInput
                style={s.input}
                value={form.name}
                onChangeText={v => setForm(f => f && { ...f, name: v })}
                placeholder={t("suppliers.namePlaceholder")}
                placeholderTextColor={C.muted}
              />

              <Text style={[s.label, { marginTop: 12 }]}>{t("suppliers.phone")}</Text>
              <TextInput
                style={s.input}
                value={form.phone}
                onChangeText={v => setForm(f => f && { ...f, phone: v })}
                placeholder={t("suppliers.phonePlaceholder")}
                placeholderTextColor={C.muted}
                keyboardType="phone-pad"
              />

              <Text style={[s.label, { marginTop: 12 }]}>{t("suppliers.address")}</Text>
              <TextInput
                style={s.input}
                value={form.address}
                onChangeText={v => setForm(f => f && { ...f, address: v })}
                placeholder={t("suppliers.addressPlaceholder")}
                placeholderTextColor={C.muted}
              />

              <View style={s.modalActions}>
                <TouchableOpacity style={s.cancelBtn} onPress={() => setForm(null)}>
                  <Text style={s.cancelBtnText}>{t("common.cancel")}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.saveBtn, !form.name.trim() && s.saveBtnOff]}
                  onPress={submitForm}
                  disabled={!form.name.trim() || saving}
                >
                  {saving
                    ? <ActivityIndicator color={C.accentFg} />
                    : <Text style={s.saveBtnText}>{t("common.save")}</Text>
                  }
                </TouchableOpacity>
              </View>
            </View>
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

  searchRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: 16, marginBottom: 8,
    backgroundColor: C.card, borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 9,
    borderWidth: 1, borderColor: C.border,
  },
  searchInput: { flex: 1, color: C.text, fontSize: F.md, padding: 0 },

  scroll: { padding: 16, paddingTop: 8, gap: 10 },
  emptyText: { color: C.muted, textAlign: "center", marginTop: 60, fontSize: F.sm },

  supplierCard: { backgroundColor: C.surface, borderRadius: R.lg, padding: 14,
                  borderWidth: 1, borderColor: C.border, ...Shadow.sm },
  supplierRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  avatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.accentSoft,
            alignItems: "center", justifyContent: "center" },
  supplierName: { color: C.text, fontSize: F.sm, fontWeight: "700" },
  supplierSub:  { color: C.muted, fontSize: F.xs, marginTop: 2 },
  debtBadge: { backgroundColor: C.danger + "22", borderRadius: R.full, paddingHorizontal: 8, paddingVertical: 4 },
  debtBadgeText: { color: C.danger, fontSize: F.xs, fontWeight: "800" },
  iconBtn: { width: 28, height: 28, borderRadius: R.md, backgroundColor: C.card,
             alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: C.border },

  detailBox: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.border, gap: 4 },
  detailHeading: { color: C.muted, fontSize: F.xs, fontWeight: "700",
                   textTransform: "uppercase", letterSpacing: 0.6 },
  detailEmpty: { color: C.muted, fontSize: F.xs },
  debtAmount: { color: C.danger, fontSize: F.md, fontWeight: "800" },
  detailRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  detailDate: { color: C.textSub, fontSize: F.xs, flexShrink: 1 },
  detailAmt:  { color: C.textSub, fontSize: F.xs, fontWeight: "700" },

  modalOverlay: { flex: 1, backgroundColor: C.overlay, justifyContent: "flex-end" },
  modalSheet:   { backgroundColor: C.surface, borderTopLeftRadius: R.xl,
                  borderTopRightRadius: R.xl, padding: 20, maxHeight: "88%", ...Shadow.lg },
  modalTitle: { color: C.text, fontSize: F.lg, fontWeight: "800", marginBottom: 14 },

  label: { color: C.textSub, fontSize: F.sm, fontWeight: "600", marginBottom: 6 },
  input: { backgroundColor: C.card, borderRadius: R.md, padding: 12,
           color: C.text, fontSize: F.md, borderWidth: 1, borderColor: C.border },

  modalActions: { flexDirection: "row", gap: 10, marginTop: 20, marginBottom: 20 },
  cancelBtn: { flex: 1, paddingVertical: 13, borderRadius: R.md, backgroundColor: C.card,
               alignItems: "center", borderWidth: 1, borderColor: C.border },
  cancelBtnText: { color: C.muted, fontSize: F.sm, fontWeight: "700" },
  saveBtn: { flex: 1, paddingVertical: 13, borderRadius: R.md, backgroundColor: C.accent,
             alignItems: "center" },
  saveBtnOff: { opacity: 0.4 },
  saveBtnText: { color: C.accentFg, fontSize: F.sm, fontWeight: "800" },
});
