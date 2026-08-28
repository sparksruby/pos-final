// Raw command builders for the two protocols the printer library has no
// native module for (react-native-bluetooth-escpos-printer ships modules
// for ESC/POS and TSC/TSPL only — see LabelPrinter.tsx). Both build a plain
// byte array that gets sent verbatim over the Bluetooth socket via the
// printRawData native patch (patches/react-native-bluetooth-escpos-printer+0.0.5.patch).
import { concatBytes, toMonochromeBitmap } from "./labelRaw";

const BASE64_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Manual bytes -> base64 encode (mirrors labelRaw.ts's decoder — no Buffer dependency). */
export const encodeBase64 = (bytes: Uint8Array): string => {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined;

    out += BASE64_CHARS[b0 >> 2];
    out += BASE64_CHARS[((b0 & 0x03) << 4) | (b1 !== undefined ? b1 >> 4 : 0)];
    out += b1 !== undefined ? BASE64_CHARS[((b1 & 0x0f) << 2) | (b2 !== undefined ? b2 >> 6 : 0)] : "=";
    out += b2 !== undefined ? BASE64_CHARS[b2 & 0x3f] : "=";
  }
  return out;
};

// Straight into a typed array: ZPL hands this its whole hex-encoded bitmap,
// which for a receipt-sized image is hundreds of thousands of characters.
const asciiBytes = (text: string): Uint8Array => {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
};

const HEX_CHARS = "0123456789ABCDEF";

/**
 * ZPL — the whole label as one ^GFA (ASCII-hex graphic field) image, since
 * ZPL's built-in fonts (like every other protocol here) have no Myanmar
 * glyphs. Coordinates/size are in dots, matching printerStore's label size.
 */
export const buildZplLabel = (capture: { width: number; height: number; pixels: Uint8Array }): Uint8Array => {
  const bmp = toMonochromeBitmap(capture);
  const totalBytes = bmp.bytesPerRow * bmp.height;

  let hex = "";
  for (let i = 0; i < bmp.data.length; i++) {
    hex += HEX_CHARS[bmp.data[i] >> 4];
    hex += HEX_CHARS[bmp.data[i] & 0x0f];
  }

  const header = `^XA^PW${bmp.width}^LL${bmp.height}^FO0,0^GFA,${totalBytes},${totalBytes},${bmp.bytesPerRow},`;
  const footer = `^FS^XZ`;
  return concatBytes(asciiBytes(header), asciiBytes(hex), asciiBytes(footer));
};

/**
 * CPCL — same whole-label-as-bitmap approach via the EG command. Unlike
 * ZPL's ^GFA, EG's image data is raw binary (not hex-encoded), appended
 * directly after the command line.
 *
 * The "200 200" in the `!` init line is CPCL's near-universal convention
 * for the assumed dpi regardless of the printer's actual physical dpi —
 * every CPCL sample this was modeled on hardcodes it the same way. If a
 * real printer prints at the wrong physical size, this is the first thing
 * to tune (see README).
 */
export const buildCpclLabel = (capture: { width: number; height: number; pixels: Uint8Array }): Uint8Array => {
  const bmp = toMonochromeBitmap(capture);

  const header = `! 0 200 200 ${bmp.height} 1\r\nPW ${bmp.width}\r\nEG ${bmp.bytesPerRow} ${bmp.height} 0 0 `;
  const footer = `\r\nPRINT\r\n`;
  return concatBytes(asciiBytes(header), bmp.data, asciiBytes(footer));
};
