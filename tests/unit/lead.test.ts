import { describe, expect, it } from "vitest";
import type { Card } from "@/lib/card";
import { findAdvice } from "@/lib/guardrail/advice";
import { feedGroup, formatWeight, LEAD_NONE, LEAD_NOTE, leadChanges, leadCombinedWeight, leadSummary, leadTitle } from "@/lib/lead";

function card(over: Partial<Card>): Card {
  return {
    holdingId: over.name ?? "x",
    name: "x",
    ticker: null,
    weightPct: 5,
    rank: 1,
    state: "ok",
    status: "material_change",
    headline: "Headline",
    claims: [],
    portfolioNote: "",
    documents: [],
    triage: null,
    attempts: 1,
    rejections: [],
    quotesVerified: 0,
    model: "m",
    usage: { prompt: 0, cached: 0, completion: 0, reasoning: 0 },
    costUsd: 0,
    generatedAt: "2026-11-02",
    ...over,
  };
}

describe("leadChanges", () => {
  it("keeps the 3 heaviest material changes, heaviest first", () => {
    const lead = leadChanges([card({ name: "a", weightPct: 2 }), card({ name: "b", weightPct: 9 }), card({ name: "c", weightPct: 4 }), card({ name: "d", weightPct: 7 })]);
    expect(lead.rows.map((r) => r.name)).toEqual(["b", "d", "c"]);
    expect(lead.materialCount).toBe(4);
    expect(lead.total).toBe(4);
  });

  it("returns nothing with 0 material changes, and fewer rows with 1 or 2", () => {
    const minor = card({ name: "m", status: "minor_update" });
    expect(leadChanges([minor]).rows).toEqual([]);
    expect(leadChanges([minor, card({ name: "a" })]).rows).toHaveLength(1);
    expect(leadChanges([minor, card({ name: "a" }), card({ name: "b" })]).rows).toHaveLength(2);
  });

  it("ignores cards that are not verified", () => {
    const lead = leadChanges([card({ name: "f", state: "fallback" }), card({ name: "e", state: "error", status: null }), card({ name: "n", state: "no_document", status: null })]);
    expect(lead.rows).toEqual([]);
    expect(lead.total).toBe(3);
  });

  it("puts missing weights last and breaks ties on rank, then name", () => {
    const lead = leadChanges([
      card({ name: "nan", weightPct: NaN }),
      card({ name: "second", weightPct: 9.1, rank: 4 }),
      card({ name: "first", weightPct: 9.1, rank: 3 }),
    ]);
    expect(lead.rows.map((r) => r.name)).toEqual(["first", "second", "nan"]);
    expect(lead.rows[2].weightPct).toBeNull();
    const byName = leadChanges([card({ name: "b", weightPct: undefined as never, rank: undefined as never }), card({ name: "a", weightPct: null as never, rank: undefined as never })]);
    expect(byName.rows.map((r) => r.name)).toEqual(["a", "b"]);
  });

  it("does not change the order of its input", () => {
    const input = [card({ name: "a", weightPct: 1 }), card({ name: "b", weightPct: 2 })];
    leadChanges(input);
    expect(input.map((c) => c.name)).toEqual(["a", "b"]);
  });
});

describe("lead wording", () => {
  it("formats weights and says when one is missing", () => {
    expect(formatWeight(9.14)).toBe("9.1%");
    expect(formatWeight(0)).toBe("0.0%");
    expect(formatWeight(null)).toBe("Weight unknown");
    expect(formatWeight(NaN)).toBe("Weight unknown");
    expect(formatWeight(-1)).toBe("Weight unknown");
  });

  it("sums the shown weights only when all are known", () => {
    expect(leadCombinedWeight(leadChanges([card({ weightPct: 10.3 }), card({ weightPct: 9.4 }), card({ weightPct: 9.1 })]).rows)).toBe(29);
    expect(leadCombinedWeight(leadChanges([card({ weightPct: 10 }), card({ weightPct: NaN })]).rows)).toBeNull();
    expect(leadCombinedWeight([])).toBeNull();
  });

  it("adapts the summary to what is shown", () => {
    const four = leadChanges([card({ weightPct: 10 }), card({ weightPct: 9 }), card({ weightPct: 8 }), card({ weightPct: 7 }), card({ status: "minor_update" })]);
    expect(leadSummary(four)).toBe("4 of 5 lines report a material change. The 3 largest are shown, about 27% of the portfolio.");
    const one = leadChanges([card({ weightPct: 10 }), card({ status: "minor_update" })]);
    expect(leadSummary(one)).toBe("1 of 2 lines report a material change, about 10% of the portfolio.");
    expect(leadTitle(one)).toBe("Largest line with a material change");
    expect(leadTitle(four)).toBe("Largest lines with a material change");
    const single = leadChanges([card({ weightPct: NaN })]);
    expect(leadSummary(single)).toBe("1 of 1 line reports a material change.");
  });

  it("passes the advice filter", () => {
    const lead = leadChanges([card({ weightPct: 10 }), card({ weightPct: 9 }), card({ weightPct: 8 }), card({ weightPct: 7 })]);
    for (const s of [LEAD_NOTE, LEAD_NONE, leadTitle(lead), leadSummary(lead)]) expect(findAdvice(s)).toBeNull();
  });
});

describe("feedGroup", () => {
  it("groups by status, and anything without an analysis apart", () => {
    expect(feedGroup(card({}))).toBe("material");
    expect(feedGroup(card({ status: "minor_update" }))).toBe("minor");
    expect(feedGroup(card({ state: "fallback", status: "minor_update" }))).toBe("minor");
    expect(feedGroup(card({ status: "no_new_information" }))).toBe("nothing");
    expect(feedGroup(card({ state: "no_source", status: null }))).toBe("other");
    expect(feedGroup(null)).toBe("other");
  });
});
