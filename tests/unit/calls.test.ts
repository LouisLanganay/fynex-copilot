import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Card } from "@/lib/card";
import { formatTimestamp, parseSilences, planChunks, timeOf, wavDurationMs } from "@/lib/extract/audio";
import { analyzeDocuments } from "@/lib/llm/analyze";
import { askDocuments } from "@/lib/llm/ask";
import { FakeClient } from "@/lib/llm/client";
import { asrCost } from "@/lib/llm/prices";
import { analysisUserMessage, TRANSCRIPT_RULES, type HoldingFacts } from "@/lib/llm/prompts";
import { triage, type TriageCandidate } from "@/lib/llm/triage";
import { runToMarkdown } from "@/lib/report/markdown";
import { buildTranscript, callCandidate, callDocumentId, callForIsin, CALLS, excerptDocument, type KnownCall } from "@/lib/sources/calls";
import { QuoteVerifier } from "@/lib/verify/quotes";

const CALL: KnownCall = { ...CALLS[0], mediaUrl: "https://example.test/call.mp4", eventUrl: "https://example.test/event" };

function wav(ms: number, byteRate = 48000): Uint8Array {
  const b = new Uint8Array(44 + Math.round((ms / 1000) * byteRate));
  new DataView(b.buffer).setUint32(28, byteRate, true);
  return b;
}

const clip = (startMs: number, endMs: number, ...turns: [number, number, string][]) => ({ chunk: { startMs, endMs }, turns: turns.map(([s, e, transcript]) => ({ startMs: s, endMs: e, transcript })) });

describe("timed chunks", () => {
  it("parses ffmpeg silencedetect output and drops an unterminated silence", () => {
    const err = "[silencedetect @ 0x1] silence_start: 12.5\n[silencedetect @ 0x1] silence_end: 13.25 | silence_duration: 0.75\n[silencedetect @ 0x1] silence_start: -0.01\n[silencedetect @ 0x1] silence_end: 0.4\n[silencedetect @ 0x1] silence_start: 90\n";
    expect(parseSilences(err)).toEqual([{ startMs: 12500, endMs: 13250 }, { startMs: 0, endMs: 400 }]);
  });
  it("cuts contiguously in the middle of the first pause after the target", () => {
    const chunks = planChunks([{ startMs: 5000, endMs: 5400 }, { startMs: 16000, endMs: 17000 }, { startMs: 33000, endMs: 33500 }], 60000);
    expect(chunks[0]).toEqual({ startMs: 0, endMs: 16500 });
    expect(chunks[1]).toEqual({ startMs: 16500, endMs: 33250 });
    for (let i = 1; i < chunks.length; i++) expect(chunks[i].startMs).toBe(chunks[i - 1].endMs);
    expect(chunks.at(-1)!.endMs).toBe(60000);
  });
  it("cuts at the maximum length when nobody pauses, and never exceeds it", () => {
    const chunks = planChunks([], 100000, { targetMs: 15000, maxMs: 40000 });
    expect(chunks.map((c) => c.endMs - c.startMs)).toEqual([40000, 40000, 20000]);
  });
  it("keeps a very short tail with the last chunk", () => {
    expect(planChunks([], 42000, { targetMs: 15000, maxMs: 45000 })).toEqual([{ startMs: 0, endMs: 42000 }]);
  });
  it("reads the WAV duration and formats timestamps", () => {
    expect(wavDurationMs(wav(2500))).toBe(2500);
    expect(wavDurationMs(new Uint8Array(3))).toBe(0);
    expect(formatTimestamp(0)).toBe("0:00");
    expect(formatTimestamp(872_900)).toBe("14:32");
    expect(formatTimestamp(3_725_000)).toBe("1:02:05");
  });
  it("bills whole seconds at the published hourly price", () => {
    expect(asrCost(3600_000)).toBeCloseTo(0.18);
    expect(asrCost(30_400)).toBeCloseTo((30 / 3600) * 0.18);
  });
});

