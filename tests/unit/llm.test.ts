import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeDocuments } from "@/lib/llm/analyze";
import { askDocuments } from "@/lib/llm/ask";
import { appendLedger, assertTotalBudget, BudgetExceededError, ledgerTotal, RunBudget } from "@/lib/llm/budget";
import { FakeClient, MetaModelClient, type ChatRequest } from "@/lib/llm/client";
import { mockHandler } from "@/lib/llm/mock";
import { costOf, estimateCost, priceOf, UnknownModelError } from "@/lib/llm/prices";
import { fallbackSelection, triage, type TriageCandidate } from "@/lib/llm/triage";
import { REFUSAL } from "@/lib/guardrail/advice";
import type { SourceDocument } from "@/lib/sources/types";

const DOC: SourceDocument = {
  id: "doc-su",
  source: "AMF",
  url: "https://example.org/su.pdf",
  title: "Third Quarter Revenues 2026",
  date: "2026-10-16",
  formOrSubtype: "Quarterly financial reporting",
  language: "en",
  contentType: "pdf",
  text: "Third Quarter Revenues 2026\nRevenues up +17% organic to €11.5 billion, a record high for any quarter.\n\nThe Group upgrades its 2026 target: Adjusted EBITA growth of between +18% and +21% organic.",
  pageStarts: [0, 90],
  pages: 2,
  ocr: false,
  fetchedAt: "2026-10-29T00:00:00Z",
};

const FACTS = { name: "Schneider Electric SE", ticker: "SU", isin: "FR0000121972", weightPct: 9.1, rank: 4, count: 12, valueEur: 2150, totalEur: 23754, atCost: true };
const ALLOWED = [9.1, 4, 2150, 12, 23754, 10];

const good = {
  status: "material_change",
  headline: "Record quarterly revenue and a higher 2026 target.",
  claims: [
    {
      category: "results",
      statement: "Revenue rose 17% organically to €11.5 billion, a record for a quarter.",
      why_it_matters: "This line is 9.1% of the portfolio, so the update covers a large share of it.",
      quotes: [{ document_id: "D1", text: "Revenues up +17% organic to €11.5 billion, a record high for any quarter." }],
    },
  ],
  portfolio_note: "Schneider is 9.1% of the portfolio, rank 4 of 12.",
};
const badQuote = { ...good, claims: [{ ...good.claims[0], quotes: [{ document_id: "D1", text: "Revenues up +19% organic to €12.5 billion, a record." }] }] };
const advice = { ...good, headline: "Strong quarter: you should consider adding to the position." };
const invented = { ...good, claims: [{ ...good.claims[0], statement: "Revenue rose 17% to €11.5 billion, about 1.7 billion more than last year." }] };

const seq = (...outs: object[]) => new FakeClient((_req, i) => ({ content: JSON.stringify(outs[Math.min(i, outs.length - 1)]) }));

describe("prices and budget", () => {
  it("computes cost from usage, cached tokens and reasoning included in completion", () => {
    const c = costOf("muse-spark-1.3", { prompt_tokens: 10_000, completion_tokens: 5_000, prompt_tokens_details: { cached_tokens: 2_000 }, completion_tokens_details: { reasoning_tokens: 4_000 } });
    expect(c).toBeCloseTo((8_000 * 1.25 + 2_000 * 0.15 + 5_000 * 4.25) / 1e6, 10);
    expect(priceOf("muse-spark-1.3-contributor").output).toBe(0.2);
  });
  it("refuses an unknown model", () => {
    expect(() => priceOf("gpt-x")).toThrow(UnknownModelError);
    expect(() => new MetaModelClient({ apiKey: "test", model: "gpt-x" })).toThrow(UnknownModelError);
  });
  it("stops a run at its cap", () => {
    const b = new RunBudget(0.05);
    b.record(0.04);
    expect(() => b.assertCanSpend(estimateCost("muse-spark-1.3", 4000, 8000))).toThrow(BudgetExceededError);
    expect(() => b.assertCanSpend(0.005)).not.toThrow();
  });
  it("enforces the total ledger cap", () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ledger-")), "l.jsonl");
    appendLedger({ ts: "t", runId: "r", model: "m", purpose: "p", prompt_tokens: 1, cached_tokens: 0, completion_tokens: 1, reasoning_tokens: 0, usd: 17.99 }, f);
    expect(ledgerTotal(f)).toBeCloseTo(17.99);
    expect(() => assertTotalBudget(0.02, f, 18)).toThrow(BudgetExceededError);
    expect(() => assertTotalBudget(0.005, f, 18)).not.toThrow();
  });
});

