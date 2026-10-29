import * as cheerio from "cheerio";
import { sha } from "@/lib/cache/cache";
import type { CandidateDocument } from "./types";

/** SEC EDGAR (PLAN.md 3.2). Pure functions here; network calls in lib/sources/fetch.ts. */

export const SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";

export interface SecTicker {
  cik: string; // 10 digits
  ticker: string;
  title: string;
}

export function parseCompanyTickers(json: Record<string, { cik_str: number; ticker: string; title: string }>): SecTicker[] {
  return Object.values(json).map((r) => ({ cik: String(r.cik_str).padStart(10, "0"), ticker: r.ticker.toUpperCase(), title: r.title }));
}

export function submissionsUrl(cik: string): string {
  return `https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`;
}

export interface Submissions {
  name: string;
  filings: {
    recent: {
      accessionNumber: string[];
      filingDate: string[];
      form: string[];
      items: string[];
      primaryDocument: string[];
      primaryDocDescription: string[];
    };
  };
}

export interface EdgarFiling {
  cik: string;
  accession: string;
  date: string;
  form: string;
  items: string[];
  primaryDocument: string;
  description: string;
}

const MATERIAL_8K_ITEMS = ["2.02", "1.01", "2.01", "7.01", "8.01", "5.02"];
const PERIODIC = ["10-Q", "10-K", "20-F", "6-K", "40-F"];

/** Keep filings worth reading, newest first. */
export function pickEdgarFilings(cik: string, sub: Submissions, sinceIso: string, max = 6): EdgarFiling[] {
  const r = sub.filings.recent;
  const out: EdgarFiling[] = [];
  for (let i = 0; i < r.form.length; i++) {
    const date = r.filingDate[i];
    if (date < sinceIso) continue;
    const form = r.form[i];
    const items = (r.items[i] || "").split(",").map((s) => s.trim()).filter(Boolean);
    const keep = (form === "8-K" && items.some((it) => MATERIAL_8K_ITEMS.includes(it))) || PERIODIC.includes(form);
    if (!keep) continue;
    out.push({
      cik,
      accession: r.accessionNumber[i],
      date,
      form,
      items,
      primaryDocument: r.primaryDocument[i],
      description: r.primaryDocDescription[i] || "",
    });
  }
  // Results releases first among same-date filings, then newest first.
  out.sort((a, b) => (a.date === b.date ? Number(b.items.includes("2.02")) - Number(a.items.includes("2.02")) : b.date.localeCompare(a.date)));
  return out.slice(0, max);
}

export function folderUrl(f: Pick<EdgarFiling, "cik" | "accession">): string {
  return `https://www.sec.gov/Archives/edgar/data/${Number(f.cik)}/${f.accession.replace(/-/g, "")}`;
}

export function indexPageUrl(f: Pick<EdgarFiling, "cik" | "accession">): string {
  return `${folderUrl(f)}/${f.accession}-index.html`;
}

export interface FilingFile {
  description: string;
  name: string;
  type: string;
}

/** Parse the filing index page (`<accession>-index.html`): it is the only place that names exhibit types. */
export function parseIndexHtml(html: string): FilingFile[] {
  const $ = cheerio.load(html);
  const out: FilingFile[] = [];
  $("table.tableFile").first().find("tr").each((_, tr) => {
    const td = $(tr).find("td");
    if (td.length < 4) return;
    out.push({
      description: $(td[1]).text().trim(),
      name: $(td[2]).text().trim(),
      type: $(td[3]).text().trim().toUpperCase(),
    });
  });
  return out;
}

/**
 * Pick the document to read in a filing: the press-release exhibit (EX-99.1,
 * else the first EX-99.x) for 8-K and 6-K, else the primary document.
 */
export function pickExhibit(f: EdgarFiling, files: FilingFile[]): string {
  if (f.form === "8-K" || f.form === "6-K") {
    const html = files.filter((x) => /\.html?$/i.test(x.name));
    const ex991 = html.find((x) => x.type === "EX-99.1");
    const ex99 = html.filter((x) => /^EX-99/.test(x.type));
    const press = ex99.find((x) => /press|release|results/i.test(`${x.description} ${x.name}`));
    const pick = ex991 ?? press ?? ex99[0] ?? html.find((x) => /ex-?99|press ?release/i.test(x.name));
    if (pick) return pick.name;
  }
  return f.primaryDocument;
}

export function edgarTitle(f: EdgarFiling, companyName: string): string {
  if (f.form === "8-K" && f.items.includes("2.02")) return `${companyName}: results release (8-K item 2.02, ${f.date})`;
  if (f.form === "8-K") return `${companyName}: current report (8-K items ${f.items.join(", ")}, ${f.date})`;
  const desc = f.description && !/^form/i.test(f.description) ? `: ${f.description}` : "";
  return `${companyName}: ${f.form}${desc} (${f.date})`;
}

export function edgarCandidate(f: EdgarFiling, file: string, companyName: string): CandidateDocument {
  const url = `${folderUrl(f)}/${file}`;
  return {
    id: sha(url),
    source: "SEC EDGAR",
    url,
    alternateUrl: indexPageUrl(f),
    title: edgarTitle(f, companyName),
    date: f.date,
    formOrSubtype: f.form === "8-K" ? `8-K ${f.items.join(",")}` : f.form,
    language: "en",
    contentType: /\.pdf$/i.test(file) ? "pdf" : "html",
  };
}

/** Normalized company name for fuzzy matching (drops legal suffixes). */
export function companyKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(the|inc|incorporated|corp|corporation|co|company|plc|sa|se|nv|n v|ag|holding|holdings|group|ltd|limited|and)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function namesMatch(a: string, b: string): boolean {
  const ka = companyKey(a);
  const kb = companyKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  const first = (k: string) => k.split(" ")[0];
  return first(ka).length >= 4 && first(ka) === first(kb);
}
