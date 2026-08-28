import React, { useState } from "react";
import {
  View, Text, TouchableOpacity, TextInput,
  StyleSheet, SafeAreaView, ScrollView,
  ActivityIndicator, Platform, StatusBar,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Redirect, router } from "expo-router";
import { syncRepo, SyncError } from "../../src/db/syncRepo";
import { syncErrorMessage } from "../../src/utils/syncErrors";
import { useSyncStore } from "../../src/store/syncStore";
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

export default function RegisterDeviceScreen() {
  const { colors: C } = useTheme();
  const { t } = useLanguage();
  const { alert } = useAlert();
  const { isTablet } = useResponsive();
  const s = React.useMemo(() => makeStyles(C, isTablet), [C, isTablet]);
  const { user } = useAuthStore();
  const { config } = useSyncStore();
  const { branches } = useBranchStore();
  const isMainBranch = !!(config && config.adminKey);

  const [deviceName, setDeviceName] = useState("");
  const [branchId, setBranchId] = useState<number | null>(null);
  const [registering, setRegistering] = useState(false);
  const [result, setResult] = useState<{ branchName: string; apiKey: string } | null>(null);

  const handleRegister = async () => {
    if (!deviceName.trim() || !branchId) return;
    const branch = branches.find(b => b.id === branchId);
    setRegistering(true);
    try {
      const { apiKey } = await syncRepo.createDevice(deviceName.trim(), branchId);
      setResult({ branchName: branch?.name ?? "", apiKey });
      setDeviceName("");
      setBranchId(null);
    } catch (e: any) {
      alert(t("common.error"), e instanceof SyncError ? syncErrorMessage(e, t) : (e?.message ?? ""));
    } finally {
      setRegistering(false);
    }
  };

  if (!isAdmin(user)) return <Redirect href="/(pos)/" />;

  return (
    <SafeAreaView style={s.root}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={20} color={C.textSub} />
        </TouchableOpacity>
        <Ionicons name="phone-portrait-outline" size={17} color={C.text} />
        <Text style={s.title}>{t("registerDevice.title")}</Text>
      </View>

      {!isMainBranch ? (
        <View style={s.center}>
          <Ionicons name="lock-closed-outline" size={30} color={C.muted} />
          <Text style={s.centerText}>{t("syncOverview.mainBranchOnly")}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.scroll}>
          <View style={s.card}>
            <Text style={s.hint}>{t("registerDevice.hint")}</Text>

            <Text style={[s.label, { marginTop: 12 }]}>{t("registerDevice.deviceName")}</Text>
            <TextInput
              style={s.input}
              value={deviceName}
              onChangeText={setDeviceName}
              placeholder={t("registerDevice.deviceNamePlaceholder")}
              placeholderTextColor={C.muted}
            />

            <Text style={[s.label, { marginTop: 12 }]}>{t("registerDevice.branch")}</Text>
            <View style={s.branchChipsRow}>
              {branches.map(b => (
                <TouchableOpacity
                  key={b.id}
                  style={[s.branchChip, branchId === b.id && s.branchChipActive]}
                  onPress={() => setBranchId(b.id)}
                >
                  <Text style={[s.branchChipText, branchId === b.id && s.branchChipTextActive]}>{b.name}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={[s.primaryBtn, (!deviceName.trim() || !branchId) && s.primaryBtnOff]}
              onPress={handleRegister}
              disabled={!deviceName.trim() || !branchId || registering}
            >
              {registering
                ? <ActivityIndicator color={C.accentFg} />
                : (<><Ionicons name="add-circle-outline" size={17} color={C.accentFg} /><Text style={s.primaryBtnText}>{t("registerDevice.register")}</Text></>)
              }
            </TouchableOpacity>
          </View>

          {result && (
            <View style={[s.card, s.resultCard]}>
              <Text style={s.section}>{t("registerDevice.resultTitle", { branch: result.branchName })}</Text>
              <Text style={s.resultHint}>{t("registerDevice.resultHint")}</Text>
              <Text style={s.keyBox} selectable>{result.apiKey}</Text>
            </View>
          )}
        </ScrollView>
      )}
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

  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 24 },
  centerText: { color: C.muted, fontSize: F.sm, textAlign: "center", lineHeight: 20 },

  scroll: { padding: 16, gap: 14, paddingBottom: 40 },
  card:    { backgroundColor: C.surface, borderRadius: R.lg, padding: 16,
             borderWidth: 1, borderColor: C.border, ...Shadow.sm },
  hint:    { color: C.textSub, fontSize: F.xs, lineHeight: 18 },
  section: { color: C.muted, fontSize: F.xs, fontWeight: "700",
             textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 },

  label: { color: C.textSub, fontSize: F.sm, fontWeight: "600", marginBottom: 6 },
  input: { backgroundColor: C.card, borderRadius: R.md, padding: 12,
           color: C.text, fontSize: F.md, borderWidth: 1, borderColor: C.border },

  branchChipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  branchChip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: R.full,
                backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  branchChipActive: { backgroundColor: C.accent, borderColor: C.accent },
  branchChipText: { color: C.muted, fontSize: F.sm, fontWeight: "600" },
  branchChipTextActive: { color: C.accentFg, fontWeight: "700" },

  primaryBtn: { flexDirection: "row", gap: 8, backgroundColor: C.accent, borderRadius: R.lg,
                paddingVertical: 14, alignItems: "center", justifyContent: "center", marginTop: 18, ...Shadow.sm },
  primaryBtnOff: { opacity: 0.4 },
  primaryBtnText: { color: C.accentFg, fontSize: F.md, fontWeight: "800" },

  resultCard: { borderColor: C.success, gap: 8 },
  resultHint: { color: C.textSub, fontSize: F.xs, lineHeight: 18 },
  keyBox: { backgroundColor: C.card, borderRadius: R.md, padding: 12,
            color: C.accent, fontSize: F.sm, fontWeight: "700",
            borderWidth: 1, borderColor: C.border },
});
