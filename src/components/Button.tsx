import React from "react";
import {
  TouchableOpacity, Text, ActivityIndicator,
  StyleSheet, ViewStyle, TextStyle,
} from "react-native";
import { F, R, ThemeColors } from "../theme";
import { useTheme } from "../context/ThemeContext";

interface Props {
  label:     string;
  onPress:   () => void;
  variant?:  "primary" | "secondary" | "danger";
  loading?:  boolean;
  disabled?: boolean;
  style?:    ViewStyle;
}

export const Button = ({
  label, onPress, variant = "primary",
  loading, disabled, style,
}: Props) => {
  const { colors: C } = useTheme();
  const styles = React.useMemo(() => makeStyles(C), [C]);
  const isDisabled = disabled || loading;

  return (
    <TouchableOpacity
      style={[
        styles.base,
        variant === "primary"   && styles.primary,
        variant === "secondary" && styles.secondary,
        variant === "danger"    && styles.danger,
        isDisabled              && styles.disabled,
        style,
      ]}
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.8}
    >
      {loading
        ? <ActivityIndicator color={variant === "primary" ? C.accentFg : C.text} />
        : <Text style={[
            styles.label,
            variant === "primary"   && styles.labelPrimary,
            variant === "secondary" && styles.labelSecondary,
            variant === "danger"    && styles.labelDanger,
          ]}>{label}</Text>
      }
    </TouchableOpacity>
  );
};

const makeStyles = (C: ThemeColors) => StyleSheet.create({
  base:      { borderRadius: R.lg, paddingVertical: 14, alignItems: "center",
               justifyContent: "center", paddingHorizontal: 16 },
  primary:   { backgroundColor: C.accent },
  secondary: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  danger:    { backgroundColor: C.danger },
  disabled:  { opacity: 0.4 },

  label:          { fontSize: F.md, fontWeight: "700" as TextStyle["fontWeight"] },
  labelPrimary:   { color: C.accentFg },
  labelSecondary: { color: C.text },
  labelDanger:    { color: "#fff" },
});
