export type SourceKind = "SEC EDGAR" | "AMF" | "ESEF" | "Earnings call";

/** A document we could analyze, before its text is fetched. */
export interface CandidateDocument {
  /** Stable id: hash of the URL. */
  id: string;
  source: SourceKind;
  url: string;
  /** Alternate link (e.g. the French twin of an AMF release, or the SEC filing index). */
  alternateUrl?: string;
  title: string;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  /** e.g. "8-K 2.02", "6-K", "10-Q", "Quarterly financial reporting". */
  formOrSubtype: string;
  language: "en" | "fr" | "other";
  contentType: "html" | "pdf" | "audio";
}

/** A speech turn of a transcript: where it starts in the text and in the recording. */
export interface TranscriptTurn {
  /** Offset in `text`. */
  start: number;
  startMs: number;
  endMs: number;
}

/** A fetched document with extracted text. */
export interface SourceDocument extends CandidateDocument {
  text: string;
  /** Offsets in `text` where each PDF page starts (empty for HTML). */
  pageStarts: number[];
  pages: number;
  /** True when the text was transcribed by the model from a scanned PDF. */
  ocr: boolean;
  /** Audio documents: the transcript's turns, in order. Quotes read as timestamps, not pages. */
  turns?: TranscriptTurn[];
  durationMs?: number;
  /** What the speech to text of this recording cost, clip by clip. */
  transcriptionUsd?: number;
  /** True when `text` holds only the quoted passages (what a public repository may carry). */
  excerpt?: boolean;
  fetchedAt: string;
}

export interface ResolvedHolding {
  source: SourceKind | null;
  secondary?: SourceKind | null;
  cik?: string;
  secTitle?: string;
  lei?: string;
  note?: string;
}
