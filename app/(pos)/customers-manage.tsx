import React, { useEffect, useState } from "react";
import {
  View, Text, TouchableOpacity, TextInput,
  StyleSheet, SafeAreaView, ScrollView, Modal,
  ActivityIndicator, Platform, StatusBar,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Redirect, router } from "expo-router";
import { customersRepo, DuplicatePhoneError } from "../../src/db/customersRepo";
import { salesRepo } from "../../src/db/salesRepo";
import { useShopStore } from "@/store/shopStore";
import { useAuthStore } from "../../src/store/authStore";
import { useTheme } from "../../src/context/ThemeContext";
import { useLanguage } from "../../src/context/LanguageContext";
import { useAlert } from "@/context/AlertContext";
import { useResponsive } from "../../src/hooks/useResponsive";
import { isAdmin } from "../../src/utils/permissions";
import { F, R, Shadow, ThemeColors } from "../../src/theme";
import type { Customer, Sale } from "../../src/types";

interface FormState {
  id?:    number;
  name:   string;
  phone:  string;
  email:  string;
}

const ANDROID_STATUS_BAR =
  Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) : 0;

export default function CustomersManageScreen() {
  const { colors: C } = useTheme();
  const { t } = useLanguage();
  const { alert } = useAlert();
  const { isTablet } = useResponsive();
  const s = React.useMemo(() => makeStyles(C, isTablet), [C, isTablet]);
  const { user } = useAuthStore();
  const currency = useShopStore(state => state.settings?.currency ?? "$");

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");

  const load = async () => {
    setIsLoading(true);
    try {
      setCustomers(await customersRepo.getAll());
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const query = search.trim().toLowerCase();
  const filtered = query.length === 0
    ? customers
    : customers.filter(c =>
        c.name.toLowerCase().includes(query) || (c.phone ?? "").includes(query)
      );

  // ── Create / edit ────────────────────────────────────────────────────────
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);

  const submitForm = async () => {
    if (!form || !form.name.trim()) return;
    setSaving(true);
    try {
      if (form.id) {
        await customersRepo.update(form.id, form.name.trim(), form.phone.trim() || undefined, form.email.trim() || undefined);
      } else {
        await customersRepo.create(form.name.trim(), form.phone.trim() || undefined, form.email.trim() || undefined);
      }
      setForm(null);
      load();
    } catch (e) {
      const message = e instanceof DuplicatePhoneError ? t("customers.duplicatePhone") : t("common.error");
      alert(t("common.error"), message);
    } finally {
      setSaving(false);
    }
  };

  const deleteCustomer = (c: Customer) => {
    alert(t("customers.deleteConfirm"), "", [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.confirm"), style: "destructive",
        onPress: async () => { await customersRepo.delete(c.id); load(); },
      },
    ]);
  };

  // ── Detail (expand to show recent purchases) ────────────────────────────
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [history, setHistory] = useState<Sale[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const toggleExpand = async (c: Customer) => {
    if (expandedId === c.id) { setExpandedId(null); return; }
    setExpandedId(c.id);
    setHistoryLoading(true);
    try {
      setHistory(await salesRepo.getSalesByCustomer(c.id, 10));
    } finally {
      setHistoryLoading(false);
    }
  };

  if (!isAdmin(user)) return <Redirect href="/(pos)/" />;

  return (
    <SafeAreaView style={s.root}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={20} color={C.textSub} />
        </TouchableOpacity>
        <Ionicons name="people-circle-outline" size={18} color={C.text} />
        <Text style={s.title}>{t("customers.title")}</Text>
        <TouchableOpacity
          style={s.addBtn}
          onPress={() => setForm({ name: "", phone: "", email: "" })}
        >
          <Ionicons name="add" size={16} color={C.accentFg} />
          <Text style={s.addBtnText}>{t("customers.addNew")}</Text>
        </TouchableOpacity>
      </View>

      <View style={s.searchRow}>
        <Ionicons name="search" size={16} color={C.muted} />
        <TextInput
          style={s.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder={t("customers.searchPlaceholder")}
          placeholderTextColor={C.muted}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {isLoading ? (
        <ActivityIndicator color={C.accent} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={s.scroll}>
          {filtered.length === 0 && <Text style={s.emptyText}>{t("customers.empty")}</Text>}

          {filtered.map(c => {
            const expanded = expandedId === c.id;
            return (
              <TouchableOpacity
                key={c.id}
                style={s.customerCard}
                onPress={() => toggleExpand(c)}
                activeOpacity={0.8}
              >
                <View style={s.customerRow}>
                  <View style={s.avatar}>
                    <Ionicons name="person" size={16} color={C.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.customerName}>{c.name}</Text>
                    <Text style={s.customerSub}>{c.phone || t("customers.noPhone")}</Text>
                  </View>
                  <View style={s.pointsBadge}>
                    <Ionicons name="star" size={11} color={C.accent} />
                    <Text style={s.pointsBadgeText}>{c.loyaltyPoints}</Text>
                  </View>
                  <TouchableOpacity
                    style={s.iconBtn}
                    onPress={() => setForm({ id: c.id, name: c.name, phone: c.phone ?? "", email: c.email ?? "" })}
                  >
                    <Ionicons name="create-outline" size={15} color={C.textSub} />
                  </TouchableOpacity>
                  <TouchableOpacity style={s.iconBtn} onPress={() => deleteCustomer(c)}>
                    <Ionicons name="trash-outline" size={15} color={C.danger} />
                  </TouchableOpacity>
                </View>

                {expanded && (
                  <View style={s.detailBox}>
                    {historyLoading ? (
                      <ActivityIndicator size="small" color={C.accent} />
                    ) : history.length === 0 ? (
                      <Text style={s.detailEmpty}>{t("customers.noPurchases")}</Text>
                    ) : (
                      history.map(sale => (
                        <View key={sale.id} style={s.detailRow}>
                          <Text style={s.detailDate}>{new Date(sale.createdAt).toLocaleDateString()}</Text>
                          <Text style={s.detailAmt}>{currency}{sale.total.toLocaleString()}</Text>
                        </View>
                      ))
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
              <Text style={s.modalTitle}>{form.id ? t("customers.editTitle") : t("customers.addNew")}</Text>

              <Text style={s.label}>{t("customers.name")}</Text>
              <TextInput
                style={s.input}
                value={form.name}
                onChangeText={v => setForm(f => f && { ...f, name: v })}
                placeholder={t("customers.namePlaceholder")}
                placeholderTextColor={C.muted}
              />

              <Text style={[s.label, { marginTop: 12 }]}>{t("customers.phone")}</Text>
              <TextInput
                style={s.input}
                value={form.phone}
                onChangeText={v => setForm(f => f && { ...f, phone: v })}
                placeholder={t("customers.phonePlaceholder")}
                placeholderTextColor={C.muted}
                keyboardType="phone-pad"
              />

              <Text style={[s.label, { marginTop: 12 }]}>{t("customers.email")}</Text>
              <TextInput
                style={s.input}
                value={form.email}
                onChangeText={v => setForm(f => f && { ...f, email: v })}
                placeholder={t("customers.emailPlaceholder")}
                placeholderTextColor={C.muted}
                keyboardType="email-address"
                autoCapitalize="none"
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

  customerCard: { backgroundColor: C.surface, borderRadius: R.lg, padding: 14,
                  borderWidth: 1, borderColor: C.border, ...Shadow.sm },
  customerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  avatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.accentSoft,
            alignItems: "center", justifyContent: "center" },
  customerName: { color: C.text, fontSize: F.sm, fontWeight: "700" },
  customerSub:  { color: C.muted, fontSize: F.xs, marginTop: 2 },
  pointsBadge: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: C.accentSoft,
                 borderRadius: R.full, paddingHorizontal: 8, paddingVertical: 4 },
  pointsBadgeText: { color: C.accent, fontSize: F.xs, fontWeight: "800" },
  iconBtn: { width: 28, height: 28, borderRadius: R.md, backgroundColor: C.card,
             alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: C.border },

  detailBox: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.border, gap: 4 },
  detailEmpty: { color: C.muted, fontSize: F.xs, textAlign: "center" },
  detailRow: { flexDirection: "row", justifyContent: "space-between" },
  detailDate: { color: C.textSub, fontSize: F.xs },
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
