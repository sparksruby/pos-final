import React, { useEffect, useState } from "react";
import {
  View, Text, TouchableOpacity, TextInput,
  StyleSheet, SafeAreaView, ScrollView, Modal,
  ActivityIndicator, Switch, Platform, StatusBar
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Redirect, router } from "expo-router";
import { usersRepo, DuplicateUserNameError } from "../../src/db/usersRepo";
import { useAuthStore } from "../../src/store/authStore";
import { useTheme } from "../../src/context/ThemeContext";
import { useLanguage } from "../../src/context/LanguageContext";
import { useAlert } from "@/context/AlertContext";
import { useResponsive } from "../../src/hooks/useResponsive";
import { isAdmin } from "../../src/utils/permissions";
import { F, R, Shadow, ThemeColors } from "../../src/theme";
import type { Role, UserAccount } from "../../src/types";

interface CreateFormState {
  name:     string;
  password: string;
  role:     Role;
}

interface ResetFormState {
  userId:      number;
  userName:    string;
  newPassword: string;
}

const ANDROID_STATUS_BAR =
  Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) : 0;

export default function UsersManageScreen() {
  const { colors: C } = useTheme();
  const { t } = useLanguage();
  const { alert } = useAlert();
  const { isTablet } = useResponsive();
  const s = React.useMemo(() => makeStyles(C, isTablet), [C, isTablet]);
  const { user: currentUser } = useAuthStore();

  const [users, setUsers] = useState<UserAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");

  const load = async () => {
    setIsLoading(true);
    try {
      setUsers(await usersRepo.getAll());
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const searchQuery = search.trim().toLowerCase();
  const filteredUsers = searchQuery.length === 0
    ? users
    : users.filter(u => u.name.toLowerCase().includes(searchQuery));

  // ── Create user ───────────────────────────────────────────────────────────
  const [createForm, setCreateForm] = useState<CreateFormState | null>(null);
  const [creating, setCreating] = useState(false);

  const submitCreate = async () => {
    if (!createForm || !createForm.name.trim() || createForm.password.length < 4) return;
    setCreating(true);
    try {
      await usersRepo.createUser(createForm.name.trim(), createForm.password, createForm.role);
      setCreateForm(null);
      load();
    } catch (e) {
      const message = e instanceof DuplicateUserNameError
        ? t("users.duplicateName")
        : t("common.error");
      alert(t("common.error"), message);
    } finally {
      setCreating(false);
    }
  };

  // ── Role / active toggles ────────────────────────────────────────────────
  const toggleActive = async (target: UserAccount) => {
    if (target.id === currentUser?.id) {
      alert(t("common.error"), t("users.cannotDeactivateSelf"));
      return;
    }
    if (target.role === "Admin" && target.isActive) {
      const activeAdmins = await usersRepo.countActiveAdmins();
      if (activeAdmins <= 1) {
        alert(t("common.error"), t("users.cannotRemoveLastAdmin"));
        return;
      }
    }
    await usersRepo.setActive(target.id, !target.isActive);
    load();
  };

  const toggleRole = async (target: UserAccount) => {
    const nextRole: Role = target.role === "Admin" ? "Cashier" : "Admin";
    if (target.role === "Admin" && nextRole === "Cashier") {
      const activeAdmins = await usersRepo.countActiveAdmins();
      if (activeAdmins <= 1) {
        alert(t("common.error"), t("users.cannotRemoveLastAdmin"));
        return;
      }
    }
    await usersRepo.setRole(target.id, nextRole);
    load();
  };

  const deleteUser = (target: UserAccount) => {
    if (target.id === currentUser?.id) {
      alert(t("common.error"), t("users.cannotDeleteSelf"));
      return;
    }
    alert(t("users.deleteConfirm"), "", [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.confirm"), style: "destructive",
        onPress: async () => {
          if (target.role === "Admin" && target.isActive) {
            const activeAdmins = await usersRepo.countActiveAdmins();
            if (activeAdmins <= 1) {
              alert(t("common.error"), t("users.cannotRemoveLastAdmin"));
              return;
            }
          }
          await usersRepo.deleteUser(target.id);
          load();
        },
      },
    ]);
  };

  // ── Reset password ───────────────────────────────────────────────────────
  const [resetForm, setResetForm] = useState<ResetFormState | null>(null);
  const [resetting, setResetting] = useState(false);

  const submitReset = async () => {
    if (!resetForm || resetForm.newPassword.length < 4) return;
    setResetting(true);
    try {
      await usersRepo.resetPassword(resetForm.userId, resetForm.newPassword);
      setResetForm(null);
      alert(t("users.resetPasswordSuccess"));
    } finally {
      setResetting(false);
    }
  };

  if (!isAdmin(currentUser)) return <Redirect href="/(pos)/" />;

  return (
    <SafeAreaView style={s.root}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={20} color={C.textSub} />
        </TouchableOpacity>
        <Ionicons name="people-outline" size={17} color={C.text} />
        <Text style={s.title}>{t("users.title")}</Text>
        <TouchableOpacity
          style={s.addBtn}
          onPress={() => setCreateForm({ name: "", password: "", role: "Cashier" })}
        >
          <Ionicons name="add" size={16} color={C.accentFg} />
          <Text style={s.addBtnText}>{t("users.addNew")}</Text>
        </TouchableOpacity>
      </View>

      <View style={s.searchRow}>
        <Ionicons name="search" size={16} color={C.muted} />
        <TextInput
          style={s.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder={t("users.searchPlaceholder")}
          placeholderTextColor={C.muted}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {isLoading ? (
        <ActivityIndicator color={C.accent} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={s.scroll}>
          {users.length === 0 && <Text style={s.emptyText}>{t("users.empty")}</Text>}
          {users.length > 0 && filteredUsers.length === 0 && (
            <Text style={s.emptyText}>{t("users.noSearchResults")}</Text>
          )}

          {filteredUsers.map(u => (
            <View key={u.id} style={[s.userCard, !u.isActive && { opacity: 0.5 }]}>
              <View style={s.userAvatar}>
                <Ionicons name="person" size={16} color={C.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.userName}>{u.name}{u.id === currentUser?.id ? " (you)" : ""}</Text>
                <TouchableOpacity onPress={() => toggleRole(u)}>
                  <Text style={s.userRole}>{t(`users.role.${u.role}` as any)}</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity style={s.iconBtn} onPress={() => setResetForm({ userId: u.id, userName: u.name, newPassword: "" })}>
                <Ionicons name="key-outline" size={16} color={C.textSub} />
              </TouchableOpacity>
              <Switch
                value={u.isActive}
                onValueChange={() => toggleActive(u)}
                trackColor={{ false: C.border, true: C.accent }}
                thumbColor="#fff"
              />
              <TouchableOpacity style={s.iconBtn} onPress={() => deleteUser(u)}>
                <Ionicons name="trash-outline" size={16} color={C.danger} />
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}

      {/* Create user modal */}
      <Modal visible={!!createForm} animationType="slide" transparent onRequestClose={() => setCreateForm(null)}>
        <View style={s.modalOverlay}>
          {createForm && (
            <View style={s.modalSheet}>
              <Text style={s.modalTitle}>{t("users.addNew")}</Text>

              <Text style={s.label}>{t("users.name")}</Text>
              <TextInput
                style={s.input}
                value={createForm.name}
                onChangeText={v => setCreateForm(f => f && { ...f, name: v })}
                placeholder={t("users.namePlaceholder")}
                placeholderTextColor={C.muted}
                autoCapitalize="none"
                autoCorrect={false}
              />

              <Text style={[s.label, { marginTop: 12 }]}>{t("users.password")}</Text>
              <TextInput
                style={s.input}
                value={createForm.password}
                onChangeText={v => setCreateForm(f => f && { ...f, password: v })}
                placeholder={t("users.passwordPlaceholder")}
                placeholderTextColor={C.muted}
                secureTextEntry
              />

              <Text style={[s.label, { marginTop: 12 }]}>{t("users.role")}</Text>
              <View style={s.roleRow}>
                {(["Admin", "Cashier"] as Role[]).map(role => (
                  <TouchableOpacity
                    key={role}
                    style={[s.roleBtn, createForm.role === role && s.roleBtnActive]}
                    onPress={() => setCreateForm(f => f && { ...f, role })}
                  >
                    <Text style={[s.roleBtnText, createForm.role === role && s.roleBtnTextActive]}>
                      {t(`users.role.${role}` as any)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={s.modalActions}>
                <TouchableOpacity style={s.cancelBtn} onPress={() => setCreateForm(null)}>
                  <Text style={s.cancelBtnText}>{t("common.cancel")}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.saveBtn, (!createForm.name.trim() || createForm.password.length < 4) && s.saveBtnOff]}
                  onPress={submitCreate}
                  disabled={!createForm.name.trim() || createForm.password.length < 4 || creating}
                >
                  {creating
                    ? <ActivityIndicator color={C.accentFg} />
                    : <Text style={s.saveBtnText}>{t("users.create")}</Text>
                  }
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </Modal>

      {/* Reset password modal */}
      <Modal visible={!!resetForm} animationType="slide" transparent onRequestClose={() => setResetForm(null)}>
        <View style={s.modalOverlay}>
          {resetForm && (
            <View style={s.modalSheet}>
              <Text style={s.modalTitle}>{t("users.resetPassword")}</Text>
              <Text style={s.hintText}>{resetForm.userName} — {t("users.resetPasswordConfirm")}</Text>
              <TextInput
                style={s.input}
                value={resetForm.newPassword}
                onChangeText={v => setResetForm(f => f && { ...f, newPassword: v })}
                placeholder={t("users.passwordPlaceholder")}
                placeholderTextColor={C.muted}
                secureTextEntry
              />
              <View style={s.modalActions}>
                <TouchableOpacity style={s.cancelBtn} onPress={() => setResetForm(null)}>
                  <Text style={s.cancelBtnText}>{t("common.cancel")}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.saveBtn, resetForm.newPassword.length < 4 && s.saveBtnOff]}
                  onPress={submitReset}
                  disabled={resetForm.newPassword.length < 4 || resetting}
                >
                  {resetting
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

  userCard: { flexDirection: "row", alignItems: "center", gap: 10,
              backgroundColor: C.surface, borderRadius: R.lg, padding: 14,
              borderWidth: 1, borderColor: C.border, ...Shadow.sm },
  userAvatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.accentSoft,
                alignItems: "center", justifyContent: "center" },
  userName: { color: C.text, fontSize: F.sm, fontWeight: "700" },
  userRole: { color: C.accent, fontSize: F.xs, fontWeight: "600", marginTop: 2 },
  iconBtn: { width: 30, height: 30, borderRadius: R.md, backgroundColor: C.card,
             alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: C.border },

  modalOverlay: { flex: 1, backgroundColor: C.overlay, justifyContent: "flex-end" },
  modalSheet:   { backgroundColor: C.surface, borderTopLeftRadius: R.xl,
                  borderTopRightRadius: R.xl, padding: 20, maxHeight: "88%", ...Shadow.lg },
  modalTitle: { color: C.text, fontSize: F.lg, fontWeight: "800", marginBottom: 14 },
  hintText: { color: C.muted, fontSize: F.xs, marginBottom: 12 },

  label: { color: C.textSub, fontSize: F.sm, fontWeight: "600", marginBottom: 6 },
  input: { backgroundColor: C.card, borderRadius: R.md, padding: 12,
           color: C.text, fontSize: F.md, borderWidth: 1, borderColor: C.border },

  roleRow: { flexDirection: "row", gap: 8 },
  roleBtn: { flex: 1, paddingVertical: 10, borderRadius: R.md, backgroundColor: C.card,
             alignItems: "center", borderWidth: 1, borderColor: C.border },
  roleBtnActive: { backgroundColor: C.accent, borderColor: C.accent },
  roleBtnText: { color: C.muted, fontSize: F.sm, fontWeight: "700" },
  roleBtnTextActive: { color: C.accentFg },

  modalActions: { flexDirection: "row", gap: 10, marginTop: 20, marginBottom: 20 },
  cancelBtn: { flex: 1, paddingVertical: 13, borderRadius: R.md, backgroundColor: C.card,
               alignItems: "center", borderWidth: 1, borderColor: C.border },
  cancelBtnText: { color: C.muted, fontSize: F.sm, fontWeight: "700" },
  saveBtn: { flex: 1, paddingVertical: 13, borderRadius: R.md, backgroundColor: C.accent,
             alignItems: "center" },
  saveBtnOff: { opacity: 0.4 },
  saveBtnText: { color: C.accentFg, fontSize: F.sm, fontWeight: "800" },
});