describe("analyzeDocuments", () => {
  it("accepts a good answer on the first attempt", async () => {
    const client = seq(good);
    const r = await analyzeDocuments(client, FACTS, ALLOWED, [DOC]);
    expect(r.state).toBe("ok");
    expect(r.attempts).toBe(1);
    expect(r.claims[0].quotes[0]).toMatchObject({ documentId: "doc-su", page: 1 });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].response_format?.json_schema.name).toBe("holding_update");
  });
  it("retries exactly once after a bad quote, with feedback", async () => {
    const client = seq(badQuote, good);
    const r = await analyzeDocuments(client, FACTS, ALLOWED, [DOC]);
    expect(r.state).toBe("ok");
    expect(r.attempts).toBe(2);
    expect(client.calls).toHaveLength(2);
    const last = client.calls[1].messages.at(-1)!;
    expect(String(last.content)).toMatch(/Quote not accepted/);
    expect(r.rejections[0]).toMatchObject({ attempt: 1, kind: "quote" });
  });
  it("falls back to the model-free template after two failures", async () => {
    const client = seq(badQuote, badQuote, good);
    const r = await analyzeDocuments(client, FACTS, ALLOWED, [DOC]);
    expect(client.calls).toHaveLength(2);
    expect(r.state).toBe("fallback");
    expect(r.headline).toBe(DOC.title);
    expect(r.claims[0].whyItMatters).toMatch(/AI summary withheld/);
    expect(r.claims[0].quotes[0].documentId).toBe("doc-su");
  });
  it("retries when the guardrail hits", async () => {
    const client = seq(advice, good);
    const r = await analyzeDocuments(client, FACTS, ALLOWED, [DOC]);
    expect(r.attempts).toBe(2);
    expect(r.rejections.some((x) => x.kind === "advice")).toBe(true);
    expect(r.headline).toBe(good.headline);
  });
  it("rejects invented numbers", async () => {
    const r = await analyzeDocuments(seq(invented, invented), FACTS, ALLOWED, [DOC]);
    expect(r.state).toBe("fallback");
    expect(r.rejections.some((x) => x.kind === "number" && x.detail.includes("1.7"))).toBe(true);
  });
  it("accepts no_new_information with zero claims", async () => {
    const r = await analyzeDocuments(seq({ status: "no_new_information", headline: "Nothing new.", claims: [], portfolio_note: "" }), FACTS, ALLOWED, [DOC]);
    expect(r).toMatchObject({ state: "ok", status: "no_new_information", attempts: 1 });
  });
  it("treats invalid JSON as a failed attempt", async () => {
    const client = new FakeClient((_r, i) => ({ content: i === 0 ? "not json" : JSON.stringify(good) }));
    const r = await analyzeDocuments(client, FACTS, ALLOWED, [DOC]);
    expect(r).toMatchObject({ state: "ok", attempts: 2 });
  });
});

const CANDS: TriageCandidate[] = [
  { id: "c1", source: "AMF", formOrSubtype: "Inside Information", title: "Bond issue", date: "2026-10-28", language: "en", pages: 2, start: "Schneider issues a bond" },
  { id: "c2", source: "AMF", formOrSubtype: "Quarterly financial reporting", title: "Third Quarter Revenues 2026", date: "2026-10-16", language: "en", pages: 12, start: "Revenues up" },
  { id: "c3", source: "AMF", formOrSubtype: "Inside Information", title: "First half results", date: "2026-07-30", language: "en", pages: 20, start: "H1" },
];

describe("triage", () => {
  it("runs the tool loop and returns the model's selection", async () => {
    const client = new FakeClient((req) => mockHandler(req));
    const t = await triage(client, "Schneider", CANDS);
    expect(t.method).toBe("model");
    expect(t.toolCalls).toEqual(["list_candidate_documents", "select_documents"]);
    expect(t.primaryId).toBe("c2");
    expect(client.calls[0].tools?.map((x) => (x.type === "function" ? x.function.name : ""))).toEqual(["list_candidate_documents", "read_document_start", "select_documents"]);
    // the assistant tool call is replayed before the tool result
    const second = client.calls[1].messages;
    expect(second.at(-2)?.role).toBe("assistant");
    expect(second.at(-1)?.role).toBe("tool");
  });
  it("skips the model with a single candidate", async () => {
    const client = new FakeClient(() => ({ content: "" }));
    expect((await triage(client, "X", [CANDS[0]])).method).toBe("single");
    expect(client.calls).toHaveLength(0);
  });
  it("falls back when the model never selects", async () => {
    const client = new FakeClient(() => ({ tool_calls: [{ id: "x", type: "function", function: { name: "list_candidate_documents", arguments: "{}" } }] }));
    const t = await triage(client, "X", CANDS);
    expect(t.method).toBe("fallback");
    expect(client.calls).toHaveLength(4);
    expect(t.primaryId).toBe("c2");
    expect(t.comparisonId).toBe("c3");
  });
  it("falls back on an unknown id", async () => {
    const client = new FakeClient(() => ({ tool_calls: [{ id: "x", type: "function", function: { name: "select_documents", arguments: '{"primary_document_id":"zzz","comparison_document_id":null,"reason":""}' } }] }));
    expect((await triage(client, "X", CANDS)).method).toBe("fallback");
  });
  it("deterministic fallback prefers results documents", () => {
    expect(fallbackSelection(CANDS)).toEqual({ primaryId: "c2", comparisonId: "c3" });
  });
});

describe("askDocuments", () => {
  it("refuses advice questions without calling the model", async () => {
    const client = new FakeClient(() => ({ content: "{}" }));
    const r = await askDocuments(client, "LVMH", [DOC], "Should I sell LVMH?");
    expect(r).toMatchObject({ kind: "refused", answer: REFUSAL, modelCalled: false });
    expect(client.calls).toHaveLength(0);
  });
  it("answers with verified quotes", async () => {
    const client = new FakeClient((req: ChatRequest) => mockHandler(req));
    const r = await askDocuments(client, "Schneider", [DOC], "What happened to revenue?");
    expect(r.kind).toBe("answer");
    expect(r.quotes.length).toBe(1);
  });
  it("withholds an answer whose quote is not in the documents", async () => {
    const client = new FakeClient(() => ({ content: JSON.stringify({ answerable: true, answer: "Revenue grew.", quotes: [{ document_id: "D1", text: "Revenue grew strongly in every single region." }] }) }));
    expect((await askDocuments(client, "Schneider", [DOC], "Revenue?")).kind).toBe("withheld");
  });
});
