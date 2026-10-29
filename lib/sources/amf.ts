import { sha } from "@/lib/cache/cache";
import type { CandidateDocument } from "./types";

/** French regulated information, info-financiere.gouv.fr Opendatasoft API (PLAN.md 3.3). */

export const AMF_RECORDS_URL = "https://info-financiere.gouv.fr/api/explore/v2.1/catalog/datasets/flux-amf-new-prod/records";

export const KEPT_SUBTYPES = [
  "Inside Information",
  "Quarterly financial reporting",
  "Half yearly financial reports and audit reports/limited reviews",
  "Annual financial and audit reports",
];

export interface AmfRecord {
  identificationsociete_iso_nom_soc: string;
  identificationsociete_iso_cd_isi: string;
  identificationsociete_iso_cd_lei?: string | null;
  informationdeposee_inf_dat_emt: string;
  informationdeposee_inf_tit_inf: string;
  informationdeposee_inf_lng_inf?: string | null;
  subtype_of_information?: string | null;
  url_de_recuperation?: string | null;
}

export function amfQueryUrl(isin: string, sinceIso: string, limit = 100): string {
  const where = `identificationsociete_iso_cd_isi="${isin}" AND informationdeposee_inf_dat_emt>=date'${sinceIso}'`;
  const p = new URLSearchParams({ where, order_by: "informationdeposee_inf_dat_emt desc", limit: String(limit) });
  return `${AMF_RECORDS_URL}?${p.toString()}`;
}

const lang = (r: AmfRecord): CandidateDocument["language"] =>
  r.informationdeposee_inf_lng_inf === "Anglais" ? "en" : r.informationdeposee_inf_lng_inf === "Français" ? "fr" : "other";

/**
 * Keep material subtypes, pair French and English twins (same subtype,
 * published within 2 hours), prefer English and keep the French URL as alternate.
 */
export function pickAmfDocuments(records: AmfRecord[], max = 6): CandidateDocument[] {
  const kept = records.filter((r) => r.url_de_recuperation && KEPT_SUBTYPES.includes(r.subtype_of_information ?? ""));
  const used = new Set<AmfRecord>();
  const out: CandidateDocument[] = [];
  const sorted = [...kept].sort((a, b) => b.informationdeposee_inf_dat_emt.localeCompare(a.informationdeposee_inf_dat_emt));
  for (const r of sorted) {
    if (used.has(r)) continue;
    used.add(r);
    const t = Date.parse(r.informationdeposee_inf_dat_emt);
    const twin = sorted.find(
      (o) =>
        !used.has(o) &&
        o.subtype_of_information === r.subtype_of_information &&
        lang(o) !== lang(r) &&
        Math.abs(Date.parse(o.informationdeposee_inf_dat_emt) - t) < 2 * 3600 * 1000,
    );
    if (twin) used.add(twin);
    const en = lang(r) === "en" ? r : twin && lang(twin) === "en" ? twin : r;
    const other = en === r ? twin : r;
    const url = en.url_de_recuperation!;
    out.push({
      id: sha(url),
      source: "AMF",
      url,
      alternateUrl: other?.url_de_recuperation ?? undefined,
      title: en.informationdeposee_inf_tit_inf.trim(),
      date: en.informationdeposee_inf_dat_emt.slice(0, 10),
      formOrSubtype: en.subtype_of_information ?? "",
      language: lang(en),
      contentType: /\.pdf($|\?)/i.test(url) ? "pdf" : "html",
    });
    if (out.length >= max) break;
  }
  return out;
}
