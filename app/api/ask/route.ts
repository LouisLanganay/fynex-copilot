import { NextResponse } from "next/server";
import { cacheGet } from "@/lib/cache/cache";
import { isAdviceRequest, REFUSAL } from "@/lib/guardrail/advice";
import { askDocuments, MAX_QUESTION_CHARS } from "@/lib/llm/ask";
import { checkPasscode, clientIp, currentMode, GateError, runBudget, serverClient } from "@/lib/pipeline/server";
import type { SourceDocument } from "@/lib/sources/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const asked = new Map<string, number>();
const MAX_PER_HOLDING = 3;

/** POST { question, holdingName, documentIds, runId, passcode? } -> guarded answer with verified quotes. */
export async function POST(req: Request) {
  let body: { question?: string; holdingName?: string; documentIds?: string[]; runId?: string; passcode?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const question = String(body.question ?? "").slice(0, MAX_QUESTION_CHARS);
  if (!question.trim()) return NextResponse.json({ error: "Empty question." }, { status: 400 });
  // Input filter before anything else: a refusal never costs a model call.
  if (isAdviceRequest(question)) return NextResponse.json({ kind: "refused", answer: REFUSAL, quotes: [], modelCalled: false });

  if (currentMode() === "replay") {
    return NextResponse.json({ kind: "unavailable", answer: "Follow-up questions need a live model key. This deployment replays a recorded run.", quotes: [], modelCalled: false });
  }
  const ids = (body.documentIds ?? []).filter((x) => /^[a-f0-9]{16}$/.test(x)).slice(0, 2);
  const docs = ids.map((id) => cacheGet<SourceDocument>("doc", id)?.value).filter((d): d is SourceDocument => !!d);
  if (!docs.length) return NextResponse.json({ error: "Documents not available." }, { status: 404 });

  const key = `${clientIp(req)}|${ids.join(",")}`;
  const n = asked.get(key) ?? 0;
  if (n >= MAX_PER_HOLDING) return NextResponse.json({ error: `Limit of ${MAX_PER_HOLDING} questions per holding reached.` }, { status: 429 });
  try {
    checkPasscode(body.passcode);
    const budget = runBudget(String(body.runId ?? "ask"), `ask:${ids[0]}`);
    asked.set(key, n + 1);
    const r = await askDocuments(serverClient()!, String(body.holdingName ?? "the company"), docs, question, budget);
    return NextResponse.json(r);
  } catch (e) {
    if (e instanceof GateError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Question failed." }, { status: 500 });
  }
}
