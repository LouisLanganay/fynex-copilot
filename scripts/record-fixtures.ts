import "./env";
import fs from "node:fs";
import path from "node:path";
import { fixturesRoot } from "@/lib/cache/cache";
import { loadPortfolio, samplePortfolioCsv } from "@/lib/pipeline/portfolio";
import type { RecordedCandidate } from "@/lib/pipeline/holding";
import { fetchEcbRates } from "@/lib/portfolio/fx";
import { listCandidates, loadDocument, LOOKBACK_DAYS } from "@/lib/sources/fetch";

/**
 * M2: fetch the sample portfolio's candidate documents from EDGAR and the AMF,
 * extract their text, and record the candidate lists (with the first 3,000
 * characters used by triage) in fixtures/candidates.json. Public documents only.
 * Full texts stay in .cache/doc; the analyzed ones are copied to fixtures by
 * `npm run analyze:sample -- --record`.
 */
async function main() {
  const { summary, resolutions } = await loadPortfolio(samplePortfolioCsv());
  const fx = await fetchEcbRates();
  const holdings: Record<string, RecordedCandidate[]> = {};
  let ok = 0;
  for (const h of summary.holdings) {
    const r = resolutions[h.id];
    const cands = r.source ? await listCandidates(h, r) : [];
    const rec: RecordedCandidate[] = [];
    for (const c of cands) {
      try {
        const d = await loadDocument(c);
        rec.push({ ...c, pages: d.pages, chars: d.text.length, start: d.text.slice(0, 3000) });
      } catch (e) {
        console.log(`   ! ${c.title}: ${(e as Error).message}`);
      }
    }
    holdings[h.id] = rec;
    const good = rec.filter((c) => c.chars > 2000);
    if (good.length) ok++;
    console.log(`${(h.ticker ?? h.id).padEnd(6)} ${String(r.source ?? "none").padEnd(9)} ${rec.length} docs in ${LOOKBACK_DAYS} days`);
    for (const c of rec) console.log(`   ${c.date} ${c.formOrSubtype.slice(0, 28).padEnd(28)} ${String(c.chars).padStart(8)} chars  ${c.title.slice(0, 70)}`);
  }
  const out = { recordedAt: new Date().toISOString(), fx, resolutions, holdings };
  fs.mkdirSync(fixturesRoot(), { recursive: true });
  fs.writeFileSync(path.join(fixturesRoot(), "candidates.json"), JSON.stringify(out, null, 1));
  console.log(`\n${ok}/${summary.count} holdings have at least one document with more than 2,000 characters of text.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
