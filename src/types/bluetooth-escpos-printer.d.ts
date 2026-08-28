// react-native-bluetooth-escpos-printer ships no TypeScript types — this
// covers only the surface this app actually calls. See node_modules'
// android/src/main/java/cn/jystudio/bluetooth/**/*.java for the full
// native API if more is ever needed.
declare module "react-native-bluetooth-escpos-printer" {
  export const BluetoothManager: {
    // Also turns Bluetooth on if it's off. Resolves with each paired
    // device as a JSON string: '{"name":"...","address":"..."}'.
    enableBluetooth(): Promise<string[]>;
    disableBluetooth(): Promise<boolean>;
    isBluetoothEnabled(): Promise<boolean>;
    scanDevices(): Promise<{ found: string; paired: string }>;
    connect(address: string): Promise<void>;
    unpaire(address: string): Promise<string>;
  };

  export const BluetoothEscposPrinter: {
    width58: number; // 384 dots
    width80: number; // 576 dots

    printerInit(): Promise<void>;
    printerAlign(align: number): Promise<void>;
    printText(text: string, options?: Record<string, unknown>): Promise<void>;
    printColumn(
      columnWidths: number[],
      columnAligns: number[],
      columnTexts: string[],
      options?: Record<string, unknown>,
    ): Promise<void>;
    // Sets the device's print-line width in dots (58mm=384, 80mm=576);
    // printPic scales images down to this if no explicit width is given.
    setWidth(width: number): void;
    // No completion callback in the native module — fire and forget.
    // Feeds paper and cuts automatically after printing.
    printPic(
      base64EncodedImage: string,
      options?: { width?: number; left?: number },
    ): void;
    printQRCode(
      content: string,
      size: number,
      correctionLevel: number,
    ): Promise<void>;
    // Added via patches/react-native-bluetooth-escpos-printer+0.0.5.patch —
    // writes base64-decoded bytes straight to the socket, no ESC/POS
    // framing. Used to send hand-built CPCL/ZPL command bytes (see
    // src/utils/labelCommands.ts) since this library has no native module
    // for either protocol.
    printRawData(base64EncodedBytes: string): Promise<void>;

    ALIGN: { LEFT: number; CENTER: number; RIGHT: number };
    ERROR_CORRECTION: { L: number; M: number; Q: number; H: number };
  };

  // TSC/TSPL label printer module — see node_modules' android/src/main/java/
  // cn/jystudio/bluetooth/tsc/RNBluetoothTscPrinterModule.java for the full
  // native API (text/qrcode/barcode/reverse are also supported there, but
  // this app only ever sends a single pre-rendered image — see
  // LabelPrinter.tsx for why).
  export const BluetoothTscPrinter: {
    printLabel(options: {
      width:  number; // dots
      height: number; // dots
      gap?:   number; // dots, 0 for gapless/continuous stock
      density?: number;
      image?: Array<{
        x: number; y: number; width: number; mode: number; image: string; // base64 PNG
      }>;
    }): Promise<void>;

    BITMAP_MODE: { OVERWRITE: number; OR: number; XOR: number };
  };
}
