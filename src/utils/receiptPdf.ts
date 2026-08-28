import * as Print from "expo-print";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { saveToDevice } from "./directSave";
import type { Sale, ShopSettings } from "../types";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const row = (label: string, value: string, bold = false) => `
  <div class="row${bold ? " bold" : ""}">
    <span>${esc(label)}</span><span>${esc(value)}</span>
  </div>`;

// Builds the same receipt content as <ReceiptView> (see src/components/ReceiptView.tsx)
// as printable HTML — expo-print renders this to a PDF rather than capturing
// a bitmap, since a saved PDF benefits from real (selectable, crisp) text.
const buildReceiptHtml = (sale: Sale, shop?: ShopSettings | null): string => {
  const currency = shop?.currency ?? "$";
  const money = (n: number) => `${currency}${n.toLocaleString()}`;
  const dateStr = new Date(sale.createdAt || Date.now()).toLocaleString();

  const itemsHtml = sale.items.map(item => `
    <div class="item">
      <div class="row bold"><span>${esc(item.productName)} × ${item.qty} ${esc(item.unit)}</span></div>
      ${row(`${money(item.unitPrice)} each`, money(item.subtotal))}
      ${item.discount > 0 ? row("Item discount", `-${money(item.discount)}`) : ""}
    </div>
  `).join("");

  const paymentHtml = sale.paymentMethod === "Split" && sale.payments?.length
    ? sale.payments.map(p => row(p.method, money(p.amount))).join("")
    : row(sale.paymentMethod, money(sale.total));

  const cashHtml = sale.paymentMethod === "Cash"
    ? row("Tendered", money(sale.tendered)) + row("Change", money(sale.changeDue))
    : "";

  const loyaltyHtml = (sale.pointsEarned > 0 || sale.pointsRedeemed > 0)
    ? `<hr />`
      + (sale.pointsRedeemed > 0 ? row("Points redeemed", `-${sale.pointsRedeemed}`) : "")
      + (sale.pointsEarned > 0 ? row("Points earned", `+${sale.pointsEarned}`) : "")
    : "";

  return `
<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  body { display: flex; justify-content: center; font-family: -apple-system, Roboto, Helvetica, Arial, sans-serif; color: #000; margin: 0; padding: 32px 0; }
  .receipt { width: 320px; }
  .center { text-align: center; }
  .shop-name { font-size: 20px; font-weight: 800; }
  .sub { font-size: 13px; margin-top: 2px; }
  .header-msg { font-style: italic; margin-top: 6px; }
  hr { border: none; border-top: 1px solid #000; margin: 10px 0; }
  .item { margin-bottom: 6px; }
  .row { display: flex; justify-content: space-between; font-size: 14px; margin-top: 2px; }
  .row.bold { font-weight: 700; }
  .total-row { display: flex; justify-content: space-between; font-size: 18px; font-weight: 800; }
  .footer { text-align: center; font-size: 14px; font-weight: 700; margin-top: 4px; }
</style>
</head>
<body>
  <div class="receipt">
    <div class="center shop-name">${esc(shop?.name || "Retail POS")}</div>
    ${shop?.address ? `<div class="center sub">${esc(shop.address)}</div>` : ""}
    ${shop?.phone ? `<div class="center sub">${esc(shop.phone)}</div>` : ""}
    ${shop?.receiptHeader ? `<div class="center sub header-msg">${esc(shop.receiptHeader)}</div>` : ""}
    <div class="center sub">Sale #${sale.id}</div>
    <div class="center sub">${esc(dateStr)}</div>
    ${sale.branchName ? `<div class="center sub">${esc(sale.branchName)}</div>` : ""}
    ${sale.customerName ? `<div class="center sub">Customer: ${esc(sale.customerName)}</div>` : ""}

    <hr />
    ${itemsHtml}
    <hr />

    ${row("Subtotal", money(sale.subtotal))}
    ${sale.discount > 0 ? row("Discount", `-${money(sale.discount)}`) : ""}
    ${sale.taxAmount > 0 ? row("Tax", money(sale.taxAmount)) : ""}

    <hr />
    <div class="total-row"><span>TOTAL</span><span>${money(sale.total)}</span></div>
    <hr />

    ${paymentHtml}
    ${cashHtml}
    ${loyaltyHtml}

    <hr />
    <div class="footer">${esc(shop?.receiptFooter || "Thank you!")}</div>
  </div>
</body>
</html>`;
};

// Renders the receipt to a PDF, then either opens the native share sheet
// (Files, email, Drive, ...) or — method: "save" — writes it straight into
// a user-picked folder via directSave.ts, no share sheet involved.
export const exportReceiptPdf = async (
  sale: Sale, shop?: ShopSettings | null, method: "share" | "save" = "share"
): Promise<boolean> => {
  const html = buildReceiptHtml(sale, shop);
  const { uri } = await Print.printToFileAsync({ html, base64: false });

  const fileName = `receipt-${sale.id}.pdf`;
  const dest = `${FileSystem.cacheDirectory}${fileName}`;
  await FileSystem.copyAsync({ from: uri, to: dest });

  if (method === "save") {
    return saveToDevice(dest, "application/pdf", fileName);
  }

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(dest, {
      mimeType: "application/pdf",
      dialogTitle: `Receipt #${sale.id}`,
      UTI: "com.adobe.pdf",
    });
  }
  return true;
};
