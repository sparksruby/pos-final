import React, { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, SafeAreaView, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView,
} from "react-native";
import { router } from "expo-router";
import { useAuthStore } from "../../src/store/authStore";
import { useTheme } from "../../src/context/ThemeContext";
import { useLanguage } from "../../src/context/LanguageContext";
import { useResponsive } from "../../src/hooks/useResponsive";
import { F, R, ThemeColors } from "../../src/theme";

export default function LoginScreen() {
  const { colors: C } = useTheme();
  const { t } = useLanguage();
  const { isTablet } = useResponsive();
  const s = React.useMemo(() => makeStyles(C), [C]);

  const { login, isLoading, error } = useAuthStore();

  const [name,     setName]     = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);

  const canSubmit = name.trim().length > 0 && password.length > 0 && !isLoading;

  const handleLogin = async () => {
    if (!canSubmit) return;
    try {
      await login(name.trim(), password);
      router.replace("/(pos)/");
    } catch {
      // error already set on the store — shown below
    }
  };

  const content = (
    <ScrollView
      contentContainerStyle={s.scroll}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {/* Logo */}
      <View style={s.logoBox}>
        <Text style={s.logoEmoji}>🛒</Text>
        <Text style={s.appName}>{t("app.name")}</Text>
      </View>

      {/* Card */}
      <View style={[s.card, isTablet && s.cardTablet]}>

        {error ? (
          <View style={s.errorBox}>
            <Text style={s.errorText}>⚠️  {error}</Text>
          </View>
        ) : null}

        <Text style={s.label}>{t("auth.name")}</Text>
        <TextInput
          style={s.input}
          value={name}
          onChangeText={setName}
          placeholder={t("auth.namePlaceholder")}
          placeholderTextColor={C.muted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="next"
        />

        <Text style={s.label}>{t("auth.password")}</Text>
        <View style={s.passRow}>
          <TextInput
            style={[s.input, { flex: 1, marginBottom: 0 }]}
            value={password}
            onChangeText={setPassword}
            placeholder={t("auth.passwordPlaceholder")}
            placeholderTextColor={C.muted}
            secureTextEntry={!showPass}
            returnKeyType="done"
            onSubmitEditing={handleLogin}
          />
          <TouchableOpacity
            style={s.eyeBtn}
            onPress={() => setShowPass(p => !p)}
          >
            <Text style={s.eyeText}>{showPass ? "🙈" : "👁️"}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[s.loginBtn, !canSubmit && s.loginBtnOff]}
          onPress={handleLogin}
          disabled={!canSubmit}
          activeOpacity={0.85}
        >
          {isLoading
            ? <ActivityIndicator color={C.accentFg} />
            : <Text style={s.loginBtnText}>{t("auth.login")}</Text>
          }
        </TouchableOpacity>
      </View>

      <Text style={s.hint}>{t("auth.defaultCreds")}</Text>
    </ScrollView>
  );

  return (
    <SafeAreaView style={s.root}>
      {Platform.OS === "ios" ? (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
          {content}
        </KeyboardAvoidingView>
      ) : content}
    </SafeAreaView>
  );
}

const makeStyles = (C: ThemeColors) => StyleSheet.create({
  root:   { flex: 1, backgroundColor: C.bg },
  scroll: { flexGrow: 1, justifyContent: "center", padding: 24, paddingVertical: 40 },

  logoBox:   { alignItems: "center", marginBottom: 28 },
  logoEmoji: { fontSize: 52, marginBottom: 8 },
  appName:   { fontSize: F.xl, fontWeight: "800", color: C.text },

  card:       { backgroundColor: C.surface, borderRadius: R.lg, padding: 20,
                borderWidth: 1, borderColor: C.border, gap: 4 },
  cardTablet: { maxWidth: 420, alignSelf: "center", width: "100%" },

  errorBox:  { backgroundColor: C.dangerSoft, borderWidth: 1, borderColor: C.border, borderRadius: R.md,
               padding: 12, marginBottom: 4 },
  errorText: { color: C.danger, fontSize: F.sm, fontWeight: "600" },

  label: { color: C.textSub, fontSize: F.sm, marginBottom: 6,
           fontWeight: "600", marginTop: 12 },
  input: { backgroundColor: C.card, borderRadius: R.md, padding: 14,
           color: C.text, fontSize: F.md,
           borderWidth: 1, borderColor: C.border },

  passRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  eyeBtn:  { padding: 14, backgroundColor: C.card, borderRadius: R.md,
             borderWidth: 1, borderColor: C.border },
  eyeText: { fontSize: 18 },

  loginBtn:     { backgroundColor: C.accent, borderRadius: R.lg,
                  paddingVertical: 15, alignItems: "center", marginTop: 16 },
  loginBtnOff:  { opacity: 0.4 },
  loginBtnText: { color: C.accentFg, fontSize: F.lg, fontWeight: "800" },

  hint: { color: C.muted, fontSize: F.xs, textAlign: "center", marginTop: 16 },
});
