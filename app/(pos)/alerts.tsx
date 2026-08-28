import React, { useEffect, useState } from "react";
import {
  View, Text, StyleSheet, SafeAreaView, ScrollView,
  ActivityIndicator, TouchableOpacity, Platform, StatusBar,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Redirect, router } from "expo-router";
import { productsRepo } from "../../src/db/productsRepo";
import { useAuthStore } from "../../src/store/authStore";
import { useBranchStore } from "../../src/store/branchStore";
import { useTheme } from "../../src/context/ThemeContext";
import { useLanguage } from "../../src/context/LanguageContext";
import { useResponsive } from "../../src/hooks/useResponsive";
import { isAdmin } from "../../src/utils/permissions";
import { F, R, Shadow, ThemeColors } from "../../src/theme";
import type { Product } from "../../src/types";

// Products expiring at or before this many days from today show under
// "Expiring Soon" — already-expired ones get their own section instead.
const EXPIRING_SOON_DAYS = 30;

const ANDROID_STATUS_BAR =
  Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) : 0;

const daysUntil = (isoDate: string) => {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(isoDate + "T00:00:00");
  return Math.round((target.getTime() - today.getTime()) / 86400000);
};

export default function AlertsScreen() {
  const { colors: C } = useTheme();
  const { t } = useLanguage();
  const { isTablet } = useResponsive();
  const s = React.useMemo(() => makeStyles(C, isTablet), [C, isTablet]);
  const { user } = useAuthStore();
  const { branches, currentBranchId } = useBranchStore();
  const currentBranch = branches.find(b => b.id === currentBranchId);

  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!currentBranchId) return;
    setIsLoading(true);
    productsRepo.getAllProducts(currentBranchId)
      .then(setProducts)
      .finally(() => setIsLoading(false));
  }, [currentBranchId]);

  const outOfStock = products.filter(p => p.stockQty <= 0);
  const lowStock    = products.filter(p => p.stockQty > 0 && p.stockQty <= p.lowStockThreshold);
  const expired      = products.filter(p => p.expiryDate && daysUntil(p.expiryDate) < 0);
  const expiringSoon = products.filter(p => p.expiryDate && daysUntil(p.expiryDate) >= 0 && daysUntil(p.expiryDate) <= EXPIRING_SOON_DAYS);

  if (!isAdmin(user)) return <Redirect href="/(pos)/" />;

  return (
    <SafeAreaView style={s.root}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={20} color={C.textSub} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>{t("alerts.title")}</Text>
          {!!currentBranch && branches.length > 1 && (
            <Text style={s.branchSubtitle}>{currentBranch.name}</Text>
          )}
        </View>
      </View>

      {isLoading ? (
        <ActivityIndicator color={C.accent} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={s.scroll}>
          <Text style={s.sectionHeading}>
            {t("alerts.lowStock")} {outOfStock.length + lowStock.length > 0 ? `(${outOfStock.length + lowStock.length})` : ""}
          </Text>
          {outOfStock.length === 0 && lowStock.length === 0 ? (
            <Text style={s.emptyText}>{t("alerts.noLowStock")}</Text>
          ) : (
            [...outOfStock, ...lowStock].map(p => (
              <View key={p.id} style={s.card}>
                <Text style={s.cardName}>{p.name}</Text>
                <Text style={s.cardMeta}>{t("alerts.currentStock")}: {p.stockQty}</Text>
                <Text style={s.cardMeta}>{t("alerts.minimumStock")}: {p.lowStockThreshold}</Text>
                <Text style={p.stockQty <= 0 ? s.badgeDanger : s.badgeWarning}>
                  {p.stockQty <= 0 ? `⚠ ${t("inventory.outOfStock")}` : `⚠ ${t("alerts.lowStockBadge")}`}
                </Text>
              </View>
            ))
          )}

          <Text style={[s.sectionHeading, { marginTop: 16 }]}>
            {t("alerts.expired")} {expired.length > 0 ? `(${expired.length})` : ""}
          </Text>
          {expired.length === 0 ? (
            <Text style={s.emptyText}>{t("alerts.noExpired")}</Text>
          ) : (
            expired.map(p => (
              <View key={p.id} style={s.card}>
                <Text style={s.cardName}>{p.name}</Text>
                <Text style={s.cardMeta}>{t("products.expiryDate")}: {p.expiryDate}</Text>
                <Text style={s.badgeDanger}>⚠ {t("alerts.expiredBadge")}</Text>
              </View>
            ))
          )}

          <Text style={[s.sectionHeading, { marginTop: 16 }]}>
            {t("alerts.expiringSoon")} {expiringSoon.length > 0 ? `(${expiringSoon.length})` : ""}
          </Text>
          {expiringSoon.length === 0 ? (
            <Text style={s.emptyText}>{t("alerts.noExpiringSoon")}</Text>
          ) : (
            expiringSoon.map(p => (
              <View key={p.id} style={s.card}>
                <Text style={s.cardName}>{p.name}</Text>
                <Text style={s.cardMeta}>{t("products.expiryDate")}: {p.expiryDate}</Text>
                <Text style={s.badgeWarning}>
                  ⚠ {t("alerts.expiringInDays", { days: daysUntil(p.expiryDate!) })}
                </Text>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const makeStyles = (C: ThemeColors, isTablet: boolean) => StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  header:  { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, paddingBottom: 8, paddingTop: ANDROID_STATUS_BAR + (isTablet ? 6 : 10) },
  backBtn: { width: 34, height: 34, borderRadius: R.md, backgroundColor: C.card,
             alignItems: "center", justifyContent: "center",
             borderWidth: 1, borderColor: C.border },
  title:   { fontSize: F.xxl, fontWeight: "700", color: C.text },
  branchSubtitle: { color: C.accent, fontSize: F.xs, fontWeight: "700", marginTop: 2 },

  scroll: { padding: 16, paddingTop: 8, gap: 10 },
  emptyText: { color: C.muted, textAlign: "center", marginVertical: 12, fontSize: F.sm },

  sectionHeading: { color: C.muted, fontSize: F.xs, fontWeight: "700",
                    textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 },

  card: { backgroundColor: C.surface, borderRadius: R.lg, padding: 14,
          borderWidth: 1, borderColor: C.border, ...Shadow.sm, gap: 2 },
  cardName: { color: C.text, fontSize: F.sm, fontWeight: "700" },
  cardMeta: { color: C.muted, fontSize: F.xs },
  badgeDanger:  { color: C.danger,  fontSize: F.xs, fontWeight: "700", marginTop: 4 },
  badgeWarning: { color: C.warning, fontSize: F.xs, fontWeight: "700", marginTop: 4 },
});
