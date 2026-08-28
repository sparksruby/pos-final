import * as XLSX from "xlsx";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { saveToDevice } from "./directSave";
import type { Sale } from "../types";

interface ExportInput {
  sales:        Sale[];
  periodLabel:  string;
  currency:     string;
  totalRevenue: number;
  topProducts:  [string, number][];
}

const buildWorkbook = ({ sales, periodLabel, currency, totalRevenue, topProducts }: ExportInput) => {
  const totalRefunded = sales.reduce((sum, sale) => sum + (sale.refundedAmount ?? 0), 0);
  const summaryRows: (string | number)[][] = [
    ["Report Period", periodLabel],
    [],
    ["Total Sales", sales.length],
    ["Total Revenue", `${currency}${totalRevenue.toLocaleString()}`],
    ...(totalRefunded > 0 ? [["Total Refunded", `${currency}${totalRefunded.toLocaleString()}`]] : []),
    [],
    ["Top Products", "Qty Sold"],
    ...topProducts.map(([name, qty]) => [name, qty]),
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);

  const detailRows: (string | number)[][] = [
    ["Sale ID", "Date/Time", "Branch", "Product", "Qty", "Unit", "Unit Price", "Line Subtotal", "Item Discount",
     "Sale Discount", "Sale Tax", "Sale Total", "Payment Method", "Payment Breakdown",
     "Customer", "Points Earned", "Points Redeemed", "Refunded Amount"],
  ];
  for (const sale of sales) {
    const dateStr = new Date(sale.createdAt).toLocaleString();
    const breakdown = sale.payments?.length
      ? sale.payments.map(p => `${p.method}: ${currency}${p.amount.toLocaleString()}`).join(", ")
      : "";
    for (const item of sale.items) {
      detailRows.push([
        sale.id, dateStr, sale.branchName ?? "", item.productName, item.qty, item.unit, item.unitPrice, item.subtotal, item.discount,
        sale.discount, sale.taxAmount, sale.total, sale.paymentMethod, breakdown,
        sale.customerName ?? "", sale.pointsEarned, sale.pointsRedeemed, sale.refundedAmount ?? 0,
      ]);
    }
  }
  const detailSheet = XLSX.utils.aoa_to_sheet(detailRows);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, summarySheet, "Summary");
  XLSX.utils.book_append_sheet(wb, detailSheet, "Sales");
  return wb;
};

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// Writes the workbook to a temp file, then either opens the native share
// sheet (Files, email, Drive, ...) or — method: "save" — writes it straight
// into a user-picked folder via directSave.ts, no share sheet involved.
export const exportSalesExcel = async (input: ExportInput, method: "share" | "save" = "share"): Promise<boolean> => {
  const wb = buildWorkbook(input);
  const base64 = XLSX.write(wb, { type: "base64", bookType: "xlsx" });

  const safeLabel = input.periodLabel.replace(/[^\w-]+/g, "_");
  const fileName = `sales-report-${safeLabel}.xlsx`;
  const uri = `${FileSystem.cacheDirectory}${fileName}`;
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });

  if (method === "save") {
    return saveToDevice(uri, XLSX_MIME, fileName);
  }

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: XLSX_MIME,
      dialogTitle: "Export Sales Report",
      UTI: "org.openxmlformats.spreadsheetml.sheet",
    });
  }
  return true;
};
