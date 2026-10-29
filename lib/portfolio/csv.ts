import Papa from "papaparse";

/** PLAN.md 5.1: portfolio CSV parsing. */

export const MAX_CSV_BYTES = 100 * 1024;
export const MAX_ROWS = 50;

export interface Holding {
  /** Stable id within a portfolio: ISIN, else ticker. */
  id: string;
  ticker: string | null;
  isin: string | null;
  name: string;
  quantity: number;
  costPrice: number | null;
  lastPrice: number | null;
  currency: string;
}

export interface RowError {
  row: number;
  message: string;
}

export interface ParseResult {
  holdings: Holding[];
  errors: RowError[];
}

export class CsvError extends Error {}

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/[\s_-]+/g, " ");

const ALIASES: Record<keyof Omit<Holding, "id">, string[]> = {
  ticker: ["ticker", "symbol", "mnemonique", "symbole"],
  isin: ["isin", "code isin"],
  name: ["name", "nom", "libelle", "company"],
  quantity: ["quantity", "qty", "shares", "quantite", "qte"],
  costPrice: ["cost price", "avg price", "average price", "pru", "prix de revient", "prix moyen"],
  lastPrice: ["last price", "cours", "price", "dernier cours"],
  currency: ["currency", "devise", "ccy"],
};

/** Strip leading formula characters (CSV injection hygiene). */
export function sanitizeCell(s: string): string {
  return s.replace(/^[=+\-@\t\r]+/, "").trim();
}

/** Parse "1 234,56", "1,234.56", "1234.5". Returns NaN on garbage. */
export function parseDecimal(raw: string): number {
  let s = raw.replace(/[\s\u00a0\u202f]/g, "").replace(/[€$£]/g, "");
  if (!s) return NaN;
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (hasComma) {
    s = s.replace(",", ".");
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
  return Number(s);
}

/** ISIN check digit: letters to numbers (A=10), then Luhn. */
export function isValidIsin(isin: string): boolean {
  if (!/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(isin)) return false;
  const digits = isin
    .split("")
    .map((c) => (/[A-Z]/.test(c) ? String(c.charCodeAt(0) - 55) : c))
    .join("");
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

function detectDelimiter(firstLine: string): string {
  const semis = (firstLine.match(/;/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  const tabs = (firstLine.match(/\t/g) || []).length;
  if (tabs > semis && tabs > commas) return "\t";
  return semis > commas ? ";" : ",";
}

export function parsePortfolioCsv(input: string): ParseResult {
  if (new TextEncoder().encode(input).length > MAX_CSV_BYTES) {
    throw new CsvError("File is larger than 100 KB.");
  }
  const text = input.replace(/^\ufeff/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const parsed = Papa.parse<string[]>(text, {
    delimiter: detectDelimiter(firstLine),
    skipEmptyLines: "greedy",
  });
  const rows = parsed.data;
  if (rows.length < 2) throw new CsvError("The file has no data rows.");
  const header = rows[0].map(fold);
  const col: Partial<Record<keyof Omit<Holding, "id">, number>> = {};
  for (const [field, aliases] of Object.entries(ALIASES) as [keyof Omit<Holding, "id">, string[]][]) {
    const idx = header.findIndex((h) => aliases.includes(h));
    if (idx >= 0) col[field] = idx;
  }
  if (col.ticker === undefined && col.isin === undefined) {
    throw new CsvError("The file needs a ticker or an ISIN column.");
  }
  if (col.quantity === undefined) throw new CsvError("The file needs a quantity column.");
  const dataRows = rows.slice(1);
  if (dataRows.length > MAX_ROWS) throw new CsvError(`The file has more than ${MAX_ROWS} rows.`);

  const holdings: Holding[] = [];
  const errors: RowError[] = [];
  const seen = new Set<string>();
  dataRows.forEach((cells, i) => {
    const rowNo = i + 2; // 1-based, header is row 1
    const get = (f: keyof Omit<Holding, "id">) => (col[f] === undefined ? "" : sanitizeCell(cells[col[f]!] ?? ""));
    const ticker = get("ticker").toUpperCase() || null;
    const isinRaw = get("isin").toUpperCase().replace(/\s/g, "") || null;
    if (!ticker && !isinRaw) {
      errors.push({ row: rowNo, message: "Missing ticker and ISIN." });
      return;
    }
    if (isinRaw && !isValidIsin(isinRaw)) {
      errors.push({ row: rowNo, message: `Invalid ISIN "${isinRaw}" (check digit).` });
      return;
    }
    const quantity = parseDecimal(get("quantity"));
    if (!(quantity > 0)) {
      errors.push({ row: rowNo, message: "Quantity must be a positive number." });
      return;
    }
    const costRaw = get("costPrice");
    const costPrice = costRaw ? parseDecimal(costRaw) : null;
    if (costPrice !== null && !(costPrice >= 0)) {
      errors.push({ row: rowNo, message: `Invalid cost price "${costRaw}".` });
      return;
    }
    const lastRaw = get("lastPrice");
    const lastPrice = lastRaw ? parseDecimal(lastRaw) : null;
    if (lastPrice !== null && !(lastPrice >= 0)) {
      errors.push({ row: rowNo, message: `Invalid last price "${lastRaw}".` });
      return;
    }
    const currency = (get("currency") || "EUR").toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      errors.push({ row: rowNo, message: `Invalid currency "${currency}".` });
      return;
    }
    const id = isinRaw ?? ticker!;
    if (seen.has(id)) {
      errors.push({ row: rowNo, message: `Duplicate line for ${id}.` });
      return;
    }
    seen.add(id);
    holdings.push({
      id,
      ticker,
      isin: isinRaw,
      name: get("name") || ticker || isinRaw!,
      quantity,
      costPrice,
      lastPrice,
      currency,
    });
  });
  return { holdings, errors };
}