describe("transcript document", () => {
  const doc = buildTranscript(CALL, [clip(30000, 45000, [500, 9000, "Revenue was 92.3 billion dollars this quarter."]), clip(0, 30000, [1000, 29000, " Good  afternoon and thank you for joining us. "], [29000, 29500, "   "])], 45000, new Date("2026-11-02"));

  it("keeps the clip offsets, sorts the clips and skips empty turns", () => {
    expect(doc.text).toBe("Good afternoon and thank you for joining us.\nRevenue was 92.3 billion dollars this quarter.");
    expect(doc.turns).toEqual([
      { start: 0, startMs: 1000, endMs: 29000 },
      { start: 45, startMs: 30500, endMs: 39000 },
    ]);
    expect(doc.contentType).toBe("audio");
    expect(doc.source).toBe("Earnings call");
  });
  it("gives a quote the time of its turn, through the same verifier as any document", () => {
    const v = new QuoteVerifier([{ id: doc.id, text: doc.text, pageStarts: [], turns: doc.turns }]);
    const r = v.check({ document_id: doc.id, text: "Revenue was 92.3 billion dollars" });
    expect(r.ok).toBe(true);
    expect(r.verified!.timeMs).toBe(30500);
    expect(r.verified!.page).toBeNull();
    expect(v.check({ document_id: doc.id, text: "Revenue was 93.2 billion dollars" }).ok).toBe(false);
  });
  it("rejects a transcript quote with a stuttered number, and only in a transcript", () => {
    const text = "Revenue should be between 96 and 97.1 1 billion US dollars or growth of 18 to 19 percent. We expect 16.4 16.4 billion in costs.";
    const transcript = new QuoteVerifier([{ id: "c", text, pageStarts: [], turns: [{ start: 0, startMs: 0, endMs: 1000 }] }]);
    expect(transcript.check({ document_id: "c", text: "between 96 and 97.1 1 billion US dollars" }).reason).toBe("misheard_number");
    expect(transcript.check({ document_id: "c", text: "We expect 16.4 16.4 billion in costs" }).reason).toBe("misheard_number");
    expect(transcript.check({ document_id: "c", text: "or growth of 18 to 19 percent" }).ok).toBe(true);
    const filing = new QuoteVerifier([{ id: "f", text: "Assets | 2026 2025 | were 12 34 in the table row", pageStarts: [] }]);
    expect(filing.check({ document_id: "f", text: "2026 2025 | were 12 34 in the table" }).ok).toBe(true);
  });
  it("adds up what the clips cost", () => {
    expect(doc.transcriptionUsd).toBeCloseTo(asrCost(30000) + asrCost(15000));
  });
  it("places a passage inside its turn, a little early, never before the turn", () => {
    const turns = [
      { start: 0, startMs: 10000, endMs: 30000 },
      { start: 100, startMs: 40000, endMs: 50000 },
    ];
    expect(timeOf(turns, 0, 200)).toBe(10000);
    expect(timeOf(turns, 50, 200)).toBe(20000 - 3000);
    expect(timeOf(turns, 10, 200)).toBe(10000);
    expect(timeOf(turns, 150, 200)).toBe(45000 - 3000);
    expect(timeOf(turns, 150)).toBe(40000);
  });
  it("has no time for a document without turns", () => {
    expect(timeOf(undefined, 10)).toBeNull();
    expect(timeOf([], 10)).toBeNull();
    const v = new QuoteVerifier([{ id: "d", text: "A plain filing paragraph with enough words.", pageStarts: [] }]);
    expect(v.check({ document_id: "d", text: "plain filing paragraph with" }).verified!.timeMs).toBeNull();
  });
  it("finds known calls by ISIN with a stable id that ignores the signed media URL", () => {
    expect(callForIsin("US5949181045")?.shortName).toBe("Microsoft");
    expect(callForIsin("FR0000121014")).toBeUndefined();
    expect(callForIsin(null)).toBeUndefined();
    expect(callDocumentId(CALL)).toBe(callDocumentId({ ...CALL, mediaUrl: "https://example.test/other.mp4" }));
    expect(callCandidate(CALL).id).toMatch(/^[a-f0-9]{16}$/);
  });
});

describe("speech to text on the fake client", () => {
  it("returns the handler's turns and costs nothing", async () => {
    const c = new FakeClient(() => ({ content: "" }), "fake", () => [{ startMs: 0, endMs: 900, transcript: "hello" }]);
    const r = await c.transcribeAudio({ purpose: "t", wav: wav(1000) });
    expect(r).toEqual({ turns: [{ startMs: 0, endMs: 900, transcript: "hello" }], audioMs: 1000, costUsd: 0 });
    expect(c.asrCalls).toHaveLength(1);
  });
  it("refuses without a handler", async () => {
    await expect(new FakeClient(() => ({ content: "" })).transcribeAudio({ purpose: "t", wav: wav(1000) })).rejects.toThrow(/no transcription handler/);
  });
});

