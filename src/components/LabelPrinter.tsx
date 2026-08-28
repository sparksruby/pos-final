import React, { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { View } from "react-native";
import { captureRef } from "react-native-view-shot";
import { BluetoothEscposPrinter, BluetoothTscPrinter } from "react-native-bluetooth-escpos-printer";
import { usePrinterStore } from "../store/printerStore";
import { LabelView } from "./LabelView";
import {
  parseRawCapture, invertRawCapture, flattenTransparentToWhite,
  type RawCapture,
} from "../utils/labelRaw";
import { buildCpclLabel, buildZplLabel, encodeBase64 } from "../utils/labelCommands";
import { buildEscposReceipt } from "../utils/escposRaster";
import { buildTsplLabel } from "../utils/tsplRaw";

export interface LabelPrintRequest {
  name:      string;
  price:     number;
  currency:  string;
  barcode?:  string;
  labelText: string;
  qty:       number;
}

export interface LabelPrinterHandle {
  print: (request: LabelPrintRequest) => Promise<void>;
}

// A thermal printer's usual resolution — see printer-settings.tsx's mm
// inputs, converted to dots here for both rendering and every protocol's
// size commands.
const DOTS_PER_MM = 8;

// Small pause between copies of the same label so a slow printer's buffer
// isn't flooded — Bluetooth SPP has no flow-control feedback this library
// exposes.
const BETWEEN_COPIES_MS = 250;

export const LabelPrinter = forwardRef<LabelPrinterHandle>((_props, ref) => {
  const containerRef = useRef<View>(null);
  const [pending, setPending] = useState<LabelPrintRequest | null>(null);
  const { labelProtocol, labelWidthMm, labelHeightMm, labelGapMm, connectionType, invertLabel, ensureConnected, sendBleBytes } = usePrinterStore();

  const widthDots  = Math.round(labelWidthMm * DOTS_PER_MM);
  const heightDots = Math.round(labelHeightMm * DOTS_PER_MM);

  // One capture of the whole label, exactly the size it will print at —
  // no crop, no rotate, no recompositing. Every line on the label is now
  // laid out the same way as the product name and the barcode digits,
  // which have always come out right; the extra pixel work only ever
  // existed to serve the sideways shop text and was where that text kept
  // getting lost.
  //
  // The flatten stays: captureRef pads to the requested size with
  // TRANSPARENT pixels, and transparent is all four bytes zero, which is
  // indistinguishable from solid ink by colour alone.
  const captureLabelRaw = async (): Promise<RawCapture> => {
    const captured = flattenTransparentToWhite(
      parseRawCapture(
        await captureRef(containerRef, { format: "raw", result: "base64", width: widthDots, height: heightDots })
      )
    );

    return invertLabel ? invertRawCapture(captured) : captured;
  };

  useImperativeHandle(ref, () => ({
    print: async (request) => {
      setPending(request);
      // Let the off-screen view actually lay out before capturing it —
      // LabelView's sizing comes straight from props, so there is nothing
      // async left to wait on beyond the layout commit.
      await new Promise(resolve => setTimeout(resolve, 80));

      try {
        await ensureConnected();

        // Explicit width/height forces react-native-view-shot to resize the
        // capture to exactly widthDots x heightDots pixels — without it, the
        // capture comes out at the view's dp size times the device's pixel
        // ratio (2x/3x on most phones), so the "dots" we hand to the printer
        // wouldn't actually match the bitmap's real pixel dimensions.
        const captureSize = { width: widthDots, height: heightDots };

        // BLE printers (see printerStore/blePrinter.ts): none of this
        // library's native modules — printPic, TSC's printLabel, the
        // printRawData patch used below for CPCL/ZPL — can be pointed at
        // an externally-managed BLE connection, they each own a classic-
        // only Bluetooth socket internally. Every protocol's bytes are
        // built the same way regardless of transport; only how they get
        // sent differs, so this branch covers all four before the
        // classic-only per-protocol calls below.
        if (connectionType === "ble") {
          const rawCapture = await captureLabelRaw();
          const bytes =
            labelProtocol === "ESCPOS" ? buildEscposReceipt(rawCapture)
            : labelProtocol === "TSPL"  ? buildTsplLabel(rawCapture, labelWidthMm, labelHeightMm, labelGapMm)
            : labelProtocol === "ZPL"   ? buildZplLabel(rawCapture)
            : buildCpclLabel(rawCapture);
          for (let i = 0; i < request.qty; i++) {
            await sendBleBytes(bytes);
            if (i < request.qty - 1) await sleep(BETWEEN_COPIES_MS);
          }
          return;
        }

        if (labelProtocol === "ESCPOS") {
          const base64 = await captureRef(containerRef, { format: "png", quality: 1, result: "base64", ...captureSize });
          for (let i = 0; i < request.qty; i++) {
            BluetoothEscposPrinter.printPic(base64, { width: widthDots });
            if (i < request.qty - 1) await sleep(BETWEEN_COPIES_MS);
          }
          return;
        }

        if (labelProtocol === "TSPL") {
          const base64 = await captureRef(containerRef, { format: "png", quality: 1, result: "base64", ...captureSize });
          for (let i = 0; i < request.qty; i++) {
            await BluetoothTscPrinter.printLabel({
              // The native module's SIZE/GAP commands take millimetres, not
              // dots — only the bitmap's own `width` field (below) is in
              // dots (the native addBitmap() converts that to bytes itself).
              // Sending dots here made the printer think each label was ~8x
              // its real physical size, which misaligns gap-sensing/cutting
              // and was clipping content near the label's right edge.
              width: labelWidthMm, height: labelHeightMm, gap: labelGapMm,
              image: [{ x: 0, y: 0, width: widthDots, mode: 0, image: base64 }],
            });
            if (i < request.qty - 1) await sleep(BETWEEN_COPIES_MS);
          }
          return;
        }

        // CPCL / ZPL — no native module in this library, build+send the raw
        // command bytes ourselves (see src/utils/labelCommands.ts).
        const rawCapture = await captureLabelRaw();
        const commandBytes = labelProtocol === "ZPL" ? buildZplLabel(rawCapture) : buildCpclLabel(rawCapture);
        const commandBase64 = encodeBase64(commandBytes);
        for (let i = 0; i < request.qty; i++) {
          await BluetoothEscposPrinter.printRawData(commandBase64);
          if (i < request.qty - 1) await sleep(BETWEEN_COPIES_MS);
        }
      } finally {
        setPending(null);
      }
    },
  }));

  // The off-screen host is explicitly sized to the label and the captured
  // view is an inner child of it. A view laid out beyond its parent's
  // bounds is not drawn, and captureRef can only read what was drawn.
  return (
    <View
      collapsable={false}
      pointerEvents="none"
      style={{
        position: "absolute", left: -9999, top: 0, backgroundColor: "#fff",
        width: widthDots, height: heightDots,
      }}
    >
      {pending && (
        <View
          ref={containerRef}
          collapsable={false}
          style={{ backgroundColor: "#fff", width: widthDots, height: heightDots }}
        >
          <LabelView
            name={pending.name}
            price={pending.price}
            currency={pending.currency}
            barcode={pending.barcode}
            labelText={pending.labelText}
            widthDots={widthDots}
            heightDots={heightDots}
          />
        </View>
      )}
    </View>
  );
});

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
