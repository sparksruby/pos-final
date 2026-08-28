import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { BluetoothManager } from "react-native-bluetooth-escpos-printer";
import { requestBluetoothPermissions } from "@/utils/bluetoothPermissions";
import { scanForBlePrinters, connectBlePrinter, type BleDeviceInfo, type BleLinkInfo, type BleWriter } from "@/utils/blePrinter";
import type { LabelProtocol } from "@/types";

const ADDR_KEY  = "pos_printer_address";
const NAME_KEY  = "pos_printer_name";
const WIDTH_KEY = "pos_printer_paper_width";
const CONN_TYPE_KEY = "pos_printer_conn_type";

const LABEL_PROTOCOL_KEY = "pos_label_protocol";
const LABEL_WIDTH_KEY    = "pos_label_width_mm";
const LABEL_HEIGHT_KEY   = "pos_label_height_mm";
const LABEL_GAP_KEY      = "pos_label_gap_mm";
const INVERT_RECEIPT_KEY = "pos_printer_invert_receipt";
const RECEIPT_TEXT_SCALE_KEY = "pos_printer_receipt_text_scale";
const INVERT_LABEL_KEY   = "pos_printer_invert_label";

export const PAPER_WIDTH_58MM = 384;
export const PAPER_WIDTH_80MM = 576;

// Common small self-adhesive barcode label size — matches the pictured
// label. Only used as the first-run default; printer-settings.tsx lets any
// size be entered.
export const DEFAULT_LABEL_WIDTH_MM  = 40;
export const DEFAULT_LABEL_HEIGHT_MM = 30;
export const DEFAULT_LABEL_GAP_MM    = 2;

export interface PairedDevice {
  name:    string;
  address: string;
}

// "classic" is the original react-native-bluetooth-escpos-printer path
// (Serial Port Profile) — works for printers that actually expose SPP.
// "ble" is the newer GATT transport (see src/utils/blePrinter.ts) added
// for printers that only speak BLE, which SPP-only classic connect()
// silently can't talk to at all (connects at the OS pairing level, but
// nothing ever reaches the printer). Picking the wrong one for a given
// physical printer is exactly the "paired fine, nothing prints" symptom
// this split exists to get out of.
export type PrinterConnectionType = "classic" | "ble";

interface PrinterStore {
  pairedDevices:   PairedDevice[];
  selectedAddress: string | null;
  selectedName:    string | null;
  connectionType:  PrinterConnectionType | null;
  bleDevices:      BleDeviceInfo[];
  isScanningBle:   boolean;
  paperWidth:      number;
  isReady:         boolean;
  isLoading:       boolean;
  isConnecting:    boolean;
  error:           string | null;

  labelProtocol:   LabelProtocol;
  labelWidthMm:    number;
  labelHeightMm:   number;
  labelGapMm:      number;
  /** Flip the printed image to its negative — for printers whose raster
   *  command treats a set bit as "leave blank" instead of "burn a dot".
   *  Kept per output because the receipt and the label are captured from
   *  different views: on the printer this was developed against the two
   *  came off the same physical printer with opposite polarity, so one
   *  shared flag could only ever get one of them right. */
  invertReceipt:   boolean;
  // Multiplies every type size and every gap on the receipt. The receipt
  // already scales itself to the paper's width; this is on top of that, for
  // taste — smaller type also means a shorter image, which prints faster.
  receiptTextScale: number;
  invertLabel:     boolean;

  init:              () => Promise<void>;
  loadPairedDevices: () => Promise<void>;
  selectPrinter:     (device: PairedDevice) => Promise<void>;
  scanBlePrinters:   () => Promise<void>;
  selectBlePrinter:  (device: BleDeviceInfo) => Promise<void>;
  forgetPrinter:     () => Promise<void>;
  setPaperWidth:     (width: number) => void;
  setLabelProtocol:  (protocol: LabelProtocol) => void;
  setLabelSize:      (widthMm: number, heightMm: number, gapMm: number) => void;
  setInvertReceipt:  (invert: boolean) => void;
  setReceiptTextScale: (scale: number) => void;
  setInvertLabel:    (invert: boolean) => void;
  // Reconnects to the saved printer — the library exposes no persistent
  // "is it still connected" check, so every print just (re)connects first.
  ensureConnected:   () => Promise<void>;
  // Only meaningful when connectionType === "ble" — every BLE print path
  // (see ReceiptPrinter.tsx/LabelPrinter.tsx) builds its own raw command
  // bytes and sends them through this instead of the classic-only native
  // module's printPic/printLabel/printRawData, none of which can be
  // pointed at an externally-managed BLE connection.
  sendBleBytes:      (bytes: Uint8Array) => Promise<void>;

