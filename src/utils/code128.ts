// Dependency-free Code 128 (subset B) encoder — no barcode-drawing library
// needed, LabelView just paints one View rectangle per module.
//
// BARS is the standard 107-entry Code 128 symbol table (values 0-106): each
// entry is the 11-module (13 for the stop pattern, value 106) black/white
// bit pattern for that value, '1' = black module, '0' = white module. This
// is the same table every Code 128 implementation uses (AIM ISS spec) —
// pulled from JsBarcode's constants and cross-checked here against the two
// widely-published reference patterns (value 0 = widths 2,1,2,2,2,2 and the
// stop pattern = widths 2,3,3,1,1,1,2) to catch transcription mistakes.
const BARS = [
  "11011001100", "11001101100", "11001100110", "10010011000", "10010001100",
  "10001001100", "10011001000", "10011000100", "10001100100", "11001001000",
  "11001000100", "11000100100", "10110011100", "10011011100", "10011001110",
  "10111001100", "10011101100", "10011100110", "11001110010", "11001011100",
  "11001001110", "11011100100", "11001110100", "11101101110", "11101001100",
  "11100101100", "11100100110", "11101100100", "11100110100", "11100110010",
  "11011011000", "11011000110", "11000110110", "10100011000", "10001011000",
  "10001000110", "10110001000", "10001101000", "10001100010", "11010001000",
  "11000101000", "11000100010", "10110111000", "10110001110", "10001101110",
  "10111011000", "10111000110", "10001110110", "11101110110", "11010001110",
  "11000101110", "11011101000", "11011100010", "11011101110", "11101011000",
  "11101000110", "11100010110", "11101101000", "11101100010", "11100011010",
  "11101111010", "11001000010", "11110001010", "10100110000", "10100001100",
  "10010110000", "10010000110", "10000101100", "10000100110", "10110010000",
  "10110000100", "10011010000", "10011000010", "10000110100", "10000110010",
  "11000010010", "11001010000", "11110111010", "11000010100", "10001111010",
  "10100111100", "10010111100", "10010011110", "10111100100", "10011110100",
  "10011110010", "11110100100", "11110010100", "11110010010", "11011011110",
  "11011110110", "11110110110", "10101111000", "10100011110", "10001011110",
  "10111101000", "10111100010", "11110101000", "11110100010", "10111011110",
  "10111101110", "11101011110", "11110101110", "11010000100", "11010010000",
  "11010011100",
  "1100011101011", // STOP (value 106) — 13 modules, not 11
];

const START_B = 104;
const STOP = 106;

// Code Set B covers ASCII 32 ("space") through 127 (value 95); char code -
// 32 = symbol value.
const MIN_CHAR_CODE = 32;
const MAX_CHAR_CODE = 127;

/**
 * Encodes `text` as Code 128 subset B and returns the full module string
 * (start + data + checksum + stop, no quiet zone) — one character per
 * module, "1" = black, "0" = white. Throws if `text` contains a character
 * outside subset B's range (ASCII 32-127) or is empty.
 */
export const encodeCode128B = (text: string): string => {
  if (!text) throw new Error("EMPTY_BARCODE_TEXT");

  const values: number[] = [START_B];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < MIN_CHAR_CODE || code > MAX_CHAR_CODE) {
      throw new Error(`UNSUPPORTED_BARCODE_CHAR: ${text[i]}`);
    }
    values.push(code - MIN_CHAR_CODE);
  }

  let checksum = values[0];
  for (let i = 1; i < values.length; i++) checksum += values[i] * i;
  values.push(checksum % 103);
  values.push(STOP);

  return values.map(v => BARS[v]).join("");
};
