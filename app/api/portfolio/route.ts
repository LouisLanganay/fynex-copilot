import { NextResponse } from "next/server";
import { CsvError } from "@/lib/portfolio/csv";
import { pct } from "@/lib/portfolio/weights";
import { currentMode, estimateRunUsd, modelLabel, portfolioFor, readSampleRun } from "@/lib/pipeline/server";

export const runtime = "nodejs";

/** POST { csv } -> holdings with code-computed weights and their resolved source. */
export async function POST(req: Request) {
  let csv: string;
  try {
    csv = String(((await req.json()) as { csv?: unknown }).csv ?? "");
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!csv.trim()) return NextResponse.json({ error: "Empty file." }, { status: 400 });
  try {
    const p = await portfolioFor(csv);
    const mode = currentMode();
    const model = modelLabel();
    const withSource = p.summary.holdings.filter((h) => p.resolutions[h.id]?.source).length;
    const run = readSampleRun();
    return NextResponse.json({
      mode,
      model,
      offline: p.offline,
      fxDate: p.summary.fxDate,
      atCost: p.summary.atCost,
      totalEur: Math.round(p.summary.totalEur),
      errors: p.errors,
      estimateUsd: mode === "live" ? estimateRunUsd(withSource, model) : 0,
      recordedAt: mode === "replay" ? run?.recordedAt ?? null : null,
      passcodeRequired: mode === "live" && !!process.env.LIVE_RUN_PASSCODE,
      holdings: p.summary.holdings.map((h) => ({
        id: h.id,
        ticker: h.ticker,
        isin: h.isin,
        name: h.name,
        quantity: h.quantity,
        currency: h.currency,
        valueEur: Math.round(h.valueEur),
        weightPct: pct(h.weight),
        weight: h.weight,
        rank: h.rank,
        source: p.resolutions[h.id]?.source ?? null,
        secondary: p.resolutions[h.id]?.secondary ?? null,
      })),
    });
  } catch (e) {
    const status = e instanceof CsvError ? 400 : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
