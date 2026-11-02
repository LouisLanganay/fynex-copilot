import "./env";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { cacheGet, cacheRoot, cacheSet, fixturesRoot } from "@/lib/cache/cache";
import type { Card } from "@/lib/card";
import { formatTimestamp, parseSilences, planChunks, type Chunk } from "@/lib/extract/audio";
import { RunBudget, runCap } from "@/lib/llm/budget";
import { clientFromEnv, type AsrTurn } from "@/lib/llm/client";
import { analyzeHolding } from "@/lib/pipeline/holding";
import type { PortfolioSummary } from "@/lib/portfolio/weights";
import { runToMarkdown, sampleRunMeta } from "@/lib/report/markdown";
import { buildTranscript, callDocumentId, CALLS, excerptDocument } from "@/lib/sources/calls";
import type { ResolvedHolding } from "@/lib/sources/types";
import { flag, option } from "./env";

/**
 * Transcribe a known earnings call with Muse Voice Transcribe, in timed clips.
 * Everything stays under the gitignored cache: audio, clips, full transcript.
 * Needs ffmpeg and MODEL_API_KEY. About $0.18 per hour of audio.
 *
 *   npm run record-call                  transcribe the known calls (cached clip by clip)
 *   npm run record-call -- --max-clips=5 stop after a few clips (test)
 *   npm run record-call -- --analyze              run the holding's card on the transcript, live
 *   npm run record-call -- --analyze --contributor  same on the contributor model (development)
 *   npm run record-call -- --analyze --record     put the card in fixtures/sample-run.json, with an
 *                                                 excerpt of the transcript (quotes only), and re-render examples/
 */

const CONCURRENCY = 6;

/** Runs the holding through the normal pipeline, then optionally records the card in the replay. */
async function analyze() {
  const contributor = flag("contributor");
  const client = clientFromEnv({ contributor });
  if (!client) throw new Error("MODEL_API_KEY is not set.");
  // The recorded run's portfolio: today's FX rates would give this one card different weights from the others.
  const recorded = JSON.parse(fs.readFileSync(path.join(fixturesRoot(), "sample-run.json"), "utf8"));
  const summary: PortfolioSummary = recorded.summary;
  const resolutions: Record<string, ResolvedHolding> = recorded.resolutions;
  const budget = new RunBudget(runCap(), `call-analyze-${Date.now()}`);
  for (const call of CALLS) {
    const h = summary.holdings.find((x) => x.isin === call.isin);
    if (!h) continue;
    const { card, documents } = await analyzeHolding(h, summary, resolutions[h.id], client, budget, { useCache: !flag("no-cache") });
    console.log(`${card.name}: ${card.state}, ${card.status}, ${card.claims.length} claims, ${card.quotesVerified} quotes, attempts ${card.attempts}, rejections ${card.rejections.length}, $${card.costUsd.toFixed(4)}`);
    console.log(`Triage: ${card.triage?.method}, ${card.triage?.reason}`);
    console.log(`Documents: ${card.documents.map((d) => `${d.source} ${d.date}`).join(" + ")}`);
    console.log(card.headline);
    for (const c of card.claims) {
      console.log(`- [${c.category}] ${c.statement}\n  ${c.whyItMatters}`);
      for (const q of c.quotes) console.log(`    ${typeof q.timeMs === "number" ? formatTimestamp(q.timeMs) : `p.${q.page}`}  "${q.text.replace(/\s+/g, " ")}"`);
    }
    for (const r of card.rejections) console.log(`  rejected (${r.kind}): ${r.detail.slice(0, 200)}`);
    if (!flag("record")) continue;
    if (card.state !== "ok" || contributor) throw new Error("Only a verified card on muse-spark-1.3 is recorded.");
    const doc = documents.find((d) => d.id === callDocumentId(call));
    if (!doc) throw new Error("The triage did not select the call: nothing recorded.");
    const { document, card: moved } = excerptDocument(doc, card);
    const transcriptionUsd = doc.transcriptionUsd ?? 0;
    const recordedAt = new Date().toISOString();
    const final: Card = { ...moved, transcriptionUsd, costUsd: moved.costUsd + transcriptionUsd, recordedAt, cachedFrom: undefined };
    const root = path.join(fixturesRoot(), "cache");
    cacheSet("doc", doc.id, document, root);
    for (const d of documents) if (d.id !== doc.id && !cacheGet("doc", d.id)?.fromFixture) cacheSet("doc", d.id, d, root);
    const file = path.join(fixturesRoot(), "sample-run.json");
    const run = JSON.parse(fs.readFileSync(file, "utf8"));
    run.cards = run.cards.map((c: Card) => (c.holdingId === h.id ? final : c));
    run.totalUsd = run.cards.reduce((sum: number, c: Card) => sum + c.costUsd, 0);
    run.additions = [{ holdingId: h.id, recordedAt, note: `The ${call.shortName} card, with its earnings call, was recorded on ${recordedAt.slice(0, 10)}.` }];
    fs.writeFileSync(file, JSON.stringify(run, null, 1));
    fs.writeFileSync(path.join("examples", "sample-run.md"), runToMarkdown(run.cards, sampleRunMeta(run)));
    console.log(`Recorded. Run total now $${run.totalUsd.toFixed(4)}.`);
  }
}

