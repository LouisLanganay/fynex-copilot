import { cached, cacheGet, cacheSet } from "@/lib/cache/cache";
import { htmlToText } from "@/lib/extract/html-to-text";
import { pdfToText, looksScanned } from "@/lib/extract/pdf-to-text";
import type { Holding } from "@/lib/portfolio/csv";
import type { ResolveDeps } from "@/lib/resolve/resolve";
import { amfQueryUrl, pickAmfDocuments, type AmfRecord } from "./amf";
import {
  edgarCandidate,
  indexPageUrl,
  parseCompanyTickers,
  parseIndexHtml,
  pickEdgarFilings,
  pickExhibit,
  SEC_TICKERS_URL,
  submissionsUrl,
  type Submissions,
} from "./edgar";
import { esefQueryUrl, ESEF_MAX_CHARS, pickEsefDocument, type EsefFilingsResponse } from "./esef";
import { fetchBytes, fetchJson, fetchText } from "./http";
import type { CandidateDocument, ResolvedHolding, SourceDocument } from "./types";

/** Network side of the sources, with caching. */

const DAY = 24 * 3600 * 1000;
export const LOOKBACK_DAYS = 120;

export function sinceIso(days = LOOKBACK_DAYS, now = new Date()): string {
  return new Date(now.getTime() - days * DAY).toISOString().slice(0, 10);
}

export const liveResolveDeps: ResolveDeps = {
  secTickers: () =>
    cached("sec", "company_tickers", async () => parseCompanyTickers(await fetchJson(SEC_TICKERS_URL)), DAY),
  openFigiTicker: (isin) =>
    cached(
      "openfigi",
      isin,
      async () => {
        const res = await fetchJson<{ data?: { ticker: string; name: string }[] }[]>("https://api.openfigi.com/v3/mapping", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify([{ idType: "ID_ISIN", idValue: isin, exchCode: "US" }]),
        });
        const d = res[0]?.data?.[0];
        return d ? { ticker: d.ticker, name: d.name } : null;
      },
      7 * DAY,
    ),
  gleifLei: (isin) =>
    cached(
      "gleif",
      isin,
      async () => {
        const res = await fetchJson<{ data: { id: string }[] }>(
          `https://api.gleif.org/api/v1/lei-records?filter%5Bisin%5D=${encodeURIComponent(isin)}`,
        );
        return res.data[0]?.id ?? null;
      },
      30 * DAY,
    ),
  esefHasFilings: async (lei) => (await esefFilings(lei)).data.some((d) => d.attributes.report_url),
};

function esefFilings(lei: string) {
  return cached("esef", lei, () => fetchJson<EsefFilingsResponse>(esefQueryUrl(lei)), DAY);
}

/** Candidate documents for a resolved holding, newest first, max 6. */
export async function listCandidates(h: Holding, r: ResolvedHolding, now = new Date()): Promise<CandidateDocument[]> {
  const since = sinceIso(LOOKBACK_DAYS, now);
  const out: CandidateDocument[] = [];
  if (r.source === "AMF" && h.isin) {
    const res = await cached(
      "amf",
      `${h.isin}-${since}`,
      () => fetchJson<{ results: AmfRecord[] }>(amfQueryUrl(h.isin!, since)),
      6 * 3600 * 1000,
    );
    out.push(...pickAmfDocuments(res.results));
  }
  if ((r.source === "SEC EDGAR" || (r.secondary === "SEC EDGAR" && out.length < 2)) && r.cik) {
    const sub = await cached("sec-sub", `${r.cik}-${since}`, () => fetchJson<Submissions>(submissionsUrl(r.cik!)), 6 * 3600 * 1000);
    const filings = pickEdgarFilings(r.cik, sub, since, r.source === "SEC EDGAR" ? 6 : 2);
    for (const f of filings) {
      const files = await cached("sec-index", f.accession, async () => parseIndexHtml(await fetchText(indexPageUrl(f))), 30 * DAY);
      out.push(edgarCandidate(f, pickExhibit(f, files), h.name));
    }
  }
  if (r.source === "ESEF" && r.lei) {
    const doc = pickEsefDocument(await esefFilings(r.lei), h.name);
    if (doc) out.push(doc);
  }
  out.sort((a, b) => b.date.localeCompare(a.date));
  return out.slice(0, 6);
}

export interface LoadOptions {
  /** Called with the PDF bytes when the PDF looks scanned (model transcription fallback). */
  transcribe?: (bytes: Uint8Array, c: CandidateDocument) => Promise<string | null>;
}

/** Fetch and extract a document, cached by id (= hash of the URL). */
export async function loadDocument(c: CandidateDocument, o: LoadOptions = {}): Promise<SourceDocument> {
  const hit = cacheGet<SourceDocument>("doc", c.id);
  if (hit) return hit.value;
  const bytes = await fetchBytes(c.url);
  let doc: SourceDocument;
  if (c.contentType === "pdf") {
    const p = await pdfToText(bytes);
    let text = p.text;
    let pageStarts = p.pageStarts;
    let ocr = false;
    if (looksScanned(p) && o.transcribe) {
      const t = await o.transcribe(bytes, c);
      if (t) {
        text = t;
        pageStarts = [];
        ocr = true;
      }
    }
    doc = { ...c, text, pageStarts, pages: p.pages, ocr, fetchedAt: new Date().toISOString() };
  } else {
    let text = htmlToText(new TextDecoder("utf-8").decode(bytes));
    if (c.source === "ESEF") text = text.slice(0, ESEF_MAX_CHARS);
    doc = { ...c, text, pageStarts: [], pages: 1, ocr: false, fetchedAt: new Date().toISOString() };
  }
  cacheSet("doc", c.id, doc);
  return doc;
}
