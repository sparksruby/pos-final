import React, { useState } from "react";
import { Modal, View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../context/ThemeContext";
import { useLanguage } from "../context/LanguageContext";
import { F, R, Shadow, ThemeColors } from "../theme";

interface Props {
  visible:    boolean;
  /** Currently selected date, "YYYY-MM-DD", or empty/undefined for none. */
  value?:     string;
  onSelect:   (date: string) => void;
  /** Only shown when the field this picker is attached to is optional. */
  onClear?:   () => void;
  onClose:    () => void;
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const fmt = (y: number, m: number, d: number) => `${y}-${pad2(m + 1)}-${pad2(d)}`;
const todayStr = () => {
  const t = new Date();
  return fmt(t.getFullYear(), t.getMonth(), t.getDate());
};

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

// Simple month-grid calendar, no native dependency — matches the app's
// existing bottom-sheet modal styling (see products-manage.tsx and
// friends) rather than a platform date picker, so it looks identical on
// Android and iOS and needs no native rebuild.
export const DatePickerModal = ({ visible, value, onSelect, onClear, onClose }: Props) => {
  const { colors: C } = useTheme();
  const { t } = useLanguage();
  const s = React.useMemo(() => makeStyles(C), [C]);

  const parsed = value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : todayStr();
  const [initialYear, initialMonth] = parsed.split("-").map(Number);
  const [viewYear, setViewYear] = useState(initialYear);
  const [viewMonth, setViewMonth] = useState(initialMonth - 1);

  // Re-sync the visible month to the field's current value each time the
  // picker opens, rather than remembering wherever it was last scrolled to.
  React.useEffect(() => {
    if (!visible) return;
    const p = value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : todayStr();
    const [y, m] = p.split("-").map(Number);
    setViewYear(y);
    setViewMonth(m - 1);
  }, [visible, value]);

  const changeMonth = (delta: number) => {
    let m = viewMonth + delta;
    let y = viewYear;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    setViewMonth(m);
    setViewYear(y);
  };

  const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();
  const prevM = viewMonth === 0 ? 11 : viewMonth - 1;
  const prevY = viewMonth === 0 ? viewYear - 1 : viewYear;
  const nextM = viewMonth === 11 ? 0 : viewMonth + 1;
  const nextY = viewMonth === 11 ? viewYear + 1 : viewYear;

  const cells: { day: number; y: number; m: number; inMonth: boolean }[] = [];
  for (let i = firstWeekday - 1; i >= 0; i--) {
    cells.push({ day: daysInPrevMonth - i, y: prevY, m: prevM, inMonth: false });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({ day, y: viewYear, m: viewMonth, inMonth: true });
  }
  for (let day = 1; cells.length < 42; day++) {
    cells.push({ day, y: nextY, m: nextM, inMonth: false });
  }

  const today = todayStr();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.sheet}>
          <View style={s.header}>
            <TouchableOpacity style={s.navBtn} onPress={() => changeMonth(-1)}>
              <Ionicons name="chevron-back" size={18} color={C.text} />
            </TouchableOpacity>
            <Text style={s.monthLabel}>
              {new Date(viewYear, viewMonth, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" })}
            </Text>
            <TouchableOpacity style={s.navBtn} onPress={() => changeMonth(1)}>
              <Ionicons name="chevron-forward" size={18} color={C.text} />
            </TouchableOpacity>
          </View>

          <View style={s.weekdayRow}>
            {WEEKDAY_LABELS.map((w, i) => (
              <Text key={i} style={s.weekdayLabel}>{w}</Text>
            ))}
          </View>

          <View style={s.grid}>
            {cells.map((cell, i) => {
              const dateStr = fmt(cell.y, cell.m, cell.day);
              const isSelected = dateStr === value;
              const isToday = dateStr === today;
              return (
                <TouchableOpacity
                  key={i}
                  style={[s.cell, isSelected && s.cellSelected]}
                  onPress={() => { onSelect(dateStr); onClose(); }}
                >
                  <Text style={[
                    s.cellText,
                    !cell.inMonth && s.cellTextOutside,
                    isToday && !isSelected && s.cellTextToday,
                    isSelected && s.cellTextSelected,
                  ]}>
                    {cell.day}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={s.footer}>
            {onClear && (
              <TouchableOpacity style={s.footerBtn} onPress={() => { onClear(); onClose(); }}>
                <Text style={s.footerBtnText}>{t("common.clear")}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={s.footerBtn} onPress={() => { onSelect(today); onClose(); }}>
              <Text style={s.footerBtnText}>{t("common.today")}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.footerBtn, s.footerBtnCancel]} onPress={onClose}>
              <Text style={s.footerBtnCancelText}>{t("common.cancel")}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const makeStyles = (C: ThemeColors) => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: C.overlay, justifyContent: "flex-end" },
  sheet:   { backgroundColor: C.surface, borderTopLeftRadius: R.xl, borderTopRightRadius: R.xl,
             padding: 20, ...Shadow.lg },

  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  navBtn: { width: 32, height: 32, borderRadius: R.md, backgroundColor: C.card,
            alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: C.border },
  monthLabel: { color: C.text, fontSize: F.md, fontWeight: "800" },

  weekdayRow: { flexDirection: "row", marginBottom: 4 },
  weekdayLabel: { flex: 1, textAlign: "center", color: C.muted, fontSize: F.xs, fontWeight: "700" },

  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: "14.28%", aspectRatio: 1, alignItems: "center", justifyContent: "center" },
  cellSelected: {},
  cellText: { color: C.text, fontSize: F.sm },
  cellTextOutside: { color: C.muted, opacity: 0.4 },
  cellTextToday: { color: C.accent, fontWeight: "800" },
  cellTextSelected: {
    color: C.accentFg, fontWeight: "800", backgroundColor: C.accent,
    width: 30, height: 30, borderRadius: 15, textAlign: "center", textAlignVertical: "center",
    overflow: "hidden",
  },

  footer: { flexDirection: "row", gap: 8, marginTop: 16 },
  footerBtn: { flex: 1, paddingVertical: 12, borderRadius: R.md, backgroundColor: C.card,
               alignItems: "center", borderWidth: 1, borderColor: C.border },
  footerBtnText: { color: C.accent, fontSize: F.sm, fontWeight: "700" },
  footerBtnCancel: { backgroundColor: "transparent", borderColor: "transparent" },
  footerBtnCancelText: { color: C.muted, fontSize: F.sm, fontWeight: "700" },
});
