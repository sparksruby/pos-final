import React, { useEffect, useState } from "react";
import {
  View, Text, TouchableOpacity, TextInput,
  StyleSheet, SafeAreaView, ScrollView, Modal,
  ActivityIndicator, Switch, Platform, StatusBar,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Redirect, router } from "expo-router";
import { branchesRepo, LastBranchError } from "../../src/db/branchesRepo";
import { syncRepo, SyncError } from "../../src/db/syncRepo";
import { syncErrorMessage } from "../../src/utils/syncErrors";
import { useBranchStore } from "../../src/store/branchStore";
import { useSyncStore } from "../../src/store/syncStore";
import { useAuthStore } from "../../src/store/authStore";
import { useTheme } from "../../src/context/ThemeContext";
import { useLanguage } from "../../src/context/LanguageContext";
import { useAlert } from "@/context/AlertContext";
import { useResponsive } from "../../src/hooks/useResponsive";
import { isAdmin } from "../../src/utils/permissions";
import { F, R, Shadow, ThemeColors } from "../../src/theme";
import type { Branch } from "../../src/types";

interface FormState {
  id?:       number;
  name:      string;
  address:   string;
  phone:     string;
  isActive:  boolean;
}

const ANDROID_STATUS_BAR =
  Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) : 0;

export default function BranchesManageScreen() {
  const { colors: C } = useTheme();
  const { t } = useLanguage();
  const { alert } = useAlert();
  const { isTablet } = useResponsive();
  const s = React.useMemo(() => makeStyles(C, isTablet), [C, isTablet]);
  const { user } = useAuthStore();
  const reloadBranchStore = useBranchStore(state => state.load);
  const currentBranchId = useBranchStore(state => state.currentBranchId);
  const syncConfig = useSyncStore(state => state.config);
  // Only possible once this device is connected AND an admin key has been
  // saved (Settings > Server Sync) — otherwise a new branch just stays
  // local to this device, same as before sync existed.
  const canCreateViaServer = !!(syncConfig && syncConfig.adminKey);
  // A device that's synced but isn't the main branch can't create a
  // branch at all — the "New Branch" button is hidden rather than falling
  // back to a local-only branch that never reaches the server and just
  // confuses which branches actually exist shop-wide. A never-synced
  // device is unaffected — that's the original single-device, multi-branch
  // setup and still creates purely locally.
  const canCreateBranch = !syncConfig || canCreateViaServer;

  const [branches, setBranches] = useState<Branch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");

  const load = async () => {
    setIsLoading(true);
    try {
      setBranches(await branchesRepo.getAll());
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const reload = async () => {
    await load();
    reloadBranchStore();
  };

  const searchQuery = search.trim().toLowerCase();
  const filteredBranches = searchQuery.length === 0
    ? branches
    : branches.filter(b =>
        b.name.toLowerCase().includes(searchQuery) ||
        (b.address ?? "").toLowerCase().includes(searchQuery) ||
        (b.phone ?? "").includes(searchQuery)
      );

  // ── Create / edit ────────────────────────────────────────────────────────
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);

  const submitForm = async () => {
    if (!form || !form.name.trim()) return;
    setSaving(true);
    try {
      if (form.id) {
        await branchesRepo.update(form.id, {
          name: form.name.trim(), address: form.address.trim() || undefined,
          phone: form.phone.trim() || undefined, isActive: form.isActive,
        });
      } else if (canCreateViaServer) {
        // Creates it on the server (visible to every connected branch),
        // then pulls it straight back down so it shows up here too.
        await syncRepo.createBranch(form.name.trim(), form.address.trim() || undefined, form.phone.trim() || undefined);
      } else {
        await branchesRepo.create(form.name.trim(), form.address.trim() || undefined, form.phone.trim() || undefined);
      }
      setForm(null);
      reload();
    } catch (e: any) {
      alert(t("common.error"), e instanceof SyncError ? syncErrorMessage(e, t) : (e?.message ?? ""));
    } finally {
      setSaving(false);
    }
  };

  const deleteBranch = (branch: Branch) => {
    alert(t("branches.deleteConfirm"), "", [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.confirm"), style: "destructive",
        onPress: async () => {
          try {
            await branchesRepo.delete(branch.id);
            reload();
          } catch (e) {
            const message = e instanceof LastBranchError ? t("branches.lastBranch") : t("common.error");
            alert(t("common.error"), message);
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
        <Ionicons name="business-outline" size={17} color={C.text} />
        <Text style={s.title}>{t("branches.title")}</Text>
        {canCreateBranch && (
          <TouchableOpacity
            style={s.addBtn}
            onPress={() => setForm({ name: "", address: "", phone: "", isActive: true })}
          >
            <Ionicons name="add" size={16} color={C.accentFg} />
            <Text style={s.addBtnText}>{t("branches.addNew")}</Text>
          </TouchableOpacity>
        )}
      </View>
      {!canCreateBranch && (
        <Text style={s.nonMainHint}>{t("branches.nonMainCannotCreate")}</Text>
      )}

      <View style={s.searchRow}>
        <Ionicons name="search" size={16} color={C.muted} />
        <TextInput
          style={s.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder={t("branches.searchPlaceholder")}
          placeholderTextColor={C.muted}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {isLoading ? (
        <ActivityIndicator color={C.accent} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={s.scroll}>
          {branches.length === 0 && <Text style={s.emptyText}>{t("branches.empty")}</Text>}
          {branches.length > 0 && filteredBranches.length === 0 && (
            <Text style={s.emptyText}>{t("branches.noSearchResults")}</Text>
          )}

          {filteredBranches.map(b => (
            <View key={b.id} style={[s.branchCard, !b.isActive && { opacity: 0.5 }]}>
              <View style={s.branchIcon}>
                <Ionicons name="business" size={16} color={C.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={s.branchNameRow}>
                  <Text style={s.branchName}>{b.name}</Text>
                  <Text style={s.branchIdTag}>#{b.id}</Text>
                  {b.id === currentBranchId && (
                    <View style={s.thisDeviceBadge}>
                      <Text style={s.thisDeviceBadgeText}>{t("branches.thisDevice")}</Text>
                    </View>
                  )}
                </View>
                {!!(b.address || b.phone) && (
                  <Text style={s.branchSub} numberOfLines={1}>
                    {[b.address, b.phone].filter(Boolean).join(" · ")}
                  </Text>
                )}
                {canCreateViaServer && !b.isSynced && (
                  <Text style={s.notSyncedTag}>{t("branches.notSynced")}</Text>
                )}
              </View>
              <TouchableOpacity
                style={s.iconBtn}
                onPress={() => setForm({ id: b.id, name: b.name, address: b.address ?? "", phone: b.phone ?? "", isActive: b.isActive })}
              >
                <Ionicons name="create-outline" size={15} color={C.textSub} />
              </TouchableOpacity>
              <TouchableOpacity style={s.iconBtn} onPress={() => deleteBranch(b)}>
                <Ionicons name="trash-outline" size={15} color={C.danger} />
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}

      {/* Create / edit modal */}
      <Modal visible={!!form} animationType="slide" transparent onRequestClose={() => setForm(null)}>
        <View style={s.modalOverlay}>
          {form && (
            <View style={s.modalSheet}>
              <Text style={s.modalTitle}>{form.id ? t("branches.editTitle") : t("branches.addNew")}</Text>
              {!form.id && (
                <Text style={s.hint}>
                  {canCreateViaServer ? t("branches.willCreateOnServer") : t("branches.willCreateLocalOnly")}
                </Text>
              )}

              <Text style={s.label}>{t("branches.name")}</Text>
              <TextInput
                style={s.input}
                value={form.name}
                onChangeText={v => setForm(f => f && { ...f, name: v })}
                placeholder={t("branches.namePlaceholder")}
                placeholderTextColor={C.muted}
              />

              <Text style={[s.label, { marginTop: 12 }]}>{t("branches.address")}</Text>
              <TextInput
                style={s.input}
                value={form.address}
                onChangeText={v => setForm(f => f && { ...f, address: v })}
                placeholder={t("branches.addressPlaceholder")}
                placeholderTextColor={C.muted}
              />

              <Text style={[s.label, { marginTop: 12 }]}>{t("branches.phone")}</Text>
              <TextInput
                style={s.input}
                value={form.phone}
                onChangeText={v => setForm(f => f && { ...f, phone: v })}
                placeholder={t("branches.phonePlaceholder")}
                placeholderTextColor={C.muted}
                keyboardType="phone-pad"
              />

              {form.id && (
                <View style={s.availRow}>
                  <Text style={s.label}>{t("products.active")}</Text>
                  <Switch
                    value={form.isActive}
                    onValueChange={v => setForm(f => f && { ...f, isActive: v })}
                    trackColor={{ false: C.border, true: C.accent }}
                    thumbColor="#fff"
                  />
                </View>
              )}

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
  nonMainHint: { color: C.muted, fontSize: F.xs, lineHeight: 18, marginHorizontal: 16, marginBottom: 8 },

  searchRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: 16, marginBottom: 8,
    backgroundColor: C.card, borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 9,
    borderWidth: 1, borderColor: C.border,
  },
  searchInput: { flex: 1, color: C.text, fontSize: F.md, padding: 0 },

  scroll: { padding: 16, paddingTop: 8, gap: 10 },
  emptyText: { color: C.muted, textAlign: "center", marginTop: 60, fontSize: F.sm },

  branchCard: { flexDirection: "row", alignItems: "center", gap: 10,
                backgroundColor: C.surface, borderRadius: R.lg, padding: 14,
                borderWidth: 1, borderColor: C.border, ...Shadow.sm },
  branchIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.accentSoft,
                alignItems: "center", justifyContent: "center" },
  branchNameRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  branchName: { color: C.text, fontSize: F.sm, fontWeight: "700" },
  branchIdTag: { color: C.muted, fontSize: F.xs },
  thisDeviceBadge: { backgroundColor: C.accentSoft, borderRadius: R.full, paddingHorizontal: 8, paddingVertical: 2 },
  thisDeviceBadgeText: { color: C.accent, fontSize: F.xs, fontWeight: "800" },
  branchSub:  { color: C.muted, fontSize: F.xs, marginTop: 2 },
  notSyncedTag: { color: C.warning, fontSize: F.xs, fontWeight: "700", marginTop: 2 },
  iconBtn: { width: 30, height: 30, borderRadius: R.md, backgroundColor: C.card,
             alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: C.border },

  modalOverlay: { flex: 1, backgroundColor: C.overlay, justifyContent: "flex-end" },
  modalSheet:   { backgroundColor: C.surface, borderTopLeftRadius: R.xl,
                  borderTopRightRadius: R.xl, padding: 20, maxHeight: "88%", ...Shadow.lg },
  modalTitle: { color: C.text, fontSize: F.lg, fontWeight: "800", marginBottom: 14 },
  hint: { color: C.textSub, fontSize: F.xs, lineHeight: 18, marginTop: -6, marginBottom: 10 },

  label: { color: C.textSub, fontSize: F.sm, fontWeight: "600", marginBottom: 6 },
  input: { backgroundColor: C.card, borderRadius: R.md, padding: 12,
           color: C.text, fontSize: F.md, borderWidth: 1, borderColor: C.border },

  availRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 14 },

  modalActions: { flexDirection: "row", gap: 10, marginTop: 20, marginBottom: 20 },
  cancelBtn: { flex: 1, paddingVertical: 13, borderRadius: R.md, backgroundColor: C.card,
               alignItems: "center", borderWidth: 1, borderColor: C.border },
  cancelBtnText: { color: C.muted, fontSize: F.sm, fontWeight: "700" },
  saveBtn: { flex: 1, paddingVertical: 13, borderRadius: R.md, backgroundColor: C.accent,
             alignItems: "center" },
  saveBtnOff: { opacity: 0.4 },
  saveBtnText: { color: C.accentFg, fontSize: F.sm, fontWeight: "800" },
});
