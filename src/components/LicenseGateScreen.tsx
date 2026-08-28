import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLicenseStore } from "../store/licenseStore";
import { useTheme } from "../context/ThemeContext";
import { useLanguage } from "../context/LanguageContext";
import { F, R, Shadow, ThemeColors } from "../theme";

// Rendered directly by app/_layout.tsx (not a routed screen) whenever the
// license isn't currently valid — mirrors (auth)/login.tsx's layout since
// this is the same kind of "nothing else in the app is reachable yet" gate.
export const LicenseGateScreen = () => {
  const { colors: C } = useTheme();
  const { t } = useLanguage();
  const s = React.useMemo(() => makeStyles(C), [C]);
  const { activate, activating, message } = useLicenseStore();

  const [key, setKey] = useState("");
  const [location, setLocation] = useState("");
  // Which field is focused, so the one being typed into can say so. On a
  // screen that is nothing but two inputs, that is most of the feedback
  // there is to give.
  const [focused, setFocused] = useState<"key" | "location" | null>(null);

  const canSubmit = key.trim().length > 0 && !activating;

  const handleActivate = async () => {
    if (!canSubmit) return;
    await activate(key, location);
  };

  const errorText = message === "OFFLINE" ? t("license.offlineError") : message;

  const content = (
    <ScrollView
      contentContainerStyle={s.scroll}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={s.logoBox}>
        <View style={s.logoTile}>
          <Ionicons name="key" size={30} color={C.accent} />
        </View>
        <Text style={s.appName}>{t("license.title")}</Text>
        <Text style={s.subtitle}>{t("license.subtitle")}</Text>
      </View>

      <View style={s.card}>
        {!!errorText && (
          <View style={s.errorBox}>
            <Ionicons name="alert-circle" size={17} color={C.danger} />
            <Text style={s.errorText}>{errorText}</Text>
          </View>
        )}

        <Text style={s.label}>{t("license.keyLabel")}</Text>
        <TextInput
          style={[s.input, s.keyInput, focused === "key" && s.inputFocused]}
          value={key}
          onChangeText={setKey}
          onFocus={() => setFocused("key")}
          onBlur={() => setFocused(null)}
          placeholder={t("license.keyPlaceholder")}
          placeholderTextColor={C.muted}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          returnKeyType="next"
        />

        <Text style={s.label}>{t("license.locationLabel")}</Text>
        <TextInput
          style={[s.input, focused === "location" && s.inputFocused]}
          value={location}
          onChangeText={setLocation}
          onFocus={() => setFocused("location")}
          onBlur={() => setFocused(null)}
          placeholder={t("license.locationPlaceholder")}
          placeholderTextColor={C.muted}
          returnKeyType="done"
          onSubmitEditing={handleActivate}
        />

        <TouchableOpacity
          style={[s.submitBtn, !canSubmit && s.submitBtnOff]}
          onPress={handleActivate}
          disabled={!canSubmit}
          activeOpacity={0.85}
        >
          {activating ? (
            <ActivityIndicator color={C.accentFg} />
          ) : (
            <>
              <Ionicons name="checkmark-circle" size={19} color={C.accentFg} />
              <Text style={s.submitBtnText}>{t("license.activate")}</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );

  return (
    <SafeAreaView style={s.root}>
      {Platform.OS === "ios" ? (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
          {content}
        </KeyboardAvoidingView>
      ) : (
        content
      )}
    </SafeAreaView>
  );
};

const makeStyles = (C: ThemeColors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },
    scroll: {
      flexGrow: 1,
      justifyContent: "center",
      padding: 24,
      paddingVertical: 40,
    },

    logoBox: { alignItems: "center", marginBottom: 28 },
    // A tinted tile rather than a bare emoji: the same shape the rest of
    // the app puts its icons in, and it survives a theme change, which a
    // full-colour emoji does not.
    logoTile: {
      width: 64,
      height: 64,
      borderRadius: R.xl,
      backgroundColor: C.accentSoft,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 14,
    },
    appName: {
      fontSize: F.xxl,
      fontWeight: "800",
      color: C.text,
      textAlign: "center",
    },
    subtitle: {
      fontSize: F.sm,
      lineHeight: F.sm * 1.5,
      color: C.textSub,
      textAlign: "center",
      marginTop: 8,
      maxWidth: 300,
    },

    card: {
      backgroundColor: C.surface,
      borderRadius: R.xl,
      padding: 20,
      borderWidth: 1,
      borderColor: C.border,
      maxWidth: 420,
      alignSelf: "center",
      width: "100%",
      ...Shadow.md,
    },

    // Bordered in danger, not in the neutral border colour — an error box
    // that outlines itself the same way every other box does has to be read
    // before it can be recognised.
    errorBox: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      backgroundColor: C.dangerSoft,
      borderWidth: 1,
      borderColor: C.danger,
      borderRadius: R.md,
      padding: 12,
      marginBottom: 8,
    },
    errorText: { flex: 1, color: C.danger, fontSize: F.sm, fontWeight: "600" },

    label: {
      color: C.muted,
      fontSize: F.xs,
      fontWeight: "800",
      textTransform: "uppercase",
      letterSpacing: 0.8,
      marginBottom: 8,
      marginTop: 14,
    },
    input: {
      backgroundColor: C.card,
      borderRadius: R.md,
      paddingHorizontal: 14,
      paddingVertical: 14,
      color: C.text,
      fontSize: F.md,
      borderWidth: 1,
      borderColor: C.border,
    },
    inputFocused: { borderColor: C.accent, backgroundColor: C.surface },
    // Licence keys are long strings of unrelated characters — spacing them
    // out is what makes one readable while it is being checked against a
    // card or a message.
    keyInput: { letterSpacing: 1.2, fontWeight: "600" },

    submitBtn: {
      flexDirection: "row",
      gap: 8,
      backgroundColor: C.accent,
      borderRadius: R.lg,
      paddingVertical: 15,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 20,
      ...Shadow.sm,
    },
    submitBtnOff: { opacity: 0.4 },
    submitBtnText: { color: C.accentFg, fontSize: F.lg, fontWeight: "800" },
  });