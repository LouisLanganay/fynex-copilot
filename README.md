# Fynex Copilot

**What changed in your stocks, with the source.**

An AI investment copilot for retail investors, built at the [Meta Global AI Developer Hackathon](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/details) (Startups track) on **Muse Spark** through the **Meta Model API**.

Drop your portfolio as a CSV. For every holding, Fynex Copilot fetches the latest official documents (earnings releases and filings from SEC EDGAR, regulated information from the French AMF, ESEF annual reports for other European issuers), reads them, PDFs included, and tells you in plain language:

- **what changed** (results, guidance, capital, strategy, risk),
- **why it matters for your portfolio**, given the weight of that line,
- **where it says so**: every claim links to the exact passage, highlighted in the original document.

It never tells you to buy or sell. It explains documents.

> Status: in development during the hackathon (Oct 27 to Nov 4, 2026). See [PLAN.md](PLAN.md) for the build plan and progress.

## Why

Retail investors in Europe own US and European stocks but rarely read the filings: they are long, technical, and spread across regulators. Generic chatbots summarize them but invent numbers and give advice they shouldn't. Fynex Copilot does the reading, shows its sources, and checks itself:

- **Quotes are verified by the server.** Each quote the model returns must exist word for word (after whitespace and typography normalization) in the fetched document. Otherwise the claim is rejected, the model retries once, and if it still fails the card falls back to a plain, model-free summary.
- **Numbers are never invented.** Portfolio weights and values are computed by code. Any number the model writes must appear in the quotes it cites, or be one of the code-computed figures.
- **No advice.** A system instruction, an input filter and an output filter (English and French) block buy, sell, hold, price target and similar language.

## Planned demo

1. Load the sample portfolio (12 real US and French stocks, fictional quantities).
2. Watch one card per holding stream in: "Schneider Electric: Q3 revenue and a EUR 6bn capital increase", "LVMH: Q3 organic growth", and so on.
3. Click a source chip: the side panel opens on the highlighted sentence in the original release, with the page number and a link to the regulator's copy.
4. Ask "Should I sell LVMH?": the copilot declines and offers what the documents say instead.

## Built during the hackathon

Everything in this repository was created during the hackathon, starting Oct 27, 2026. Fynex (fynexapp.com) is the existing startup behind the project: a portfolio tracker for European retail investors. **No Fynex code is used here.** The only link is that the CSV importer also accepts the column layout Fynex uses for portfolio tables.

Built during the event (updated as the work lands):

- [ ] Portfolio CSV import and code-computed weights (ECB FX rates)
- [ ] Identifier resolution: ticker and ISIN to SEC CIK, AMF ISIN, LEI
- [ ] Document fetchers: SEC EDGAR (8-K item 2.02, 6-K, 10-Q, 10-K, 20-F), AMF info-financiere, ESEF via filings.xbrl.org
- [ ] Text extraction for HTML and PDF, with a Muse Spark transcription fallback for scanned PDFs
- [ ] Document triage agent (Muse Spark tool calling)
- [ ] Structured analysis (Muse Spark JSON schema output)
- [ ] Quote verifier, numbers check, retry and fallback template
- [ ] No-advice guardrail (input and output filters)
- [ ] Web app: upload, "What changed" feed, source panel with highlighted passage, follow-up questions
- [ ] Budget caps and cost accounting

The commit history of this repo is the record of the work.

## How it uses Meta's models

- **Muse Spark 1.3** (`muse-spark-1.3`) on the Meta Model API, through its OpenAI-compatible Chat Completions endpoint.
- **Tool calling**: a triage agent lists candidate documents, reads their first page, and selects which ones to analyze.
- **Structured output**: the analysis is returned as JSON constrained by a schema, then verified by the server.
- **Native PDF input**: scanned PDFs are sent to Muse Spark directly and transcribed, then verified like any other text.
- **Prompt caching**: the long constant system prompt is shared across holdings.
- Optional: **Muse Spark Open** (`meta-models/muse-spark-open-1026`) via Baseten, same code path, if partner credits are available.

## Stack

Next.js (App Router) and TypeScript, server-side model calls, no database (disk or memory cache plus committed fixtures for the sample), Tailwind CSS, `openai` SDK pointed at `https://api.meta.ai/v1`, `unpdf` and `cheerio` for text extraction, `zod` for validation, `vitest` and Playwright for tests. Deployable on Vercel.

Data sources, all public and keyless: SEC EDGAR, info-financiere.gouv.fr (AMF / DILA), filings.xbrl.org, GLEIF, OpenFIGI, ECB reference rates.

## Getting started

Requires Node.js 20 or later.

```bash
git clone https://github.com/LouisLanganay/fynex-copilot.git
cd fynex-copilot
npm install
cp .env.example .env.local   # then fill in MODEL_API_KEY and SEC_USER_AGENT
npm run dev                  # http://localhost:3000
```

Without a key, the app still runs and replays a recorded analysis of the sample portfolio.

Useful scripts (available once the scaffold lands):

```bash
npm test                 # unit tests, no network, no model calls
npm run e2e              # end-to-end test on samples/portfolio.csv with fixtures
npm run smoke            # one tiny live call to the Meta Model API (< $0.01)
npm run analyze:sample   # live analysis of the sample portfolio, prints cost
```

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `MODEL_API_KEY` | yes for live runs | Meta Model API key (starts with `LLM_`) |
| `MODEL_API_BASE_URL` | no | Defaults to `https://api.meta.ai/v1` |
| `MODEL_ID` | no | Defaults to `muse-spark-1.3` |
| `SEC_USER_AGENT` | yes | Declared User-Agent for SEC EDGAR, e.g. `Fynex Copilot hackathon you@example.com` |
| `LLM_PROVIDER` | no | `meta` (default) or `baseten` |
| `BASETEN_API_KEY` | no | Only with `LLM_PROVIDER=baseten` |
| `BASETEN_MODEL_ID` | no | Defaults to `meta-models/muse-spark-open-1026` |
| `MAX_USD_PER_RUN` | no | Hard cost cap per portfolio analysis, default 3 |
| `BUDGET_USD_TOTAL` | no | Local ledger cap, default 100 |
| `MAX_HOLDINGS_PER_RUN` | no | Default 15 |
| `LIVE_RUN_PASSCODE` | no | If set, live runs on the deployed site require it |
| `DEMO_READONLY` | no | `true` serves fixtures only, never calls the model |

See [.env.example](.env.example).

## Sample portfolio

[`samples/portfolio.csv`](samples/portfolio.csv): Apple, Microsoft, NVIDIA, JPMorgan Chase, Coca-Cola (SEC EDGAR), ASML (SEC EDGAR, Form 6-K), LVMH, Schneider Electric, L'Oreal, Safran, Vinci, TotalEnergies (AMF). Quantities and cost prices are fictional.

## Disclaimer

Fynex Copilot explains public documents. It is not investment advice and does not recommend buying, selling or holding any security. Always read the original documents linked in each card.

## License

[MIT](LICENSE)
