import React, { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, SafeAreaView, ScrollView,
  ActivityIndicator,
  Platform, StatusBar
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useAuthStore } from "../../src/store/authStore";
import { useTheme } from "../../src/context/ThemeContext";
import { useLanguage } from "../../src/context/LanguageContext";
import { useAlert } from "@/context/AlertContext";
import { useResponsive } from "../../src/hooks/useResponsive";
import { F, R, Shadow, ThemeColors } from "../../src/theme";

const ANDROID_STATUS_BAR =
  Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) : 0;

export default function ChangePasswordScreen() {
  const { colors: C } = useTheme();
  const { t } = useLanguage();
  const { alert } = useAlert();
  const { isTablet } = useResponsive();
  const s = React.useMemo(() => makeStyles(C, isTablet), [C, isTablet]);
  const { changePassword } = useAuthStore();

  const [current, setCurrent]   = useState("");
  const [next, setNext]         = useState("");
  const [confirm, setConfirm]   = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (next.length < 4) {
      alert(t("common.error"), t("changePassword.tooShort"));
      return;
    }
    if (next !== confirm) {
      alert(t("common.error"), t("changePassword.mismatch"));
      return;
    }
    setSubmitting(true);
    try {
      await changePassword(current, next);
      alert(t("changePassword.success"), "", [
        { text: t("common.ok"), onPress: () => router.back() },
      ]);
    } catch (e: any) {
      const message = e?.message === "WRONG_CURRENT_PASSWORD"
        ? t("changePassword.wrongCurrent")
        : t("changePassword.failed");
      alert(t("common.error"), message);
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = current.length > 0 && next.length > 0 && confirm.length > 0 && !submitting;

  return (
    <SafeAreaView style={s.root}>
      <ScrollView contentContainerStyle={s.scrollOuter}>
        <View style={[s.scroll, isTablet && s.scrollTablet]}>

          <View style={s.header}>
            <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
              <Ionicons name="arrow-back" size={20} color={C.textSub} />
            </TouchableOpacity>
            <Text style={s.title}>{t("changePassword.title")}</Text>
          </View>

          <View style={s.card}>
            <Text style={s.label}>{t("changePassword.current")}</Text>
            <TextInput
              style={s.input}
              value={current}
              onChangeText={setCurrent}
              secureTextEntry
              placeholderTextColor={C.muted}
            />

            <Text style={[s.label, { marginTop: 14 }]}>{t("changePassword.new")}</Text>
            <TextInput
              style={s.input}
              value={next}
              onChangeText={setNext}
              secureTextEntry
              placeholderTextColor={C.muted}
            />

            <Text style={[s.label, { marginTop: 14 }]}>{t("changePassword.confirm")}</Text>
            <TextInput
              style={s.input}
              value={confirm}
              onChangeText={setConfirm}
              secureTextEntry
              placeholderTextColor={C.muted}
            />
          </View>

          <TouchableOpacity
            style={[s.submitBtn, !canSubmit && s.submitBtnOff]}
            onPress={handleSubmit}
            disabled={!canSubmit}
            activeOpacity={0.85}
          >
            {submitting
              ? <ActivityIndicator color={C.accentFg} />
              : (
                <>
                  <Ionicons name="key-outline" size={18} color={C.accentFg} />
                  <Text style={s.submitText}>{t("changePassword.submit")}</Text>
                </>
              )
            }
          </TouchableOpacity>

        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (C: ThemeColors, isTablet: boolean) => StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  scrollOuter: { flexGrow: 1, alignItems: "center" },
  scroll: { padding: 16, gap: 14, paddingBottom: 40, width: "100%" },
  scrollTablet: { maxWidth: 480 },

  header:  { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 4, paddingTop: ANDROID_STATUS_BAR + (isTablet ? 6 : 10) },
  backBtn: { width: 34, height: 34, borderRadius: R.md, backgroundColor: C.card,
             alignItems: "center", justifyContent: "center",
             borderWidth: 1, borderColor: C.border },
  title:   { fontSize: F.xxl, fontWeight: "700", color: C.text, flex: 1 },

  card:  { backgroundColor: C.surface, borderRadius: R.lg, padding: 16,
           borderWidth: 1, borderColor: C.border, ...Shadow.sm },
  label: { color: C.textSub, fontSize: F.sm, fontWeight: "600", marginBottom: 6 },
  input: { backgroundColor: C.card, borderRadius: R.md, padding: 14,
           color: C.text, fontSize: F.md, borderWidth: 1, borderColor: C.border },

  submitBtn:    { flexDirection: "row", gap: 8, backgroundColor: C.accent, borderRadius: R.lg,
                  paddingVertical: 15, alignItems: "center", justifyContent: "center", ...Shadow.md },
  submitBtnOff: { opacity: 0.4 },
  submitText:   { color: C.accentFg, fontSize: F.lg, fontWeight: "800" },
});