const FACTS: HoldingFacts = { name: "Microsoft Corp.", ticker: "MSFT", isin: "US5949181045", weightPct: 8.9, rank: 5, count: 12, valueEur: 2102, totalEur: 23754, atCost: true };

describe("a transcript through the existing pipeline", () => {
  const doc = buildTranscript(CALL, [clip(600000, 630000, [2000, 28000, "We expect revenue growth of 15 percent next quarter, driven by the cloud."])], 630000);
  const update = (over: object) =>
    JSON.stringify({
      status: "material_change",
      headline: "The company gave its outlook on the call.",
      claims: [{ category: "guidance", statement: "The company said on the call it expects 15 percent revenue growth.", why_it_matters: "This is the company's own outlook for a line of the portfolio.", quotes: [{ document_id: "D1", text: "We expect revenue growth of 15 percent next quarter" }] }],
      portfolio_note: "This line is 8.9% of the portfolio.",
      ...over,
    });

  it("verifies quotes and returns their timestamp", async () => {
    const c = new FakeClient(() => ({ content: update({}) }));
    const r = await analyzeDocuments(c, FACTS, [8.9], [doc]);
    expect(r.state).toBe("ok");
    expect(r.claims[0].quotes[0].timeMs).toBe(602000);
    expect(r.claims[0].quotes[0].page).toBeNull();
  });
  it("sends the transcript rules only when a transcript is read", () => {
    const docs = [{ promptId: "D1", title: "t", date: "2026-10-28", source: "SEC EDGAR", text: "x" }];
    expect(analysisUserMessage(FACTS, [], docs)).not.toContain(TRANSCRIPT_RULES);
    expect(analysisUserMessage(FACTS, [], [{ ...docs[0], transcript: true }])).toContain(TRANSCRIPT_RULES);
  });
  it("retries a quote that is not in the transcript, then falls back", async () => {
    const bad = update({ claims: [{ category: "guidance", statement: "The company expects growth.", why_it_matters: "Outlook of the company.", quotes: [{ document_id: "D1", text: "We expect revenue growth of 25 percent next quarter" }] }] });
    const c = new FakeClient(() => ({ content: bad }));
    const r = await analyzeDocuments(c, FACTS, [8.9], [doc]);
    expect(c.calls).toHaveLength(2);
    expect(r.state).toBe("fallback");
    expect(r.rejections.some((x) => x.kind === "quote")).toBe(true);
  });
  it("rejects a number the transcript quote does not carry", async () => {
    const bad = update({ claims: [{ category: "guidance", statement: "The company expects 25 percent growth.", why_it_matters: "Outlook of the company.", quotes: [{ document_id: "D1", text: "We expect revenue growth of 15 percent next quarter" }] }] });
    const r = await analyzeDocuments(new FakeClient(() => ({ content: bad })), FACTS, [8.9], [doc]);
    expect(r.rejections.some((x) => x.kind === "number")).toBe(true);
  });
  it("rejects advice written about a call", async () => {
    const bad = update({ headline: "After this call you should sell the line." });
    const r = await analyzeDocuments(new FakeClient(() => ({ content: bad })), FACTS, [8.9], [doc]);
    expect(r.rejections.some((x) => x.kind === "advice")).toBe(true);
    expect(r.state).toBe("fallback");
  });
  it("answers follow-up questions with timestamps", async () => {
    const c = new FakeClient(() => ({ content: JSON.stringify({ answerable: true, answer: "The company expects 15 percent growth.", quotes: [{ document_id: "D1", text: "We expect revenue growth of 15 percent next quarter" }] }) }));
    const r = await askDocuments(c, "Microsoft", [doc], "What is the outlook?");
    expect(r.kind).toBe("answer");
    expect(r.quotes[0].timeMs).toBe(602000);
  });
  it("lets the triage pick the call", async () => {
    const cands: TriageCandidate[] = [
      { id: "call", source: "Earnings call", formOrSubtype: "Earnings call, automatic transcript", title: "Call", date: "2026-10-28", language: "en", pages: 1, start: "" },
      { id: "rel", source: "SEC EDGAR", formOrSubtype: "8-K 2.02", title: "Release", date: "2026-10-28", language: "en", pages: 1, start: "" },
    ];
    const c = new FakeClient(() => ({ content: null, tool_calls: [{ id: "1", type: "function", function: { name: "select_documents", arguments: JSON.stringify({ primary_document_id: "call", comparison_document_id: "rel", reason: "Outlook is on the call." }) } }] }));
    const r = await triage(c, "Microsoft", cands);
    expect(r).toMatchObject({ primaryId: "call", comparisonId: "rel", method: "model" });
  });
});

