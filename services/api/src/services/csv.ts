export type Cell = string | number | boolean | null;

// Spreadsheet apps run a cell that starts with one of these as a formula. Strings come from contract text,
// so a vendor name like =HYPERLINK(...) would execute when the export is opened in Excel.
const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

// Only strings are escaped: numbers and booleans are ours, and a negative day count must stay a number.
export function csvCell(value: Cell): string {
  if (value === null) return "";
  if (typeof value !== "string") return String(value);
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return NEEDS_QUOTES.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

// rfc 4180: CRLF between records, and after the last one.
export function toCsv(header: readonly string[], rows: readonly (readonly Cell[])[]): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(",") + "\r\n").join("");
}
