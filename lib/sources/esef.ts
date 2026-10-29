import { sha } from "@/lib/cache/cache";
import type { CandidateDocument } from "./types";

/** ESEF annual reports via filings.xbrl.org (PLAN.md 3.4). */

export const XBRL_BASE = "https://filings.xbrl.org";

export function esefQueryUrl(lei: string): string {
  const filter = JSON.stringify([{ name: "entity.identifier", op: "eq", val: lei }]);
  return `${XBRL_BASE}/api/filings?filter=${encodeURIComponent(filter)}&sort=-date_added&page[size]=5`;
}

export interface EsefFilingsResponse {
  data: {
    id: string;
    attributes: { report_url?: string | null; viewer_url?: string | null; period_end?: string | null; date_added?: string | null; processed?: string | null };
  }[];
}

/** Latest annual report with an XHTML report. */
export function pickEsefDocument(res: EsefFilingsResponse, companyName: string): CandidateDocument | null {
  const f = res.data.find((d) => d.attributes.report_url);
  if (!f) return null;
  const a = f.attributes;
  const url = new URL(a.report_url!, XBRL_BASE).toString();
  const date = (a.date_added ?? a.processed ?? a.period_end ?? "").slice(0, 10);
  return {
    id: sha(url),
    source: "ESEF",
    url,
    alternateUrl: a.viewer_url ? new URL(a.viewer_url, XBRL_BASE).toString() : undefined,
    title: `${companyName}: annual financial report (ESEF, period ending ${a.period_end ?? "n/a"})`,
    date,
    formOrSubtype: "Annual report (ESEF)",
    language: "other",
    contentType: "html",
  };
}

/** Annual reports run to hundreds of pages: keep about the first 30 pages of text. */
export const ESEF_MAX_CHARS = 90_000;
