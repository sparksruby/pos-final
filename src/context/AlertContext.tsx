import React, { createContext, useCallback, useContext, useState } from "react";
import { Modal, View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useTheme } from "./ThemeContext";
import { useLanguage } from "./LanguageContext";
import { F, R, Shadow, ThemeColors } from "../theme";

export interface AlertButton {
  text: string;
  style?: "default" | "cancel" | "destructive";
  onPress?: () => void | Promise<void>;
}

interface AlertState {
  title: string;
  message?: string;
  buttons: AlertButton[];
}

interface AlertContextValue {
  /** Drop-in replacement for React Native's Alert.alert(title, message, buttons) — same shape, own UI. */
  alert: (title: string, message?: string, buttons?: AlertButton[]) => void;
}

const AlertContext = createContext<AlertContextValue | null>(null);

export const useAlert = (): AlertContextValue => {
  const ctx = useContext(AlertContext);
  if (!ctx) throw new Error("useAlert must be used within AlertProvider");
  return ctx;
};

export const AlertProvider = ({ children }: { children: React.ReactNode }) => {
  const { colors: C } = useTheme();
  const { t } = useLanguage();
  const s = React.useMemo(() => makeStyles(C), [C]);
  const [state, setState] = useState<AlertState | null>(null);

  const alert = useCallback(
    (title: string, message?: string, buttons?: AlertButton[]) => {
      setState({
        title,
        message,
        buttons:
          buttons && buttons.length > 0 ? buttons : [{ text: t("common.ok") }],
      });
    },
    [t],
  );

  const handlePress = (btn: AlertButton) => {
    setState(null);
    // Fire after the modal starts closing, same as native Alert — a button
    // that navigates or opens another modal shouldn't fight this one for
    // the screen.
    setTimeout(() => {
      btn.onPress?.();
    }, 0);
  };

  const stacked = (state?.buttons.length ?? 0) > 2;

  return (
    <AlertContext.Provider value={{ alert }}>
      {children}
      <Modal
        visible={!!state}
        transparent
        animationType="fade"
        onRequestClose={() => setState(null)}
      >
        <View style={s.overlay}>
          {state && (
            <View style={s.card}>
              <Text style={s.title}>{state.title}</Text>
              {!!state.message && (
                <Text style={s.message}>{state.message}</Text>
              )}
              <View style={[s.buttonRow, stacked && s.buttonColumn]}>
                {state.buttons.map((btn, i) => (
                  <TouchableOpacity
                    key={i}
                    style={[
                      s.button,
                      stacked && s.buttonStacked,
                      btn.style === "cancel" && s.buttonCancel,
                      btn.style === "destructive" && s.buttonDestructive,
                    ]}
                    onPress={() => handlePress(btn)}
                    activeOpacity={0.75}
                  >
                    <Text
                      style={[
                        s.buttonText,
                        btn.style === "cancel" && s.buttonTextCancel,
                        btn.style === "destructive" && s.buttonTextDestructive,
                      ]}
                    >
                      {btn.text}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}
        </View>
      </Modal>
    </AlertContext.Provider>
  );
};

const makeStyles = (C: ThemeColors) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: C.overlay,
      alignItems: "center",
      justifyContent: "center",
      padding: 28,
    },
    card: {
      backgroundColor: C.surface,
      borderRadius: R.xl,
      padding: 20,
      width: "100%",
      maxWidth: 360,
      borderWidth: 1,
      borderColor: C.border,
      ...Shadow.lg,
    },

    title: {
      color: C.text,
      fontSize: F.lg,
      fontWeight: "800",
      textAlign: "center",
    },
    message: {
      color: C.textSub,
      fontSize: F.sm,
      textAlign: "center",
      marginTop: 10,
      lineHeight: 20,
    },

    buttonRow: { flexDirection: "row", gap: 10, marginTop: 20 },
    buttonColumn: {
      flexDirection: "column",
    },

    // `flex: 1` makes each button take its share of buttonRow's width
    // instead of shrinking to its text's natural (tiny) width. See
    // buttonStacked below for why it has to be turned back off once the
    // row becomes a column.
    button: {
      flex: 1,
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: R.md,
      backgroundColor: C.accent,
      alignItems: "center",
      justifyContent: "center",
      minHeight: 46,
    },
    // Three or more buttons stack vertically, and there `flex: 1` is not
    // harmless: it sets flex-basis to 0, so the column measures as though
    // its buttons had no height at all. The dialog then sized itself to
    // the title and message only and the buttons rendered *outside* it,
    // spilling down the screen past the bottom edge of the white box.
    buttonStacked: { flex: 0, alignSelf: "stretch" },
    buttonCancel: {
      backgroundColor: C.card,
      borderWidth: 1,
      borderColor: C.border,
    },
    buttonDestructive: { backgroundColor: C.danger },
    buttonText: { color: C.accentFg, fontSize: F.sm, fontWeight: "800" },
    buttonTextCancel: { color: C.muted },
    buttonTextDestructive: { color: "#fff" },
  });
