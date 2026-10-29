import fs from "node:fs";
import path from "node:path";

/**
 * Budget caps (PLAN.md section 8).
 * - RunBudget: per portfolio analysis (MAX_USD_PER_RUN, default 3).
 * - Ledger: append-only JSONL of every paid call, total cap BUDGET_USD_TOTAL.
 */

export class BudgetExceededError extends Error {
  constructor(
    public scope: "run" | "total",
    message: string,
  ) {
    super(message);
  }
}

export class RunBudget {
  spent = 0;
  calls = 0;
  constructor(
    public readonly maxUsd: number,
    public readonly runId: string = `run-${Date.now()}`,
  ) {}

  assertCanSpend(estimate: number) {
    if (this.spent + estimate > this.maxUsd) {
      throw new BudgetExceededError(
        "run",
        `Run cap reached: spent $${this.spent.toFixed(4)}, next call up to $${estimate.toFixed(4)}, cap $${this.maxUsd}.`,
      );
    }
  }

  record(cost: number) {
    this.spent += cost;
    this.calls += 1;
  }
}

export interface LedgerEntry {
  ts: string;
  runId: string;
  model: string;
  purpose: string;
  prompt_tokens: number;
  cached_tokens: number;
  completion_tokens: number;
  reasoning_tokens: number;
  usd: number;
}

export function ledgerPath(): string {
  if (process.env.COST_LEDGER_PATH) return process.env.COST_LEDGER_PATH;
  const base = process.env.VERCEL ? "/tmp/fynex-copilot" : path.join(process.cwd(), ".cache");
  return path.join(base, "ledger.jsonl");
}

export function readLedger(file = ledgerPath()): LedgerEntry[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as LedgerEntry];
      } catch {
        return [];
      }
    });
}

export function ledgerTotal(file = ledgerPath()): number {
  return readLedger(file).reduce((s, e) => s + (Number(e.usd) || 0), 0);
}

export function appendLedger(entry: LedgerEntry, file = ledgerPath()) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(entry) + "\n");
}

export function totalCap(): number {
  const v = Number(process.env.BUDGET_USD_TOTAL);
  return Number.isFinite(v) && v > 0 ? v : 100;
}

export function runCap(): number {
  const v = Number(process.env.MAX_USD_PER_RUN);
  return Number.isFinite(v) && v > 0 ? v : 3;
}

export function assertTotalBudget(estimate: number, file = ledgerPath(), cap = totalCap()) {
  const total = ledgerTotal(file);
  if (total + estimate > cap) {
    throw new BudgetExceededError(
      "total",
      `Total budget reached: ledger $${total.toFixed(4)}, next call up to $${estimate.toFixed(4)}, cap $${cap}.`,
    );
  }
}
