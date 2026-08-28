import React, { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { View } from "react-native";
import { captureRef } from "react-native-view-shot";
import { BluetoothEscposPrinter } from "react-native-bluetooth-escpos-printer";
import { usePrinterStore } from "../store/printerStore";
import { useShopStore } from "@/store/shopStore";
import { ReceiptView } from "./ReceiptView";
import { parseRawCapture, trimTrailingBlankRows, invertRawCapture, flattenTransparentToWhite, resizeRawCaptureWidth } from "../utils/labelRaw";
import { buildEscposReceipt } from "../utils/escposRaster";
import { buildZplLabel, buildCpclLabel } from "../utils/labelCommands";
import { buildTsplLabel } from "../utils/tsplRaw";
import type { Sale } from "../types";

export interface ReceiptPrinterHandle {
  print: (sale: Sale) => Promise<void>;
}

// A thermal printer's usual resolution, same constant LabelPrinter uses to
// convert its mm settings into dots.
const DOTS_PER_MM = 8;

// How tall the off-screen host lets a receipt be. It has to be stated, and
// generously: an absolutely-positioned view with an automatic height is
// measured against the space its parent has left, which off-screen is the
// screen. A receipt taller than the screen was therefore laid out — and
// reported by onLayout — clamped to about screen height, while its content
// carried on past that. captureRef was then asked to fit the taller
// content into the shorter height, and it scales rather than crops, which
// is why the printed text came out squashed flat, and squashed worse the
// longer the receipt got.
//
// 6000dp is far more than any single sale's receipt and costs nothing: the
// host is off-screen, mounted only while a print is in flight, and its
// height only sets how much room the receipt is allowed to ask for.
const MAX_RECEIPT_HEIGHT = 6000;

// Renders ReceiptView off-screen, captures it as an image, and sends that
// image to the saved Bluetooth printer. Mount one of these anywhere in a
// screen's tree and call `.print()` via a ref.
export const ReceiptPrinter = forwardRef<ReceiptPrinterHandle>((_props, ref) => {
  const containerRef = useRef<View>(null);
  const [pending, setPending] = useState<Sale | null>(null);
  const { paperWidth, labelProtocol, connectionType, invertReceipt, receiptTextScale, ensureConnected, sendBleBytes, setLastReceiptGeom } = usePrinterStore();
  const shopSettings = useShopStore(state => state.settings);

  // The capture asks for an exact height, so that height has to be the
  // one the receipt finally settled at.
  //
  // onLayout fires more than once for a single sale — a second pass after
  // text measurement or a font load is normal, and the receipt grows a lot
  // between them. Nothing downstream depends on the measurement any more
  // (the capture takes the view at its natural size, see below), so this
  // exists only to hold the print back until the receipt has stopped
  // growing. The wait is generous for that reason: overshooting costs a
  // few hundred milliseconds once per sale, undershooting used to mean
  // capturing a receipt that was still only its masthead.
  const LAYOUT_SETTLE_MS = 350;
  const layoutResolveRef = useRef<(() => void) | null>(null);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleLayout = () => {
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(() => {
      layoutResolveRef.current?.();
      layoutResolveRef.current = null;
    }, LAYOUT_SETTLE_MS);
  };

  useImperativeHandle(ref, () => ({
    print: async (sale) => {
      setPending(sale);
      const layout = new Promise<void>(resolve => { layoutResolveRef.current = resolve; });
      // 3000ms ceiling only — real layouts land far sooner; it exists so a
      // print request can't hang forever if onLayout never fires for some
      // edge case (e.g. an empty sale.items list).
      await Promise.race([layout, new Promise<void>(resolve => setTimeout(resolve, 3000))]);

      try {
        await ensureConnected();

        // BLE printers (see printerStore/blePrinter.ts) can't use the
        // native module's printPic — that call owns its own classic-only
        // Bluetooth socket internally, with no way to redirect it at a
        // BLE connection. Build the raster bytes ourselves instead and
        // send those over the BLE writer.
        //
        // Dispatched on the same labelProtocol setting the Label Printer
        // section uses, not hardcoded to ESC/POS — confirmed on real
        // hardware (a Zywell ZY310, primarily a label printer) that its
        // BLE firmware runs TSPL labels fine but silently drops an
        // ESC/POS GS v 0 raster receipt at any paper width: no error,
        // just nothing on paper, because the raster command itself isn't
        // implemented, not because of a width mismatch. Same physical
        // Bluetooth link, same printer, different command language.
        if (connectionType === "ble") {
          // No size is requested. captureRef's width/height do not mean
          // pixels: asked for 576 x 737 on a 3x-density phone it returned
          // 1728 x 261 — the width multiplied by the screen density, and
          // the height taken from a layout measurement that had not
          // settled, multiplied by the same. Nothing about that bitmap was
          // the shape of the receipt, and the printer rendered it squashed
          // to a third of its height. Captured at its natural size the
          // shape is right by construction, and resizeRawCaptureWidth
          // brings it to the printer's dot width with arithmetic that can
          // be checked.
          //
          // Then, in order: flatten, resize, trim, invert. Flattening comes
          // first because transparent pixels are all four bytes zero, which
          // is indistinguishable from solid ink — left in, they survived
          // the blank-row trim as though they were content, and the
          // inversion turned them into the block of solid black that used
          // to follow every receipt.
          const raw = parseRawCapture(
            await captureRef(containerRef, { format: "raw", result: "base64" })
          );
          const scaled = resizeRawCaptureWidth(flattenTransparentToWhite(raw), paperWidth);
          const rawCapture = trimTrailingBlankRows(scaled);
          const captured = invertReceipt ? invertRawCapture(rawCapture) : rawCapture;

          // Both sizes, for the printer screen. These two have to be in the
          // same proportion; when they were not, that difference was the
          // squash.
          setLastReceiptGeom({
            viewW: raw.width,
            viewH: raw.height,
            imgW: captured.width,
            imgH: captured.height,
          });

          if (labelProtocol === "TSPL") {
            // Derive TSPL's SIZE from the bitmap's own dot count, not from
            // the paper's nominal label ("80mm" / "58mm"). A roll sold as
            // 80mm only prints 72mm of that (576 dots at 8 dots/mm; a 58mm
            // roll likewise prints 48mm / 384 dots) — the rest is margin
            // the print head can't reach. Declaring SIZE 80mm for a
            // 576-dot bitmap told the printer the page was 640 dots wide
            // and left the difference as a blank strip down the right-hand
            // edge, which is exactly what showed up on paper.
            const widthMm = captured.width / DOTS_PER_MM;
            const heightMm = Math.ceil(captured.height / DOTS_PER_MM);
            await sendBleBytes(buildTsplLabel(captured, widthMm, heightMm, 0));
          } else if (labelProtocol === "ZPL") {
            await sendBleBytes(buildZplLabel(captured));
          } else if (labelProtocol === "CPCL") {
            await sendBleBytes(buildCpclLabel(captured));
          } else {
            await sendBleBytes(buildEscposReceipt(captured));
          }
          return;
        }

        const base64 = await captureRef(containerRef, {
          format: "png",
          quality: 1,
          result: "base64",
        });
        BluetoothEscposPrinter.setWidth(paperWidth);
        BluetoothEscposPrinter.printPic(base64, { width: paperWidth });
      } finally {
        setPending(null);
      }
    },
  }));

  // The off-screen wrapper is `position: absolute` so it never affects the
  // host screen's layout — but the ref handed to captureRef is the inner,
  // normally-laid-out View, not the absolute wrapper itself. That's the
  // one structural difference that was left between this and the label
  // print path, which captures inner views (LabelPrinter's mainRef /
  // stripRef inside its own absolute wrapper) and renders correct
  // black-on-white from the same builders, same protocol, same printer,
  // while this one kept coming back inverted.
  return (
    <View
      collapsable={false}
      pointerEvents="none"
      style={{ position: "absolute", left: -9999, top: 0, width: paperWidth, height: MAX_RECEIPT_HEIGHT }}
    >
      {pending && (
        <View ref={containerRef} collapsable={false} style={{ backgroundColor: "#fff", width: paperWidth }}>
          <ReceiptView
            sale={pending}
            width={paperWidth}
            shop={shopSettings}
            textScale={receiptTextScale}
            onLayout={handleLayout}
          />
        </View>
      )}
    </View>
  );
});
