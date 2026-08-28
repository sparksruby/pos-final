import React, { useEffect, useState } from "react";
import {
  View, Text, TouchableOpacity, TextInput,
  StyleSheet, SafeAreaView, ScrollView, Modal,
  ActivityIndicator, Platform, StatusBar,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Redirect, router } from "expo-router";
import { expensesRepo } from "../../src/db/expensesRepo";
import { useShopStore } from "../../src/store/shopStore";
import { useAuthStore } from "../../src/store/authStore";
import { useBranchStore } from "../../src/store/branchStore";
import { useTheme } from "../../src/context/ThemeContext";
import { useLanguage } from "../../src/context/LanguageContext";
import { useAlert } from "@/context/AlertContext";
import { useResponsive } from "../../src/hooks/useResponsive";
import { isAdmin } from "../../src/utils/permissions";
import { F, R, Shadow, ThemeColors } from "../../src/theme";
import type { Expense } from "../../src/types";

const CATEGORY_KEYS = ["rent", "utilities", "salary", "transport", "supplies", "maintenance", "other"] as const;

const ANDROID_STATUS_BAR =
  Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) : 0;

export default function ExpensesScreen() {
  const { colors: C } = useTheme();
  const { t } = useLanguage();
  const { alert } = useAlert();
  const { isTablet } = useResponsive();
  const s = React.useMemo(() => makeStyles(C, isTablet), [C, isTablet]);
  const { user } = useAuthStore();
  const { currentBranchId } = useBranchStore();
  const currency = useShopStore(state => state.settings?.currency ?? "$");

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");

  const load = async () => {
    if (!currentBranchId) return;
    setIsLoading(true);
    try {
      setExpenses(await expensesRepo.getAll(currentBranchId));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); }, [currentBranchId]);

  const searchQuery = search.trim().toLowerCase();
  const filteredExpenses = searchQuery.length === 0
    ? expenses
    : expenses.filter(e =>
        e.category.toLowerCase().includes(searchQuery) ||
        (e.description ?? "").toLowerCase().includes(searchQuery)
      );
  const filteredTotal = filteredExpenses.reduce((sum, e) => sum + e.amount, 0);

  // Render only a growing window — the total above still reflects every
  // matching expense regardless of how many are actually mounted.
  const PAGE_SIZE = 30;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [search, currentBranchId]);
  const visibleExpenses = filteredExpenses.slice(0, visibleCount);

  // ── Create ────────────────────────────────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false);
  const [category, setCategory]     = useState<string>(CATEGORY_KEYS[0]);
  const [description, setDescription] = useState("");
  const [amount, setAmount]         = useState("");
  const [saving, setSaving]         = useState(false);

  const openCreate = () => {
    setCategory(CATEGORY_KEYS[0]);
    setDescription("");
    setAmount("");
    setCreateOpen(true);
  };

  const submitCreate = async () => {
    const amountNum = Number(amount);
    if (!currentBranchId || !amountNum || amountNum <= 0) return;
    setSaving(true);
    try {
      const branchName = useBranchStore.getState().branches.find(b => b.id === currentBranchId)?.name ?? "";
      await expensesRepo.create(currentBranchId, branchName, {
        category: t(`expenses.categories.${category}` as any),
        description: description.trim() || undefined,
        amount: amountNum,
        actorName: user?.name,
      });
      setCreateOpen(false);
      load();
    } finally {
      setSaving(false);
    }
  };

  const deleteExpense = (expense: Expense) => {
    alert(t("expenses.deleteConfirm"), "", [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.confirm"), style: "destructive",
        onPress: async () => {
          await expensesRepo.delete(expense.id);
          load();
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
        <Ionicons name="cash-outline" size={18} color={C.text} />
        <Text style={s.title}>{t("expenses.title")}</Text>
        <TouchableOpacity style={s.addBtn} onPress={openCreate}>
          <Ionicons name="add" size={16} color={C.accentFg} />
          <Text style={s.addBtnText}>{t("expenses.addNew")}</Text>
        </TouchableOpacity>
      </View>

      <View style={s.searchRow}>
        <Ionicons name="search" size={16} color={C.muted} />
        <TextInput
          style={s.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder={t("expenses.searchPlaceholder")}
          placeholderTextColor={C.muted}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {!isLoading && filteredExpenses.length > 0 && (
        <Text style={s.totalLine}>{t("expenses.total")}: {currency}{filteredTotal.toLocaleString()}</Text>
      )}

      {isLoading ? (
        <ActivityIndicator color={C.accent} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={s.scroll}>
          {expenses.length === 0 && <Text style={s.emptyText}>{t("expenses.empty")}</Text>}
          {expenses.length > 0 && filteredExpenses.length === 0 && (
            <Text style={s.emptyText}>{t("expenses.noSearchResults")}</Text>
          )}
          {visibleExpenses.map(e => (
            <View key={e.id} style={s.card}>
              <View style={{ flex: 1 }}>
                <View style={s.cardHeaderRow}>
                  <Text style={s.categoryTag}>{e.category}</Text>
                  <Text style={s.dateText}>{new Date(e.createdAt).toLocaleString()}</Text>
                </View>
                {!!e.description && <Text style={s.descText} numberOfLines={2}>{e.description}</Text>}
                {!!e.actorName && <Text style={s.metaText}>{e.actorName}</Text>}
              </View>
              <View style={s.cardRight}>
                <Text style={s.amountText}>{currency}{e.amount.toLocaleString()}</Text>
                <TouchableOpacity style={s.deleteBtn} onPress={() => deleteExpense(e)}>
                  <Ionicons name="trash-outline" size={14} color={C.danger} />
                </TouchableOpacity>
              </View>
            </View>
          ))}
          {filteredExpenses.length > visibleCount && (
            <TouchableOpacity style={s.loadMoreBtn} onPress={() => setVisibleCount(c => c + PAGE_SIZE)}>
              <Text style={s.loadMoreBtnText}>
                {t("common.loadMore")} ({filteredExpenses.length - visibleCount})
              </Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      )}

      {/* Create expense */}
      <Modal visible={createOpen} animationType="slide" transparent onRequestClose={() => setCreateOpen(false)}>
        <View style={s.modalOverlay}>
          <ScrollView style={s.modalSheet} keyboardShouldPersistTaps="handled">
            <Text style={s.modalTitle}>{t("expenses.addNew")}</Text>

            <Text style={s.label}>{t("expenses.category")}</Text>
            <View style={s.categoryRow}>
              {CATEGORY_KEYS.map(key => (
                <TouchableOpacity
                  key={key}
                  style={[s.categoryChip, category === key && s.categoryChipActive]}
                  onPress={() => setCategory(key)}
                >
                  <Text style={[s.categoryChipText, category === key && s.categoryChipTextActive]}>
                    {t(`expenses.categories.${key}` as any)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[s.label, { marginTop: 14 }]}>{t("expenses.amount")}</Text>
            <TextInput
              style={s.input}
              value={amount}
              onChangeText={setAmount}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={C.muted}
            />

            <Text style={[s.label, { marginTop: 12 }]}>{t("expenses.description")}</Text>
            <TextInput
              style={s.input}
              value={description}
              onChangeText={setDescription}
              placeholder={t("expenses.descriptionPlaceholder")}
              placeholderTextColor={C.muted}
            />

            <View style={s.modalActions}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setCreateOpen(false)}>
                <Text style={s.cancelBtnText}>{t("common.cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.saveBtn, (!amount || Number(amount) <= 0) && s.saveBtnOff]}
                onPress={submitCreate}
                disabled={!amount || Number(amount) <= 0 || saving}
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
  totalLine: { color: C.accent, fontSize: F.sm, fontWeight: "800", marginHorizontal: 16, marginBottom: 8 },

  scroll: { padding: 16, paddingTop: 8, gap: 10 },
  emptyText: { color: C.muted, textAlign: "center", marginTop: 60, fontSize: F.sm },

  loadMoreBtn: { marginTop: 4, paddingVertical: 12, borderRadius: R.md, backgroundColor: C.card,
                 alignItems: "center", borderWidth: 1, borderColor: C.border },
  loadMoreBtnText: { color: C.text, fontSize: F.sm, fontWeight: "700" },

  card: { flexDirection: "row", alignItems: "center", gap: 10,
          backgroundColor: C.surface, borderRadius: R.lg, padding: 14,
          borderWidth: 1, borderColor: C.border, ...Shadow.sm },
  cardHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  categoryTag: { color: C.accent, fontSize: F.xs, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  dateText: { color: C.muted, fontSize: F.xs },
  descText: { color: C.text, fontSize: F.sm, marginTop: 4 },
  metaText: { color: C.muted, fontSize: F.xs, marginTop: 2 },
  cardRight: { alignItems: "flex-end", gap: 6 },
  amountText: { color: C.text, fontSize: F.md, fontWeight: "800" },
  deleteBtn: { width: 26, height: 26, borderRadius: R.md, backgroundColor: C.card,
               alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: C.border },

  modalOverlay: { flex: 1, backgroundColor: C.overlay, justifyContent: "flex-end" },
  modalSheet:   { backgroundColor: C.surface, borderTopLeftRadius: R.xl,
                  borderTopRightRadius: R.xl, padding: 20, maxHeight: "88%", ...Shadow.lg },
  modalTitle: { color: C.text, fontSize: F.lg, fontWeight: "800", marginBottom: 14 },

  label: { color: C.textSub, fontSize: F.sm, fontWeight: "600", marginBottom: 6 },
  input: { backgroundColor: C.card, borderRadius: R.md, padding: 12,
           color: C.text, fontSize: F.md, borderWidth: 1, borderColor: C.border },

  categoryRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  categoryChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: R.full,
                  backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  categoryChipActive: { backgroundColor: C.accent, borderColor: C.accent },
  categoryChipText: { color: C.muted, fontSize: F.xs, fontWeight: "700" },
  categoryChipTextActive: { color: C.accentFg },

  modalActions: { flexDirection: "row", gap: 10, marginTop: 20, marginBottom: 20 },
  cancelBtn: { flex: 1, paddingVertical: 13, borderRadius: R.md, backgroundColor: C.card,
               alignItems: "center", borderWidth: 1, borderColor: C.border },
  cancelBtnText: { color: C.muted, fontSize: F.sm, fontWeight: "700" },
  saveBtn: { flex: 1, paddingVertical: 13, borderRadius: R.md, backgroundColor: C.accent,
             alignItems: "center", justifyContent: "center" },
  saveBtnOff: { opacity: 0.4 },
  saveBtnText: { color: C.accentFg, fontSize: F.sm, fontWeight: "800" },
});
