import fs from "node:fs";
import path from "node:path";
import type { Card, CardDocument } from "@/lib/card";
import { cacheGet, cacheSet, fixturesRoot, sha } from "@/lib/cache/cache";
import { analyzeDocuments } from "@/lib/llm/analyze";
import { BudgetExceededError, type RunBudget } from "@/lib/llm/budget";
import type { LlmClient } from "@/lib/llm/client";
import { PROMPT_VERSION, type HoldingFacts } from "@/lib/llm/prompts";
import { transcribePdf, transcriptionEnabled } from "@/lib/llm/transcribe";
import { triage, type TriageCandidate, type TriageResult } from "@/lib/llm/triage";
import { allowedNumbers, eur, pct, type PortfolioSummary, type WeightedHolding } from "@/lib/portfolio/weights";
import { listCandidates, loadDocument } from "@/lib/sources/fetch";
import type { CandidateDocument, ResolvedHolding, SourceDocument } from "@/lib/sources/types";

/** One holding, end to end: candidates, documents, triage, analysis, card. */

export interface RecordedCandidate extends CandidateDocument {
  pages: number;
  chars: number;
  start: string;
}

/** fixtures/candidates.json: candidate lists recorded for the sample portfolio (offline mode). */
export function readRecordedCandidates(): Record<string, RecordedCandidate[]> {
  const f = path.join(fixturesRoot(), "candidates.json");
  if (!fs.existsSync(f)) return {};
  return JSON.parse(fs.readFileSync(f, "utf8")).holdings ?? {};
}

export interface HoldingRunOptions {
  /** Use recorded candidates and documents only (no network). */
  offline?: boolean;
  /** Reuse a cached analysis when available. */
  useCache?: boolean;
  onStep?: (step: string) => void;
}

export function facts(h: WeightedHolding, s: PortfolioSummary): HoldingFacts {
  return {
    name: h.name,
    ticker: h.ticker,
    isin: h.isin,
    weightPct: pct(h.weight),
    rank: h.rank,
    count: s.count,
    valueEur: eur(h.valueEur),
    totalEur: eur(s.totalEur),
    atCost: s.atCost,
  };
}

function toCardDoc(d: SourceDocument): CardDocument {
  return {
    id: d.id,
    source: d.source,
    title: d.title,
    date: d.date,
    url: d.url,
    alternateUrl: d.alternateUrl,
    formOrSubtype: d.formOrSubtype,
    language: d.language,
    pages: d.pages,
    ocr: d.ocr,
    chars: d.text.length,
  };
}

export function baseCard(h: WeightedHolding, model: string): Card {
  return {
    holdingId: h.id,
    name: h.name,
    ticker: h.ticker,
    weightPct: pct(h.weight),
    rank: h.rank,
    state: "error",
    status: null,
    headline: "",
    claims: [],
    portfolioNote: "",
    documents: [],
    triage: null,
    attempts: 0,
    rejections: [],
    quotesVerified: 0,
    model,
    usage: { prompt: 0, cached: 0, completion: 0, reasoning: 0 },
    costUsd: 0,
    generatedAt: new Date().toISOString(),
  };
}

