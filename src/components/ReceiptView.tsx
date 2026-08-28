import React from "react";
import { View, Text, StyleSheet, LayoutChangeEvent } from "react-native";
import type { Sale, ShopSettings } from "../types";

interface Props {
  sale:  Sale;
  width: number;
  shop?: ShopSettings | null;
  /** Taste multiplier on top of the width-derived scale — see printerStore. */
  textScale?: number;
  onLayout?: (e: LayoutChangeEvent) => void;
}

// The width these sizes were originally chosen against — 58mm paper, whose
// printable area is 384 dots at 8 dots/mm. Everything below is expressed
// relative to it, so a wider roll gets proportionally larger text rather
// than the same text stranded on more paper.
const BASE_WIDTH = 384;

// A dashed rule, drawn as a row of small filled blocks rather than with
// borderStyle: "dashed". RN's dashed borders render inconsistently on
// Android and this ends up in a 1-bit bitmap where a hairline that renders
// slightly grey can disappear entirely at the threshold — explicit blocks
// always survive.
const DashedRule = ({ width, scale }: { width: number; scale: number }) => {
  const dash = Math.max(2, Math.round(3 * scale));
  const gap = dash;
  const count = Math.floor(width / (dash + gap));
  return (
    <View style={{ flexDirection: "row", marginVertical: Math.round(7 * scale) }}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={{ width: dash, height: Math.max(1, Math.round(scale)), backgroundColor: "#000", marginRight: gap }} />
      ))}
    </View>
  );
};

// Rendered off-screen and captured as an image (see ReceiptPrinter) rather
// than sent as text — captured bitmaps print correctly on ESC/POS printers
// regardless of font/locale since it's just pixels.
export const ReceiptView = ({ sale, width, shop, textScale = 1, onLayout }: Props) => {
  const currency = shop?.currency ?? "$";
  const money = (n: number) => `${currency}${n.toLocaleString()}`;
  const created = new Date(sale.createdAt || Date.now());
  const dateStr = created.toLocaleDateString();
  const timeStr = created.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  // Type and spacing scale with the paper. The sizes used to be fixed, so
  // switching from a 58mm roll to an 80mm one left every line the same
  // ~1.75mm tall while the paper grew by half again — the text kept its
  // real size but shrank against the page, which reads as squashed.
  const scale = (width / BASE_WIDTH) * textScale;
  const s = React.useMemo(() => makeStyles(scale), [scale]);
  const ruleWidth = width - Math.round(28 * scale);

  return (
    <View style={[s.receipt, { width }]} onLayout={onLayout}>
      {/* Masthead */}
      <Text style={s.shopName}>{shop?.name || "Retail POS"}</Text>
      {!!shop?.address && <Text style={s.centerSub}>{shop.address}</Text>}
      {!!shop?.phone && <Text style={s.centerSub}>{shop.phone}</Text>}
      {!!shop?.receiptHeader && <Text style={[s.centerSub, s.headerMsg]}>{shop.receiptHeader}</Text>}

      <DashedRule width={ruleWidth} scale={scale} />

      {/* Sale meta — paired left/right instead of a stack of centred lines,
          which reads as a form rather than a run-on header and is shorter. */}
      <View style={s.metaRow}>
        <Text style={s.meta}>Sale #{sale.id}</Text>
        <Text style={s.meta}>{dateStr} {timeStr}</Text>
      </View>
      {(!!sale.branchName || !!sale.cashierName) && (
        <View style={s.metaRow}>
          <Text style={s.meta}>{sale.branchName ?? ""}</Text>
          <Text style={s.meta}>{sale.cashierName ? `Cashier: ${sale.cashierName}` : ""}</Text>
        </View>
      )}
      {!!sale.customerName && (
        <View style={s.metaRow}>
          <Text style={s.meta}>Customer: {sale.customerName}</Text>
        </View>
      )}

      <View style={s.rule} />

      {/* Items — the name owns its line so long Myanmar names never fight
          the amount for space, with quantity and unit price indented under
          it and the amount right-aligned to form a clean money column. */}
      {sale.items.map(item => (
        <View key={item.id} style={s.itemBlock}>
          <Text style={s.itemName}>{item.productName}</Text>
          <View style={s.row}>
            <Text style={s.itemMeta}>  {item.qty} {item.unit} × {money(item.unitPrice)}</Text>
            <Text style={s.itemAmt}>{money(item.subtotal)}</Text>
          </View>
          {item.discount > 0 && (
            <View style={s.row}>
              <Text style={s.itemMeta}>  Discount</Text>
              <Text style={s.itemMeta}>-{money(item.discount)}</Text>
            </View>
          )}
        </View>
      ))}

      <DashedRule width={ruleWidth} scale={scale} />

      <View style={s.row}>
        <Text style={s.label}>Subtotal</Text>
        <Text style={s.value}>{money(sale.subtotal)}</Text>
      </View>
      {sale.discount > 0 && (
        <View style={s.row}>
          <Text style={s.label}>Discount</Text>
          <Text style={s.value}>-{money(sale.discount)}</Text>
        </View>
      )}
      {sale.taxAmount > 0 && (
        <View style={s.row}>
          <Text style={s.label}>Tax</Text>
          <Text style={s.value}>{money(sale.taxAmount)}</Text>
        </View>
      )}

      {/* The total is the one line anyone reads from across a counter, so
          it gets the heaviest rules and the largest type on the receipt. */}
      <View style={s.totalRuleTop} />
      <View style={s.row}>
        <Text style={s.totalLabel}>TOTAL</Text>
        <Text style={s.totalValue}>{money(sale.total)}</Text>
      </View>
      <View style={s.totalRuleBottom} />

      {sale.paymentMethod === "Split" && sale.payments && sale.payments.length > 0 ? (
        sale.payments.map(p => (
          <View key={p.method} style={s.row}>
            <Text style={s.label}>{p.method}</Text>
            <Text style={s.value}>{money(p.amount)}</Text>
          </View>
        ))
      ) : (
        <View style={s.row}>
          <Text style={s.label}>{sale.paymentMethod}</Text>
          <Text style={s.value}>{money(sale.total)}</Text>
        </View>
      )}
      {sale.paymentMethod === "Cash" && (
        <>
          <View style={s.row}>
            <Text style={s.label}>Tendered</Text>
            <Text style={s.value}>{money(sale.tendered)}</Text>
          </View>
          <View style={s.row}>
            <Text style={s.label}>Change</Text>
            <Text style={s.value}>{money(sale.changeDue)}</Text>
          </View>
        </>
      )}

      {(sale.pointsEarned > 0 || sale.pointsRedeemed > 0) && (
        <>
          <DashedRule width={ruleWidth} scale={scale} />
          {sale.pointsRedeemed > 0 && (
            <View style={s.row}>
              <Text style={s.label}>Points redeemed</Text>
              <Text style={s.value}>-{sale.pointsRedeemed}</Text>
            </View>
          )}
          {sale.pointsEarned > 0 && (
            <View style={s.row}>
              <Text style={s.label}>Points earned</Text>
              <Text style={s.value}>+{sale.pointsEarned}</Text>
            </View>
          )}
        </>
      )}

      <DashedRule width={ruleWidth} scale={scale} />
      <Text style={s.footer}>{shop?.receiptFooter || "Thank you!"}</Text>
    </View>
  );
};

