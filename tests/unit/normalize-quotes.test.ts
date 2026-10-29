import { describe, expect, it } from "vitest";
import { normalize, norm, toRawRange } from "@/lib/extract/normalize";
import { pageOf, QuoteVerifier, verifyClaimQuotes } from "@/lib/verify/quotes";

describe("normalize", () => {
  it("splits ligatures with NFKC", () => {
    expect(norm("signiﬁcant proﬁt")).toBe("significant profit");
  });
  it("removes soft hyphens and zero-width characters", () => {
    expect(norm("reve\u00adnue gr\u200bowth")).toBe("revenue growth");
  });
  it("joins words hyphenated across a line break", () => {
    expect(norm("operating mar-\ngin improved")).toBe("operating margin improved");
    expect(norm("operating mar-\n  gin")).toBe("operating margin");
  });
  it("keeps the hyphen when asked (compound words split across lines)", () => {
    expect(norm("non-\nGAAP results", { joinHyphens: false })).toBe("non-gaap results");
  });
  it("does not join a hyphen followed by a digit", () => {
    expect(norm("2025-\n2026")).toBe("2025- 2026");
  });
  it("maps curly quotes and apostrophes to straight ones", () => {
    expect(norm("L\u2019Oréal said \u201cstrong\u201d")).toBe("l'oréal said \"strong\"");
  });
  it("maps every dash variant to a hyphen", () => {
    expect(norm("a\u2013b\u2014c\u2212d\u2011e")).toBe("a-b-c-d-e");
  });
  it("maps NBSP and thin spaces to a space and collapses whitespace", () => {
    expect(norm("  €\u00a057.1\u202fbillion \n\n\t up  ")).toBe("€ 57.1 billion up");
  });
  it("lowercases", () => {
    expect(norm("Record HIGH")).toBe("record high");
  });
  it("maps normalized offsets back to the raw text", () => {
    const raw = "Hello  W\u00adorld,\n  \u201csigniﬁcant\u201d results";
    const n = normalize(raw);
    const at = n.text.indexOf("significant");
    const r = toRawRange(n, at, at + "significant".length);
    expect(raw.slice(r.start, r.end)).toBe("signiﬁcant");
    const w = n.text.indexOf("world");
    const rw = toRawRange(n, w, w + 5);
    expect(raw.slice(rw.start, rw.end)).toBe("W\u00adorld");
  });
});

const DOC = {
  id: "doc1",
  text: "Third quarter 2026.\nRevenues up +17% organic to €11.5 billion, a record high for any quarter.\n\nThe Group\u2019s signiﬁcant pro-\ngress continued.",
  pageStarts: [0, 20, 90],
};
const OTHER = { id: "doc2", text: "Something entirely different is written in this second document.", pageStarts: [] };

describe("QuoteVerifier", () => {
  const v = new QuoteVerifier([DOC, OTHER]);

  it("accepts an exact quote", () => {
    const c = v.check({ document_id: "doc1", text: "Revenues up +17% organic to €11.5 billion" });
    expect(c.ok).toBe(true);
    expect(c.verified!.page).toBe(2);
  });
  it("accepts a quote after normalization (straight quotes, line breaks, ligatures)", () => {
    const c = v.check({ document_id: "doc1", text: "The Group's significant progress continued." });
    expect(c.ok).toBe(true);
    expect(c.verified!.page).toBe(3);
    expect(c.verified!.text).toContain("pro-\ngress");
  });
  it("accepts a quote that spans a line break", () => {
    expect(v.check({ document_id: "doc1", text: "Third quarter 2026. Revenues up +17% organic" }).ok).toBe(true);
  });
  it("tolerates wrapping quotation marks and a trailing ellipsis", () => {
    expect(v.check({ document_id: "doc1", text: "\u201cRevenues up +17% organic to €11.5 billion...\u201d" }).ok).toBe(true);
  });
  it("rejects a one-word substitution", () => {
    const c = v.check({ document_id: "doc1", text: "Revenues up +17% organic to €12.5 billion" });
    expect(c).toMatchObject({ ok: false, reason: "not_found" });
  });
  it("rejects a quote attributed to another document", () => {
    expect(v.check({ document_id: "doc2", text: "Revenues up +17% organic to €11.5 billion" })).toMatchObject({ ok: false, reason: "not_found" });
  });
  it("rejects an unknown document id", () => {
    expect(v.check({ document_id: "nope", text: "Revenues up +17% organic to €11.5 billion" })).toMatchObject({ ok: false, reason: "unknown_document" });
  });
  it("rejects quotes shorter than 20 or longer than 400 characters", () => {
    expect(v.check({ document_id: "doc1", text: "Revenues up" })).toMatchObject({ ok: false, reason: "too_short" });
    expect(v.check({ document_id: "doc1", text: "x".repeat(401) })).toMatchObject({ ok: false, reason: "too_long" });
  });
  it("drops a claim when one quote out of two fails", () => {
    const r = verifyClaimQuotes(v, [
      { document_id: "doc1", text: "Revenues up +17% organic to €11.5 billion" },
      { document_id: "doc1", text: "Revenues down 3% organic to €9.0 billion" },
    ]);
    expect(r.ok).toBe(false);
  });
  it("keeps a claim when all quotes verify", () => {
    const r = verifyClaimQuotes(v, [
      { document_id: "doc1", text: "Revenues up +17% organic to €11.5 billion" },
      { document_id: "doc2", text: "Something entirely different is written" },
    ]);
    expect(r.ok).toBe(true);
  });
});

describe("pageOf", () => {
  it("maps offsets across page boundaries", () => {
    expect(pageOf([0, 100, 250], 0)).toBe(1);
    expect(pageOf([0, 100, 250], 99)).toBe(1);
    expect(pageOf([0, 100, 250], 100)).toBe(2);
    expect(pageOf([0, 100, 250], 300)).toBe(3);
    expect(pageOf([], 10)).toBeNull();
  });
});
