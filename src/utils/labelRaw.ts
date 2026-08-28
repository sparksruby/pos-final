// Decodes react-native-view-shot's format:"raw" capture ("<width>:<height>|
// <base64 ARGB bytes>", see the library's Android ViewShot.java —
// Bitmap#copyPixelsToBuffer on ARGB_8888) into a packed 1bpp monochrome
// bitmap, for building CPCL/ZPL bitmap commands ourselves (those two
// protocols have no native module in react-native-bluetooth-escpos-printer,
// unlike ESC/POS's printPic or TSPL's printLabel — see LabelPrinter.tsx).
//
// No image-decoding dependency needed: "raw" gives uncompressed pixels
// directly, we just have to parse the header and un-base64 it ourselves.

const BASE64_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// Character code -> 6-bit value, with 0xFF marking anything that is not a
// base64 digit (padding, newlines, whatever else turns up).
const BASE64_LOOKUP = (() => {
  const table = new Uint8Array(256).fill(0xff);
  for (let i = 0; i < BASE64_CHARS.length; i++) table[BASE64_CHARS.charCodeAt(i)] = i;
  return table;
})();

/**
 * Manual base64 -> bytes decode (no Buffer/atob dependency — RN has neither
 * by default).
 *
 * Written for size, because of what it is fed: a receipt capture is a few
 * million pixels at four bytes each, so the input string runs to several
 * megabytes and this is the hottest loop in a print job by a wide margin.
 * Two things used to make it far slower than it needed to be — a regex
 * `replace` that built a second multi-megabyte string before decoding
 * started, and `BASE64_CHARS.indexOf(c)` per character, which rescans up to
 * 64 characters for every one of those millions. A 256-entry lookup table
 * indexed by char code does the same job in one step, and skipping
 * non-base64 characters inline removes the need to pre-clean the string at
 * all. This was most of the delay between pressing Print and the paper
 * moving.
 */
export const decodeBase64 = (input: string): Uint8Array => {
  const length = input.length;
  // Upper bound: 4 base64 characters carry 3 bytes. Trimmed at the end if
  // the input held padding or whitespace.
  const bytes = new Uint8Array((length * 3) >> 2);

  let bitBuffer = 0;
  let bitCount = 0;
  let outIndex = 0;
  for (let i = 0; i < length; i++) {
    const value = BASE64_LOOKUP[input.charCodeAt(i) & 0xff];
    if (value === 0xff) continue;
    bitBuffer = (bitBuffer << 6) | value;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      bytes[outIndex++] = (bitBuffer >> bitCount) & 0xff;
    }
  }
  return outIndex === bytes.length ? bytes : bytes.subarray(0, outIndex);
};

