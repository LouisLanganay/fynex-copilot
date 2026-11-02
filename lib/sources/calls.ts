import { sha } from "@/lib/cache/cache";
import type { Card, CardQuote } from "@/lib/card";
import type { Chunk } from "@/lib/extract/audio";
import type { AsrTurn } from "@/lib/llm/client";
import { asrCost } from "@/lib/llm/prices";
import type { CandidateDocument, SourceDocument, TranscriptTurn } from "./types";

/**
 * Earnings calls as a document type: an automatic transcript with timestamps
 * instead of pages. Full transcripts stay in the local cache, never in the
 * repository: only short verified quotes are recorded (see excerptDocument).
 */

export interface KnownCall {
  isin: string;
  shortName: string;
  title: string;
  date: string;
  /** The official recording, as offered by the company's own player ("Download URL"). Publicly readable, no login. */
  mediaUrl: string;
  /** The company's page for the event. */
  eventUrl: string;
  /** The official HLS stream of the same recording, with a separate audio rendition (the MP4 is 3.5 GB of video). */
  audioStreamUrl: string;
  keywords: string[];
}

export const CALLS: KnownCall[] = [
  {
    isin: "US5949181045",
    shortName: "Microsoft",
    title: "Microsoft FY27 Q1 earnings call",
    date: "2026-10-28",
    mediaUrl: "https://samediusprodwestus2.blob.core.windows.net/video-7536455/6f6901e80d/VOD001.mp4?sv=2025-01-05&se=2031-10-28T23%3A32%3A06Z&sr=b&sp=r&sig=2b6d6hRr%2FfHfH0rRMrJDYYdReyf6KktsLfnoy6rmAe8%3D",
    eventUrl: "https://www.microsoft.com/en-us/investor/events/fy-2027/earnings-fy-2027-q1",
    audioStreamUrl: "https://stream.event.microsoft.com/prodnc/Content/HLS/VOD/13941/5014/020bd157-9da8-44c6-bd67-35e07465b78b/351e70eb-d58a-1670-c146-b46b30885f88/Stream(08)/index.m3u8",
    keywords: ["Azure", "Copilot", "Foundry", "GitHub Copilot", "Microsoft 365", "OpenAI", "capex"],
  },
];

export function callForIsin(isin: string | null | undefined): KnownCall | undefined {
  return CALLS.find((c) => c.isin === isin);
}

/** Document ids hash the event page: the media URL carries a signature that may be reissued. */
export function callDocumentId(call: KnownCall): string {
  return sha(call.eventUrl);
}

export function callCandidate(call: KnownCall): CandidateDocument {
  return {
    id: callDocumentId(call),
    source: "Earnings call",
    url: call.mediaUrl,
    alternateUrl: call.eventUrl,
    title: call.title,
    date: call.date,
    formOrSubtype: "Earnings call, automatic transcript",
    language: "en",
    contentType: "audio",
  };
}

/** Assembles the transcript from the timed clips. A turn's time is the clip's offset plus the time inside the clip. */
export function buildTranscript(call: KnownCall, clips: { chunk: Chunk; turns: AsrTurn[] }[], durationMs: number, now = new Date()): SourceDocument {
  let text = "";
  const turns: TranscriptTurn[] = [];
  for (const { chunk, turns: asr } of [...clips].sort((a, b) => a.chunk.startMs - b.chunk.startMs)) {
    for (const t of asr) {
      const said = t.transcript.replace(/\s+/g, " ").trim();
      if (!said) continue;
      if (text) text += "\n";
      turns.push({ start: text.length, startMs: chunk.startMs + t.startMs, endMs: Math.min(chunk.startMs + t.endMs, chunk.endMs) });
      text += said;
    }
  }
  const transcriptionUsd = clips.reduce((sum, c) => sum + asrCost(c.chunk.endMs - c.chunk.startMs), 0);
  return { ...callCandidate(call), text, pageStarts: [], pages: 1, ocr: false, turns, durationMs, transcriptionUsd, fetchedAt: now.toISOString() };
}

/**
 * The document a public repository may carry: only the quoted passages, each
 * as its own turn. Returns the rewritten document and the card with its quotes
 * pointing into it, so the replay needs no full transcript.
 */
export function excerptDocument(doc: SourceDocument, card: Card): { document: SourceDocument; card: Card } {
  let text = "";
  const turns: TranscriptTurn[] = [];
  const seen = new Map<string, { start: number; end: number }>();
  const move = (q: CardQuote): CardQuote => {
    if (q.documentId !== doc.id) return q;
    const key = `${q.start}:${q.end}`;
    let at = seen.get(key);
    if (!at) {
      if (text) text += "\n\n";
      at = { start: text.length, end: text.length + q.text.length };
      turns.push({ start: at.start, startMs: q.timeMs ?? 0, endMs: q.timeMs ?? 0 });
      text += q.text;
      seen.set(key, at);
    }
    return { ...q, start: at.start, end: at.end };
  };
  const claims = card.claims.map((c) => ({ ...c, quotes: c.quotes.map(move) }));
  return { document: { ...doc, text, turns, excerpt: true }, card: { ...card, claims } };
}
