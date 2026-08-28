import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { darkColors, lightColors, ThemeColors } from "../theme";

export type ThemeMode = "light" | "dark" | "system";
type Scheme = "light" | "dark";

const STORAGE_KEY = "pos_theme_mode";

interface ThemeContextValue {
  mode:       ThemeMode;
  scheme:     Scheme;
  colors:     ThemeColors;
  setMode:    (mode: ThemeMode) => void;
  toggle:     () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>("dark");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(saved => {
      if (saved === "light" || saved === "dark" || saved === "system") {
        setModeState(saved);
      }
      setLoaded(true);
    });
  }, []);

  const setMode = (next: ThemeMode) => {
    setModeState(next);
    AsyncStorage.setItem(STORAGE_KEY, next);
  };

  const toggle = () => setMode(scheme === "dark" ? "light" : "dark");

  const scheme: Scheme = mode === "system"
    ? (systemScheme === "light" ? "light" : "dark")
    : mode;

  const colors = scheme === "light" ? lightColors : darkColors;

  const value = useMemo(
    () => ({ mode, scheme, colors, setMode, toggle }),
    [mode, scheme, colors]
  );

  if (!loaded) return null;

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
};
