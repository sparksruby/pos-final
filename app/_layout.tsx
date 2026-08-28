import { useEffect, useState } from "react";
import { View, ActivityIndicator } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ThemeProvider, useTheme } from "../src/context/ThemeContext";
import { LanguageProvider } from "../src/context/LanguageContext";
import { AlertProvider } from "../src/context/AlertContext";
import { PrintProvider } from "../src/context/PrintContext";
import { useAuthStore } from "../src/store/authStore";
import { useBranchStore } from "../src/store/branchStore";
import { useShopStore } from "../src/store/shopStore";
import { useLicenseStore } from "../src/store/licenseStore";
import { LicenseGateScreen } from "../src/components/LicenseGateScreen";
import { initDatabase } from "../src/db/database";

function RootStack() {
  const { scheme, colors } = useTheme();
  const { isReady, init } = useAuthStore();
  const loadBranches = useBranchStore(state => state.load);
  const loadShopSettings = useShopStore(state => state.load);
  const [dbReady, setDbReady] = useState(false);
  const licenseStatus = useLicenseStore(state => state.status);
  const initLicense = useLicenseStore(state => state.init);

  useEffect(() => { initLicense(); }, []);

  // Nothing else in the app — not even the local database — spins up until
  // the license gate clears, same "checked once at launch, then trusted
  // offline" reasoning documented in licenseStore.ts.
  useEffect(() => {
    if (licenseStatus !== "valid") return;
    initDatabase().then(async () => {
      await loadBranches();
      // Shop settings are read by screens that never load them themselves
      // (products-manage's label printing reads currency + the default
      // label text; sales-history/reports/etc. read the shop header), and
      // the store starts at `settings: null`. Only payment.tsx and
      // backup.tsx ever called load(), so anything reached without first
      // visiting one of those saw null and silently fell back — which is
      // why a product with no per-item label text printed a blank strip
      // instead of the shop's default label text.
      await loadShopSettings();
      setDbReady(true);
      init();
    });
  }, [licenseStatus]);

  if (licenseStatus === "checking") {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  if (licenseStatus === "blocked") {
    return <LicenseGateScreen />;
  }

  // Each of (pos) and (auth) guards itself with a <Redirect> based on
  // session state (see their _layout.tsx) — expo-router's file-based
  // routing keeps every route reachable regardless of which Stack.Screen
  // is declared here, so the actual gate has to live in the group layouts.
  if (!dbReady || !isReady) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      />
    </>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <AlertProvider>
          <PrintProvider>
            <RootStack />
          </PrintProvider>
        </AlertProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}
