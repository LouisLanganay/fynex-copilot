import { describe, expect, it } from "vitest";
import { htmlToText } from "@/lib/extract/html-to-text";
import { joinPages, looksScanned } from "@/lib/extract/pdf-to-text";
import { amfQueryUrl, pickAmfDocuments, type AmfRecord } from "@/lib/sources/amf";
import { companyKey, namesMatch, parseCompanyTickers, parseIndexHtml, pickEdgarFilings, pickExhibit, type Submissions } from "@/lib/sources/edgar";
import { esefQueryUrl, pickEsefDocument } from "@/lib/sources/esef";
import { resolveHolding, type ResolveDeps } from "@/lib/resolve/resolve";
import type { Holding } from "@/lib/portfolio/csv";

const rec = (date: string, subtype: string, lang: string, title: string, n: number): AmfRecord => ({
  identificationsociete_iso_nom_soc: "LVMH",
  identificationsociete_iso_cd_isi: "FR0000121014",
  informationdeposee_inf_dat_emt: date,
  informationdeposee_inf_tit_inf: title,
  informationdeposee_inf_lng_inf: lang,
  subtype_of_information: subtype,
  url_de_recuperation: `https://fr.ftp.opendatasoft.com/datadila/INFOFI/ECO/2026/10/FCECO0${n}.pdf`,
});

describe("AMF", () => {
  const records = [
    rec("2026-10-27T15:59:37+00:00", "Total number of voting rights and capital", "Anglais", "Voting rights", 1),
    rec("2026-10-26T15:44:16+00:00", "Acquisition or disposal of the issuer's own shares", "Anglais", "Weekly share buyback", 2),
    rec("2026-10-12T15:45:10+00:00", "Inside Information", "Français", "LVMH : Poursuite de la croissance", 3),
    rec("2026-10-12T15:45:30+00:00", "Inside Information", "Anglais", "LVMH: Continued growth in the third quarter", 4),
    rec("2026-07-27T15:50:00+00:00", "Half yearly financial reports and audit reports/limited reviews", "Français", "Rapport semestriel", 5),
  ];
  it("drops noise subtypes, pairs twins and prefers English", () => {
    const docs = pickAmfDocuments(records);
    expect(docs.map((d) => d.title)).toEqual(["LVMH: Continued growth in the third quarter", "Rapport semestriel"]);
    expect(docs[0].language).toBe("en");
    expect(docs[0].alternateUrl).toContain("FCECO03");
    expect(docs[0].date).toBe("2026-10-12");
    expect(docs[1]).toMatchObject({ language: "fr", alternateUrl: undefined, contentType: "pdf" });
  });
  it("builds an ODSQL query by ISIN and date", () => {
    const u = decodeURIComponent(amfQueryUrl("FR0000121014", "2026-07-01"));
    expect(u).toContain('identificationsociete_iso_cd_isi="FR0000121014"');
    expect(u).toContain("informationdeposee_inf_dat_emt>=date'2026-07-01'");
  });
});

const SUB: Submissions = {
  name: "Apple Inc.",
  filings: {
    recent: {
      accessionNumber: ["a1", "a2", "a3", "a4", "a5", "a6"],
      filingDate: ["2026-10-22", "2026-08-01", "2026-07-31", "2026-07-30", "2026-07-30", "2026-03-01"],
      form: ["4", "8-K", "10-Q", "8-K", "8-K", "8-K"],
      items: ["", "5.07", "", "2.02,9.01", "8.01", "2.02"],
      primaryDocument: ["f4.xml", "x.htm", "q.htm", "k.htm", "o.htm", "old.htm"],
      primaryDocDescription: ["", "", "10-Q", "", "", ""],
    },
  },
};

describe("EDGAR", () => {
  it("keeps results releases, periodic reports and material 8-Ks in the window", () => {
    const f = pickEdgarFilings("0000320193", SUB, "2026-07-01");
    expect(f.map((x) => x.accession)).toEqual(["a3", "a4", "a5"]);
  });
  it("parses company_tickers.json", () => {
    expect(parseCompanyTickers({ "0": { cik_str: 320193, ticker: "aapl", title: "Apple Inc." } })).toEqual([{ cik: "0000320193", ticker: "AAPL", title: "Apple Inc." }]);
  });
  const INDEX = `<table class="tableFile" summary="Document Format Files">
    <tr><th>Seq</th><th>Description</th><th>Document</th><th>Type</th><th>Size</th></tr>
    <tr><td>1</td><td>6-K</td><td><a href="/x/form6-k.htm">form6-k.htm</a></td><td>6-K</td><td>11161</td></tr>
    <tr><td>2</td><td>EX-99.2</td><td><a href="/x/presentation.htm">presentation.htm</a></td><td>EX-99.2</td><td>20676</td></tr>
    <tr><td>3</td><td>EX-99.1</td><td><a href="/x/pressrelease.htm">pressrelease.htm</a></td><td>EX-99.1</td><td>41553</td></tr>
    <tr><td>4</td><td></td><td><a href="/x/img.jpg">img.jpg</a></td><td>GRAPHIC</td><td>1</td></tr>
  </table>`;
  it("picks the EX-99.1 exhibit from the index page", () => {
    const files = parseIndexHtml(INDEX);
    expect(files).toHaveLength(4);
    const f = { cik: "1", accession: "a", date: "2026-10-14", form: "6-K", items: [], primaryDocument: "form6-k.htm", description: "" };
    expect(pickExhibit(f, files)).toBe("pressrelease.htm");
    expect(pickExhibit({ ...f, form: "10-Q", primaryDocument: "q.htm" }, files)).toBe("q.htm");
  });
  it("matches company names loosely", () => {
    expect(companyKey("ASML Holding N.V.")).toBe("asml");
    expect(namesMatch("ASML HOLDING NV", "ASML Holding N.V.")).toBe(true);
    expect(namesMatch("SUNCOR ENERGY INC", "Schneider Electric SE")).toBe(false);
    expect(namesMatch("Schneider National, Inc.", "Schneider Electric SE")).toBe(false);
    expect(namesMatch("Vinci Compass Investments Ltd.", "Vinci SA")).toBe(false);
    expect(namesMatch("COCA COLA CO", "The Coca-Cola Company")).toBe(true);
    expect(namesMatch("JPMORGAN CHASE & CO", "JPMorgan Chase & Co.")).toBe(true);
  });
});