function wavClip(wav: string, c: Chunk): Uint8Array {
  const out = execFileSync(
    "ffmpeg",
    ["-v", "error", "-ss", (c.startMs / 1000).toFixed(3), "-t", ((c.endMs - c.startMs) / 1000).toFixed(3), "-i", wav, "-c:a", "pcm_s16le", "-map_metadata", "-1", "-bitexact", "-f", "wav", "pipe:1"],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  return new Uint8Array(out);
}

async function main() {
  if (flag("analyze")) return analyze();
  const client = clientFromEnv();
  if (!client?.transcribeAudio) {
    console.log("MODEL_API_KEY is not set: nothing to do.");
    process.exit(1);
  }
  const budget = new RunBudget(Number(option("cap")) || 1, `call-${Date.now()}`);
  const dir = path.join(cacheRoot(), "calls");
  fs.mkdirSync(dir, { recursive: true });
  for (const call of CALLS) {
    const id = callDocumentId(call);
    const wav = path.join(dir, `${id}.wav`);
    if (!fs.existsSync(wav)) {
      console.log(`Extracting the audio of "${call.title}"...`);
      execFileSync("ffmpeg", ["-v", "error", "-y", "-i", call.audioStreamUrl, "-vn", "-ac", "1", "-ar", "24000", "-c:a", "pcm_s16le", "-map_metadata", "-1", `${wav}.tmp.wav`]);
      fs.renameSync(`${wav}.tmp.wav`, wav);
    }
    const durationMs = Math.round(Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", wav]).toString().trim()) * 1000);
    const detect = spawnSync("ffmpeg", ["-hide_banner", "-i", wav, "-af", "silencedetect=noise=-35dB:d=0.25", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const chunks = planChunks(parseSilences(detect.stderr), durationMs);
    const limit = Number(option("max-clips")) || chunks.length;
    console.log(`${(durationMs / 60000).toFixed(1)} min, ${chunks.length} clips.`);

    const clips: { chunk: Chunk; turns: AsrTurn[] }[] = [];
    let next = 0;
    const worker = async () => {
      while (next < Math.min(limit, chunks.length)) {
        const i = next++;
        const chunk = chunks[i];
        const key = `${id}-${chunk.startMs}-${chunk.endMs}`;
        let turns = cacheGet<AsrTurn[]>("call-clip", key)?.value;
        if (!turns) {
          turns = (await client.transcribeAudio!({ purpose: `transcribe:${id}:${i}`, wav: wavClip(wav, chunk), languageBias: ["English"], keywords: call.keywords }, budget)).turns;
          cacheSet("call-clip", key, turns);
        }
        clips.push({ chunk, turns });
        if (i % 20 === 0) console.log(`clip ${i}/${chunks.length}, spent $${budget.spent.toFixed(4)}`);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    const doc = buildTranscript(call, clips, durationMs);
    if (limit >= chunks.length && !flag("no-save")) cacheSet("transcript", id, doc);
    console.log(`Transcript: ${doc.text.length} chars, ${doc.turns?.length} turns, $${budget.spent.toFixed(4)}.`);
  }
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
