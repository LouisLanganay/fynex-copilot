/** Shapes shared by the server and the UI (no Node imports here). */

export type CardStatus = "material_change" | "minor_update" | "no_new_information";

export interface CardQuote {
  documentId: string;
  /** Raw passage from the document (what the UI highlights). */
  text: string;
  start: number;
  end: number;
  page: number | null;
}

export interface CardClaim {
  category: "results" | "guidance" | "capital" | "strategy" | "risk" | "other";
  statement: string;
  whyItMatters: string;
  quotes: CardQuote[];
}

export interface CardDocument {
  id: string;
  source: string;
  title: string;
  date: string;
  url: string;
  alternateUrl?: string;
  formOrSubtype: string;
  language: string;
  pages: number;
  ocr: boolean;
  chars: number;
}

export interface Rejection {
  attempt: number;
  kind: "quote" | "number" | "advice" | "schema" | "empty";
  detail: string;
}

export interface Card {
  holdingId: string;
  name: string;
  ticker: string | null;
  weightPct: number;
  rank: number;
  state: "ok" | "fallback" | "no_source" | "no_document" | "budget" | "error";
  status: CardStatus | null;
  headline: string;
  claims: CardClaim[];
  portfolioNote: string;
  documents: CardDocument[];
  triage: { method: string; reason: string; toolCalls: string[] } | null;
  attempts: number;
  rejections: Rejection[];
  quotesVerified: number;
  model: string;
  usage: { prompt: number; cached: number; completion: number; reasoning: number };
  costUsd: number;
  note?: string;
  generatedAt: string;
  /** Set when served from the recorded sample run. */
  cachedFrom?: string;
}
