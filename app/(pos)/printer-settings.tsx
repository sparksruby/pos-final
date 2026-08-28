import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
  StatusBar,
  Platform
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { BluetoothEscposPrinter } from "react-native-bluetooth-escpos-printer";
import {
  usePrinterStore,
  PAPER_WIDTH_58MM,
  PAPER_WIDTH_80MM,
  PairedDevice,
} from "@/store/printerStore";
import type { BleDeviceInfo } from "@/utils/blePrinter";
import { buildEscposText } from "@/utils/escposRaster";
import { useTheme } from "../../src/context/ThemeContext";
import { useLanguage } from "../../src/context/LanguageContext";
import { useAlert } from "@/context/AlertContext";
import { F, R, Shadow, ThemeColors } from "../../src/theme";
import { useResponsive } from "@/hooks/useResponsive";
import type { LabelProtocol } from "@/types";
import type { TranslationKey } from "@/i18n/translations";

const LABEL_PROTOCOLS: LabelProtocol[] = ["ESCPOS", "TSPL", "CPCL", "ZPL"];

// Multiplies the receipt's own width-derived scale. Kept to three coarse
// steps rather than a slider: on a 203dpi head the difference a single
// point makes is invisible, and a receipt only has to be readable.
const RECEIPT_TEXT_SIZES: { scale: number; labelKey: TranslationKey }[] = [
  { scale: 0.85, labelKey: "printer.textSmall"  },
  { scale: 1,    labelKey: "printer.textNormal" },
  { scale: 1.15, labelKey: "printer.textLarge"  },
];

const ANDROID_STATUS_BAR =
  Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) : 0;

