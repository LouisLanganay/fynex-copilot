import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { CardClaim, CardStatus, Rejection } from "@/lib/card";
import { findAdvice } from "@/lib/guardrail/advice";
import type { SourceDocument } from "@/lib/sources/types";
import { checkNumbers } from "@/lib/verify/numbers";
import { QuoteVerifier, verifyClaimQuotes, QUOTE_MAX, QUOTE_MIN } from "@/lib/verify/quotes";
import type { RunBudget } from "./budget";
import { EmptyOutputError, type CallUsage, type LlmClient } from "./client";
import { analysisUserMessage, ANALYSIS_SYSTEM, retryMessage, type HoldingFacts, type PromptDocument } from "./prompts";
import { HOLDING_UPDATE_SCHEMA, HoldingUpdateZ, type HoldingUpdate } from "./schema";

/**
 * Analysis call, verification, one retry, then a model-free fallback (PLAN.md 5.5, 5.6, 6).
 */

export interface AnalysisResult {
  state: "ok" | "fallback";
  status: CardStatus;
  headline: string;
  claims: CardClaim[];
  portfolioNote: string;
  attempts: number;
  rejections: Rejection[];
  usage: CallUsage;
  costUsd: number;
  note?: string;
}

// Muse Spark spends 4k to 8k tokens reasoning before the JSON: 8000 was measured too low once (truncated JSON).
export const ANALYSIS_MAX_TOKENS = 12000;

interface Evaluation {
  claims: CardClaim[];
  problems: string[];
  rejections: Rejection[];
  accepted: boolean;
}

export function evaluateUpdate(
  update: HoldingUpdate,
  verifier: QuoteVerifier,
  promptToDoc: Map<string, string>,
  allowed: number[],
  attempt: number,
): Evaluation {
  const problems: string[] = [];
  const rejections: Rejection[] = [];
  const claims: CardClaim[] = [];
  const reject = (kind: Rejection["kind"], detail: string) => {
    rejections.push({ attempt, kind, detail });
    problems.push(detail);
  };

  for (const c of update.claims) {
    const quotes = c.quotes.map((q) => ({ document_id: promptToDoc.get(q.document_id) ?? `unknown:${q.document_id}`, text: q.text }));
    const v = verifyClaimQuotes(verifier, quotes);
    if (!v.ok) {
      for (const f of v.failures) {
        reject("quote", `Quote not accepted (${f.reason}) in document ${f.quote.document_id.startsWith("unknown:") ? f.quote.document_id.slice(8) : "given"}: "${f.quote.text.slice(0, 160)}"`);
      }
      continue;
    }
    const nums = checkNumbers([c.statement, c.why_it_matters], v.verified.map((q) => q.text), allowed);
    if (!nums.ok) {
      reject("number", `Numbers not found in the claim's quotes: ${nums.unsupported.join(", ")} (claim: "${c.statement.slice(0, 100)}")`);
      continue;
    }
    const advice = findAdvice(`${c.statement}\n${c.why_it_matters}`);
    if (advice) {
      reject("advice", `Advice-like wording is not allowed: "${advice}"`);
      continue;
    }
    claims.push({ category: c.category, statement: c.statement, whyItMatters: c.why_it_matters, quotes: v.verified });
  }

  const allQuoteTexts = claims.flatMap((c) => c.quotes.map((q) => q.text));
  const topNums = checkNumbers([update.headline, update.portfolio_note], allQuoteTexts, allowed);
  if (!topNums.ok) reject("number", `Numbers in headline or portfolio_note not supported: ${topNums.unsupported.join(", ")}`);
  const topAdvice = findAdvice(`${update.headline}\n${update.portfolio_note}`);
  if (topAdvice) reject("advice", `Advice-like wording is not allowed: "${topAdvice}"`);

  const emptyOk = update.status === "no_new_information" && update.claims.length === 0;
  const accepted = topNums.ok && !topAdvice && (emptyOk || claims.length > 0);
  return { claims, problems, rejections, accepted };
}

