import OpenAI from "openai";
import type { ChatCompletionMessage, ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import { costOf, estimateCost, type Usage } from "./prices";
import { appendLedger, assertTotalBudget, type RunBudget } from "./budget";

/**
 * The only way the app calls a model (CLAUDE.md "Spending").
 * Every call: price check (unknown model refuses), run cap and total cap
 * checked BEFORE the call from an upper-bound estimate, real cost computed
 * from `usage` AFTER the call and appended to the ledger.
 */

export type ReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface ChatRequest {
  purpose: string;
  messages: ChatCompletionMessageParam[];
  max_tokens: number;
  reasoning_effort: ReasoningEffort;
  response_format?: { type: "json_schema"; json_schema: { name: string; schema: Record<string, unknown>; strict?: boolean } };
  tools?: ChatCompletionTool[];
}

export interface CallUsage {
  prompt: number;
  cached: number;
  completion: number;
  reasoning: number;
}

export interface ChatResult {
  model: string;
  message: ChatCompletionMessage;
  finishReason: string | null;
  usage: CallUsage;
  costUsd: number;
}

export interface LlmClient {
  readonly model: string;
  /** False for the fake / mock client: costs are zero and nothing hits the network. */
  readonly live: boolean;
  chat(req: ChatRequest, budget?: RunBudget): Promise<ChatResult>;
}

export class EmptyOutputError extends Error {}

function charsOf(messages: ChatCompletionMessageParam[], tools?: ChatCompletionTool[]): number {
  return JSON.stringify(messages).length + (tools ? JSON.stringify(tools).length : 0);
}

export interface MetaClientOptions {
  apiKey: string;
  baseURL?: string;
  model?: string;
  ledgerFile?: string;
  totalCapUsd?: number;
  timeoutMs?: number;
}

export class MetaModelClient implements LlmClient {
  readonly live = true;
  readonly model: string;
  private sdk: OpenAI;
  constructor(private opts: MetaClientOptions) {
    this.model = opts.model ?? "muse-spark-1.3";
    // Fails fast on an unknown model.
    estimateCost(this.model, 0, 0);
    this.sdk = new OpenAI({
      apiKey: opts.apiKey,
      baseURL: opts.baseURL ?? "https://api.meta.ai/v1",
      // SDK retries 408/409/429/5xx and connection errors with exponential
      // backoff and jitter, and honours Retry-After. 400s are never retried.
      maxRetries: 3,
      timeout: opts.timeoutMs ?? 110_000,
    });
  }

  async chat(req: ChatRequest, budget?: RunBudget): Promise<ChatResult> {
    const estimate = estimateCost(this.model, charsOf(req.messages, req.tools), req.max_tokens);
    budget?.assertCanSpend(estimate);
    assertTotalBudget(estimate, this.opts.ledgerFile, this.opts.totalCapUsd);

    const body: Record<string, unknown> = {
      model: this.model,
      messages: req.messages,
      max_tokens: req.max_tokens,
      reasoning_effort: req.reasoning_effort,
    };
    if (req.response_format) body.response_format = req.response_format;
    if (req.tools) {
      body.tools = req.tools;
      body.tool_choice = "auto"; // the only value Meta accepts
    }
    const res = (await this.sdk.chat.completions.create(body as never)) as OpenAI.Chat.Completions.ChatCompletion;
    const u = (res.usage ?? { prompt_tokens: 0, completion_tokens: 0 }) as Usage;
    const usage: CallUsage = {
      prompt: u.prompt_tokens,
      cached: u.prompt_tokens_details?.cached_tokens ?? 0,
      completion: u.completion_tokens,
      reasoning: u.completion_tokens_details?.reasoning_tokens ?? 0,
    };
    const costUsd = costOf(this.model, u);
    budget?.record(costUsd);
    appendLedger(
      {
        ts: new Date().toISOString(),
        runId: budget?.runId ?? "none",
        model: this.model,
        purpose: req.purpose,
        prompt_tokens: usage.prompt,
        cached_tokens: usage.cached,
        completion_tokens: usage.completion,
        reasoning_tokens: usage.reasoning,
        usd: Number(costUsd.toFixed(6)),
      },
      this.opts.ledgerFile,
    );
    const choice = res.choices[0];
    if (!choice) throw new EmptyOutputError("No choice returned");
    if (choice.message.content == null && !choice.message.tool_calls?.length) {
      throw new EmptyOutputError(
        `Empty output (finish_reason=${choice.finish_reason}, reasoning tokens=${usage.reasoning}): raise max_tokens.`,
      );
    }
    return { model: this.model, message: choice.message, finishReason: choice.finish_reason, usage, costUsd };
  }
}

export type FakeHandler = (req: ChatRequest, callIndex: number) => Partial<ChatCompletionMessage> & { content?: string | null };

/** Deterministic client for tests and `--mock` runs. Never touches the network, costs $0. */
export class FakeClient implements LlmClient {
  readonly live = false;
  calls: ChatRequest[] = [];
  constructor(
    private handler: FakeHandler,
    readonly model = "fake-muse-spark",
  ) {}
  async chat(req: ChatRequest, budget?: RunBudget): Promise<ChatResult> {
    const i = this.calls.length;
    this.calls.push({ ...req, messages: [...req.messages] });
    const m = this.handler(req, i);
    budget?.record(0);
    return {
      model: this.model,
      message: { role: "assistant", content: m.content ?? null, refusal: null, tool_calls: m.tool_calls } as ChatCompletionMessage,
      finishReason: m.tool_calls?.length ? "tool_calls" : "stop",
      usage: { prompt: 0, cached: 0, completion: 0, reasoning: 0 },
      costUsd: 0,
    };
  }
}

export interface ClientEnvOptions {
  mock?: boolean;
  /** Use the cheaper contributor model (development on public data only). */
  contributor?: boolean;
}

/**
 * Build the client from env. Returns null when no key is configured and mock is off
 * (the app then serves the recorded sample run).
 */
export function clientFromEnv(o: ClientEnvOptions = {}, mockFactory?: () => LlmClient): LlmClient | null {
  if (o.mock || process.env.MODEL_MODE === "mock") return mockFactory ? mockFactory() : null;
  const provider = process.env.LLM_PROVIDER ?? "meta";
  if (provider === "baseten") {
    const key = process.env.BASETEN_API_KEY;
    if (!key) return null;
    return new MetaModelClient({
      apiKey: key,
      baseURL: process.env.BASETEN_BASE_URL ?? "https://inference.baseten.co/v1",
      model: process.env.BASETEN_MODEL_ID ?? "meta-models/muse-spark-open-1026",
    });
  }
  const key = process.env.MODEL_API_KEY;
  if (!key) return null;
  const base = process.env.MODEL_ID ?? "muse-spark-1.3";
  return new MetaModelClient({
    apiKey: key,
    baseURL: process.env.MODEL_API_BASE_URL || "https://api.meta.ai/v1",
    model: o.contributor ? `${base.replace(/-contributor$/, "")}-contributor` : base,
  });
}
