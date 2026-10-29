import "./env";
import fs from "node:fs";
import path from "node:path";
import type { Card } from "@/lib/card";
import { cacheSet, fixturesRoot } from "@/lib/cache/cache";
import { RunBudget, runCap } from "@/lib/llm/budget";
import { clientFromEnv } from "@/lib/llm/client";
import { mockClient } from "@/lib/llm/mock";
import { analyzeHolding } from "@/lib/pipeline/holding";
import { loadPortfolio, samplePortfolioCsv } from "@/lib/pipeline/portfolio";
import { runToMarkdown } from "@/lib/report/markdown";
import { flag, option } from "./env";

/**
 * Analyze the sample portfolio end to end from the command line.
 *
 *   npm run analyze:sample -- --mock            no model, no cost (deterministic stand-in)
 *   npm run analyze:sample -- --mock --offline  no network at all (recorded documents)
 *   npm run analyze:sample                      live run on muse-spark-1.3 (needs MODEL_API_KEY)
 *   npm run analyze:sample -- --contributor     live run on muse-spark-1.3-contributor (dev only)
 *   --only=AAPL,MC   restrict to some tickers
 *   --record         save the run as fixtures/sample-run.json, the analyzed documents as fixtures,
 *                    and examples/sample-run.md
 *   --no-cache       ignore cached analyses
 */
async function main() {
  const mock = flag("mock");
  const offline = flag("offline");
  const client = clientFromEnv({ mock, contributor: flag("contributor") }, mockClient);
  if (!client) {
    console.log("MODEL_API_KEY is not set. Use --mock for a model-free run.");
    process.exit(1);
  }
  const { summary, resolutions, errors } = await loadPortfolio(samplePortfolioCsv(), { offline });
  for (const e of errors) console.log(`CSV row ${e.row}: ${e.message}`);
  const only = option("only")?.split(",").map((s) => s.trim().toUpperCase());
  const holdings = summary.holdings.filter((h) => !only || only.includes((h.ticker ?? "").toUpperCase()));
  const budget = new RunBudget(runCap());
  console.log(`Model: ${client.model}${client.live ? "" : " (no cost)"}. Holdings: ${holdings.length}. Run cap: $${budget.maxUsd}.\n`);

  const cards: Card[] = new Array(holdings.length);
  const docsUsed = new Map<string, unknown>();
  let next = 0;
  const started = Date.now();
  async function worker() {
    while (next < holdings.length) {
      const i = next++;
      const h = holdings[i];
      const t0 = Date.now();
      try {
        const { card, documents } = await analyzeHolding(h, summary, resolutions[h.id], client!, budget, {
          offline,
          useCache: !flag("no-cache"),
        });
        cards[i] = card;
        for (const d of documents) docsUsed.set(d.id, d);
      } catch (e) {
        console.log(`${h.ticker}: error ${(e as Error).message}`);
        cards[i] = { ...(await import("@/lib/pipeline/holding")).baseCard(h, client!.model), state: "error", headline: "Analysis failed.", note: (e as Error).message };
      }
      const c = cards[i];
      const rej = c.rejections.length ? `, ${c.rejections.length} rejected (${[...new Set(c.rejections.map((r) => r.kind))].join("/")})` : "";
      console.log(
        `${(h.ticker ?? h.id).padEnd(6)} ${String(c.weightPct).padStart(5)}%  ${c.state.padEnd(10)} ${(c.status ?? "").padEnd(18)} claims ${c.claims.length}, quotes ${c.quotesVerified}${rej}, attempts ${c.attempts}, triage ${c.triage?.method ?? "-"}, $${c.costUsd.toFixed(4)}, ${((Date.now() - t0) / 1000).toFixed(0)}s${c.cachedFrom ? " (cached)" : ""}`,
      );
      if (flag("verbose")) console.log(`       ${c.headline}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, holdings.length) }, worker));
  const total = cards.reduce((s, c) => s + c.costUsd, 0);
  const allVerified = cards.every((c) => c.state !== "ok" || c.claims.every((cl) => cl.quotes.length > 0));
  console.log(`\nTotal cost of this run: $${total.toFixed(4)} (budget tracker: $${budget.spent.toFixed(4)}), ${((Date.now() - started) / 1000).toFixed(0)}s.`);
  console.log(`Cards: ${cards.filter((c) => c.state === "ok").length} ok, ${cards.filter((c) => c.state === "fallback").length} fallback, ${cards.filter((c) => !["ok", "fallback"].includes(c.state)).length} other. All claims carry verified quotes: ${allVerified}.`);

  if (flag("record")) {
    const run = { recordedAt: new Date().toISOString(), model: client.model, totalUsd: total, summary, resolutions, cards };
    fs.writeFileSync(path.join(fixturesRoot(), "sample-run.json"), JSON.stringify(run, null, 1));
    for (const [id, d] of docsUsed) cacheSet("doc", id, d, path.join(fixturesRoot(), "cache"));
    fs.mkdirSync("examples", { recursive: true });
    fs.writeFileSync(
      path.join("examples", "sample-run.md"),
      runToMarkdown(cards, { model: client.model, generatedAt: run.recordedAt, totalUsd: total }),
    );
    console.log("Recorded fixtures/sample-run.json, fixtures/cache/doc/*, examples/sample-run.md");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
