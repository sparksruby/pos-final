import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  StatusBar,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import appJson from "../../app.json";
import { useTheme, ThemeMode } from "../../src/context/ThemeContext";
import { useLanguage } from "../../src/context/LanguageContext";
import { useAlert } from "@/context/AlertContext";
import { useResponsive } from "../../src/hooks/useResponsive";
import { useAuthStore } from "../../src/store/authStore";
import { isAdmin } from "../../src/utils/permissions";
import { Language } from "../../src/i18n/translations";
import { F, R, Shadow, ThemeColors, withAlpha } from "../../src/theme";

const ANDROID_STATUS_BAR =
  Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) : 0;

type IconName = keyof typeof Ionicons.glyphMap;
type Styles = ReturnType<typeof makeStyles>;

// A settings destination. `tint` colours the icon and its tile: this
// screen is a list of a dozen-plus rows that are otherwise identical in
// shape, and colour is the only thing that lets someone find "Reports"
// without reading every label on the way down.
interface NavItem {
  icon: IconName;
  label: string;
  route: string;
  tint: string;
}

const NavRow = ({
  item,
  last,
  s,
}: {
  item: NavItem;
  last: boolean;
  s: Styles;
}) => (
  <TouchableOpacity
    style={[s.navRow, !last && s.navRowDivider]}
    onPress={() => router.push(item.route as never)}
    activeOpacity={0.7}
  >
    <View style={[s.navIcon, { backgroundColor: withAlpha(item.tint, 0.14) }]}>
      <Ionicons name={item.icon} size={17} color={item.tint} />
    </View>
    <Text style={s.navLabel} numberOfLines={1}>
      {item.label}
    </Text>
    <Ionicons
      name="chevron-forward"
      size={17}
      color={s.chevron.color as string}
    />
  </TouchableOpacity>
);

const NavCard = ({
  title,
  items,
  s,
}: {
  title?: string;
  items: NavItem[];
  s: Styles;
}) => (
  <View style={s.card}>
    {!!title && <Text style={s.section}>{title}</Text>}
    {items.map((item, i) => (
      <NavRow
        key={item.route}
        item={item}
        last={i === items.length - 1}
        s={s}
      />
    ))}
  </View>
);