  // What the last BLE print actually did, shown on the printer settings
  // screen. Print speed over BLE is decided by things with no visible
  // effect on paper — the MTU the printer granted, whether each write
  // waits for an acknowledgement, the connection interval Android chose —
  // so without these numbers a slow print can only be guessed at.
  bleLink:      BleLinkInfo | null;
  lastPrintMs:  number | null;
  lastPrintKb:  number | null;

  // The receipt's laid-out size against the size of the bitmap made from
  // it. These two have to be in the same proportion: captureRef scales
  // whatever it captured into the size asked for, so if the view is not the
  // shape the capture claims, every glyph is stretched by the difference —
  // which is exactly what "the text prints squashed" looks like. Shown on
  // the printer screen so the two numbers can be compared directly.
  lastReceiptGeom: { viewW: number; viewH: number; imgW: number; imgH: number } | null;
  setLastReceiptGeom: (geom: { viewW: number; viewH: number; imgW: number; imgH: number }) => void;
}

// Not part of the zustand state on purpose — a connected BleWriter wraps a
// live native device handle, not serializable/comparable app state, and
// nothing needs to react to it changing the way UI reacts to
// selectedAddress/connectionType. ensureConnected() populates it;
// sendBleBytes() and forgetPrinter() are the only other readers.
let bleWriter: BleWriter | null = null;

