/**
 * Prices in USD per 1M tokens, from https://dev.meta.ai/docs/pricing-rate-limits
 * (checked 2026-10-29). Reasoning tokens are included in `completion_tokens`
 * by the API (verified on a live call) and billed at the output price.
 * An unknown model id refuses to run.
 */
export interface ModelPrice {
  input: number;
  cachedInput: number;
  output: number;
}

export const PRICES: Record<string, ModelPrice> = {
  "muse-spark-1.3": { input: 1.25, cachedInput: 0.15, output: 4.25 },
  "muse-spark-1.3-contributor": { input: 0.1, cachedInput: 0.002, output: 0.2 },
  // Baseten Muse Spark Open: price not verified, use the Standard Muse Spark price as a prudent ceiling.
  "meta-models/muse-spark-open-1026": { input: 1.25, cachedInput: 1.25, output: 4.25 },
};

export class UnknownModelError extends Error {
  constructor(model: string) {
    super(`No price known for model "${model}": refusing to call it.`);
  }
}

export function priceOf(model: string): ModelPrice {
  const p = PRICES[model];
  if (!p) throw new UnknownModelError(model);
  return p;
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  prompt_tokens_details?: { cached_tokens?: number | null } | null;
  completion_tokens_details?: { reasoning_tokens?: number | null } | null;
}

export function costOf(model: string, usage: Usage): number {
  const p = priceOf(model);
  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
  const fresh = Math.max(0, usage.prompt_tokens - cached);
  return (fresh * p.input + cached * p.cachedInput + usage.completion_tokens * p.output) / 1_000_000;
}

/** Upper bound before a call: chars / 4 input tokens, full max_tokens output. */
export function estimateCost(model: string, inputChars: number, maxTokens: number): number {
  const p = priceOf(model);
  return (Math.ceil(inputChars / 4) * p.input + maxTokens * p.output) / 1_000_000;
}
