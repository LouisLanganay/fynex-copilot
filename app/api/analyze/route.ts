import { NextResponse } from "next/server";
import { analyzeHolding, baseCard } from "@/lib/pipeline/holding";
import { checkPasscode, currentMode, GateError, portfolioFor, recordedCard, runBudget, serverClient } from "@/lib/pipeline/server";

export const runtime = "nodejs";
export const maxDuration = 120;

/** POST { csv, holdingId, runId, passcode? } -> one card. One request per holding. */
export async function POST(req: Request) {
  let body: { csv?: string; holdingId?: string; runId?: string; passcode?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const { csv = "", holdingId = "", runId = "" } = body;
  if (!csv || !holdingId || !/^[\w-]{6,64}$/.test(runId)) return NextResponse.json({ error: "Missing fields." }, { status: 400 });

  try {
    const mode = currentMode();
    const p = await portfolioFor(csv);
    const h = p.summary.holdings.find((x) => x.id === holdingId);
    if (!h) return NextResponse.json({ error: "Unknown holding." }, { status: 404 });

    if (mode === "replay") {
      const card = recordedCard(holdingId);
      if (card) return NextResponse.json({ card });
      return NextResponse.json({
        card: { ...baseCard(h, "none"), state: "no_document", headline: "Not in the recorded sample.", note: "This deployment replays a recorded run of the sample portfolio. Live analysis needs a Meta Model API key." },
      });
    }
    checkPasscode(body.passcode);
    const budget = runBudget(runId, holdingId);
    const { card } = await analyzeHolding(h, p.summary, p.resolutions[h.id], serverClient()!, budget, { offline: p.offline });
    return NextResponse.json({ card, runSpentUsd: budget.spent });
  } catch (e) {
    if (e instanceof GateError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("analyze failed", (e as Error).message);
    return NextResponse.json({ error: "Analysis failed. Retry this card." }, { status: 500 });
  }
}
