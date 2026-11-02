/**
 * Timed chunks for call transcription. Muse Voice Transcribe returns turn-level
 * timestamps only, and a continuous monologue can come back as one long turn.
 * So we cut the recording at its pauses into short clips and keep each clip's
 * offset: a passage is located to within a clip, whatever the API reports.
 */

import type { TranscriptTurn } from "@/lib/sources/types";

export interface Silence {
  startMs: number;
  endMs: number;
}

export interface Chunk {
  startMs: number;
  endMs: number;
}

/** Parses the stderr of `ffmpeg -af silencedetect`. An unterminated last silence is dropped. */
export function parseSilences(stderr: string): Silence[] {
  const out: Silence[] = [];
  let open: number | null = null;
  for (const line of stderr.split("\n")) {
    const start = line.match(/silence_start: (-?[\d.]+)/);
    if (start) open = Math.max(0, Number(start[1])) * 1000;
    const end = line.match(/silence_end: ([\d.]+)/);
    if (end && open !== null) {
      out.push({ startMs: Math.round(open), endMs: Math.round(Number(end[1]) * 1000) });
      open = null;
    }
  }
  return out;
}

export interface ChunkPlan {
  /** Cut at the first pause after this length. */
  targetMs: number;
  /** Cut anyway at this length if no pause was found. */
  maxMs: number;
}

export const DEFAULT_CHUNKS: ChunkPlan = { targetMs: 15_000, maxMs: 40_000 };

/** Contiguous chunks covering [0, durationMs], cut in the middle of pauses when possible. */
export function planChunks(silences: Silence[], durationMs: number, plan: ChunkPlan = DEFAULT_CHUNKS): Chunk[] {
  const cuts = silences.map((s) => Math.round((s.startMs + s.endMs) / 2)).filter((c) => c > 0 && c < durationMs);
  const chunks: Chunk[] = [];
  let start = 0;
  let i = 0;
  while (start < durationMs) {
    while (i < cuts.length && cuts[i] < start + plan.targetMs) i++;
    let end: number;
    if (i < cuts.length && cuts[i] <= start + plan.maxMs) end = cuts[i];
    else end = Math.min(start + plan.maxMs, durationMs);
    // A tail shorter than the target joins this chunk when that stays under the maximum.
    if (durationMs - end < plan.targetMs / 3 && durationMs - start <= plan.maxMs) end = durationMs;
    chunks.push({ startMs: start, endMs: end });
    start = end;
  }
  return chunks;
}

/** Duration of a mono 16-bit PCM WAV with the canonical 44-byte header. */
export function wavDurationMs(bytes: Uint8Array): number {
  if (bytes.length < 44) return 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const byteRate = view.getUint32(28, true);
  return byteRate ? Math.round(((bytes.length - 44) / byteRate) * 1000) : 0;
}

/** "14:32", or "1:02:05" past the hour. */
export function formatTimestamp(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** Lead before the estimated moment: measured error is under 3 s for 90% of passages, and it is better to start early. */
export const QUOTE_LEAD_MS = 3000;

/**
 * Where a passage starts in the recording. Turns are timed, words are not, so the
 * position inside a turn is proportional to the characters before it, minus a
 * small lead, and never earlier than the turn. Null for a document without turns.
 * Measured against the company's own captions: see NOTES.md.
 */
export function timeOf(turns: TranscriptTurn[] | undefined, offset: number, textLength = Infinity): number | null {
  if (!turns?.length) return null;
  let i = 0;
  while (i + 1 < turns.length && turns[i + 1].start <= offset) i++;
  const t = turns[i];
  const end = turns[i + 1]?.start ?? textLength;
  if (!Number.isFinite(end) || end <= t.start) return t.startMs;
  const fraction = Math.min(1, Math.max(0, offset - t.start) / (end - t.start));
  return Math.max(t.startMs, Math.round(t.startMs + fraction * (t.endMs - t.startMs) - QUOTE_LEAD_MS));
}
