import React, { useEffect, useState } from "react";
import {
  View, Text, TouchableOpacity, TextInput, Modal,
  StyleSheet, SafeAreaView, ScrollView,
  ActivityIndicator, Platform, StatusBar,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { shiftsRepo, ShiftAlreadyOpenError } from "../../src/db/shiftsRepo";
import { useShopStore } from "@/store/shopStore";
import { useAuthStore } from "../../src/store/authStore";
import { useTheme } from "../../src/context/ThemeContext";
import { useLanguage } from "../../src/context/LanguageContext";
import { useAlert } from "@/context/AlertContext";
import { useResponsive } from "../../src/hooks/useResponsive";
import { isAdmin } from "../../src/utils/permissions";
import { F, R, Shadow, ThemeColors } from "../../src/theme";
import type { Shift, ShiftSummary } from "../../src/types";

const ANDROID_STATUS_BAR =
  Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) : 0;

export default function ShiftScreen() {
  const { colors: C } = useTheme();
  const { t } = useLanguage();
  const { alert } = useAlert();
  const { isTablet } = useResponsive();
  const s = React.useMemo(() => makeStyles(C, isTablet), [C, isTablet]);
  const currency = useShopStore(state => state.settings?.currency ?? "$");
  const { user } = useAuthStore();
  const admin = isAdmin(user);

  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState<Shift | null>(null);
  const [summary, setSummary] = useState<ShiftSummary | null>(null);
  const [history, setHistory] = useState<Shift[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const open = await shiftsRepo.getOpenShift();
      setCurrent(open);
      setSummary(open ? await shiftsRepo.getSummary(open.id) : null);
      setHistory(await shiftsRepo.getShifts(admin ? { limit: 20 } : { cashierId: user?.id, limit: 20 }));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // ── Start shift ──────────────────────────────────────────────────────────
  const [startModalOpen, setStartModalOpen] = useState(false);
  const [openingCash, setOpeningCash] = useState("0");
  const [starting, setStarting] = useState(false);

  const confirmStart = async () => {
    setStarting(true);
    try {
      await shiftsRepo.openShift(Number(openingCash) || 0, user?.id, user?.name);
      setStartModalOpen(false);
      setOpeningCash("0");
      await load();
    } catch (e) {
      const message = e instanceof ShiftAlreadyOpenError ? t("shift.alreadyOpen") : t("common.error");
      alert(t("common.error"), message);
    } finally {
      setStarting(false);
    }
  };

  // ── Close shift ──────────────────────────────────────────────────────────
  const [closeModalOpen, setCloseModalOpen] = useState(false);
  const [closingCash, setClosingCash] = useState("0");
  const [closeNotes, setCloseNotes] = useState("");
  const [closing, setClosing] = useState(false);

  const openCloseModal = () => {
    setClosingCash(summary ? String(summary.expectedCash) : "0");
    setCloseNotes("");
    setCloseModalOpen(true);
  };

  const closingDiff = (Number(closingCash) || 0) - (summary?.expectedCash ?? 0);

  const confirmClose = async () => {
    if (!current) return;
    setClosing(true);
    try {
      await shiftsRepo.closeShift(current.id, Number(closingCash) || 0, closeNotes.trim() || undefined);
      setCloseModalOpen(false);
      await load();
    } catch {
      alert(t("common.error"), t("common.error"));
    } finally {
      setClosing(false);
    }
  };

  return (
    <SafeAreaView style={s.root}>
      <ScrollView contentContainerStyle={s.scrollOuter}>
        <View style={[s.scroll, isTablet && s.scrollTablet]}>

          <View style={s.header}>
            <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
              <Ionicons name="arrow-back" size={20} color={C.textSub} />
            </TouchableOpacity>
            <Text style={s.title}>{t("shift.title")}</Text>
          </View>

          {loading ? (
            <ActivityIndicator color={C.accent} style={{ marginTop: 30 }} />
          ) : current && summary ? (
            <>
              <View style={s.card}>
                <View style={s.openRow}>
                  <View style={s.openDot} />
                  <Text style={s.openLabel}>{t("shift.open")}</Text>
                </View>
                <Text style={s.metaText}>
                  {t("shift.openedBy", { name: current.cashierName || t("reports.unknownCashier") })}
                  {" · "}{new Date(current.openedAt).toLocaleString()}
                </Text>

                <View style={s.divider} />
                <SumRow s={s} label={t("shift.openingCash")} value={`${currency}${current.openingCash.toLocaleString()}`} />
                <SumRow s={s} label={t("shift.cashSales")} value={`${currency}${summary.cashSales.toLocaleString()}`} />
                {summary.splitCashSales > 0 &&
                  <SumRow s={s} label={t("shift.splitCashSales")} value={`${currency}${summary.splitCashSales.toLocaleString()}`} />}
                <SumRow s={s} label={t("shift.cardSales")} value={`${currency}${summary.cardSales.toLocaleString()}`} />
                <SumRow s={s} label={t("shift.qrSales")} value={`${currency}${summary.qrSales.toLocaleString()}`} />
                {summary.refundsTotal > 0 &&
                  <SumRow s={s} label={t("shift.refunds")} value={`-${currency}${summary.refundsTotal.toLocaleString()}`} danger C={C} />}
                <View style={s.divider} />
                <SumRow s={s} label={t("shift.expectedCash")} value={`${currency}${summary.expectedCash.toLocaleString()}`} accent C={C} large />
                <Text style={s.metaText}>{t("shift.salesCount", { count: summary.salesCount })}</Text>
              </View>

              <TouchableOpacity style={s.closeBtn} onPress={openCloseModal} activeOpacity={0.85}>
                <Ionicons name="lock-closed-outline" size={18} color="#fff" />
                <Text style={s.closeBtnText}>{t("shift.closeShift")}</Text>
              </TouchableOpacity>
            </>
          ) : (
            <View style={s.card}>
              <Text style={s.noShiftText}>{t("shift.noOpenShift")}</Text>
              <TouchableOpacity
                style={s.startBtn}
                onPress={() => setStartModalOpen(true)}
                activeOpacity={0.85}
              >
                <Ionicons name="play-circle-outline" size={18} color={C.accentFg} />
                <Text style={s.startBtnText}>{t("shift.startShift")}</Text>
              </TouchableOpacity>
            </View>
          )}

          {history.length > 0 && (
            <View style={s.card}>
              <Text style={s.section}>{t("shift.history")}</Text>
              {history.map(shift => (
                <View key={shift.id} style={s.historyRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.historyDate}>{new Date(shift.openedAt).toLocaleDateString()}</Text>
                    <Text style={s.historySub}>
                      {shift.cashierName || t("reports.unknownCashier")}
                      {shift.status === "open" ? ` · ${t("shift.open")}` : ""}
                    </Text>
                  </View>
                  {shift.status === "closed" && shift.difference !== undefined && (
                    <Text style={[
                      s.historyDiff,
                      Math.abs(shift.difference) < 0.01 ? { color: C.success } : { color: C.danger },
                    ]}>
                      {shift.difference >= 0 ? "+" : ""}{currency}{shift.difference.toLocaleString()}
                    </Text>
                  )}
                </View>
              ))}
            </View>
          )}

        </View>
      </ScrollView>

      {/* Start shift */}
      <Modal visible={startModalOpen} transparent animationType="fade" onRequestClose={() => setStartModalOpen(false)}>
        <View style={s.modalOverlay}>
          <View style={s.modalBox}>
            <Text style={s.modalTitle}>{t("shift.startShift")}</Text>
            <Text style={s.label}>{t("shift.openingCash")}</Text>
            <TextInput
              style={s.input}
              keyboardType="numeric"
              value={openingCash}
              onChangeText={setOpeningCash}
              placeholder="0"
              placeholderTextColor={C.muted}
              autoFocus
              selectTextOnFocus
            />
            <View style={s.modalBtnRow}>
              <TouchableOpacity style={s.modalCancelBtn} onPress={() => setStartModalOpen(false)}>
                <Text style={s.modalCancelText}>{t("common.cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.modalConfirmBtn} onPress={confirmStart} disabled={starting}>
                {starting
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={s.modalConfirmText}>{t("shift.startShift")}</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Close shift */}
      <Modal visible={closeModalOpen} transparent animationType="fade" onRequestClose={() => setCloseModalOpen(false)}>
        <View style={s.modalOverlay}>
          <View style={s.modalBox}>
            <Text style={s.modalTitle}>{t("shift.closeShift")}</Text>

            <SumRow s={s} label={t("shift.expectedCash")} value={`${currency}${(summary?.expectedCash ?? 0).toLocaleString()}`} />

            <Text style={[s.label, { marginTop: 10 }]}>{t("shift.closingCash")}</Text>
            <TextInput
              style={s.input}
              keyboardType="numeric"
              value={closingCash}
              onChangeText={setClosingCash}
              placeholder="0"
              placeholderTextColor={C.muted}
              selectTextOnFocus
            />
            <Text style={[
              s.diffText,
              Math.abs(closingDiff) < 0.01 ? { color: C.success } : { color: C.danger },
            ]}>
              {Math.abs(closingDiff) < 0.01
                ? t("shift.balanced")
                : closingDiff > 0
                ? t("shift.over", { amount: `${currency}${closingDiff.toLocaleString()}` })
                : t("shift.short", { amount: `${currency}${Math.abs(closingDiff).toLocaleString()}` })
              }
            </Text>

            <Text style={[s.label, { marginTop: 10 }]}>{t("shift.notes")}</Text>
            <TextInput
              style={s.input}
              value={closeNotes}
              onChangeText={setCloseNotes}
              placeholder={t("shift.notesPlaceholder")}
              placeholderTextColor={C.muted}
            />

            <View style={s.modalBtnRow}>
              <TouchableOpacity style={s.modalCancelBtn} onPress={() => setCloseModalOpen(false)}>
                <Text style={s.modalCancelText}>{t("common.cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.modalConfirmBtn} onPress={confirmClose} disabled={closing}>
                {closing
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={s.modalConfirmText}>{t("shift.closeShift")}</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Summary row ──────────────────────────────────────────────────────────────

const SumRow = ({
  s, C, label, value, accent, danger, large,
}: {
  s: Styles; label: string; value: string;
  C?: ThemeColors; accent?: boolean; danger?: boolean; large?: boolean;
}) => (
  <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 }}>
    <Text style={[s.sumLabel, large && { fontWeight: "800" }]}>{label}</Text>
    <Text style={[
      s.sumValue,
      accent && C && { color: C.accent },
      danger && C && { color: C.danger },
      large  && { fontSize: F.lg, fontWeight: "800" },
    ]}>{value}</Text>
  </View>
);

// ─── Styles ───────────────────────────────────────────────────────────────────

type Styles = ReturnType<typeof makeStyles>;

const makeStyles = (C: ThemeColors, isTablet: boolean) => StyleSheet.create({
  root:   { flex: 1, backgroundColor: C.bg },
  scrollOuter: { flexGrow: 1, alignItems: "center" },
  scroll: { padding: 16, gap: 14, paddingBottom: 40, width: "100%" },
  scrollTablet: { maxWidth: 640 },

  header:  { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 4, paddingTop: ANDROID_STATUS_BAR + (isTablet ? 6 : 10) },
  backBtn: { width: 34, height: 34, borderRadius: R.md, backgroundColor: C.card,
             alignItems: "center", justifyContent: "center",
             borderWidth: 1, borderColor: C.border },
  title:   { fontSize: F.xxl, fontWeight: "700", color: C.text, flex: 1 },

  card:    { backgroundColor: C.surface, borderRadius: R.lg, padding: 16,
             borderWidth: 1, borderColor: C.border, ...Shadow.sm },
  section: { color: C.muted, fontSize: F.xs, fontWeight: "700",
             textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 },

  openRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  openDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.success },
  openLabel: { color: C.success, fontSize: F.sm, fontWeight: "800" },
  metaText: { color: C.muted, fontSize: F.xs, marginTop: 4 },

  divider: { height: 1, backgroundColor: C.border, marginVertical: 8 },
  sumLabel: { color: C.text, fontSize: F.sm },
  sumValue: { color: C.text, fontSize: F.sm, fontWeight: "700" },

  noShiftText: { color: C.muted, fontSize: F.sm, textAlign: "center", marginBottom: 14 },
  startBtn: { flexDirection: "row", gap: 8, backgroundColor: C.accent, borderRadius: R.lg,
              paddingVertical: 14, alignItems: "center", justifyContent: "center", ...Shadow.sm },
  startBtnText: { color: C.accentFg, fontSize: F.md, fontWeight: "800" },

  closeBtn: { flexDirection: "row", gap: 8, backgroundColor: C.danger, borderRadius: R.lg,
              paddingVertical: 16, alignItems: "center", justifyContent: "center", ...Shadow.md },
  closeBtnText: { color: "#fff", fontSize: F.lg, fontWeight: "800" },

  historyRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8,
                borderTopWidth: 1, borderTopColor: C.border },
  historyDate: { color: C.text, fontSize: F.sm, fontWeight: "600" },
  historySub:  { color: C.muted, fontSize: F.xs, marginTop: 2 },
  historyDiff: { fontSize: F.sm, fontWeight: "800" },

  modalOverlay: { flex: 1, backgroundColor: C.overlay, alignItems: "center", justifyContent: "center", padding: 24 },
  modalBox: { backgroundColor: C.surface, borderRadius: R.lg, padding: 18, width: "100%", maxWidth: 360,
              gap: 4, borderWidth: 1, borderColor: C.border, ...Shadow.lg },
  modalTitle: { color: C.text, fontSize: F.md, fontWeight: "700", marginBottom: 8 },

  label: { color: C.textSub, fontSize: F.sm, fontWeight: "600", marginBottom: 6 },
  input: { backgroundColor: C.card, borderRadius: R.md, padding: 12,
           color: C.text, fontSize: F.md, borderWidth: 1, borderColor: C.border },
  diffText: { fontSize: F.sm, fontWeight: "800", textAlign: "right", marginTop: 6 },

  modalBtnRow: { flexDirection: "row", gap: 10, marginTop: 16 },
  modalCancelBtn: { flex: 1, paddingVertical: 12, borderRadius: R.md, backgroundColor: C.card,
                    alignItems: "center", borderWidth: 1, borderColor: C.border },
  modalCancelText: { color: C.textSub, fontSize: F.sm, fontWeight: "700" },
  modalConfirmBtn: { flex: 1, paddingVertical: 12, borderRadius: R.md, backgroundColor: C.accent,
                     alignItems: "center" },
  modalConfirmText: { color: C.accentFg, fontSize: F.sm, fontWeight: "700" },
});
