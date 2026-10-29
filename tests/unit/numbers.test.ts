import { describe, expect, it } from "vitest";
import { checkNumbers, extractNumbers, parseNumber } from "@/lib/verify/numbers";

describe("parseNumber", () => {
  it("handles English and French separators", () => {
    expect(parseNumber("1,234.5")).toEqual([1234.5]);
    expect(parseNumber("1 234,5")).toEqual([1234.5]);
    expect(parseNumber("1.234,5")).toEqual([1234.5]);
    expect(parseNumber("57,1")).toEqual([57.1]);
    expect(parseNumber("1,234,567")).toEqual([1234567]);
  });
  it("keeps both readings when ambiguous", () => {
    expect(parseNumber("1,234")).toEqual([1234, 1.234]);
  });
});

describe("extractNumbers", () => {
  it("ignores years, quarter labels and 9M", () => {
    expect(extractNumbers("In Q3 2026 and 9M 2025, H1 and FY2026").map((t) => t.raw)).toEqual([]);
  });
  it("ignores bare single digits but not percentages", () => {
    expect(extractNumbers("3 documents, up 5%").map((t) => t.raw)).toEqual(["5"]);
  });
  it("reads currency amounts and percentages", () => {
    const t = extractNumbers("€57.1 billion, up 12% and $1,234.5 million");
    expect(t.map((x) => x.raw)).toEqual(["57.1", "12", "1,234.5"]);
    expect(t[1].percent).toBe(true);
  });
});

describe("checkNumbers", () => {
  const quote = "Revenue reached €57.1 billion, up 12% on a reported basis; net debt of 1 234,5 million.";
  it("passes when the number is in the quote", () => {
    expect(checkNumbers(["Revenue was 57.1 billion euros, up 12%."], [quote], []).ok).toBe(true);
  });
  it("matches 57.1 against €57.1 billion", () => {
    expect(checkNumbers(["€57.1bn"], [quote], []).ok).toBe(true);
  });
  it("matches 1,234.5 against 1 234,5", () => {
    expect(checkNumbers(["Net debt was 1,234.5 million."], [quote], []).ok).toBe(true);
  });
  it("fails on an invented number", () => {
    const r = checkNumbers(["Revenue was 58.3 billion."], [quote], []);
    expect(r.ok).toBe(false);
    expect(r.unsupported).toEqual(["58.3"]);
  });
  it("accepts code-computed numbers from the allowed list", () => {
    expect(checkNumbers(["This line is 8.4% of the portfolio, rank 3 of 12."], [quote], [8.4, 3, 12]).ok).toBe(true);
  });
  it("ignores years and Q3", () => {
    expect(checkNumbers(["In Q3 2026 revenue rose."], [], []).ok).toBe(true);
  });
  it("rejects a computed difference", () => {
    expect(checkNumbers(["Revenue grew by 6.1 billion."], [quote], []).ok).toBe(false);
  });
});