/** First sentences of the document, verified like any quote, for the model-free fallback. */
export function fallbackClaim(doc: SourceDocument, verifier: QuoteVerifier): CardClaim | null {
  const flat = doc.text.replace(/\s+/g, " ").trim();
  const sentences = flat.match(/[^.!?]{15,}[.!?]/g) ?? [];
  let excerpt = "";
  for (const s of sentences) {
    if ((excerpt + s).length > QUOTE_MAX - 10) break;
    excerpt += s;
    if (excerpt.length > 160) break;
  }
  excerpt = excerpt.trim() || flat.slice(0, 300);
  if (excerpt.length < QUOTE_MIN) return null;
  const check = verifier.check({ document_id: doc.id, text: excerpt });
  if (!check.ok) return null;
  return {
    category: "other",
    statement: `Latest document: ${doc.title} (${doc.date}).`,
    whyItMatters: "AI summary withheld: quotes could not be verified. Read the original document.",
    quotes: [check.verified!],
  };
}

export async function analyzeDocuments(
  client: LlmClient,
  facts: HoldingFacts,
  allowed: number[],
  docs: SourceDocument[],
  budget?: RunBudget,
): Promise<AnalysisResult> {
  const promptDocs: PromptDocument[] = docs.map((d, i) => ({ promptId: `D${i + 1}`, title: d.title, date: d.date, source: d.source, text: d.text }));
  const promptToDoc = new Map(promptDocs.map((p, i) => [p.promptId, docs[i].id]));
  // The verifier sees the same capped text as the model.
  const verifier = new QuoteVerifier(docs.map((d) => ({ id: d.id, text: d.text, pageStarts: d.pageStarts })));
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: ANALYSIS_SYSTEM },
    { role: "user", content: analysisUserMessage(facts, allowed, promptDocs) },
  ];
  const usage: CallUsage = { prompt: 0, cached: 0, completion: 0, reasoning: 0 };
  let costUsd = 0;
  const rejections: Rejection[] = [];

  for (let attempt = 1; attempt <= 2; attempt++) {
    let content: string | null = null;
    try {
      const res = await client.chat(
        {
          purpose: `analyze:${facts.ticker ?? facts.name}:attempt${attempt}`,
          messages,
          max_tokens: ANALYSIS_MAX_TOKENS,
          reasoning_effort: "medium",
          response_format: { type: "json_schema", json_schema: HOLDING_UPDATE_SCHEMA as never },
        },
        budget,
      );
      usage.prompt += res.usage.prompt;
      usage.cached += res.usage.cached;
      usage.completion += res.usage.completion;
      usage.reasoning += res.usage.reasoning;
      costUsd += res.costUsd;
      content = res.message.content;
    } catch (e) {
      if (!(e instanceof EmptyOutputError)) throw e;
      rejections.push({ attempt, kind: "empty", detail: e.message });
      continue;
    }
    let update: HoldingUpdate;
    try {
      update = HoldingUpdateZ.parse(JSON.parse(content ?? ""));
    } catch (e) {
      rejections.push({ attempt, kind: "schema", detail: `Invalid JSON: ${(e as Error).message.slice(0, 200)}` });
      messages.push({ role: "assistant", content: content ?? "" });
      messages.push({ role: "user", content: retryMessage(["The answer was cut off or was not valid JSON for the schema. Keep the reasoning short and return the complete JSON."]) });
      continue;
    }
    const ev = evaluateUpdate(update, verifier, promptToDoc, allowed, attempt);
    rejections.push(...ev.rejections);
    if (ev.accepted) {
      return {
        state: "ok",
        status: update.status,
        headline: update.headline,
        claims: ev.claims,
        portfolioNote: update.portfolio_note,
        attempts: attempt,
        rejections,
        usage,
        costUsd,
      };
    }
    messages.push({ role: "assistant", content: content ?? "" });
    messages.push({ role: "user", content: retryMessage(ev.problems.length ? ev.problems : ["No claim survived verification."]) });
  }

  const primary = docs[0];
  const claim = fallbackClaim(primary, verifier);
  return {
    state: "fallback",
    status: "minor_update",
    headline: primary.title,
    claims: claim ? [claim] : [],
    portfolioNote: "",
    attempts: 2,
    rejections,
    usage,
    costUsd,
    note: "AI summary withheld: quotes could not be verified.",
  };
}