export default function PrinterSettingsScreen() {
  const { colors: C } = useTheme();
  const { t } = useLanguage();
  const { alert } = useAlert();
  const { isTablet } = useResponsive();
  const s = React.useMemo(() => makeStyles(C, isTablet), [C, isTablet]);

  const {
    pairedDevices,
    selectedAddress,
    selectedName,
    connectionType,
    bleDevices,
    isScanningBle,
    paperWidth,
    isLoading,
    isReady,
    isConnecting,
    init,
    loadPairedDevices,
    selectPrinter,
    scanBlePrinters,
    selectBlePrinter,
    forgetPrinter,
    setPaperWidth,
    ensureConnected,
    sendBleBytes,
    labelProtocol,
    labelWidthMm,
    labelHeightMm,
    labelGapMm,
    setLabelProtocol,
    setLabelSize,
    invertReceipt,
    setInvertReceipt,
    invertLabel,
    setInvertLabel,
    receiptTextScale,
    setReceiptTextScale,
    bleLink,
    lastPrintMs,
    lastPrintKb,
    lastReceiptGeom,
  } = usePrinterStore();

  const [testing, setTesting] = useState(false);
  const [widthInput, setWidthInput]   = useState(String(labelWidthMm));
  const [heightInput, setHeightInput] = useState(String(labelHeightMm));
  const [gapInput, setGapInput]       = useState(String(labelGapMm));

  // init() loads the persisted label size from AsyncStorage asynchronously
  // — on this screen's very first render (before it resolves) labelWidthMm
  // etc. are still just the hardcoded defaults, so the inputs above would
  // otherwise start out showing "40/30/2" even when a different size was
  // saved before. Re-sync once loading actually finishes.
  useEffect(() => {
    if (!isReady) return;
    setWidthInput(String(labelWidthMm));
    setHeightInput(String(labelHeightMm));
    setGapInput(String(labelGapMm));
  }, [isReady]);

  // Persists on every keystroke, not just onBlur — leaving the screen (back
  // button, hardware back, a nav link) doesn't reliably fire onBlur before
  // the screen unmounts, which was silently dropping the edit.
  const commitLabelSize = (width: string, height: string, gap: string) => {
    setLabelSize(
      Math.max(1, Number(width) || labelWidthMm),
      Math.max(1, Number(height) || labelHeightMm),
      Math.max(0, Number(gap) || 0),
    );
  };

  // onBlur just tidies up the displayed text (strips a trailing "." or a
  // value that parsed back to the fallback) — the value itself is already
  // saved by the time this runs.
  const normalizeLabelSizeInputs = () => {
    setWidthInput(String(Math.max(1, Number(widthInput) || labelWidthMm)));
    setHeightInput(String(Math.max(1, Number(heightInput) || labelHeightMm)));
    setGapInput(String(Math.max(0, Number(gapInput) || 0)));
  };

  useEffect(() => {
    init().then(loadPairedDevices);
  }, []);

  const handleSelect = async (device: PairedDevice) => {
    try {
      await selectPrinter(device);
    } catch {
      alert(t("common.error"), t("printer.connectFailed"));
    }
  };

  const handleScanBle = async () => {
    await scanBlePrinters();
    const err = usePrinterStore.getState().error;
    if (err === "BLUETOOTH_OFF") alert(t("common.error"), t("printer.bleOff"));
    else if (err) alert(t("common.error"), t("printer.bleScanFailed"));
  };

  const handleSelectBle = async (device: BleDeviceInfo) => {
    try {
      await selectBlePrinter(device);
    } catch {
      alert(t("common.error"), t("printer.connectFailed"));
    }
  };

  const handleForget = () => {
    alert(t("printer.forgetTitle"), t("printer.forgetConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("common.confirm"), style: "destructive", onPress: forgetPrinter },
    ]);
  };

  const handleTestPrint = async () => {
    if (!selectedAddress) return;
    setTesting(true);
    try {
      if (connectionType === "ble") {
        await sendBleBytes(buildEscposText("Retail POS\nTest Print OK"));
        return;
      }
      await ensureConnected();
      await BluetoothEscposPrinter.printerInit();
      await BluetoothEscposPrinter.printerAlign(BluetoothEscposPrinter.ALIGN.CENTER);
      await BluetoothEscposPrinter.printText("Retail POS\nTest Print OK\n\n\n", {});
    } catch {
      alert(t("common.error"), t("printer.testPrintFailed"));
    } finally {
      setTesting(false);
    }
  };

  // Everything above the paired-devices list rides along as the FlatList's
  // own header, so the whole screen scrolls as one unit — a ScrollView
  // wrapping a FlatList would trigger RN's nested-VirtualizedList warning.
  const ListHeader = (
    <>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={20} color={C.textSub} />
        </TouchableOpacity>
        <Ionicons name="print-outline" size={18} color={C.text} />
        <Text style={s.title}>{t("printer.title")}</Text>
        <TouchableOpacity style={s.refreshBtn} onPress={loadPairedDevices}>
          <Ionicons name="refresh" size={16} color={C.textSub} />
        </TouchableOpacity>
      </View>

      {/* Selected printer */}
      <View style={s.card}>
        <Text style={s.section}>{t("printer.selected")}</Text>
        {selectedAddress ? (
          <>
            <View style={s.selectedRow}>
              <View style={s.selectedIcon}>
                <Ionicons name="print" size={18} color={C.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={s.selectedName}>{selectedName || selectedAddress}</Text>
                  <View style={s.connTypeBadge}>
                    <Text style={s.connTypeBadgeText}>{connectionType === "ble" ? "BLE" : "Classic"}</Text>
                  </View>
                </View>
                <Text style={s.selectedAddr}>{selectedAddress}</Text>
              </View>
            </View>
            <View style={s.actionsRow}>
              <TouchableOpacity style={s.testBtn} onPress={handleTestPrint} disabled={testing}>
                {testing ? (
                  <ActivityIndicator size="small" color={C.text} />
                ) : (
                  <>
                    <Ionicons name="receipt-outline" size={15} color={C.text} />
                    <Text style={s.testBtnText}>{t("printer.testPrint")}</Text>
                  </>
                )}
              </TouchableOpacity>
              <TouchableOpacity style={s.forgetBtn} onPress={handleForget}>
                <Ionicons name="close-circle-outline" size={15} color={C.danger} />
                <Text style={s.forgetBtnText}>{t("printer.forget")}</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <Text style={s.noneText}>{t("printer.none")}</Text>
        )}
      </View>

      {/* Paper width */}
      <View style={s.card}>
        <Text style={s.section}>{t("printer.paperWidth")}</Text>
        <View style={s.optionRow}>
          <TouchableOpacity
            style={[s.optionBtn, paperWidth === PAPER_WIDTH_58MM && s.optionActive]}
            onPress={() => setPaperWidth(PAPER_WIDTH_58MM)}
          >
            <Text style={[s.optionText, paperWidth === PAPER_WIDTH_58MM && s.optionActiveText]}>58mm</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.optionBtn, paperWidth === PAPER_WIDTH_80MM && s.optionActive]}
            onPress={() => setPaperWidth(PAPER_WIDTH_80MM)}
          >
            <Text style={[s.optionText, paperWidth === PAPER_WIDTH_80MM && s.optionActiveText]}>80mm</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Print colour — separate per output: the receipt and the label are
          captured from different views and came off the same printer with
          opposite polarity, so one shared setting could only fix one. */}
      <View style={s.card}>
        <Text style={s.section}>{t("printer.invertReceipt")}</Text>
        <View style={s.optionRow}>
          <TouchableOpacity
            style={[s.optionBtn, !invertReceipt && s.optionActive]}
            onPress={() => setInvertReceipt(false)}
          >
            <Text style={[s.optionText, !invertReceipt && s.optionActiveText]}>{t("printer.invertOff")}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.optionBtn, invertReceipt && s.optionActive]}
            onPress={() => setInvertReceipt(true)}
          >
            <Text style={[s.optionText, invertReceipt && s.optionActiveText]}>{t("printer.invertOn")}</Text>
          </TouchableOpacity>
        </View>

        <Text style={[s.section, { marginTop: 16 }]}>{t("printer.invertLabel")}</Text>
        <View style={s.optionRow}>
          <TouchableOpacity
            style={[s.optionBtn, !invertLabel && s.optionActive]}
            onPress={() => setInvertLabel(false)}
          >
            <Text style={[s.optionText, !invertLabel && s.optionActiveText]}>{t("printer.invertOff")}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.optionBtn, invertLabel && s.optionActive]}
            onPress={() => setInvertLabel(true)}
          >
            <Text style={[s.optionText, invertLabel && s.optionActiveText]}>{t("printer.invertOn")}</Text>
          </TouchableOpacity>
        </View>
        <Text style={s.labelSizeHint}>{t("printer.invertHint")}</Text>
      </View>

      {/* Receipt text size */}
      <View style={s.card}>
        <Text style={s.section}>{t("printer.textSize")}</Text>
        <View style={s.optionRow}>
          {RECEIPT_TEXT_SIZES.map(opt => (
            <TouchableOpacity
              key={opt.scale}
              style={[s.optionBtn, receiptTextScale === opt.scale && s.optionActive]}
              onPress={() => setReceiptTextScale(opt.scale)}
              activeOpacity={0.8}
            >
              <Text style={[s.optionText, receiptTextScale === opt.scale && s.optionActiveText]}>
                {t(opt.labelKey)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={s.labelSizeHint}>{t("printer.textSizeHint")}</Text>
      </View>

      {/* What the Bluetooth link actually negotiated. Only meaningful for
          BLE printers, and only once something has been printed — print
          speed over BLE is set by things that leave no trace on paper, so
          without this a slow print can only be guessed at. */}
      {!!bleLink && (
        <View style={s.card}>
          <Text style={s.section}>{t("printer.linkTitle")}</Text>
          <Text style={s.linkStat}>
            MTU {bleLink.mtu} · {bleLink.chunkSize} B/write ·{" "}
            {bleLink.withResponse ? "with ack" : "no ack"} ·{" "}
            {bleLink.highPriority ? "fast interval" : "default interval"}
          </Text>
          {lastPrintMs != null && (
            <Text style={s.linkStat}>
              {lastPrintKb} KB in {(lastPrintMs / 1000).toFixed(1)}s
              {lastPrintKb ? ` · ${Math.round((lastPrintKb * 1024) / (lastPrintMs / 1000))} B/s` : ""}
            </Text>
          )}
          {!!lastReceiptGeom && (
            <Text style={s.linkStat}>
              view {lastReceiptGeom.viewW}×{lastReceiptGeom.viewH} → image {lastReceiptGeom.imgW}×{lastReceiptGeom.imgH}
            </Text>
          )}
          <Text style={s.labelSizeHint}>{t("printer.linkHint")}</Text>
        </View>
      )}

      {/* Label printer */}
      <View style={s.card}>
        <Text style={s.section}>{t("printer.labelProtocol")}</Text>
        <View style={s.protocolRow}>
          {LABEL_PROTOCOLS.map(p => (
            <TouchableOpacity
              key={p}
              style={[s.optionBtn, labelProtocol === p && s.optionActive]}
              onPress={() => setLabelProtocol(p)}
            >
              <Text style={[s.optionText, labelProtocol === p && s.optionActiveText]}>{p}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[s.section, { marginTop: 16 }]}>{t("printer.labelSize")}</Text>
        <View style={s.labelSizeRow}>
          <View style={s.labelSizeField}>
            <Text style={s.labelSizeCaption}>{t("printer.labelWidth")}</Text>
            <TextInput
              style={s.labelSizeInput}
              value={widthInput}
              onChangeText={v => { setWidthInput(v); commitLabelSize(v, heightInput, gapInput); }}
              onBlur={normalizeLabelSizeInputs}
              keyboardType="numeric"
              placeholderTextColor={C.muted}
            />
          </View>
          <View style={s.labelSizeField}>
            <Text style={s.labelSizeCaption}>{t("printer.labelHeight")}</Text>
            <TextInput
              style={s.labelSizeInput}
              value={heightInput}
              onChangeText={v => { setHeightInput(v); commitLabelSize(widthInput, v, gapInput); }}
              onBlur={normalizeLabelSizeInputs}
              keyboardType="numeric"
              placeholderTextColor={C.muted}
            />
          </View>
          <View style={s.labelSizeField}>
            <Text style={s.labelSizeCaption}>{t("printer.labelGap")}</Text>
            <TextInput
              style={s.labelSizeInput}
              value={gapInput}
              onChangeText={v => { setGapInput(v); commitLabelSize(widthInput, heightInput, v); }}
              onBlur={normalizeLabelSizeInputs}
              keyboardType="numeric"
              placeholderTextColor={C.muted}
            />
          </View>
        </View>
        <Text style={s.labelSizeHint}>{t("printer.labelSizeHint")}</Text>
      </View>

      {/* BLE printers — a separate transport from the classic-Bluetooth
          "Paired Devices" list below (see printerStore.ts's connectionType
          comment). Many compact/label thermal printers only speak BLE —
          they'll never show useful print output over a classic connection
          even when OS-level pairing succeeds, which is what this section
          exists to get around. */}
      <View style={s.card}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={s.section}>{t("printer.blePrinters")}</Text>
          <TouchableOpacity style={s.scanBtn} onPress={handleScanBle} disabled={isScanningBle}>
            {isScanningBle ? (
              <ActivityIndicator size="small" color={C.accent} />
            ) : (
              <>
                <Ionicons name="bluetooth" size={13} color={C.accent} />
                <Text style={s.scanBtnText}>{t("printer.scan")}</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
        <Text style={s.labelSizeHint}>{t("printer.bleHint")}</Text>
        {bleDevices.length === 0 && !isScanningBle ? (
          <Text style={[s.noneText, { marginTop: 8 }]}>{t("printer.noBleFound")}</Text>
        ) : (
          bleDevices.map(d => {
            const isSelected = d.id === selectedAddress && connectionType === "ble";
            return (
              <TouchableOpacity
                key={d.id}
                style={[s.bleDeviceRow, isSelected && s.deviceRowActive]}
                onPress={() => handleSelectBle(d)}
                disabled={isConnecting}
              >
                <Ionicons name="bluetooth-outline" size={16} color={isSelected ? C.accent : C.textSub} />
                <View style={{ flex: 1 }}>
                  <Text style={s.deviceName}>{d.name}</Text>
                  <Text style={s.deviceAddr}>{d.id}</Text>
                </View>
                {isSelected ? (
                  <Text style={s.connectedTag}>{t("printer.connected")}</Text>
                ) : (
                  <Text style={s.connectTag}>{t("printer.connect")}</Text>
                )}
              </TouchableOpacity>
            );
          })
        )}
      </View>

      {/* Paired devices */}
      <View style={s.listHeader}>
        <Text style={s.section}>{t("printer.pairedDevices")}</Text>
      </View>
    </>
  );

  return (
    <SafeAreaView style={s.root}>
      {isLoading ? (
        <>
          {ListHeader}
          <ActivityIndicator color={C.accent} style={{ marginTop: 30 }} />
        </>
      ) : (
        <FlatList
          data={pairedDevices}
          keyExtractor={(d) => d.address}
          contentContainerStyle={s.list}
          ListHeaderComponent={ListHeader}
          ListEmptyComponent={
            <View style={s.emptyBox}>
              <Text style={s.emptyText}>{t("printer.noPrinters")}</Text>
              <Text style={s.emptyHint}>{t("printer.noPrintersHint")}</Text>
            </View>
          }
          renderItem={({ item }) => {
            const isSelected = item.address === selectedAddress;
            return (
              <TouchableOpacity
                style={[s.deviceRow, isSelected && s.deviceRowActive]}
                onPress={() => handleSelect(item)}
                disabled={isConnecting}
              >
                <Ionicons
                  name="print-outline"
                  size={18}
                  color={isSelected ? C.accent : C.textSub}
                />
                <View style={{ flex: 1 }}>
                  <Text style={s.deviceName}>{item.name || item.address}</Text>
                  <Text style={s.deviceAddr}>{item.address}</Text>
                </View>
                {isSelected ? (
                  <Text style={s.connectedTag}>{t("printer.connected")}</Text>
                ) : isConnecting ? (
                  <ActivityIndicator size="small" color={C.accent} />
                ) : (
                  <Text style={s.connectTag}>{t("printer.connect")}</Text>
                )}
              </TouchableOpacity>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (C: ThemeColors, isTablet: boolean) => StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },

    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
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
      borderWidth: 1,
      borderColor: C.border,
    },
    title: { fontSize: F.lg, fontWeight: "700", color: C.text, flex: 1 },
    refreshBtn: {
      width: 34,
      height: 34,
      borderRadius: R.md,
      backgroundColor: C.card,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: C.border,
    },

    card: {
      backgroundColor: C.surface,
      borderRadius: R.lg,
      padding: 16,
      borderWidth: 1,
      borderColor: C.border,
      marginHorizontal: 16,
      marginBottom: 12,
      ...Shadow.sm,
    },
    section: {
      color: C.muted,
      fontSize: F.xs,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.8,
      marginBottom: 12,
    },

    selectedRow: { flexDirection: "row", alignItems: "center", gap: 12 },
    selectedIcon: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: C.accentSoft,
      alignItems: "center",
      justifyContent: "center",
    },
    selectedName: { color: C.text, fontSize: F.md, fontWeight: "700" },
    selectedAddr: { color: C.muted, fontSize: F.xs, marginTop: 2 },
    noneText: { color: C.muted, fontSize: F.sm },

    connTypeBadge: {
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: R.full,
      backgroundColor: C.accentSoft,
    },
    connTypeBadgeText: { color: C.accent, fontSize: 9.5, fontWeight: "800" },

    scanBtn: {
      flexDirection: "row",
      gap: 5,
      alignItems: "center",
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: R.full,
      backgroundColor: C.accentSoft,
    },
    scanBtnText: { color: C.accent, fontSize: F.xs, fontWeight: "700" },

    bleDeviceRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      backgroundColor: C.card,
      borderRadius: R.md,
      padding: 12,
      marginTop: 8,
      borderWidth: 1,
      borderColor: C.border,
    },

    actionsRow: { flexDirection: "row", gap: 8, marginTop: 14 },
    testBtn: {
      flex: 1,
      flexDirection: "row",
      gap: 6,
      backgroundColor: C.card,
      borderRadius: R.md,
      paddingVertical: 10,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: C.border,
    },
    testBtnText: { color: C.text, fontSize: F.sm, fontWeight: "700" },
    forgetBtn: {
      flex: 1,
      flexDirection: "row",
      gap: 6,
      backgroundColor: C.card,
      borderRadius: R.md,
      paddingVertical: 10,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: C.border,
    },
    forgetBtnText: { color: C.danger, fontSize: F.sm, fontWeight: "700" },

    optionRow: { flexDirection: "row", gap: 8 },
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
    optionText: { color: C.muted, fontSize: F.sm, fontWeight: "700" },
    optionActiveText: { color: C.accentFg },

    protocolRow: { flexDirection: "row", gap: 8 },

    labelSizeRow: { flexDirection: "row", gap: 8 },
    labelSizeField: { flex: 1 },
    labelSizeCaption: { color: C.muted, fontSize: F.xs, marginBottom: 6 },
    labelSizeInput: {
      backgroundColor: C.card,
      borderRadius: R.md,
      padding: 10,
      color: C.text,
      fontSize: F.sm,
      borderWidth: 1,
      borderColor: C.border,
      textAlign: "center",
    },
    labelSizeHint: { color: C.muted, fontSize: F.xs, marginTop: 10 },
    linkStat: { color: C.text, fontSize: F.sm, fontWeight: "600", marginTop: 4 },

    listHeader: { paddingHorizontal: 16, marginBottom: 4 },
    // No horizontal padding here — ListHeaderComponent's own cards already
    // carry their own (marginHorizontal), and deviceRow below carries its
    // own too, now that the header rides inside this same content
    // container (see the ListHeader/FlatList merge above).
    list: { paddingBottom: 24, gap: 10 },

    emptyBox: {
      alignItems: "center",
      marginTop: 30,
      gap: 6,
      paddingHorizontal: 20,
    },
    emptyText: { color: C.muted, fontSize: F.sm, textAlign: "center" },
    emptyHint: {
      color: C.muted,
      fontSize: F.xs,
      textAlign: "center",
      opacity: 0.8,
    },

    deviceRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      backgroundColor: C.surface,
      borderRadius: R.lg,
      padding: 14,
      marginHorizontal: 16,
      borderWidth: 1,
      borderColor: C.border,
      ...Shadow.sm,
    },
    deviceRowActive: { borderColor: C.accent },
    deviceName: { color: C.text, fontSize: F.sm, fontWeight: "600" },
    deviceAddr: { color: C.muted, fontSize: F.xs, marginTop: 2 },
    connectedTag: { color: C.accent, fontSize: F.xs, fontWeight: "800" },
    connectTag: { color: C.muted, fontSize: F.xs, fontWeight: "700" },
  });
