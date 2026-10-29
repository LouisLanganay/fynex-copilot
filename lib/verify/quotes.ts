import { normalize, toRawRange, type Normalized } from "@/lib/extract/normalize";

export const QUOTE_MIN = 20;
export const QUOTE_MAX = 400;

export interface QuoteInput {
  document_id: string;
  text: string;
}

export interface VerifiedQuote {
  documentId: string;
  text: string;
  /** Raw offsets in the document text. */
  start: number;
  end: number;
  /** 1-based page number for PDFs, null for HTML. */
  page: number | null;
}

export type QuoteFailure = "too_short" | "too_long" | "unknown_document" | "not_found";

export interface QuoteCheck {
  ok: boolean;
  quote: QuoteInput;
  reason?: QuoteFailure;
  verified?: VerifiedQuote;
}

export interface VerifiableDocument {
  id: string;
  text: string;
  pageStarts: number[];
}

interface Prepared {
  doc: VerifiableDocument;
  joined: Normalized;
  kept: Normalized;
}

/** Caches normalized forms of the documents for repeated checks. */
export class QuoteVerifier {
  private docs = new Map<string, Prepared>();

  constructor(documents: VerifiableDocument[]) {
    for (const d of documents) {
      this.docs.set(d.id, {
        doc: d,
        joined: normalize(d.text, { joinHyphens: true }),
        kept: normalize(d.text, { joinHyphens: false }),
      });
    }
  }

  check(q: QuoteInput): QuoteCheck {
    const prepared = this.docs.get(q.document_id);
    if (!prepared) return { ok: false, quote: q, reason: "unknown_document" };
    // Strip ellipses and wrapping quotes the model sometimes adds around a quote.
    let cleaned = q.text.trim();
    for (let k = 0; k < 2; k++) {
      cleaned = cleaned.replace(/^["'\u201c\u2018\u00ab\s]+/, "").replace(/(\.\.\.|\u2026|["'\u201d\u2019\u00bb\s])+$/, "");
    }
    for (const variant of [prepared.joined, prepared.kept]) {
      const nq = normalize(cleaned, { joinHyphens: variant === prepared.joined }).text;
      if (nq.length < QUOTE_MIN) return { ok: false, quote: q, reason: "too_short" };
      if (nq.length > QUOTE_MAX) return { ok: false, quote: q, reason: "too_long" };
      const at = variant.text.indexOf(nq);
      if (at >= 0) {
        const raw = toRawRange(variant, at, at + nq.length);
        return {
          ok: true,
          quote: q,
          verified: {
            documentId: q.document_id,
            text: prepared.doc.text.slice(raw.start, raw.end),
            start: raw.start,
            end: raw.end,
            page: pageOf(prepared.doc.pageStarts, raw.start),
          },
        };
      }
    }
    return { ok: false, quote: q, reason: "not_found" };
  }
}

/** 1-based page number containing `offset`, or null when there are no pages. */
export function pageOf(pageStarts: number[], offset: number): number | null {
  if (!pageStarts.length) return null;
  let page = 1;
  for (let i = 0; i < pageStarts.length; i++) {
    if (pageStarts[i] <= offset) page = i + 1;
    else break;
  }
  return page;
}

/** Verify all quotes of a claim: the claim survives only if every quote verifies. */
export function verifyClaimQuotes(
  verifier: QuoteVerifier,
  quotes: QuoteInput[],
): { ok: true; verified: VerifiedQuote[] } | { ok: false; failures: QuoteCheck[] } {
  if (!quotes.length) return { ok: false, failures: [] };
  const checks = quotes.map((q) => verifier.check(q));
  const failures = checks.filter((c) => !c.ok);
  if (failures.length) return { ok: false, failures };
  return { ok: true, verified: checks.map((c) => c.verified!) };
}
