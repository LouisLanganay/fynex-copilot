import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import type { RunBudget } from "./budget";
import type { CallUsage, LlmClient } from "./client";
import { TRIAGE_SYSTEM } from "./prompts";

/**
 * Document triage with tool calling (PLAN.md 5.4). The model lists candidates,
 * reads the start of unclear ones, and selects the document(s) to analyze.
 * Deterministic fallback when it does not finish in 4 turns or picks an unknown id.
 */

export interface TriageCandidate {
  id: string;
  source: string;
  formOrSubtype: string;
  title: string;
  date: string;
  language: string;
  pages: number;
  /** First characters of the text (read_document_start). */
  start: string;
}

export interface TriageResult {
  primaryId: string;
  comparisonId: string | null;
  reason: string;
  method: "single" | "model" | "fallback";
  turns: number;
  toolCalls: string[];
  usage: CallUsage;
  costUsd: number;
}

export const TRIAGE_TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "list_candidate_documents",
      description: "List the recent official documents found for this holding, newest first.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "read_document_start",
      description: "Return the first 3,000 characters of a candidate document's text.",
      parameters: {
        type: "object",
        properties: { document_id: { type: "string" } },
        required: ["document_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "select_documents",
      description: "Finish the triage: choose the primary document to analyze and an optional comparison document.",
      parameters: {
        type: "object",
        properties: {
          primary_document_id: { type: "string" },
          comparison_document_id: { type: ["string", "null"] },
          reason: { type: "string" },
        },
        required: ["primary_document_id", "comparison_document_id", "reason"],
        additionalProperties: false,
      },
    },
  },
];

const RESULTS_RE = /result|revenue|sales|quarter|trimestre|chiffre d'affaires|earnings|semestriel|half|2\.02|growth|croissance/i;

export function fallbackSelection(c: TriageCandidate[]): { primaryId: string; comparisonId: string | null } {
  const sorted = [...c].sort((a, b) => b.date.localeCompare(a.date));
  const results = sorted.filter((d) => RESULTS_RE.test(`${d.title} ${d.formOrSubtype}`));
  const primary = results[0] ?? sorted[0];
  const comparison = results.find((d) => d.id !== primary.id) ?? null;
  return { primaryId: primary.id, comparisonId: comparison?.id ?? null };
}

const zero = (): CallUsage => ({ prompt: 0, cached: 0, completion: 0, reasoning: 0 });

export async function triage(
  client: LlmClient,
  holdingName: string,
  candidates: TriageCandidate[],
  budget?: RunBudget,
  maxTurns = 4,
): Promise<TriageResult> {
  if (!candidates.length) throw new Error("triage: no candidates");
  if (candidates.length === 1) {
    return { primaryId: candidates[0].id, comparisonId: null, reason: "Only one candidate document.", method: "single", turns: 0, toolCalls: [], usage: zero(), costUsd: 0 };
  }
  const known = new Map(candidates.map((c) => [c.id, c]));
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: TRIAGE_SYSTEM },
    { role: "user", content: `Holding: ${holdingName}. Choose the document(s) to analyze.` },
  ];
  const usage = zero();
  let costUsd = 0;
  const toolCalls: string[] = [];
  for (let turn = 1; turn <= maxTurns; turn++) {
    const res = await client.chat(
      { purpose: "triage", messages, tools: TRIAGE_TOOLS, max_tokens: 2000, reasoning_effort: "low" },
      budget,
    );
    usage.prompt += res.usage.prompt;
    usage.cached += res.usage.cached;
    usage.completion += res.usage.completion;
    usage.reasoning += res.usage.reasoning;
    costUsd += res.costUsd;
    const calls = res.message.tool_calls ?? [];
    if (!calls.length) break;
    messages.push({ role: "assistant", content: res.message.content ?? null, tool_calls: calls } as ChatCompletionMessageParam);
    for (const call of calls) {
      if (call.type !== "function") continue;
      const name = call.function.name;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        args = {};
      }
      toolCalls.push(name);
      if (name === "select_documents") {
        const primary = String(args.primary_document_id ?? "");
        const comparison = args.comparison_document_id ? String(args.comparison_document_id) : null;
        if (known.has(primary)) {
          return {
            primaryId: primary,
            comparisonId: comparison && known.has(comparison) && comparison !== primary ? comparison : null,
            reason: String(args.reason ?? "").slice(0, 300),
            method: "model",
            turns: turn,
            toolCalls,
            usage,
            costUsd,
          };
        }
        const fb = fallbackSelection(candidates);
        return { ...fb, reason: "Model picked an unknown document id: deterministic fallback.", method: "fallback", turns: turn, toolCalls, usage, costUsd };
      }
      let result: unknown;
      if (name === "list_candidate_documents") {
        result = candidates.map((c) => ({
          document_id: c.id,
          source: c.source,
          form_or_subtype: c.formOrSubtype,
          title: c.title,
          date: c.date,
          language: c.language,
          pages: c.pages,
        }));
      } else if (name === "read_document_start") {
        const c = known.get(String(args.document_id ?? ""));
        result = c ? { document_id: c.id, text: c.start.slice(0, 3000) } : { error: "unknown document_id" };
      } else {
        result = { error: `unknown tool ${name}` };
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  const fb = fallbackSelection(candidates);
  return { ...fb, reason: "Triage did not finish: deterministic fallback.", method: "fallback", turns: maxTurns, toolCalls, usage, costUsd };
}