// Joins byte runs into one buffer.
//
// The command builders used to assemble their output as
// `new Uint8Array([...header, ...bitmap, ...footer])`. Spreading a bitmap
// into an array literal turns a compact hundred-kilobyte Uint8Array into a
// hundred thousand individually boxed JavaScript numbers, which are then
// read back one at a time to fill the typed array — and the ESC/POS builder
// did it twice over the same data. Allocating once and copying each run
// with `set` is the same result without any of that.
export const concatBytes = (...parts: (Uint8Array | number[])[]): Uint8Array => {
  let total = 0;
  for (const part of parts) total += part.length;

  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

export interface RawCapture {
  width:  number;
  height: number;
  /** RGBA-or-ARGB bytes (order is ambiguous by design — see toMonochrome below), 4 per pixel, row-major. */
  pixels: Uint8Array;
}

export const parseRawCapture = (captured: string): RawCapture => {
  const sep = captured.indexOf("|");
  if (sep === -1) throw new Error("INVALID_RAW_CAPTURE");
  const [wStr, hStr] = captured.slice(0, sep).split(":");
  const width = Number(wStr);
  const height = Number(hStr);
  if (!width || !height) throw new Error("INVALID_RAW_CAPTURE_SIZE");
  const pixels = decodeBase64(captured.slice(sep + 1));
  return { width, height, pixels };
};

// Second-smallest of four bytes. Alpha is exactly one of the four, and
// this discards one extreme, so the result reflects the colour channels
// whatever order they arrive in and whether alpha reads 0 or 255:
//
//   opaque white       255,255,255,255 -> 255  (paper)
//   opaque black         0,  0,  0,255 ->   0  (ink)
//   transparent white  255,255,255,  0 -> 255  (paper)
//   transparent black    0,  0,  0,  0 ->   0  (ink)
//
// Both rules this replaces got one of those four wrong: `min(...)` scored
// a transparent pixel as ink because alpha alone dragged the minimum to
// zero, and counting dark bytes needed a different count depending on
// whether the pixel was opaque or not.
//
// Written without the array-and-for-of it reads more nicely as: this runs
// once per pixel, twice over (the blank-row trim and the monochrome pack),
// so on a receipt that is a couple of million allocations handed to the
// garbage collector for nothing.
const secondSmallest = (a: number, b: number, c: number, d: number): number => {
  let min1 = 255, min2 = 255;
  if (a < min1) { min2 = min1; min1 = a; } else if (a < min2) { min2 = a; }
  if (b < min1) { min2 = min1; min1 = b; } else if (b < min2) { min2 = b; }
  if (c < min1) { min2 = min1; min1 = c; } else if (c < min2) { min2 = c; }
  if (d < min1) { min2 = min1; min1 = d; } else if (d < min2) { min2 = d; }
  return min2;
};

// Flips a capture to its photographic negative, for printers whose raster
// command treats a set bit as "leave blank" rather than "burn a dot".
// Every byte is flipped, alpha included, which is correct rather than
// sloppy: secondSmallest above ignores whichever single byte is the
// extreme, so an inverted opaque-white pixel (0,0,0,0) still reads as ink
// and an inverted opaque-black one (255,255,255,0) still reads as paper.
//
// Rewrites the buffer in place rather than allocating a second one. A
// receipt capture is several megabytes; both printers hand the result
// straight to a command builder and never look at the original again.
export const invertRawCapture = (capture: RawCapture): RawCapture => {
  const { pixels } = capture;
  for (let i = 0; i < pixels.length; i++) pixels[i] = 255 - pixels[i];
  return capture;
};

// Fills transparent pixels with white.
//
// captureRef pads to the size asked for, and the padding is transparent
// rather than white. A transparent pixel is all four bytes zero, which is
// indistinguishable from solid ink by colour alone — so the padding below
// a receipt survived the blank-row trim as if it were content, and the
// inversion then turned it into the solid black block that came out of
// the printer after every receipt.
//
// Alpha's position among the four bytes is not fixed, so it is found
// rather than assumed: in an opaque ink pixel three bytes are dark and
// exactly one is bright, and that one is alpha. Any receipt or label has
// black text, so such a pixel exists; if none is found the capture has no
// ink to print and is handed back untouched.
export const flattenTransparentToWhite = (capture: RawCapture, threshold = 128): RawCapture => {
  const { pixels } = capture;

  let alphaIndex = -1;
  for (let p = 0; p < pixels.length && alphaIndex === -1; p += 4) {
    let darkCount = 0;
    let brightIndex = -1;
    for (let c = 0; c < 4; c++) {
      if (pixels[p + c] < threshold) darkCount++;
      else brightIndex = c;
    }
    if (darkCount === 3) alphaIndex = brightIndex;
  }
  if (alphaIndex === -1) return capture;

  // In place, for the same reason as invertRawCapture above.
  for (let p = 0; p < pixels.length; p += 4) {
    if (pixels[p + alphaIndex] < threshold) {
      pixels[p] = 255; pixels[p + 1] = 255; pixels[p + 2] = 255; pixels[p + 3] = 255;
    }
  }
  return capture;
};

// Scales a capture down to an exact pixel width, keeping its proportions.
//
// captureRef's width/height options do not mean what they appear to. Asked
// for 576 x 737 on a 3x-density phone it returned 1728 x 261 — the width
// multiplied by the screen density, and the height taken from a stale,
// mid-layout measurement multiplied by the same. The proportions were then
// nothing like the receipt's, and the printer dutifully rendered a receipt
// squashed to a third of its height.
//
// So nothing is requested any more: the view is captured at its own
// natural size, whatever that is, which is the one thing guaranteed to
// have the right shape. This brings it to the printer's dot width
// afterwards, where the arithmetic is ours and can be checked.
//
// Each output pixel averages the block of input pixels it covers rather
// than sampling one of them. At a 3:1 reduction, picking one pixel per
// block drops whole stems out of small glyphs; averaging keeps a trace of
// every stroke, which then survives the threshold to 1bpp.
export const resizeRawCaptureWidth = (capture: RawCapture, targetWidth: number): RawCapture => {
  const { width, height, pixels } = capture;
  if (width === targetWidth || targetWidth <= 0 || width <= 0) return capture;

  const scale = width / targetWidth;
  const targetHeight = Math.max(1, Math.round(height / scale));
  const out = new Uint8Array(targetWidth * targetHeight * 4);

  for (let y = 0; y < targetHeight; y++) {
    const srcY0 = Math.floor(y * scale);
    const srcY1 = Math.min(height, Math.max(srcY0 + 1, Math.floor((y + 1) * scale)));

    for (let x = 0; x < targetWidth; x++) {
      const srcX0 = Math.floor(x * scale);
      const srcX1 = Math.min(width, Math.max(srcX0 + 1, Math.floor((x + 1) * scale)));

      let a = 0, b = 0, c = 0, d = 0, count = 0;
      for (let sy = srcY0; sy < srcY1; sy++) {
        let p = (sy * width + srcX0) * 4;
        for (let sx = srcX0; sx < srcX1; sx++) {
          a += pixels[p]; b += pixels[p + 1]; c += pixels[p + 2]; d += pixels[p + 3];
          p += 4;
          count++;
        }
      }

      const o = (y * targetWidth + x) * 4;
      out[o]     = (a / count) | 0;
      out[o + 1] = (b / count) | 0;
      out[o + 2] = (c / count) | 0;
      out[o + 3] = (d / count) | 0;
    }
  }

  return { width: targetWidth, height: targetHeight, pixels: out };
};

// Crops blank rows off the bottom of a capture, keeping `marginRows` of
// white after the last row that has any ink on it.
//
// A receipt's captured height is whatever its container laid out to, which
// is not the same as where its content actually ends — and for TSPL that
// height becomes the SIZE the printer feeds out, so every unused row at
// the bottom is blank paper the user tears off and throws away. Cropping
// here rather than trying to make the capture height exact keeps this
// independent of how the view happened to lay out.
//
// The margin is not cosmetic: a thermal print head sits a short distance
// behind the tear bar, so stopping the feed exactly at the last printed
// row leaves those last lines still inside the mechanism, unreadable
// until the next print pushes them out.
export const trimTrailingBlankRows = (
  capture: RawCapture,
  marginRows = 24, // ~3mm at 8 dots/mm
  threshold = 128,
): RawCapture => {
  const { width, height, pixels } = capture;

  let lastInkRow = -1;
  for (let y = height - 1; y >= 0; y--) {
    let rowHasInk = false;
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      if (secondSmallest(pixels[p], pixels[p + 1], pixels[p + 2], pixels[p + 3]) < threshold) {
        rowHasInk = true;
        break;
      }
    }
    if (rowHasInk) { lastInkRow = y; break; }
  }

  // No ink at all — nothing to crop against, hand it back untouched
  // rather than returning a zero-height bitmap the command builders
  // would have to special-case.
  if (lastInkRow === -1) return capture;

  const newHeight = Math.min(height, lastInkRow + 1 + marginRows);
  if (newHeight >= height) return capture;

  return { width, height: newHeight, pixels: pixels.subarray(0, width * newHeight * 4) };
};

/**
 * Packs the capture into a 1bpp monochrome bitmap, MSB-first per byte,
 * 1 = black/print (the convention ZPL's ^GFA and CPCL's EG both expect).
 * See secondSmallest above for how ink is told from paper without
 * assuming a channel order or an alpha value.
 */
export const toMonochromeBitmap = (
  capture: RawCapture,
  threshold = 128
): { width: number; height: number; bytesPerRow: number; data: Uint8Array } => {
  const { width, height, pixels } = capture;
  const bytesPerRow = Math.ceil(width / 8);
  const data = new Uint8Array(bytesPerRow * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      if (secondSmallest(pixels[p], pixels[p + 1], pixels[p + 2], pixels[p + 3]) < threshold) {
        const byteIndex = y * bytesPerRow + (x >> 3);
        data[byteIndex] |= 0x80 >> (x & 7);
      }
    }
  }

  return { width, height, bytesPerRow, data };
};