describe("what the public repository carries", () => {
  const long = "Words that nobody quoted and that must stay out of the repository. ";
  const doc = buildTranscript(CALL, [clip(0, 30000, [0, 29000, long.repeat(10)]), clip(30000, 60000, [1000, 29000, "We expect revenue growth of 15 percent next quarter."]), clip(60000, 90000, [1000, 29000, long.repeat(10)])], 90000);
  const start = doc.text.indexOf("We expect");
  const quote = { documentId: doc.id, text: "We expect revenue growth of 15 percent", start, end: start + 38, page: null, timeMs: 31000 };
  const other = { documentId: "other", text: "A release passage.", start: 5, end: 23, page: 2 };
  const card = {
    claims: [
      { category: "guidance", statement: "s", whyItMatters: "w", quotes: [quote, other] },
      { category: "results", statement: "s", whyItMatters: "w", quotes: [quote] },
    ],
  } as unknown as Card;

  it("keeps only the quotes, points the card at them and leaves other documents alone", () => {
    const { document, card: moved } = excerptDocument(doc, card);
    expect(document.excerpt).toBe(true);
    expect(document.text).toBe(quote.text);
    expect(document.text).not.toContain("nobody quoted");
    const q = moved.claims[0].quotes[0];
    expect(document.text.slice(q.start, q.end)).toBe(q.text);
    expect(q.timeMs).toBe(31000);
    expect(moved.claims[0].quotes[1]).toEqual(other);
    expect(moved.claims[1].quotes[0].start).toBe(q.start);
    expect(document.turns).toEqual([{ start: 0, startMs: 31000, endMs: 31000 }]);
  });
  it("renders a timestamp link in the Markdown report", () => {
    const md = runToMarkdown(
      [{ name: "Microsoft", ticker: "MSFT", weightPct: 8.9, state: "ok", status: "material_change", headline: "H", claims: card.claims, portfolioNote: "", documents: [{ ...callCandidate(CALL), chars: 1, pages: 1, ocr: false }], triage: null, attempts: 1, rejections: [], quotesVerified: 1, model: "m", usage: { prompt: 0, cached: 0, completion: 0, reasoning: 0 }, costUsd: 0 } as unknown as Card],
      { model: "m", generatedAt: "2026-11-02", totalUsd: 0 },
    );
    expect(md).toContain("at 0:31](https://example.test/call.mp4#t=31)");
  });
});

describe("the recorded replay", () => {
  const read = (f: string) => JSON.parse(fs.readFileSync(path.join("fixtures", f), "utf8"));
  const run = read("sample-run.json");

  it("resolves every quote of every card from the committed fixtures", () => {
    for (const card of run.cards as Card[]) {
      for (const claim of card.claims) {
        for (const q of claim.quotes) {
          const doc = read(`cache/doc/${q.documentId}.json`).value;
          expect(doc.text.slice(q.start, q.end)).toBe(q.text);
        }
      }
    }
  });
  it("carries only short quotes of the call, with their times", () => {
    const card = (run.cards as Card[]).find((c) => c.documents.some((d) => d.contentType === "audio"))!;
    const id = card.documents.find((d) => d.contentType === "audio")!.id;
    const doc = read(`cache/doc/${id}.json`).value;
    const quotes = card.claims.flatMap((c) => c.quotes).filter((q) => q.documentId === id);
    expect(quotes.length).toBeGreaterThan(0);
    expect(doc.excerpt).toBe(true);
    expect(doc.text.length).toBeLessThanOrEqual(quotes.reduce((s, q) => s + q.text.length + 2, 0));
    expect(quotes.every((q) => q.text.length <= 400 && typeof q.timeMs === "number")).toBe(true);
  });
  it("dates each card honestly and adds up to the stated total", () => {
    const total = (run.cards as Card[]).reduce((s, c) => s + c.costUsd, 0);
    expect(run.totalUsd).toBeCloseTo(total, 6);
    const added = (run.cards as Card[]).filter((c) => c.recordedAt);
    expect(added.map((c) => c.holdingId)).toEqual(run.additions.map((a: { holdingId: string }) => a.holdingId));
    expect(run.recordedAt.slice(0, 10)).toBe("2026-10-29");
    expect(added[0].recordedAt!.slice(0, 10)).toBe("2026-11-02");
  });
});
