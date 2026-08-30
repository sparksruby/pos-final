import * as XLSX from "xlsx";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { saveToDevice } from "./directSave";

/**
 * The reports screen, as a spreadsheet.
 *
 * Sales History already exported the raw sales; this exports what the
 * reports screen worked out from them — the breakdowns by product,
 * category, cashier, payment method and branch, each on its own sheet so a
 * shopkeeper can sort and filter one without the others in the way.
 *
 * Profit is included because the screen shows it, and it carries the same
 * caveat: it uses each product's cost price as it stands today, not the
 * cost on the day of the sale. The header row says so, since a figure like
 * this ends up in a spreadsheet that outlives the screen it came from.
 */

/** The shape the reports screen already builds — see Row in reports.tsx. */
export interface ReportRow {
  label:   string;
  qty:     number;
  revenue: number;
  /** Absent for the breakdowns where profit is not meaningful (payment method). */
  profit?: number;
}

export interface ReportExportInput {
  periodLabel:   string;
  branchLabel:   string;
  currency:      string;
  count:         number;
  netRevenue:    number;
  refundedTotal: number;
  profitTotal:   number;
  totalDiscount: number;
  byProduct:     ReportRow[];
  byCategory:    ReportRow[];
  byCashier:     ReportRow[];
  byMethod:      ReportRow[];
  byBranch:      ReportRow[];
}

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const sheetFor = (rows: ReportRow[], countHeader: string) =>
  XLSX.utils.aoa_to_sheet([
    [countHeader, "Qty", "Revenue", "Profit"],
    ...rows.map(r => [r.label, r.qty, r.revenue, r.profit ?? 0]),
  ]);

const buildWorkbook = (input: ReportExportInput) => {
  const summary: (string | number)[][] = [
    ["Report Period", input.periodLabel],
    ["Branch", input.branchLabel],
    [],
    ["Sales", input.count],
    ["Net Revenue", input.netRevenue],
    ["Refunded", input.refundedTotal],
    ["Discounts Given", input.totalDiscount],
    ["Profit", input.profitTotal],
    [],
    ["Currency", input.currency],
    // Written into the file rather than only shown on screen: a spreadsheet
    // gets emailed on and read by people who never saw the app.
    ["Note", "Profit uses each product's current cost price, not the cost at the time of sale."],
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), "Summary");
  XLSX.utils.book_append_sheet(wb, sheetFor(input.byProduct, "Product"), "By Product");
  XLSX.utils.book_append_sheet(wb, sheetFor(input.byCategory, "Category"), "By Category");
  XLSX.utils.book_append_sheet(wb, sheetFor(input.byCashier, "Cashier"), "By Cashier");
  XLSX.utils.book_append_sheet(wb, sheetFor(input.byMethod, "Payment Method"), "By Payment");
  if (input.byBranch.length > 0) {
    XLSX.utils.book_append_sheet(wb, sheetFor(input.byBranch, "Branch"), "By Branch");
  }
  return wb;
};

export const exportReportExcel = async (
  input: ReportExportInput, method: "share" | "save" = "share"
): Promise<boolean> => {
  const wb = buildWorkbook(input);
  const base64 = XLSX.write(wb, { type: "base64", bookType: "xlsx" });

  const safePeriod = input.periodLabel.replace(/[^A-Za-z0-9-]+/g, "-");
  const filename = `report-${safePeriod}.xlsx`;

  if (method === "save") {
    return saveToDevice(filename, base64, XLSX_MIME);
  }

  const uri = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(uri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  if (!(await Sharing.isAvailableAsync())) return false;
  await Sharing.shareAsync(uri, {
    mimeType: XLSX_MIME,
    dialogTitle: filename,
    UTI: "org.openxmlformats.spreadsheetml.sheet",
  });
  return true;
};