export default function SettingsScreen() {
  const { colors: C, mode, setMode } = useTheme();
  const { lang, setLang, t } = useLanguage();
  const { alert } = useAlert();
  const { isTablet } = useResponsive();
  const s = React.useMemo(() => makeStyles(C, isTablet), [C, isTablet]);

  const { user, logout } = useAuthStore();
  const admin = isAdmin(user);

  const THEME_OPTIONS: { key: ThemeMode; label: string }[] = [
    { key: "light", label: t("settings.theme.light") },
    { key: "dark", label: t("settings.theme.dark") },
    { key: "system", label: t("settings.theme.system") },
  ];

  const LANG_OPTIONS: { key: Language; label: string }[] = [
    { key: "en", label: t("settings.language.en") },
    { key: "my", label: t("settings.language.my") },
  ];

  // Printer, Register, Products and Server Sync each used to sit in a card
  // of its own — four single-row cards in a row, each carrying a card's
  // full padding and border for one line of text. Grouped, they read as
  // one list and take about half the height.
  const generalItems: NavItem[] = [
    {
      icon: "print-outline",
      label: t("settings.printer"),
      route: "/(pos)/printer-settings",
      tint: C.accent,
    },
    {
      icon: "time-outline",
      label: t("shift.title"),
      route: "/(pos)/shift",
      tint: C.info,
    },
    {
      icon: "cube-outline",
      label: t("settings.products"),
      route: "/(pos)/products-manage",
      tint: C.success,
    },
    {
      icon: "cloud-outline",
      label: t("sync.title"),
      route: "/(pos)/sync-settings",
      tint: C.warning,
    },
    // Here rather than under Management, because the whole Management card
    // is admin-only and a cashier needs this one: checking a sale they just
    // rang up, reprinting a receipt, seeing the day before handing over.
    // The screen limits them to today and hides the export.
    {
      icon: "receipt-outline",
      label: t("salesHistory.title"),
      route: "/(pos)/sales-history",
      tint: C.info,
    },
  ];

  const managementItems: NavItem[] = [
    {
      icon: "bar-chart-outline",
      label: t("reports.title"),
      route: "/(pos)/reports",
      tint: C.info,
    },
    {
      icon: "trending-up-outline",
      label: t("analytics.title"),
      route: "/(pos)/analytics",
      tint: C.accent,
    },
    {
      icon: "calculator-outline",
      label: t("pl.title"),
      route: "/(pos)/profit-loss",
      tint: C.warning,
    },
    {
      icon: "layers-outline",
      label: t("inventory.title"),
      route: "/(pos)/inventory",
      tint: C.success,
    },
    {
      icon: "people-circle-outline",
      label: t("settings.customers"),
      route: "/(pos)/customers-manage",
      tint: C.accent,
    },
    {
      icon: "people-outline",
      label: t("settings.manageUsers"),
      route: "/(pos)/users-manage",
      tint: C.info,
    },
    {
      icon: "business-outline",
      label: t("branches.title"),
      route: "/(pos)/branches-manage",
      tint: C.accent,
    },
    {
      icon: "cart-outline",
      label: t("suppliers.title"),
      route: "/(pos)/suppliers-manage",
      tint: C.success,
    },
    {
      icon: "bag-handle-outline",
      label: t("purchases.title"),
      route: "/(pos)/purchases",
      tint: C.info,
    },
    {
      icon: "cash-outline",
      label: t("expenses.title"),
      route: "/(pos)/expenses",
      tint: C.warning,
    },
    {
      icon: "warning-outline",
      label: t("alerts.title"),
      route: "/(pos)/alerts",
      tint: C.danger,
    },
    {
      icon: "storefront-outline",
      label: t("settings.shopSettings"),
      route: "/(pos)/shop-settings",
      tint: C.accent,
    },
    {
      icon: "archive-outline",
      label: t("backup.title"),
      route: "/(pos)/backup",
      tint: C.muted,
    },
  ];

  const handleLogout = () => {
    alert(t("settings.logout"), t("settings.logoutConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("settings.logout"),
        style: "destructive",
        onPress: () => logout(),
      },
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
            <Text style={s.title}>{t("settings.title")}</Text>
          </View>

          {/* Account — the signed-in user is who this whole screen acts as,
              so it leads, as a filled panel rather than another list row. */}
          <View style={s.profileCard}>
            <View style={s.avatar}>
              <Text style={s.avatarLetter}>
                {(user?.name ?? "?").slice(0, 1).toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.profileName} numberOfLines={1}>
                {user?.name}
              </Text>
              <Text style={s.profileRole}>
                {user ? t(`users.role.${user.role}` as any) : ""}
              </Text>
            </View>
            <TouchableOpacity
              style={s.profileAction}
              onPress={() => router.push("/(pos)/change-password")}
            >
              <Ionicons name="key-outline" size={16} color={C.accent} />
              <Text style={s.profileActionText}>
                {t("settings.changePassword")}
              </Text>
            </TouchableOpacity>
          </View>

          <NavCard title={t("settings.general")} items={generalItems} s={s} />

          {admin && (
            <NavCard
              title={t("settings.management")}
              items={managementItems}
              s={s}
            />
          )}

          {/* Appearance and language were a card each; they are two answers
              to the same question — how this app should look and read — so
              they share one. */}
          <View style={s.card}>
            <Text style={s.section}>{t("settings.preferences")}</Text>

            <Text style={s.optionLabel}>{t("settings.appearance")}</Text>
            <View style={s.optionRow}>
              {THEME_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.key}
                  style={[s.optionBtn, mode === opt.key && s.optionActive]}
                  onPress={() => setMode(opt.key)}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[
                      s.optionText,
                      mode === opt.key && s.optionActiveText,
                    ]}
                  >
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[s.optionLabel, { marginTop: 16 }]}>
              {t("settings.language")}
            </Text>
            <View style={s.optionRow}>
              {LANG_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.key}
                  style={[s.optionBtn, lang === opt.key && s.optionActive]}
                  onPress={() => setLang(opt.key)}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[
                      s.optionText,
                      lang === opt.key && s.optionActiveText,
                    ]}
                  >
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <TouchableOpacity
            style={s.logoutBtn}
            onPress={handleLogout}
            activeOpacity={0.85}
          >
            <Ionicons name="log-out-outline" size={18} color={C.danger} />
            <Text style={s.logoutBtnText}>{t("settings.logout")}</Text>
          </TouchableOpacity>

          {/* Version, set as a footnote rather than a card: it is the one
              thing here nobody came looking for. */}
          <Text style={s.versionText}>
            {t("app.name")} · {t("settings.version")} {appJson.expo.version}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (C: ThemeColors, isTablet: boolean) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },
    scrollOuter: { flexGrow: 1, alignItems: "center" },
    scroll: { padding: 16, gap: 14, paddingBottom: 40, width: "100%" },
    scrollTablet: { maxWidth: 640 },

    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      marginBottom: 2,
      paddingTop: ANDROID_STATUS_BAR + (isTablet ? 6 : 10),
    },
    backBtn: {
      width: 36,
      height: 36,
      borderRadius: R.md,
      backgroundColor: C.surface,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: C.border,
    },
    title: { fontSize: F.xxl, fontWeight: "800", color: C.text, flex: 1 },

    profileCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      backgroundColor: C.surface,
      borderRadius: R.xl,
      padding: 14,
      borderWidth: 1,
      borderColor: C.border,
      ...Shadow.sm,
    },
    avatar: {
      width: 46,
      height: 46,
      borderRadius: 23,
      backgroundColor: C.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarLetter: { color: C.accentFg, fontSize: F.lg, fontWeight: "800" },
    profileName: { color: C.text, fontSize: F.lg, fontWeight: "800" },
    profileRole: {
      color: C.muted,
      fontSize: F.xs,
      marginTop: 2,
      textTransform: "uppercase",
      letterSpacing: 0.6,
      fontWeight: "700",
    },
    profileAction: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      backgroundColor: C.accentSoft,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: R.full,
    },
    profileActionText: { color: C.accent, fontSize: F.xs, fontWeight: "700" },

    card: {
      backgroundColor: C.surface,
      borderRadius: R.xl,
      paddingHorizontal: 14,
      paddingVertical: 6,
      borderWidth: 1,
      borderColor: C.border,
      ...Shadow.sm,
    },
    section: {
      color: C.muted,
      fontSize: F.xs,
      fontWeight: "800",
      textTransform: "uppercase",
      letterSpacing: 0.8,
      marginTop: 12,
      marginBottom: 4,
    },

    navRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingVertical: 11,
    },
    navRowDivider: { borderBottomWidth: 1, borderBottomColor: C.border },
    navIcon: {
      width: 32,
      height: 32,
      borderRadius: R.md,
      alignItems: "center",
      justifyContent: "center",
    },
    navLabel: { color: C.text, fontSize: F.md, fontWeight: "600", flex: 1 },
    // Not applied to a view — a slot for handing the chevron's colour to
    // NavRow, which has the stylesheet but not the palette.
    chevron: { color: C.muted },

    optionLabel: {
      color: C.textSub,
      fontSize: F.sm,
      fontWeight: "700",
      marginBottom: 8,
    },
    optionRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
    optionBtn: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: R.md,
      backgroundColor: C.card,
      alignItems: "center",
      borderWidth: 1,
      borderColor: C.border,
    },
    optionActive: { backgroundColor: C.accent, borderColor: C.accent },
    optionText: { color: C.textSub, fontSize: F.sm, fontWeight: "700" },
    optionActiveText: { color: C.accentFg },

    // Outlined rather than a solid red bar. Logging out is reversible and
    // routine; a filled danger button that size was the loudest thing on the
    // screen and read as a warning about itself.
    logoutBtn: {
      flexDirection: "row",
      gap: 8,
      backgroundColor: C.surface,
      borderRadius: R.lg,
      paddingVertical: 14,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: C.border,
    },
    logoutBtnText: { color: C.danger, fontSize: F.md, fontWeight: "800" },

    versionText: {
      color: C.muted,
      fontSize: F.xs,
      textAlign: "center",
      marginTop: 2,
    },
  });