export const usePrinterStore = create<PrinterStore>((set, get) => ({
  pairedDevices:   [],
  selectedAddress: null,
  selectedName:    null,
  connectionType:  null,
  bleDevices:      [],
  isScanningBle:   false,
  paperWidth:      PAPER_WIDTH_58MM,
  isReady:         false,
  isLoading:       false,
  isConnecting:    false,
  error:           null,

  labelProtocol:   "TSPL",
  labelWidthMm:    DEFAULT_LABEL_WIDTH_MM,
  labelHeightMm:   DEFAULT_LABEL_HEIGHT_MM,
  labelGapMm:      DEFAULT_LABEL_GAP_MM,
  invertReceipt:   false,
  invertLabel:     false,
  receiptTextScale: 1,

  init: async () => {
    if (get().isReady) return;
    const [addr, name, connType, width, labelProtocol, labelWidthMm, labelHeightMm, labelGapMm, invertReceipt, invertLabel, receiptTextScale] = await Promise.all([
      AsyncStorage.getItem(ADDR_KEY),
      AsyncStorage.getItem(NAME_KEY),
      AsyncStorage.getItem(CONN_TYPE_KEY),
      AsyncStorage.getItem(WIDTH_KEY),
      AsyncStorage.getItem(LABEL_PROTOCOL_KEY),
      AsyncStorage.getItem(LABEL_WIDTH_KEY),
      AsyncStorage.getItem(LABEL_HEIGHT_KEY),
      AsyncStorage.getItem(LABEL_GAP_KEY),
      AsyncStorage.getItem(INVERT_RECEIPT_KEY),
      AsyncStorage.getItem(INVERT_LABEL_KEY),
      AsyncStorage.getItem(RECEIPT_TEXT_SCALE_KEY),
    ]);
    set({
      selectedAddress: addr,
      selectedName:    name,
      // Printers selected before this field existed have no stored value —
      // they were always classic connections (BLE didn't exist yet), so
      // that's the correct default rather than leaving it null.
      connectionType:  addr ? ((connType as PrinterConnectionType | null) ?? "classic") : null,
      paperWidth:      width ? Number(width) : PAPER_WIDTH_58MM,
      labelProtocol:   (labelProtocol as LabelProtocol | null) ?? "TSPL",
      labelWidthMm:    labelWidthMm ? Number(labelWidthMm) : DEFAULT_LABEL_WIDTH_MM,
      labelHeightMm:   labelHeightMm ? Number(labelHeightMm) : DEFAULT_LABEL_HEIGHT_MM,
      labelGapMm:      labelGapMm ? Number(labelGapMm) : DEFAULT_LABEL_GAP_MM,
      invertReceipt:   invertReceipt === "1",
      invertLabel:     invertLabel === "1",
      receiptTextScale: receiptTextScale ? Number(receiptTextScale) : 1,
      isReady:         true,
    });
  },

  loadPairedDevices: async () => {
    set({ isLoading: true, error: null });
    try {
      const ok = await requestBluetoothPermissions();
      if (!ok) throw new Error("PERMISSION_DENIED");
      const raw = await BluetoothManager.enableBluetooth();
      const devices = (raw ?? [])
        .map(s => {
          try { return JSON.parse(s) as PairedDevice; } catch { return null; }
        })
        .filter((d): d is PairedDevice => !!d && !!d.address);
      set({ pairedDevices: devices });
    } catch (e: any) {
      set({ error: e?.message ?? "PRINTER_LIST_FAILED" });
    } finally {
      set({ isLoading: false });
    }
  },

  selectPrinter: async (device) => {
    set({ isConnecting: true, error: null });
    try {
      const ok = await requestBluetoothPermissions();
      if (!ok) throw new Error("PERMISSION_DENIED");
      await BluetoothManager.connect(device.address);
      bleWriter = null; // switching away from any previously-selected BLE printer
      await AsyncStorage.multiSet([[ADDR_KEY, device.address], [NAME_KEY, device.name], [CONN_TYPE_KEY, "classic"]]);
      set({ selectedAddress: device.address, selectedName: device.name, connectionType: "classic" });
    } catch (e: any) {
      set({ error: e?.message ?? "CONNECT_FAILED" });
      throw e;
    } finally {
      set({ isConnecting: false });
    }
  },

  // Lists nearby *advertising* BLE printers (see blePrinter.ts's scan
  // comment on why an already-bonded-but-currently-off printer won't show
  // up) — a separate list from pairedDevices above, which only ever
  // reflects the OS's classic-Bluetooth bonded devices and has no
  // equivalent concept for BLE.
  scanBlePrinters: async () => {
    set({ isScanningBle: true, error: null, bleDevices: [] });
    try {
      const devices = await scanForBlePrinters();
      set({ bleDevices: devices });
    } catch (e: any) {
      set({ error: e?.message ?? "BLE_SCAN_FAILED" });
    } finally {
      set({ isScanningBle: false });
    }
  },

  selectBlePrinter: async (device) => {
    set({ isConnecting: true, error: null });
    try {
      bleWriter = await connectBlePrinter(device.id);
      await AsyncStorage.multiSet([[ADDR_KEY, device.id], [NAME_KEY, device.name], [CONN_TYPE_KEY, "ble"]]);
      set({ selectedAddress: device.id, selectedName: device.name, connectionType: "ble" });
    } catch (e: any) {
      set({ error: e?.message ?? "CONNECT_FAILED" });
      throw e;
    } finally {
      set({ isConnecting: false });
    }
  },

  forgetPrinter: async () => {
    if (bleWriter) { await bleWriter.disconnect().catch(() => {}); bleWriter = null; }
    await AsyncStorage.multiRemove([ADDR_KEY, NAME_KEY, CONN_TYPE_KEY]);
    set({ selectedAddress: null, selectedName: null, connectionType: null });
  },

  setPaperWidth: (width) => {
    set({ paperWidth: width });
    AsyncStorage.setItem(WIDTH_KEY, String(width));
  },

  setLabelProtocol: (protocol) => {
    set({ labelProtocol: protocol });
    AsyncStorage.setItem(LABEL_PROTOCOL_KEY, protocol);
  },

  setInvertReceipt: (invert) => {
    set({ invertReceipt: invert });
    AsyncStorage.setItem(INVERT_RECEIPT_KEY, invert ? "1" : "0");
  },

  setReceiptTextScale: (scale) => {
    set({ receiptTextScale: scale });
    AsyncStorage.setItem(RECEIPT_TEXT_SCALE_KEY, String(scale));
  },

  setInvertLabel: (invert) => {
    set({ invertLabel: invert });
    AsyncStorage.setItem(INVERT_LABEL_KEY, invert ? "1" : "0");
  },

  setLabelSize: (widthMm, heightMm, gapMm) => {
    set({ labelWidthMm: widthMm, labelHeightMm: heightMm, labelGapMm: gapMm });
    AsyncStorage.multiSet([
      [LABEL_WIDTH_KEY,  String(widthMm)],
      [LABEL_HEIGHT_KEY, String(heightMm)],
      [LABEL_GAP_KEY,    String(gapMm)],
    ]);
  },

  ensureConnected: async () => {
    const { selectedAddress, connectionType } = get();
    if (!selectedAddress) throw new Error("NO_PRINTER_SELECTED");
    const ok = await requestBluetoothPermissions();
    if (!ok) throw new Error("PERMISSION_DENIED");

    if (connectionType === "ble") {
      if (bleWriter) return; // reuse the live connection — reconnecting on every print isn't needed for BLE the way classic's socket-per-call model wants it
      bleWriter = await connectBlePrinter(selectedAddress);
      return;
    }
    await BluetoothManager.connect(selectedAddress);
  },

  bleLink:     null,
  lastPrintMs: null,
  lastPrintKb: null,
  lastReceiptGeom: null,

  setLastReceiptGeom: (geom) => set({ lastReceiptGeom: geom }),

  sendBleBytes: async (bytes) => {
    await get().ensureConnected();
    if (!bleWriter) throw new Error("NOT_CONNECTED");
    const startedAt = Date.now();
    await bleWriter.write(bytes);
    set({
      bleLink:     bleWriter.info,
      lastPrintMs: Date.now() - startedAt,
      lastPrintKb: Math.round(bytes.length / 102.4) / 10,
    });
  },
}));