const makeStyles = (scale: number) => {
  // Rounded because these end up as printer dots — a fractional font size
  // just gets anti-aliased into a slightly blurrier glyph at this
  // resolution, and a rule must land on a whole dot or it can vanish
  // entirely when the bitmap is thresholded.
  const px = (n: number) => Math.round(n * scale);
  const rule = Math.max(1, px(1));

  // Every line gets an explicit line height, at 1.5x its type size.
  //
  // Without one, React Native gives a line only as much room as the font's
  // own metrics ask for, and Myanmar asks for less than it uses: its vowel
  // signs and medials stack well above and below the Latin line box, so
  // consecutive lines sat almost on top of each other and the whole receipt
  // read as squeezed — the "flat" look — with the tops and tails of Myanmar
  // glyphs crowding the line above and below. 1.5x is enough for a
  // fully-stacked Myanmar syllable and looks deliberate on the Latin lines
  // rather than merely roomy.
  const line = (size: number) => Math.round(size * 1.5);

  // Type is a step smaller than it was across the board. On an 80mm roll
  // the width-derived scale alone made everything half again as large, and
  // large type on a receipt reads as shouting, not as clarity — the room it
  // takes is better spent on the space between lines.
  const size = {
    shop:  px(19),
    sub:   px(11),
    meta:  px(10),
    item:  px(12),
    small: px(11),
    body:  px(12),
    total: px(17),
  };

  return StyleSheet.create({
    receipt: { backgroundColor: "#fff", paddingVertical: px(14), paddingHorizontal: px(12) },

    shopName:  { color: "#000", fontSize: size.shop, lineHeight: line(size.shop), fontWeight: "800", textAlign: "center", letterSpacing: px(0.5) },
    centerSub: { color: "#000", fontSize: size.sub, lineHeight: line(size.sub), textAlign: "center", marginTop: px(2) },
    headerMsg: { fontStyle: "italic", marginTop: px(5) },

    metaRow: { flexDirection: "row", justifyContent: "space-between", marginTop: px(1) },
    meta: { color: "#000", fontSize: size.meta, lineHeight: line(size.meta) },

    rule: { height: rule, backgroundColor: "#000", marginVertical: px(7) },

    // Each item is its own block with air around it, so a two-line item
    // never runs into the next one's name.
    itemBlock: { marginBottom: px(6) },
    itemName:  { color: "#000", fontSize: size.item, lineHeight: line(size.item), fontWeight: "700" },
    itemMeta:  { color: "#000", fontSize: size.small, lineHeight: line(size.small) },
    itemAmt:   { color: "#000", fontSize: size.item, lineHeight: line(size.item), fontWeight: "700" },

    row: { flexDirection: "row", justifyContent: "space-between", marginTop: px(1) },
    label: { color: "#000", fontSize: size.body, lineHeight: line(size.body) },
    value: { color: "#000", fontSize: size.body, lineHeight: line(size.body), fontWeight: "600" },

    totalRuleTop:    { height: Math.max(2, px(2)), backgroundColor: "#000", marginTop: px(8), marginBottom: px(5) },
    totalRuleBottom: { height: Math.max(2, px(2)), backgroundColor: "#000", marginTop: px(5), marginBottom: px(8) },
    totalLabel: { color: "#000", fontSize: size.total, lineHeight: line(size.total), fontWeight: "800", letterSpacing: px(0.5) },
    totalValue: { color: "#000", fontSize: size.total, lineHeight: line(size.total), fontWeight: "800" },

    footer: { color: "#000", fontSize: size.body, lineHeight: line(size.body), fontWeight: "700", textAlign: "center", marginTop: px(2) },
  });
};
