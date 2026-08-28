// Raw ESC/POS command bytes for printing a captured view as a raster
// image — the BLE transport's equivalent of what
// BluetoothEscposPrinter.printPic() does internally over a classic
// Bluetooth socket (see blePrinter.ts for why that native call can't be
// reused as-is for BLE devices: it owns its own classic-only connection,
// with no way to hand it an externally-managed one).
//
// Command reference (identical across virtually every ESC/POS-compatible
// printer, unlike TSPL/ZPL/CPCL's protocol-specific bitmap commands):
//   ESC @        (0x1B 0x40)            — reset/initialize
//   GS v 0 m xL xH yL yH d1..dk         — print raster bit image
//     m = 0 (normal), xL/xH = bytes-per-row (little-endian 16-bit),
//     yL/yH = row count (little-endian 16-bit), then the packed 1bpp data
//     itself — same MSB-first/1=black convention toMonochromeBitmap
//     already produces for the ZPL/CPCL label path, reused verbatim here.
import { concatBytes, toMonochromeBitmap, type RawCapture } from "./labelRaw";

const ESC = 0x1b;
const GS = 0x1d;

export const buildEscposReceipt = (capture: RawCapture): Uint8Array => {
  const bmp = toMonochromeBitmap(capture);

  const init = [ESC, 0x40]; // ESC @

  const xL = bmp.bytesPerRow & 0xff;
  const xH = (bmp.bytesPerRow >> 8) & 0xff;
  const yL = bmp.height & 0xff;
  const yH = (bmp.height >> 8) & 0xff;
  const rasterHeader = [GS, 0x76, 0x30, 0x00, xL, xH, yL, yH];

  // Feed a few lines so the printed receipt clears the cutter/tear bar —
  // deliberately no cut command (GS V): plenty of these budget printers
  // have no cutter at all, and sending one to a printer that doesn't
  // understand it is more likely to be silently ignored or, on some
  // firmwares, to stall the rest of the buffer than to do anything useful.
  const feed = [0x0a, 0x0a, 0x0a, 0x0a];

  return concatBytes(init, rasterHeader, bmp.data, feed);
};

// Plain ASCII text print — the BLE equivalent of printer-settings.tsx's
// Test Print (which uses the classic-only native module's printerInit/
// printerAlign/printText). ESC/POS text commands have no Myanmar glyphs
// (same limitation noted throughout LabelView/ReceiptView), which is fine
// here since this is only ever used for the plain-ASCII test message.
export const buildEscposText = (text: string): Uint8Array => {
  const ESC_INIT = [ESC, 0x40];
  const ALIGN_CENTER = [ESC, 0x61, 0x01];
  const textBytes = Array.from(text).map(c => c.charCodeAt(0) & 0xff);
  const feed = [0x0a, 0x0a];
  return concatBytes(ESC_INIT, ALIGN_CENTER, textBytes, feed);
};