describe("ESEF", () => {
  it("builds the filings.xbrl.org query and picks the latest report", () => {
    expect(decodeURIComponent(esefQueryUrl("724500Y6DUVHQD6OXN27"))).toContain('"val":"724500Y6DUVHQD6OXN27"');
    const d = pickEsefDocument(
      { data: [{ id: "1", attributes: { report_url: "/lei/2025-12-31/ESEF/NL/0/r.xhtml", period_end: "2025-12-31", date_added: "2026-03-04 13:55:19" } }] },
      "ASML",
    );
    expect(d).toMatchObject({ source: "ESEF", url: "https://filings.xbrl.org/lei/2025-12-31/ESEF/NL/0/r.xhtml", date: "2026-03-04" });
  });
});

describe("extraction", () => {
  it("turns HTML filings into text with table cells separated", () => {
    const t = htmlToText(
      `<html><head><style>p{}</style></head><body><ix:header>hidden</ix:header><p>Revenue was <b>$92.3</b>&nbsp;billion.</p><table><tr><td>Revenue</td><td>$</td><td>92.3</td></tr></table><script>x()</script></body></html>`,
    );
    expect(t).toContain("Revenue was $92.3 billion.");
    expect(t).toContain("Revenue | 92.3");
    expect(t).not.toContain("hidden");
    expect(t).not.toContain("x()");
  });
  it("joins PDF pages with an offset table and detects scanned PDFs", () => {
    const p = joinPages(["Page one text", "Page two"]);
    expect(p.pageStarts).toEqual([0, 15]);
    expect(p.text.slice(p.pageStarts[1])).toBe("Page two");
    expect(looksScanned(p)).toBe(true);
    expect(looksScanned(joinPages(["x".repeat(500)]))).toBe(false);
  });
});

describe("resolution order", () => {
  const deps = (over: Partial<ResolveDeps> = {}): ResolveDeps => ({
    secTickers: async () => [
      { cik: "0000320193", ticker: "AAPL", title: "Apple Inc." },
      { cik: "0000311337", ticker: "SU", title: "SUNCOR ENERGY INC" },
      { cik: "0000937966", ticker: "ASML", title: "ASML HOLDING NV" },
      { cik: "0000879764", ticker: "TTE", title: "TotalEnergies SE" },
    ],
    openFigiTicker: async () => null,
    gleifLei: async () => null,
    esefHasFilings: async () => false,
    ...over,
  });
  const h = (ticker: string | null, isin: string | null, name: string): Holding => ({ id: isin ?? ticker!, ticker, isin, name, quantity: 1, costPrice: 1, lastPrice: null, currency: "EUR" });

  it("FR ISIN goes to the AMF even when the ticker collides with a US one", async () => {
    expect(await resolveHolding(h("SU", "FR0000121972", "Schneider Electric SE"), deps())).toMatchObject({ source: "AMF", secondary: null });
  });
  it("FR ISIN keeps EDGAR as secondary when the company also files with the SEC", async () => {
    expect(await resolveHolding(h("TTE", "FR0000120271", "TotalEnergies SE"), deps())).toMatchObject({ source: "AMF", secondary: "SEC EDGAR", cik: "0000879764" });
  });
  it("US ISIN with a ticker goes to EDGAR", async () => {
    expect(await resolveHolding(h("AAPL", "US0378331005", "Apple Inc."), deps())).toMatchObject({ source: "SEC EDGAR", cik: "0000320193" });
  });
  it("non-US ISIN with a matching SEC name goes to EDGAR (ASML)", async () => {
    expect(await resolveHolding(h("ASML", "NL0010273215", "ASML Holding N.V."), deps())).toMatchObject({ source: "SEC EDGAR", cik: "0000937966" });
  });
  it("ISIN only: OpenFIGI then the SEC map", async () => {
    const r = await resolveHolding(h(null, "US0378331005", "Apple"), deps({ openFigiTicker: async () => ({ ticker: "AAPL", name: "APPLE INC" }) }));
    expect(r).toMatchObject({ source: "SEC EDGAR", cik: "0000320193" });
  });
  it("other EU ISIN falls back to GLEIF and ESEF", async () => {
    const r = await resolveHolding(h(null, "DE0007164600", "SAP SE"), deps({ gleifLei: async () => "LEI123", esefHasFilings: async () => true }));
    expect(r).toEqual({ source: "ESEF", lei: "LEI123" });
  });
  it("nothing found", async () => {
    expect((await resolveHolding(h(null, "DE0007164600", "SAP SE"), deps())).source).toBeNull();
  });
});
