import { findAdvice, isAdviceRequest, REFUSAL } from "@/lib/guardrail/advice";
import type { SourceDocument } from "@/lib/sources/types";
import { checkNumbers } from "@/lib/verify/numbers";
import { QuoteVerifier, verifyClaimQuotes, type VerifiedQuote } from "@/lib/verify/quotes";
import type { RunBudget } from "./budget";
import { EmptyOutputError, type LlmClient } from "./client";
import { ASK_SYSTEM, documentsBlock } from "./prompts";
import { ANSWER_SCHEMA, AnswerZ } from "./schema";

/** Follow-up question on one holding's documents (PLAN.md 7). */

export const MAX_QUESTION_CHARS = 300;

export interface AskResult {
  kind: "refused" | "answer" | "unanswerable" | "withheld";
  answer: string;
  quotes: VerifiedQuote[];
  costUsd: number;
  modelCalled: boolean;
}

export async function askDocuments(
  client: LlmClient,
  holdingName: string,
  docs: SourceDocument[],
  question: string,
  budget?: RunBudget,
): Promise<AskResult> {
  const q = question.trim().slice(0, MAX_QUESTION_CHARS);
  // Input filter first: refusals cost $0 and never reach the model.
  if (isAdviceRequest(q)) return { kind: "refused", answer: REFUSAL, quotes: [], costUsd: 0, modelCalled: false };

  const promptDocs = docs.map((d, i) => ({ promptId: `D${i + 1}`, title: d.title, date: d.date, source: d.source, text: d.text }));
  const promptToDoc = new Map(promptDocs.map((p, i) => [p.promptId, docs[i].id]));
  const verifier = new QuoteVerifier(docs.map((d) => ({ id: d.id, text: d.text, pageStarts: d.pageStarts })));
  let costUsd = 0;
  try {
    const res = await client.chat(
      {
        purpose: `ask:${holdingName}`,
        messages: [
          { role: "system", content: ASK_SYSTEM },
          { role: "user", content: `Company: ${holdingName}\n\nDOCUMENTS:\n${documentsBlock(promptDocs)}\n\nQUESTION: ${q}` },
        ],
        max_tokens: 4000,
        reasoning_effort: "low",
        response_format: { type: "json_schema", json_schema: ANSWER_SCHEMA as never },
      },
      budget,
    );
    costUsd = res.costUsd;
    const a = AnswerZ.parse(JSON.parse(res.message.content ?? ""));
    if (!a.answerable) return { kind: "unanswerable", answer: "The documents don't say.", quotes: [], costUsd, modelCalled: true };
    const v = verifyClaimQuotes(
      verifier,
      a.quotes.map((x) => ({ document_id: promptToDoc.get(x.document_id) ?? `unknown:${x.document_id}`, text: x.text })),
    );
    if (!v.ok || findAdvice(a.answer) || !checkNumbers([a.answer], v.verified.map((x) => x.text), []).ok) {
      return { kind: "withheld", answer: "Answer withheld: its sources could not be verified.", quotes: [], costUsd, modelCalled: true };
    }
    return { kind: "answer", answer: a.answer, quotes: v.verified, costUsd, modelCalled: true };
  } catch (e) {
    if (e instanceof EmptyOutputError || e instanceof SyntaxError) {
      return { kind: "withheld", answer: "Answer withheld: the model returned no usable answer.", quotes: [], costUsd, modelCalled: true };
    }
    throw e;
  }
}
