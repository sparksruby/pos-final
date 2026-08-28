import React, { createContext, useCallback, useContext, useRef } from "react";
import { router } from "expo-router";
import { ReceiptPrinter, ReceiptPrinterHandle } from "../components/ReceiptPrinter";
import { useAlert } from "./AlertContext";
import { useLanguage } from "./LanguageContext";
import type { Sale } from "../types";

interface PrintContextValue {
  /**
   * Prints a receipt. Reports its own failures — callers do not need to
   * catch, and should generally not await: see below.
   */
  printReceipt: (sale: Sale) => Promise<void>;
}

const PrintContext = createContext<PrintContextValue | null>(null);

export const usePrint = (): PrintContextValue => {
  const ctx = useContext(PrintContext);
  if (!ctx) throw new Error("usePrint must be used within PrintProvider");
  return ctx;
};

/**
 * Holds the one <ReceiptPrinter> for the whole app, above the navigator.
 *
 * It used to be mounted inside the screens that print. That made a print
 * job the property of a screen: the checkout screen could not close until
 * the paper had finished coming out, because navigating away would unmount
 * the off-screen view being captured and the connection writing it. So
 * after tapping Print the cashier sat looking at a finished sale for as
 * long as the receipt took — which, for a long receipt over Bluetooth, is
 * many seconds — and if the printer never answered, the screen never left
 * at all.
 *
 * Mounted here it outlives any screen, so a caller can start a print and
 * navigate in the same breath.
 */
export const PrintProvider = ({ children }: { children: React.ReactNode }) => {
  const printerRef = useRef<ReceiptPrinterHandle>(null);
  const { alert } = useAlert();
  const { t } = useLanguage();

  const printReceipt = useCallback(async (sale: Sale) => {
    try {
      await printerRef.current?.print(sale);
    } catch (e: any) {
      if (e?.message === "NO_PRINTER_SELECTED") {
        alert(t("payment.noPrinterTitle"), t("payment.noPrinterMsg"), [
          { text: t("common.cancel"), style: "cancel" },
          { text: t("payment.connectPrinter"), onPress: () => router.push("/(pos)/printer-settings") },
        ]);
      } else {
        alert(t("common.error"), t("payment.printFailed"));
      }
    }
  }, [alert, t]);

  return (
    <PrintContext.Provider value={{ printReceipt }}>
      {children}
      <ReceiptPrinter ref={printerRef} />
    </PrintContext.Provider>
  );
};
