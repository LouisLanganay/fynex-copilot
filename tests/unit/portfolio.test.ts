import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CsvError, isValidIsin, parseDecimal, parsePortfolioCsv, sanitizeCell } from "@/lib/portfolio/csv";
import { parseEcbXml, toEur, type FxRates } from "@/lib/portfolio/fx";
import { allowedNumbers, computeWeights, pct } from "@/lib/portfolio/weights";

const SAMPLE = fs.readFileSync(path.join(__dirname, "../../samples/portfolio.csv"), "utf8");
const FX: FxRates = { date: "2026-10-29", rates: { EUR: 1, USD: 1.1, GBP: 0.85 } };

describe("csv", () => {
  it("parses the sample portfolio", () => {
    const r = parsePortfolioCsv(SAMPLE);
    expect(r.errors).toEqual([]);
    expect(r.holdings).toHaveLength(12);
    expect(r.holdings[0]).toMatchObject({ ticker: "AAPL", isin: "US0378331005", quantity: 12, costPrice: 180, currency: "USD" });
  });
  it("parses the Fynex layout: semicolons, French headers, decimal comma, BOM", () => {
    const csv = "\ufeffNom;ISIN;Quantité;Prix de revient;Devise\nLVMH;FR0000121014;4;610,50;EUR\nSchneider;FR0000121972;1 000;215,00;EUR\n";
    const r = parsePortfolioCsv(csv);
    expect(r.errors).toEqual([]);
    expect(r.holdings.map((h) => [h.name, h.quantity, h.costPrice])).toEqual([
      ["LVMH", 4, 610.5],
      ["Schneider", 1000, 215],
    ]);
  });
  it("lists bad rows instead of guessing", () => {
    const csv = "ticker,isin,name,quantity\nAAPL,US0378331005,Apple,0\n,,Nothing,3\nMSFT,US5949181045,Microsoft,abc\nKO,US1912161007,Coca-Cola,5\n";
    const r = parsePortfolioCsv(csv);
    expect(r.holdings.map((h) => h.ticker)).toEqual(["KO"]);
    expect(r.errors.map((e) => e.row)).toEqual([2, 3, 4]);
  });
  it("rejects a wrong ISIN check digit", () => {
    const r = parsePortfolioCsv("isin,quantity\nUS0378331006,3\n");
    expect(r.errors[0].message).toMatch(/check digit/);
  });
  it("rejects files over 50 rows", () => {
    const rows = Array.from({ length: 51 }, (_, i) => `T${i},1`).join("\n");
    expect(() => parsePortfolioCsv(`ticker,quantity\n${rows}\n`)).toThrow(CsvError);
  });
  it("rejects files over 100 KB", () => {
    expect(() => parsePortfolioCsv("ticker,quantity\n" + "A,1\n".repeat(30000))).toThrow(/100 KB/);
  });
  it("requires a ticker or ISIN column and a quantity column", () => {
    expect(() => parsePortfolioCsv("name,quantity\nApple,1\n")).toThrow(/ticker or an ISIN/);
    expect(() => parsePortfolioCsv("ticker,name\nAAPL,Apple\n")).toThrow(/quantity/);
  });
  it("sanitizes formula cells", () => {
    expect(sanitizeCell("=HYPERLINK(1)")).toBe("HYPERLINK(1)");
    expect(sanitizeCell("@SUM")).toBe("SUM");
  });
  it("validates ISINs", () => {
    expect(isValidIsin("NL0010273215")).toBe(true);
    expect(isValidIsin("FR0000121014")).toBe(true);
    expect(isValidIsin("FR0000121015")).toBe(false);
  });
  it("parses decimals", () => {
    expect(parseDecimal("1 234,56")).toBe(1234.56);
    expect(parseDecimal("1,234.56")).toBe(1234.56);
    expect(parseDecimal("12")).toBe(12);
    expect(parseDecimal("abc")).toBeNaN();
  });
});

describe("fx", () => {
  it("parses the ECB daily XML", () => {
    const xml = `<Cube><Cube time='2026-10-29'><Cube currency='USD' rate='1.0812'/><Cube currency='GBP' rate='0.8421'/></Cube></Cube>`;
    expect(parseEcbXml(xml)).toEqual({ date: "2026-10-29", rates: { EUR: 1, USD: 1.0812, GBP: 0.8421 } });
  });
  it("converts to EUR", () => {
    expect(toEur(110, "USD", FX)).toBeCloseTo(100);
    expect(toEur(100, "EUR", FX)).toBe(100);
    expect(toEur(8500, "GBX", FX)).toBeCloseTo(100);
    expect(() => toEur(1, "XYZ", FX)).toThrow();
  });
});

describe("weights", () => {
  it("computes weights that sum to 100% and ranks lines", () => {
    const { holdings } = parsePortfolioCsv(SAMPLE);
    const s = computeWeights(holdings, FX);
    const sum = s.holdings.reduce((a, h) => a + h.weight, 0);
    expect(sum).toBeCloseTo(1, 10);
    expect(Math.round(sum * 1000) / 10).toBe(100);
    expect(s.holdings.map((h) => h.rank)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(s.atCost).toBe(true);
    const tte = s.holdings.find((h) => h.ticker === "TTE")!;
    expect(tte.valueEur).toBeCloseTo(40 * 56);
  });
  it("prefers last price over cost price", () => {
    const s = computeWeights(
      [
        { id: "A", ticker: "A", isin: null, name: "A", quantity: 1, costPrice: 100, lastPrice: 300, currency: "EUR" },
        { id: "B", ticker: "B", isin: null, name: "B", quantity: 1, costPrice: 100, lastPrice: null, currency: "EUR" },
      ],
      FX,
    );
    expect(pct(s.holdings[0].weight)).toBe(75);
    expect(s.holdings[0].priceBasis).toBe("last_price");
  });
  it("exposes the allowed numbers", () => {
    const { holdings } = parsePortfolioCsv(SAMPLE);
    const s = computeWeights(holdings, FX);
    const a = allowedNumbers(s.holdings[0], s);
    expect(a).toContain(pct(s.holdings[0].weight));
    expect(a).toContain(12);
  });
});
