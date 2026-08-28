// Raw TSPL command bytes for the BLE label-printing path — the equivalent
// of what BluetoothTscPrinter.printLabel() builds internally over a
// classic Bluetooth socket (see blePrinter.ts/escposRaster.ts for why that
// native call can't be reused for BLE-only printers). Mirrors
// LabelPrinter.tsx's existing TSPL call: SIZE/GAP in millimetres, the
// bitmap itself in dots — sending dots for SIZE/GAP there previously made
// the printer think each label was ~8x its real size (see that file's
// comment), so this keeps the same mm-for-size/dots-for-bitmap split.
import { concatBytes, toMonochromeBitmap, type RawCapture } from "./labelRaw";

const asciiBytes = (text: string): number[] => Array.from(text).map(c => c.charCodeAt(0));

export const buildTsplLabel = (
  capture: RawCapture, widthMm: number, heightMm: number, gapMm: number
): Uint8Array => {
  const bmp = toMonochromeBitmap(capture);

  const header = asciiBytes(
    `SIZE ${widthMm} mm,${heightMm} mm\r\n` +
    `GAP ${gapMm} mm,0\r\n` +
    `CLS\r\n` +
    `BITMAP 0,0,${bmp.bytesPerRow},${bmp.height},0,`
  );
  const footer = asciiBytes(`\r\nPRINT 1\r\n`);

  return concatBytes(header, bmp.data, footer);
};
