import React, { useState } from "react";
import {
  View, Text, TouchableOpacity,
  StyleSheet, SafeAreaView, ScrollView, ActivityIndicator, StatusBar, Platform
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Redirect, router } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { exportBackup, importBackup } from "../../src/utils/backup";
import { isDirectSaveAvailable } from "../../src/utils/directSave";
import { useAuthStore } from "../../src/store/authStore";
import { useProductStore } from "../../src/store/productStore";
import { useBranchStore } from "../../src/store/branchStore";
import { useShopStore } from "../../src/store/shopStore";
import { useTheme } from "../../src/context/ThemeContext";
import { useLanguage } from "../../src/context/LanguageContext";
import { useAlert } from "@/context/AlertContext";
import { useResponsive } from "../../src/hooks/useResponsive";
import { isAdmin } from "../../src/utils/permissions";
import { F, R, Shadow, ThemeColors } from "../../src/theme";

const ANDROID_STATUS_BAR =
  Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) : 0;

export default function BackupScreen() {
  const { colors: C } = useTheme();
  const { t } = useLanguage();
  const { alert } = useAlert();
  const { isTablet } = useResponsive();
  const s = React.useMemo(() => makeStyles(C, isTablet), [C, isTablet]);
  const { user } = useAuthStore();

  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);

  if (!isAdmin(user)) return <Redirect href="/(pos)/" />;

  const handleExport = async (method: "share" | "save") => {
    setExporting(true);
    try {
      const ok = await exportBackup(method);
      if (method === "save" && ok) alert(t("backup.savedTitle"), t("backup.savedMessage"));
    } catch (e: any) {
      alert(t("common.error"), t("backup.exportFailed"));
    } finally {
      setExporting(false);
    }
  };

  const runImport = async (uri: string) => {
    setImporting(true);
    try {
      await importBackup(uri);
      // Refresh the stores every screen reads from so the POS home screen
      // (and anything else already mounted) shows the restored data right
      // away — branchStore first since productStore.load() reads whichever
      // branch id it left behind, and a restored backup can shuffle branch
      // ids around.
      await useBranchStore.getState().load();
      await Promise.all([
        useProductStore.getState().load(),
        useShopStore.getState().load(),
      ]);
      alert(t("backup.importDoneTitle"), t("backup.importDoneMessage"));
    } catch (e: any) {
      const message = e?.message === "INVALID_BACKUP_FILE" ? t("backup.invalidFile")
        : e?.message === "BACKUP_VERSION_TOO_NEW" ? t("backup.versionTooNew")
        : t("backup.importFailed");
      alert(t("common.error"), message);
    } finally {
      setImporting(false);
    }
  };

  const handleImport = async () => {
    // Some Android file managers report a .zip as application/octet-stream
    // instead of application/zip — accept both rather than have the picker
    // silently grey the file out.
    const result = await DocumentPicker.getDocumentAsync({
      type: ["application/zip", "application/x-zip-compressed", "application/octet-stream"],
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets[0]) return;
    const uri = result.assets[0].uri;

    alert(t("backup.confirmTitle"), t("backup.confirmMessage"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("backup.confirmAction"), style: "destructive", onPress: () => runImport(uri) },
    ]);
  };

  return (
    <SafeAreaView style={s.root}>
      <ScrollView contentContainerStyle={s.scrollOuter}>
        <View style={[s.scroll, isTablet && s.scrollTablet]}>

          <View style={s.header}>
            <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
              <Ionicons name="arrow-back" size={20} color={C.textSub} />
            </TouchableOpacity>
            <Text style={s.title}>{t("backup.title")}</Text>
          </View>

          <View style={s.card}>
            <Text style={s.section}>{t("backup.exportTitle")}</Text>
            <Text style={s.body}>{t("backup.exportBody")}</Text>
            <TouchableOpacity style={s.actionBtn} onPress={() => handleExport("share")} disabled={exporting} activeOpacity={0.85}>
              {exporting
                ? <ActivityIndicator color={C.accentFg} />
                : <>
                    <Ionicons name="cloud-download-outline" size={18} color={C.accentFg} />
                    <Text style={s.actionBtnText}>{t("backup.exportAction")}</Text>
                  </>
              }
            </TouchableOpacity>
            {isDirectSaveAvailable && (
              <TouchableOpacity style={s.secondaryBtn} onPress={() => handleExport("save")} disabled={exporting} activeOpacity={0.85}>
                <Ionicons name="download-outline" size={16} color={C.text} />
                <Text style={s.secondaryBtnText}>{t("backup.saveToDevice")}</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={s.card}>
            <Text style={s.section}>{t("backup.importTitle")}</Text>
            <Text style={s.body}>{t("backup.importBody")}</Text>
            <Text style={s.warning}>{t("backup.importWarning")}</Text>
            <TouchableOpacity style={s.dangerBtn} onPress={handleImport} disabled={importing} activeOpacity={0.85}>
              {importing
                ? <ActivityIndicator color="#fff" />
                : <>
                    <Ionicons name="cloud-upload-outline" size={18} color="#fff" />
                    <Text style={s.dangerBtnText}>{t("backup.importAction")}</Text>
                  </>
              }
            </TouchableOpacity>
          </View>

        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (C: ThemeColors, isTablet: boolean) => StyleSheet.create({
  root:   { flex: 1, backgroundColor: C.bg },
  scrollOuter: { flexGrow: 1, alignItems: "center" },
  scroll: { padding: 16, gap: 14, paddingBottom: 40, width: "100%" },
  scrollTablet: { maxWidth: 640 },

  header:  { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 4, paddingTop: ANDROID_STATUS_BAR + (isTablet ? 6 : 10) },
  backBtn: { width: 34, height: 34, borderRadius: R.md, backgroundColor: C.card,
             alignItems: "center", justifyContent: "center",
             borderWidth: 1, borderColor: C.border },
  title:   { fontSize: F.xxl, fontWeight: "700", color: C.text, flex: 1 },

  card:    { backgroundColor: C.surface, borderRadius: R.lg, padding: 16,
             borderWidth: 1, borderColor: C.border, gap: 4, ...Shadow.sm },
  section: { color: C.muted, fontSize: F.xs, fontWeight: "700",
             textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8 },
  body:    { color: C.textSub, fontSize: F.sm, lineHeight: 20 },
  warning: { color: C.danger, fontSize: F.sm, lineHeight: 20, marginTop: 8, fontWeight: "600" },

  actionBtn:     { flexDirection: "row", gap: 8, backgroundColor: C.accent, borderRadius: R.lg,
                   paddingVertical: 14, alignItems: "center", justifyContent: "center", marginTop: 14 },
  actionBtnText: { color: C.accentFg, fontSize: F.md, fontWeight: "800" },

  secondaryBtn:     { flexDirection: "row", gap: 8, backgroundColor: C.card, borderRadius: R.lg,
                      paddingVertical: 12, alignItems: "center", justifyContent: "center", marginTop: 10,
                      borderWidth: 1, borderColor: C.border },
  secondaryBtnText: { color: C.text, fontSize: F.sm, fontWeight: "700" },

  dangerBtn:     { flexDirection: "row", gap: 8, backgroundColor: C.danger, borderRadius: R.lg,
                   paddingVertical: 14, alignItems: "center", justifyContent: "center", marginTop: 14 },
  dangerBtnText: { color: "#fff", fontSize: F.md, fontWeight: "800" },
});
