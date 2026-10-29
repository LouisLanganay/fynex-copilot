export type SourceKind = "SEC EDGAR" | "AMF" | "ESEF";

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
  contentType: "html" | "pdf";
}

/** A fetched document with extracted text. */
export interface SourceDocument extends CandidateDocument {
  text: string;
  /** Offsets in `text` where each PDF page starts (empty for HTML). */
  pageStarts: number[];
  pages: number;
  /** True when the text was transcribed by the model from a scanned PDF. */
  ocr: boolean;
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
