import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Modal,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Redirect, router } from "expo-router";
import {
  analyticsRepo,
  ALL_BRANCHES,
  type BranchScope,
  type ScopedFigures,
} from "../../src/db/analyticsRepo";
import { DatePickerModal } from "../../src/components/DatePickerModal";
import { toDateKey, anchorFromDateKey } from "../../src/utils/reportPeriods";
import { useBranchStore } from "../../src/store/branchStore";
import { useShopStore } from "@/store/shopStore";
import { useAuthStore } from "../../src/store/authStore";
import { useTheme } from "../../src/context/ThemeContext";
import { useLanguage } from "../../src/context/LanguageContext";
import { useResponsive } from "../../src/hooks/useResponsive";
import { isAdmin } from "../../src/utils/permissions";
import { F, R, Shadow, ThemeColors } from "../../src/theme";

const ANDROID_STATUS_BAR =
  Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) : 0;

type Mode = "daily" | "monthly" | "yearly";

const boundsFor = (mode: Mode, day: Date): { from: string; to: string } => {
  const y = day.getFullYear();
  const m = day.getMonth();
  if (mode === "daily") {
    const from = new Date(y, m, day.getDate(), 0, 0, 0, 0);
    const to = new Date(y, m, day.getDate(), 23, 59, 59, 999);
    return { from: from.toISOString(), to: to.toISOString() };
  }
  if (mode === "monthly") {
    return {
      from: new Date(y, m, 1, 0, 0, 0, 0).toISOString(),
      to: new Date(y, m + 1, 0, 23, 59, 59, 999).toISOString(),
    };
  }
  return {
    from: new Date(y, 0, 1, 0, 0, 0, 0).toISOString(),
    to: new Date(y, 11, 31, 23, 59, 59, 999).toISOString(),
  };
};

/**
 * The statement a shopkeeper reads to answer one question: did I make money.
 *
 * Laid out the way a profit and loss account is, because the order is the
 * argument — takings, then what those goods cost, then what it cost to keep
 * the doors open, and only then the number at the bottom. A screen that
 * leads with the bottom line teaches nobody where it came from.
 *
 * Stock bought sits below the statement, not inside it. See the note at the
 * top of analyticsRepo for why folding it in turns every restocking month
 * into a fictional loss.
 */
