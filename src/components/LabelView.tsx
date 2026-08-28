import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { encodeCode128B } from "../utils/code128";

interface Props {
  name: string;
  price: number;
  currency: string;
  barcode?: string;
  labelText: string; // shop line under the barcode — already resolved to product.labelText ?? shop default ?? ""
  widthDots: number;
  heightDots: number;
}

// One size for the product name, the price and the shop line, so nothing on
// the label shouts over anything else. The barcode digits stay a touch
// smaller — they're a fallback for the scanner, not something anyone reads.
const LABEL_FONT_SIZE = 13;
const LABEL_PAD = 6;

// The shop line runs ALONG the label, under the barcode, like every other
// line on it.
//
// It used to be set down the right-hand edge, turned a quarter turn. That
// needed the text captured separately, its pixels rotated, and the two
// halves composited back together — three steps the product name, the price
// and the barcode digits never go through, and every one of them a place
// where the text could come back empty. On real hardware it did, repeatedly:
// the strip printed as a few stray dots while everything laid out normally
// printed perfectly. This route is the same one those working lines take,
// with nothing left to go wrong.
export const LabelView = ({
  name,
  price,
  currency,
  barcode,
  labelText,
  widthDots,
  heightDots,
}: Props) => {
  const barcodeAreaWidth = widthDots - LABEL_PAD * 2;

  let modules = "";
  try {
    if (barcode) modules = encodeCode128B(barcode);
  } catch {
    modules = ""; // unsupported char in barcode — render the label without bars rather than crash
  }
  // Whole dots only: a fractional bar width gets anti-aliased into grey,
  // and grey is a coin toss once the bitmap is thresholded to 1bpp.
  const moduleWidth = modules.length
    ? Math.max(1, Math.floor(barcodeAreaWidth / modules.length))
    : 1;
  const barcodeHeight = Math.round(heightDots * 0.3);

  return (
    <View style={[s.label, { width: widthDots, height: heightDots }]}>
      <View style={s.headerRow}>
        <Text style={s.name} numberOfLines={1}>
          {name}
        </Text>
        <Text style={s.price}>
          {currency}
          {price.toLocaleString()}
        </Text>
      </View>

      {!!modules && (
        <View style={[s.barcode, { height: barcodeHeight }]}>
          {modules.split("").map((bit, i) => (
            <View
              key={i}
              style={{
                width: moduleWidth,
                height: barcodeHeight,
                backgroundColor: bit === "1" ? "#000" : "#fff",
              }}
            />
          ))}
        </View>
      )}

      {!!barcode && <Text style={s.barcodeNumber}>{barcode}</Text>}

      {!!labelText && (
        <View style={s.shopBlock}>
          {/* A short rule rather than a full-width one, so it reads as a
              divider under the barcode instead of a second box edge. */}
          <View style={[s.shopRule, { width: Math.round(widthDots * 0.55) }]} />
          <Text style={s.shopText} numberOfLines={1}>
            {labelText}
          </Text>
        </View>
      )}
    </View>
  );
};

const s = StyleSheet.create({
  // Opaque white background matters here, not just cosmetics — the
  // raw-bitmap path (labelRaw.ts) reads these pixels directly, and an
  // uncovered area captures transparent.
  label: {
    backgroundColor: "#fff",
    paddingHorizontal: LABEL_PAD,
    paddingTop: LABEL_PAD,
    overflow: "hidden",
  },

  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  name: {
    color: "#000",
    fontSize: LABEL_FONT_SIZE,
    fontWeight: "700",
    flexShrink: 1,
    marginRight: 4,
  },
  price: { color: "#000", fontSize: LABEL_FONT_SIZE, fontWeight: "800" },

  barcode: { flexDirection: "row", justifyContent: "center", marginTop: 6 },
  barcodeNumber: {
    color: "#000",
    fontSize: 11,
    textAlign: "center",
    marginTop: 2,
    letterSpacing: 1,
  },

  shopBlock: { alignItems: "center", marginTop: 5 },
  shopRule: { height: 1, backgroundColor: "#000", marginBottom: 4 },
  shopText: {
    color: "#000",
    fontSize: LABEL_FONT_SIZE,
    fontWeight: "800",
    letterSpacing: 0.5,
    textAlign: "center",
  },
});
