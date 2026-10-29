import fs from "node:fs";
import path from "node:path";
import type { Card } from "@/lib/card";
import { fixturesRoot, sha } from "@/lib/cache/cache";
import { RunBudget, runCap } from "@/lib/llm/budget";
import { clientFromEnv, type LlmClient } from "@/lib/llm/client";
import { mockClient } from "@/lib/llm/mock";
import { loadPortfolio, type LoadedPortfolio } from "./portfolio";

/**
 * Server-side state for the web app: mode selection, per-run budgets,
 * live-run gating (passcode, holdings per run, runs per hour) and the
 * recorded sample run. All in memory, per instance (PLAN.md section 8).
 */

export type Mode = "live" | "mock" | "replay";

export function currentMode(): Mode {
  if (process.env.DEMO_READONLY === "true") return "replay";
  if (process.env.MODEL_MODE === "mock") return "mock";
  if (process.env.LLM_PROVIDER === "baseten" ? process.env.BASETEN_API_KEY : process.env.MODEL_API_KEY) return "live";
  return "replay";
}

let client: LlmClient | null | undefined;
export function serverClient(): LlmClient | null {
  if (client === undefined) client = clientFromEnv({}, mockClient);
  return client;
}

export function modelLabel(): string {
  const m = currentMode();
  if (m === "replay") return readSampleRun()?.model ?? "recorded";
  return serverClient()?.model ?? "none";
}

const portfolios = new Map<string, Promise<LoadedPortfolio>>();
export function portfolioFor(csv: string): Promise<LoadedPortfolio> {
  const key = sha(csv);
  let p = portfolios.get(key);
  if (!p) {
    p = loadPortfolio(csv, { offline: currentMode() === "replay" });
    p.catch(() => portfolios.delete(key));
    portfolios.set(key, p);
    if (portfolios.size > 50) portfolios.delete(portfolios.keys().next().value!);
  }
  return p;
}

const budgets = new Map<string, { budget: RunBudget; holdings: Set<string>; startedAt: number }>();
const MAX_HOLDINGS = () => Number(process.env.MAX_HOLDINGS_PER_RUN) || 15;
const MAX_RUNS_PER_HOUR = 10;

export class GateError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Budget for a run id, creating it if the hourly live-run limit allows. */
export function runBudget(runId: string, holdingId: string): RunBudget {
  const now = Date.now();
  for (const [k, v] of budgets) if (now - v.startedAt > 3600_000) budgets.delete(k);
  let r = budgets.get(runId);
  if (!r) {
    if (budgets.size >= MAX_RUNS_PER_HOUR) throw new GateError(429, "Too many live runs in the last hour on this server. Try the recorded sample.");
    r = { budget: new RunBudget(runCap(), runId), holdings: new Set(), startedAt: now };
    budgets.set(runId, r);
  }
  r.holdings.add(holdingId);
  if (r.holdings.size > MAX_HOLDINGS()) throw new GateError(400, `A live run is limited to ${MAX_HOLDINGS()} holdings.`);
  return r.budget;
}

export function checkPasscode(passcode: string | undefined) {
  const expected = process.env.LIVE_RUN_PASSCODE;
  if (expected && passcode !== expected) throw new GateError(401, "Live analysis needs the passcode. The recorded sample run is free to view.");
}

export interface SampleRun {
  recordedAt: string;
  model: string;
  totalUsd: number;
  cards: Card[];
}

let sample: SampleRun | null | undefined;
export function readSampleRun(): SampleRun | null {
  if (sample === undefined) {
    const f = path.join(fixturesRoot(), "sample-run.json");
    sample = fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, "utf8")) as SampleRun) : null;
  }
  return sample;
}

export function recordedCard(holdingId: string): Card | null {
  const run = readSampleRun();
  const c = run?.cards.find((x) => x.holdingId === holdingId);
  return c ? { ...c, cachedFrom: run!.recordedAt } : null;
}

/** Cost estimate shown before a run: about $0.05 per holding on muse-spark-1.3 (measured). */
export function estimateRunUsd(holdingsWithSource: number, model: string): number {
  const perHolding = model.endsWith("-contributor") ? 0.004 : model.startsWith("muse-spark") ? 0.05 : 0;
  return Math.round(holdingsWithSource * perHolding * 100) / 100;
}

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
}
