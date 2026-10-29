import fs from "node:fs";
import path from "node:path";
import { fixturesRoot } from "@/lib/cache/cache";
import { parsePortfolioCsv, type RowError } from "@/lib/portfolio/csv";
import { fetchEcbRates, type FxRates } from "@/lib/portfolio/fx";
import { computeWeights, type PortfolioSummary } from "@/lib/portfolio/weights";
import { resolveHolding } from "@/lib/resolve/resolve";
import { liveResolveDeps } from "@/lib/sources/fetch";
import type { ResolvedHolding } from "@/lib/sources/types";

export interface RecordedContext {
  recordedAt: string;
  fx: FxRates;
  resolutions: Record<string, ResolvedHolding>;
}

export function readRecordedContext(): RecordedContext | null {
  const f = path.join(fixturesRoot(), "candidates.json");
  if (!fs.existsSync(f)) return null;
  const j = JSON.parse(fs.readFileSync(f, "utf8"));
  return { recordedAt: j.recordedAt, fx: j.fx, resolutions: j.resolutions };
}

export interface LoadedPortfolio {
  summary: PortfolioSummary;
  resolutions: Record<string, ResolvedHolding>;
  errors: RowError[];
  offline: boolean;
}

export async function loadPortfolio(csv: string, o: { offline?: boolean } = {}): Promise<LoadedPortfolio> {
  const { holdings, errors } = parsePortfolioCsv(csv);
  const recorded = readRecordedContext();
  let offline = !!o.offline;
  let fx: FxRates;
  if (offline) {
    if (!recorded) throw new Error("Offline mode needs fixtures/candidates.json (run npm run record-fixtures).");
    fx = recorded.fx;
  } else {
    try {
      fx = await fetchEcbRates();
    } catch (e) {
      if (!recorded) throw e;
      fx = recorded.fx;
      offline = true;
    }
  }
  const summary = computeWeights(holdings, fx);
  const resolutions: Record<string, ResolvedHolding> = {};
  for (const h of summary.holdings) {
    if (offline) resolutions[h.id] = recorded?.resolutions[h.id] ?? { source: null, note: "Offline: identifier not in the recorded sample." };
    else resolutions[h.id] = await resolveHolding(h, liveResolveDeps);
  }
  return { summary, resolutions, errors, offline };
}

export function samplePortfolioCsv(): string {
  return fs.readFileSync(path.join(process.cwd(), "samples", "portfolio.csv"), "utf8");
}