export default function ProfitLossScreen() {
  const { colors: C } = useTheme();
  const { t } = useLanguage();
  const { isTablet } = useResponsive();
  const s = React.useMemo(() => makeStyles(C, isTablet), [C, isTablet]);
  const { user } = useAuthStore();
  const currency = useShopStore((state) => state.settings?.currency ?? "$");

  const branches = useBranchStore((state) => state.branches);

  const [mode, setMode] = useState<Mode>("daily");
  const [day, setDay] = useState(() => new Date());
  const [branchFilter, setBranchFilter] = useState<number | "all">("all");
  const [branchPickerOpen, setBranchPickerOpen] = useState(false);
  const [figures, setFigures] = useState<ScopedFigures | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  // False on an ordinary branch device, which holds no other branch's
  // history — see analyticsRepo.canScopeByBranch.
  const [canScope, setCanScope] = useState(false);

  useEffect(() => {
    analyticsRepo.canScopeByBranch().then(setCanScope);
  }, []);

  const selectedBranch = branches.find((b) => b.id === branchFilter);
  const branchLabel = selectedBranch?.name ?? t("reports.allBranches");

  const scope: BranchScope = useMemo(
    () =>
      selectedBranch
        ? { kind: "branch", id: selectedBranch.id, name: selectedBranch.name }
        : ALL_BRANCHES,
    [selectedBranch?.id, selectedBranch?.name],
  );

  useEffect(() => {
    setIsLoading(true);
    const { from, to } = boundsFor(mode, day);
    analyticsRepo
      .getScopedFigures(from, to, scope)
      .then(setFigures)
      .finally(() => setIsLoading(false));
  }, [mode, day, scope]);

  if (!isAdmin(user)) return <Redirect href="/(pos)/" />;

  const money = (n: number) => `${currency}${Math.round(n).toLocaleString()}`;
  const margin =
    figures && figures.netRevenue > 0
      ? (figures.netProfit / figures.netRevenue) * 100
      : null;

  const periodLabel =
    mode === "daily"
      ? day.toDateString()
      : mode === "monthly"
        ? day.toLocaleDateString(undefined, { month: "long", year: "numeric" })
        : String(day.getFullYear());

  const step = (delta: number) => {
    const next = new Date(day);
    if (mode === "daily") next.setDate(next.getDate() + delta);
    else if (mode === "monthly") next.setMonth(next.getMonth() + delta);
    else next.setFullYear(next.getFullYear() + delta);
    if (next <= new Date()) setDay(next);
  };

  const atToday = (() => {
    const now = new Date();
    if (mode === "daily") return day.toDateString() === now.toDateString();
    if (mode === "monthly") {
      return (
        day.getFullYear() === now.getFullYear() &&
        day.getMonth() === now.getMonth()
      );
    }
    return day.getFullYear() === now.getFullYear();
  })();

  return (
    <SafeAreaView style={s.root}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={20} color={C.textSub} />
        </TouchableOpacity>
        <Text style={s.title}>{t("pl.title")}</Text>
      </View>

      <ScrollView contentContainerStyle={s.scroll}>
        <View style={s.controlRow}>
          <View style={s.modeRow}>
            {(["daily", "monthly", "yearly"] as Mode[]).map((m) => (
              <TouchableOpacity
                key={m}
                style={[s.modeBtn, mode === m && s.modeBtnActive]}
                onPress={() => setMode(m)}
                activeOpacity={0.8}
              >
                <Text style={[s.modeText, mode === m && s.modeTextActive]}>
                  {t(`pl.mode.${m}` as never)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {canScope && branches.length > 1 && (
            <TouchableOpacity
              style={s.branchBtn}
              onPress={() => setBranchPickerOpen(true)}
              activeOpacity={0.8}
            >
              <Ionicons name="business-outline" size={14} color={C.textSub} />
              <Text style={s.branchBtnText} numberOfLines={1}>
                {branchLabel}
              </Text>
              <Ionicons name="chevron-down" size={13} color={C.muted} />
            </TouchableOpacity>
          )}
        </View>

        <View style={s.navRow}>
          <TouchableOpacity style={s.navBtn} onPress={() => step(-1)}>
            <Ionicons name="chevron-back" size={18} color={C.text} />
          </TouchableOpacity>
          {/* Open in every mode, not only Daily. The date behind the label
              is a date whatever the mode is — picking any day in March
              while Monthly is selected opens March — and the arrows alone
              meant twelve taps to reach last year. */}
          <TouchableOpacity
            style={s.navLabelBtn}
            onPress={() => setPickerOpen(true)}
            activeOpacity={0.7}
          >
            <Text style={s.navLabel}>{periodLabel}</Text>
            <Ionicons name="calendar-outline" size={15} color={C.muted} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.navBtn, atToday && s.navBtnOff]}
            onPress={() => step(1)}
            disabled={atToday}
          >
            <Ionicons name="chevron-forward" size={18} color={C.text} />
          </TouchableOpacity>
        </View>

        {isLoading ? (
          <ActivityIndicator color={C.accent} style={{ marginTop: 48 }} />
        ) : !figures ? null : (
          <>
            <View style={s.statRow}>
              <View style={s.stat}>
                <Text style={s.statLabel}>{t("pl.revenue")}</Text>
                <Text
                  style={s.statValue}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.6}
                >
                  {money(figures.netRevenue)}
                </Text>
              </View>
              <View style={s.stat}>
                <Text style={s.statLabel}>{t("pl.netProfit")}</Text>
                <Text
                  style={[
                    s.statValue,
                    { color: figures.netProfit < 0 ? C.danger : C.success },
                  ]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.6}
                >
                  {money(figures.netProfit)}
                </Text>
                {margin !== null && (
                  <Text style={s.statMeta}>
                    {t("pl.margin", { value: margin.toFixed(1) })}
                  </Text>
                )}
              </View>
            </View>

            <View style={s.card}>
              <Text style={s.cardTitle}>{t("pl.breakdown")}</Text>

              <Line
                s={s}
                label={t("pl.grossSales")}
                value={money(figures.revenue)}
              />
              {figures.refunds > 0 && (
                <Line
                  s={s}
                  label={t("pl.refunds")}
                  value={`− ${money(figures.refunds)}`}
                />
              )}
              <Line
                s={s}
                label={t("pl.netSales")}
                value={money(figures.netRevenue)}
              />
              <Line
                s={s}
                label={t("pl.costOfSales")}
                value={`− ${money(figures.costOfSales)}`}
              />

              <View style={[s.line, s.lineHighlight]}>
                <Text style={s.lineLabelStrong}>{t("pl.grossProfit")}</Text>
                <Text
                  style={[
                    s.lineValueStrong,
                    { color: figures.grossProfit < 0 ? C.danger : C.success },
                  ]}
                >
                  {money(figures.grossProfit)}
                </Text>
              </View>

              <Line
                s={s}
                label={t("pl.staffCosts")}
                value={`− ${money(figures.staffCosts)}`}
              />
              <Line
                s={s}
                label={t("pl.otherExpenses")}
                value={`− ${money(figures.otherExpenses)}`}
              />

              <View style={[s.line, s.lineHighlight, s.lineLast]}>
                <Text style={s.lineLabelStrong}>{t("pl.netProfit")}</Text>
                <Text
                  style={[
                    s.lineValueStrong,
                    { color: figures.netProfit < 0 ? C.danger : C.success },
                  ]}
                >
                  {money(figures.netProfit)}
                </Text>
              </View>
            </View>

            <View style={s.noteBox}>
              <View style={s.noteRow}>
                <Text style={s.noteLabel}>{t("analytics.stockPurchased")}</Text>
                {/* Read through the sync, a branch has no stock purchases to
                    show. The 0 it would otherwise print says "bought
                    nothing", which is a claim this screen cannot make. */}
                <Text
                  style={[
                    s.noteValue,
                    figures.source === "mirror" && s.noteValueMissing,
                  ]}
                >
                  {figures.source === "mirror"
                    ? t("analytics.notAvailable")
                    : money(figures.stockPurchased)}
                </Text>
              </View>
              <Text style={s.noteText}>
                {figures.source === "mirror"
                  ? t("analytics.mirrorNote", { branch: branchLabel })
                  : t("analytics.stockNote")}
              </Text>
            </View>

            {figures.source === "mixed" && (
              <Text style={s.footnote}>{t("analytics.mixedNote")}</Text>
            )}

            {/* The same caveat the Reports screen carries, for the same
                reason: the number is close enough to steer a shop and wrong
                enough to keep out of a tax return. */}
            <Text style={s.footnote}>{t("pl.costNote")}</Text>
          </>
        )}
      </ScrollView>

      <Modal
        visible={branchPickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setBranchPickerOpen(false)}
      >
        <TouchableOpacity
          style={s.pickerOverlay}
          activeOpacity={1}
          onPress={() => setBranchPickerOpen(false)}
        >
          <View style={s.pickerSheet}>
            <Text style={s.pickerTitle}>{t("reports.byBranch")}</Text>
            <TouchableOpacity
              style={s.pickerRow}
              onPress={() => {
                setBranchFilter("all");
                setBranchPickerOpen(false);
              }}
            >
              <Text
                style={[
                  s.pickerRowText,
                  branchFilter === "all" && s.pickerRowTextActive,
                ]}
              >
                {t("reports.allBranches")}
              </Text>
              {branchFilter === "all" && (
                <Ionicons name="checkmark" size={16} color={C.accent} />
              )}
            </TouchableOpacity>
            {branches.map((b) => (
              <TouchableOpacity
                key={b.id}
                style={s.pickerRow}
                onPress={() => {
                  setBranchFilter(b.id);
                  setBranchPickerOpen(false);
                }}
              >
                <Text
                  style={[
                    s.pickerRowText,
                    branchFilter === b.id && s.pickerRowTextActive,
                  ]}
                  numberOfLines={1}
                >
                  {b.name}
                </Text>
                {branchFilter === b.id && (
                  <Ionicons name="checkmark" size={16} color={C.accent} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      <DatePickerModal
        visible={pickerOpen}
        value={toDateKey(day)}
        onClose={() => setPickerOpen(false)}
        onSelect={(key) => {
          setDay(anchorFromDateKey(key));
          setPickerOpen(false);
        }}
      />
    </SafeAreaView>
  );
}

const Line = ({
  s,
  label,
  value,
}: {
  s: ReturnType<typeof makeStyles>;
  label: string;
  value: string;
}) => (
  <View style={s.line}>
    <Text style={s.lineLabel}>{label}</Text>
    <Text style={s.lineValue}>{value}</Text>
  </View>
);

const makeStyles = (C: ThemeColors, isTablet: boolean) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      padding: 16,
      paddingBottom: 8,
      paddingTop: ANDROID_STATUS_BAR + (isTablet ? 6 : 10),
    },
    backBtn: {
      width: 34,
      height: 34,
      borderRadius: R.md,
      backgroundColor: C.card,
      alignItems: "center",
      justifyContent: "center",
    },
    title: { color: C.text, fontSize: F.lg, fontWeight: "800" },
    scroll: { padding: 16, paddingTop: 8, gap: 14, paddingBottom: 40 },

    controlRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    modeRow: { flex: 1, flexDirection: "row", gap: 8 },
    modeBtn: {
      flex: 1,
      paddingVertical: 9,
      borderRadius: R.md,
      alignItems: "center",
      backgroundColor: C.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: C.border,
    },
    modeBtnActive: { backgroundColor: C.accent, borderColor: C.accent },
    modeText: { color: C.textSub, fontSize: F.sm, fontWeight: "700" },
    modeTextActive: { color: C.accentFg },

    branchBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      maxWidth: 140,
      paddingHorizontal: 11,
      paddingVertical: 9,
      borderRadius: R.md,
      backgroundColor: C.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: C.border,
    },
    branchBtnText: {
      color: C.text,
      fontSize: F.xs,
      fontWeight: "700",
      flexShrink: 1,
    },

    pickerOverlay: {
      flex: 1,
      backgroundColor: C.overlay,
      justifyContent: "center",
      padding: 32,
    },
    pickerSheet: {
      backgroundColor: C.card,
      borderRadius: R.lg,
      padding: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: C.border,
      ...Shadow.lg,
    },
    pickerTitle: {
      color: C.muted,
      fontSize: F.xs,
      fontWeight: "700",
      letterSpacing: 0.6,
      textTransform: "uppercase",
      paddingHorizontal: 12,
      paddingTop: 8,
      paddingBottom: 6,
    },
    pickerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 12,
      paddingVertical: 12,
      borderRadius: R.sm,
    },
    pickerRowText: { color: C.text, fontSize: F.md, flexShrink: 1 },
    pickerRowTextActive: { color: C.accent, fontWeight: "700" },

    navRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    navBtn: {
      width: 34,
      height: 34,
      borderRadius: R.md,
      backgroundColor: C.card,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: C.border,
    },
    navBtnOff: { opacity: 0.35 },
    navLabelBtn: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      paddingVertical: 9,
      borderRadius: R.md,
      backgroundColor: C.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: C.border,
    },
    navLabel: { color: C.text, fontSize: F.sm, fontWeight: "700" },

    statRow: { flexDirection: "row", gap: 10 },
    stat: {
      flex: 1,
      backgroundColor: C.card,
      borderRadius: R.lg,
      padding: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: C.border,
      ...Shadow.sm,
    },
    statLabel: {
      color: C.muted,
      fontSize: F.xs,
      fontWeight: "700",
      letterSpacing: 0.6,
      textTransform: "uppercase",
      marginBottom: 6,
    },
    statValue: { color: C.text, fontSize: F.xl, fontWeight: "800" },
    statMeta: { color: C.muted, fontSize: F.xs, marginTop: 2 },

    card: {
      backgroundColor: C.card,
      borderRadius: R.lg,
      padding: 6,
      paddingTop: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: C.border,
      ...Shadow.sm,
    },
    cardTitle: {
      color: C.muted,
      fontSize: F.xs,
      fontWeight: "700",
      letterSpacing: 0.6,
      textTransform: "uppercase",
      paddingHorizontal: 10,
      marginBottom: 6,
    },
    line: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 10,
      paddingVertical: 11,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: C.border,
    },
    lineLast: { borderBottomWidth: 0 },
    lineHighlight: { backgroundColor: C.surface, borderRadius: R.sm },
    lineLabel: { color: C.textSub, fontSize: F.md },
    lineValue: { color: C.text, fontSize: F.md },
    lineLabelStrong: { color: C.text, fontSize: F.md, fontWeight: "800" },
    lineValueStrong: { fontSize: F.lg, fontWeight: "800" },

    noteBox: {
      padding: 14,
      borderRadius: R.lg,
      backgroundColor: C.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: C.border,
      gap: 6,
    },
    noteRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    noteLabel: { color: C.text, fontSize: F.md, fontWeight: "700" },
    noteValue: { color: C.warning, fontSize: F.lg, fontWeight: "800" },
    noteValueMissing: { color: C.muted, fontSize: F.sm, fontWeight: "700" },
    noteText: { color: C.muted, fontSize: F.xs, lineHeight: 17 },

    footnote: {
      color: C.muted,
      fontSize: F.xs,
      lineHeight: 17,
      paddingHorizontal: 4,
    },
  });
