import React, { useEffect, useState } from "react";
import {
  View, Text, TouchableOpacity, TextInput,
  StyleSheet, SafeAreaView, ScrollView,
  ActivityIndicator, Platform, StatusBar,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Redirect, router } from "expo-router";
import { useSyncStore } from "../../src/store/syncStore";
import { syncRepo } from "../../src/db/syncRepo";
import { useBranchStore } from "../../src/store/branchStore";
import { useAuthStore } from "../../src/store/authStore";
import { useTheme } from "../../src/context/ThemeContext";
import { useLanguage } from "../../src/context/LanguageContext";
import { useAlert } from "@/context/AlertContext";
import { useResponsive } from "../../src/hooks/useResponsive";
import { isAdmin } from "../../src/utils/permissions";
import { F, R, Shadow, ThemeColors } from "../../src/theme";

const ANDROID_STATUS_BAR =
  Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) : 0;

const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—");

export default function SyncSettingsScreen() {
  const { colors: C } = useTheme();
  const { t } = useLanguage();
  const { alert } = useAlert();
  const { isTablet } = useResponsive();
  const s = React.useMemo(() => makeStyles(C, isTablet), [C, isTablet]);
  const { user } = useAuthStore();

  const { config, isSyncing, lastError, lastResult, load, connect, disconnect, syncNow, setAdminKey } = useSyncStore();
  const { branches, load: loadBranches } = useBranchStore();
  const [isLoading, setIsLoading] = useState(true);

  const [serverUrl, setServerUrl] = useState("");
  const [deviceKey, setDeviceKey] = useState("");
  const [connecting, setConnecting] = useState(false);

  const [adminKeyInput, setAdminKeyInput] = useState("");
  const [savingAdminKey, setSavingAdminKey] = useState(false);

  const handleSaveAdminKey = async () => {
    if (!adminKeyInput.trim()) return;
    setSavingAdminKey(true);
    try {
      await setAdminKey(adminKeyInput.trim());
      setAdminKeyInput("");
    } catch (e: any) {
      alert(t("common.error"), e?.message ?? "");
    } finally {
      setSavingAdminKey(false);
    }
  };

  useEffect(() => {
    load().finally(() => setIsLoading(false));
  }, []);

  const boundBranch = branches.find(b => b.id === config?.boundBranchId);

  const handleConnect = async () => {
    if (!serverUrl.trim() || !deviceKey.trim()) return;
    setConnecting(true);
    try {
      await connect(serverUrl.trim(), deviceKey.trim());
      await loadBranches();
      setServerUrl(""); setDeviceKey("");
    } catch {
      alert(t("sync.connectFailedTitle"), t("sync.connectFailedMsg"));
    } finally {
      setConnecting(false);
    }
  };

  const doDisconnect = async () => { await disconnect(); await loadBranches(); };

  const handleDisconnect = async () => {
    const unsyncedCount = await syncRepo.getUnsyncedCount();
    if (unsyncedCount > 0) {
      alert(
        t("sync.disconnectUnsyncedTitle"),
        t("sync.disconnectUnsyncedMsg", { count: unsyncedCount }),
        [
          { text: t("common.cancel"), style: "cancel" },
          {
            text: t("sync.syncNowFirst"),
            onPress: async () => { await handleSyncNow(); },
          },
          { text: t("sync.disconnectAnyway"), style: "destructive", onPress: doDisconnect },
        ]
      );
      return;
    }
    alert(t("sync.disconnectConfirm"), "", [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("common.confirm"), style: "destructive", onPress: doDisconnect },
    ]);
  };

  const handleSyncNow = async () => {
    await syncNow();
    await loadBranches();
  };

  // Every role can view connection status and trigger Sync Now — a
  // cashier's own device is still the one whose data does/doesn't reach
  // the server, so being able to check that and kick off a sync
  // themselves is useful day-to-day. Connect/Disconnect/Admin Key stay
  // admin-only below (canEdit) since those change which server/branch
  // this device is bound to, or hand out an admin-level credential.
  if (!user) return <Redirect href="/(pos)/" />;
  const canEdit = isAdmin(user);

  return (
    <SafeAreaView style={s.root}>
      <ScrollView contentContainerStyle={s.scrollOuter}>
        <View style={[s.scroll, isTablet && s.scrollTablet]}>

          <View style={s.header}>
            <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
              <Ionicons name="arrow-back" size={20} color={C.textSub} />
            </TouchableOpacity>
            <Text style={s.title}>{t("sync.title")}</Text>
          </View>

          {isLoading ? (
            <ActivityIndicator color={C.accent} style={{ marginTop: 40 }} />
          ) : config ? (
            <>
              <View style={s.card}>
                <Text style={s.section}>{t("sync.status")}</Text>
                <View style={s.statusRow}>
                  <Ionicons name="cloud-done-outline" size={16} color={C.success} />
                  <Text style={s.statusText}>{t("sync.connected")}</Text>
                </View>
                <View style={s.infoRow}>
                  <Text style={s.infoLabel}>{t("sync.server")}</Text>
                  <Text style={s.infoValue} numberOfLines={1}>{config.serverUrl}</Text>
                </View>
                <View style={s.infoRow}>
                  <Text style={s.infoLabel}>{t("sync.boundBranch")}</Text>
                  <Text style={s.infoValue}>{boundBranch?.name ?? "—"}</Text>
                </View>
                <View style={s.infoRow}>
                  <Text style={s.infoLabel}>{t("sync.lastPull")}</Text>
                  <Text style={s.infoValue}>{fmtTime(config.lastPullAt)}</Text>
                </View>
                <View style={s.infoRow}>
                  <Text style={s.infoLabel}>{t("sync.lastPush")}</Text>
                  <Text style={s.infoValue}>{fmtTime(config.lastPushAt)}</Text>
                </View>
              </View>

              {canEdit && (
                <View style={s.card}>
                  <Text style={s.section}>{t("sync.adminKey")}</Text>
                  <Text style={s.hint}>{t("sync.adminKeyHint")}</Text>
                  <View style={s.infoRow}>
                    <Text style={s.infoLabel}>{t("sync.adminKeyStatus")}</Text>
                    <Text style={s.infoValue}>
                      {config.adminKey ? t("sync.adminKeySet") : t("sync.adminKeyNotSet")}
                    </Text>
                  </View>
                  <TextInput
                    style={[s.input, { marginTop: 4 }]}
                    value={adminKeyInput}
                    onChangeText={setAdminKeyInput}
                    placeholder={t("sync.adminKeyPlaceholder")}
                    placeholderTextColor={C.muted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    secureTextEntry
                  />
                  <TouchableOpacity
                    style={[s.saveAdminKeyBtn, !adminKeyInput.trim() && s.primaryBtnOff]}
                    onPress={handleSaveAdminKey}
                    disabled={!adminKeyInput.trim() || savingAdminKey}
                  >
                    {savingAdminKey
                      ? <ActivityIndicator color={C.accentFg} size="small" />
                      : <Text style={s.saveAdminKeyBtnText}>{t("common.save")}</Text>
                    }
                  </TouchableOpacity>
                </View>
              )}

              {lastResult && (
                <View style={s.card}>
                  <Text style={s.section}>{t("sync.lastResult")}</Text>
                  <Text style={s.resultLine}>{t("sync.salesPushed", { count: lastResult.salesPushed })}</Text>
                  <Text style={s.resultLine}>{t("sync.movementsPushed", { count: lastResult.movementsPushed })}</Text>
                  <Text style={s.resultLine}>{t("sync.pulled", { count: lastResult.pulled })}</Text>
                  {lastResult.skipped > 0 && (
                    <Text style={s.resultLineWarn}>{t("sync.skipped", { count: lastResult.skipped })}</Text>
                  )}
                </View>
              )}

              {lastError && (
                <View style={[s.card, s.errorCard]}>
                  <Text style={s.errorText}>{lastError}</Text>
                </View>
              )}

              <TouchableOpacity style={s.primaryBtn} onPress={handleSyncNow} disabled={isSyncing}>
                {isSyncing
                  ? <ActivityIndicator color={C.accentFg} />
                  : (<><Ionicons name="sync-outline" size={17} color={C.accentFg} /><Text style={s.primaryBtnText}>{t("sync.syncNow")}</Text></>)
                }
              </TouchableOpacity>

              {canEdit && !!config.adminKey && (
                <>
                  <TouchableOpacity style={s.secondaryBtn} onPress={() => router.push("/(pos)/sync-overview")}>
                    <Ionicons name="albums-outline" size={16} color={C.text} />
                    <Text style={s.secondaryBtnText}>{t("sync.viewAllBranchesActivity")}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.secondaryBtn} onPress={() => router.push("/(pos)/register-device")}>
                    <Ionicons name="phone-portrait-outline" size={16} color={C.text} />
                    <Text style={s.secondaryBtnText}>{t("registerDevice.title")}</Text>
                  </TouchableOpacity>
                </>
              )}

              {canEdit && (
                <TouchableOpacity style={s.dangerBtn} onPress={handleDisconnect} disabled={isSyncing}>
                  <Text style={s.dangerBtnText}>{t("sync.disconnect")}</Text>
                </TouchableOpacity>
              )}
            </>
          ) : canEdit ? (
            <>
              <View style={s.card}>
                <Text style={s.section}>{t("sync.connectTitle")}</Text>
                <Text style={s.hint}>{t("sync.connectHint")}</Text>

                <Text style={[s.label, { marginTop: 12 }]}>{t("sync.server")}</Text>
                <TextInput
                  style={s.input}
                  value={serverUrl}
                  onChangeText={setServerUrl}
                  placeholder={t("sync.serverPlaceholder")}
                  placeholderTextColor={C.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                />

                <Text style={[s.label, { marginTop: 12 }]}>{t("sync.deviceKey")}</Text>
                <TextInput
                  style={s.input}
                  value={deviceKey}
                  onChangeText={setDeviceKey}
                  placeholder={t("sync.deviceKeyPlaceholder")}
                  placeholderTextColor={C.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry
                />

                {lastError && <Text style={s.errorText}>{lastError}</Text>}

                <TouchableOpacity
                  style={[s.primaryBtn, { marginTop: 16 }, (!serverUrl.trim() || !deviceKey.trim()) && s.primaryBtnOff]}
                  onPress={handleConnect}
                  disabled={!serverUrl.trim() || !deviceKey.trim() || connecting}
                >
                  {connecting
                    ? <ActivityIndicator color={C.accentFg} />
                    : (<><Ionicons name="cloud-upload-outline" size={17} color={C.accentFg} /><Text style={s.primaryBtnText}>{t("sync.connect")}</Text></>)
                  }
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <View style={s.card}>
              <Text style={s.section}>{t("sync.notConnected")}</Text>
              <Text style={s.hint}>{t("sync.notConnectedCashierHint")}</Text>
            </View>
          )}

        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (C: ThemeColors, isTablet: boolean) => StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  scrollOuter: { flexGrow: 1, alignItems: "center" },
  scroll: { padding: 16, gap: 14, paddingBottom: 40, width: "100%" },
  scrollTablet: { maxWidth: 640 },

  header:  { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 4, paddingTop: ANDROID_STATUS_BAR + (isTablet ? 6 : 10) },
  backBtn: { width: 34, height: 34, borderRadius: R.md, backgroundColor: C.card,
             alignItems: "center", justifyContent: "center",
             borderWidth: 1, borderColor: C.border },
  title:   { fontSize: F.xxl, fontWeight: "700", color: C.text, flex: 1 },

  card:    { backgroundColor: C.surface, borderRadius: R.lg, padding: 16,
             borderWidth: 1, borderColor: C.border, gap: 6, ...Shadow.sm },
  section: { color: C.muted, fontSize: F.xs, fontWeight: "700",
             textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 },
  hint:    { color: C.textSub, fontSize: F.xs, lineHeight: 18 },

  statusRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  statusText: { color: C.success, fontSize: F.md, fontWeight: "700" },

  infoRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  infoLabel: { color: C.muted, fontSize: F.sm },
  infoValue: { color: C.text, fontSize: F.sm, fontWeight: "600", flexShrink: 1, textAlign: "right", marginLeft: 8 },

  resultLine: { color: C.textSub, fontSize: F.sm },
  resultLineWarn: { color: C.warning, fontSize: F.sm, fontWeight: "700", marginTop: 2 },

  label: { color: C.textSub, fontSize: F.sm, fontWeight: "600", marginBottom: 6 },
  input: { backgroundColor: C.card, borderRadius: R.md, padding: 12,
           color: C.text, fontSize: F.md, borderWidth: 1, borderColor: C.border },

  errorCard: { borderColor: C.danger },
  errorText: { color: C.danger, fontSize: F.xs, marginTop: 8 },

  saveAdminKeyBtn: { marginTop: 10, backgroundColor: C.card, borderRadius: R.md, borderWidth: 1,
                     borderColor: C.border, paddingVertical: 10, alignItems: "center" },
  saveAdminKeyBtnText: { color: C.accent, fontSize: F.sm, fontWeight: "700" },

  primaryBtn: { flexDirection: "row", gap: 8, backgroundColor: C.accent, borderRadius: R.lg,
                paddingVertical: 14, alignItems: "center", justifyContent: "center", ...Shadow.sm },
  primaryBtnOff: { opacity: 0.4 },
  primaryBtnText: { color: C.accentFg, fontSize: F.md, fontWeight: "800" },

  dangerBtn: { paddingVertical: 12, alignItems: "center" },
  dangerBtnText: { color: C.danger, fontSize: F.sm, fontWeight: "700" },

  secondaryBtn: { flexDirection: "row", gap: 8, backgroundColor: C.card, borderRadius: R.lg,
                  borderWidth: 1, borderColor: C.border, paddingVertical: 13,
                  alignItems: "center", justifyContent: "center" },
  secondaryBtnText: { color: C.text, fontSize: F.sm, fontWeight: "700" },
});