export async function analyzeHolding(
  h: WeightedHolding,
  summary: PortfolioSummary,
  resolution: ResolvedHolding,
  client: LlmClient,
  budget: RunBudget,
  o: HoldingRunOptions = {},
): Promise<{ card: Card; documents: SourceDocument[] }> {
  const card = baseCard(h, client.model);
  const step = o.onStep ?? (() => {});
  if (!resolution.source) {
    return { card: { ...card, state: "no_source", headline: "No public source found for this identifier.", note: resolution.note }, documents: [] };
  }

  // 1. Candidates and their text.
  step("Finding documents");
  let candidates: (CandidateDocument & { start?: string; pages?: number })[];
  if (o.offline) candidates = readRecordedCandidates()[h.id] ?? [];
  else candidates = await listCandidates(h, resolution);
  if (!candidates.length) {
    return { card: { ...card, state: "no_document", headline: "No recent document found in the last 120 days." }, documents: [] };
  }

  const loaded = new Map<string, SourceDocument>();
  const load = async (c: CandidateDocument): Promise<SourceDocument | null> => {
    if (loaded.has(c.id)) return loaded.get(c.id)!;
    let d: SourceDocument | null = null;
    if (o.offline) d = cacheGet<SourceDocument>("doc", c.id)?.value ?? null;
    else {
      d = await loadDocument(c, {
        transcribe: transcriptionEnabled() && client.live ? (bytes) => transcribePdf(client, bytes, `${c.id}.pdf`, budget) : undefined,
      }).catch(() => null);
    }
    if (d) loaded.set(c.id, d);
    return d;
  };

  // Triage needs the start of each document; offline it comes from the recording.
  const triageCands: TriageCandidate[] = [];
  for (const c of candidates) {
    let start = c.start;
    let pages = c.pages ?? 1;
    if (start === undefined) {
      const d = await load(c);
      if (!d) continue;
      start = d.text.slice(0, 3000);
      pages = d.pages;
    }
    triageCands.push({ id: c.id, source: c.source, formOrSubtype: c.formOrSubtype, title: c.title, date: c.date, language: c.language, pages, start });
  }
  if (!triageCands.length) {
    return { card: { ...card, state: "error", headline: "Documents could not be downloaded.", note: "Retry later." }, documents: [] };
  }

  try {
    // 2. Triage (tool calling).
    step(triageCands.length > 1 ? `Choosing among ${triageCands.length} documents` : "One document found");
    // Triage depends only on the candidate list: cache it like the analysis (live runs only).
    const triageKey = sha([client.model, PROMPT_VERSION, ...triageCands.map((c) => c.id)].join("|"));
    const triageHit = o.useCache !== false && client.live ? cacheGet<TriageResult>("triage", triageKey) : null;
    const t = triageHit ? { ...triageHit.value, costUsd: 0, usage: { prompt: 0, cached: 0, completion: 0, reasoning: 0 } } : await triage(client, h.name, triageCands, budget);
    if (!triageHit && client.live) cacheSet("triage", triageKey, t);
    card.triage = { method: t.method, reason: t.reason, toolCalls: t.toolCalls };
    card.costUsd += t.costUsd;
    addUsage(card, t.usage);

    const ids = [t.primaryId, t.comparisonId].filter((x): x is string => !!x);
    const docs: SourceDocument[] = [];
    for (const id of ids) {
      const c = candidates.find((x) => x.id === id)!;
      const d = await load(c);
      if (d) docs.push(d);
    }
    if (!docs.length) return { card: { ...card, state: "error", headline: "The selected document could not be read." }, documents: [] };
    card.documents = docs.map(toCardDoc);

    // 3. Analysis, with cache.
    const allowed = allowedNumbers(h, summary);
    const key = sha([client.model, PROMPT_VERSION, ...docs.map((d) => d.id), pct(h.weight), h.rank, summary.count].join("|"));
    const hit = o.useCache !== false ? cacheGet<Card>("analysis", key) : null;
    if (hit) return { card: { ...hit.value, cachedFrom: hit.storedAt }, documents: docs };

    const pages = docs.reduce((s, d) => s + d.pages, 0);
    step(docs.some((d) => d.contentType === "pdf") ? `Reading ${pages}-page PDF` : "Reading the filing");
    const a = await analyzeDocuments(client, facts(h, summary), allowed, docs, budget);
    step(`Verifying ${a.claims.reduce((s, c) => s + c.quotes.length, 0)} quotes`);
    const out: Card = {
      ...card,
      state: a.state,
      status: a.status,
      headline: a.headline,
      claims: a.claims,
      portfolioNote: a.portfolioNote,
      attempts: a.attempts,
      rejections: a.rejections,
      quotesVerified: a.claims.reduce((s, c) => s + c.quotes.length, 0),
      costUsd: card.costUsd + a.costUsd,
      note: a.note,
      generatedAt: new Date().toISOString(),
    };
    addUsage(out, a.usage);
    if (client.live) cacheSet("analysis", key, out);
    return { card: out, documents: docs };
  } catch (e) {
    if (e instanceof BudgetExceededError) {
      return { card: { ...card, state: "budget", headline: "Budget cap reached.", note: e.message }, documents: [] };
    }
    throw e;
  }
}

function addUsage(card: Card, u: Card["usage"]) {
  card.usage = {
    prompt: card.usage.prompt + u.prompt,
    cached: card.usage.cached + u.cached,
    completion: card.usage.completion + u.completion,
    reasoning: card.usage.reasoning + u.reasoning,
  };
}
