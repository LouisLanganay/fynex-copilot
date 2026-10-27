# Fynex Copilot: development plan

Status legend: `[ ]` todo, `[x]` done. The building agent ticks boxes as it goes (see `CLAUDE.md`).

This file is the single source of truth for the build. It was written on 2026-10-27 after reading the official docs listed in section 13. Everything marked **(verified)** was checked against a live doc page or a live keyless API call on 2026-10-27. Everything marked **(unverified)** must be checked by the builder before relying on it.

---

## 1. Goal and constraints

**Product.** A small standalone web app. The user drops a portfolio CSV. For each holding, the app fetches the latest public company documents (earnings releases and filings from SEC EDGAR, regulated information from the French AMF, ESEF annual reports for other European issuers), has Muse Spark read them, and produces one card per holding:

1. **What changed** (results, guidance, capital, strategy, risk), in plain language.
2. **Why it matters for this portfolio**, using the line's weight, which is computed by code.
3. **The exact source passage** for every claim, clickable, opening a side panel with the passage highlighted and a link to the original document.

**Hard rules (non negotiable).**

- **No advice.** The app never says buy, sell, hold, add, trim, or gives a price target. Enforced by a system instruction AND a deterministic output filter AND a deterministic input filter on follow-up questions (section 6).
- **No invented numbers.** Weights, totals and FX conversions are computed by code. Any number that appears in model-written text must appear verbatim in one of the quotes attached to that claim, or be one of the code-computed numbers passed in the prompt (section 5.6).
- **Every quote is verified.** The server checks that each quote exists verbatim (after normalization) in the fetched document text. Unverified quotes are rejected; the card is retried once, then falls back to a deterministic template (section 5.5).
- **Public data only.** Only public filings and the user's own CSV. No scraping behind logins, no paid market data.
- **No Fynex code.** This repo is standalone. Fynex (fynexapp.com) is the startup behind it, but none of its code is reused. The only link is that the CSV parser also accepts the column layout Fynex uses for portfolio tables (section 5.1).
- **Budget.** Must stay well under the $150 of Meta Model API credits. Hard caps in code (section 8).
- **Must work and demo in 5 minutes.** Reliability beats features. Every stretch goal is optional.

**Hackathon facts (from the participant guide).** Track: Startups. Problem statement: "Build for Your World". Repo must be public. Demo video: 3 minutes, showing only what was built during the hackathon. Submission deadline: **Wed Nov 4, 9:00 PM ET** (= Thu Nov 5, 03:00 Paris time). Judging rubric: Impact 30%, Use of Meta AI tooling 25%, Technical depth 20%, Demo 25%. Anti-projects to stay clear of: "Basic RAG applications" and advice-giving apps. Our answers: the pipeline is an agent with tool calls, document triage, multimodal PDF fallback and a verification loop, not retrieval plus chat; and it refuses advice by design.

---

## 2. Architecture

**Recommendation: Next.js (App Router) + TypeScript, server-side model calls, no database, deployable to Vercel in one click.**

Why:

- One codebase for UI and API routes; API keys stay server-side (Meta's auth doc explicitly says to keep keys out of browser code).
- No database: the only state is a cache of fetched public documents and model outputs. Locally: files under `.cache/`. On Vercel: in-memory LRU plus `/tmp` (the filesystem is ephemeral, which is fine for a cache), plus committed **fixtures** for the sample portfolio so the demo never depends on live calls.
- Vercel Hobby allows functions up to 300 s (verified, Vercel duration docs). We avoid long requests anyway: **one API call per holding**, fired in parallel from the browser with a small concurrency limit (4), so each function runs well under 120 s and cards stream in one by one.

**Model access: the official `openai` npm SDK pointed at `https://api.meta.ai/v1`, using the Chat Completions API.**

Why Chat Completions rather than the Responses API (both are supported by Meta):

- Every feature we need is documented on Chat Completions: structured output via `response_format: { type: "json_schema", json_schema: {...} }`, tool calling, inline PDF via a `file` content block, `reasoning_effort` (verified, Meta docs).
- Baseten (optional partner) exposes the same OpenAI-compatible `/v1/chat/completions` (verified, Baseten docs). One code path serves both providers; switching is `LLM_PROVIDER=baseten`.
- The Meta cookbook recipes for structured output and tool calling use Chat Completions too.

**Stack (latest versions on npm as of 2026-10-27):** `next@16`, `react`, `typescript`, `openai@7`, `zod@4` (validate model JSON a second time, server-side), `papaparse` (CSV), `unpdf` (PDF text per page, serverless friendly), `cheerio` (HTML filings to text), `vitest` (unit), `@playwright/test` (end-to-end), Tailwind CSS for styling. No other runtime dependency without a note in `NOTES.md`.

**Directory layout (target):**

```
app/
  page.tsx                  upload screen + feed
  api/portfolio/route.ts    POST csv -> parsed holdings + weights + resolution
  api/analyze/route.ts      POST one holding -> card (maxDuration = 120)
  api/ask/route.ts          POST follow-up question on one holding (guarded)
  api/document/route.ts     GET cached document text by id (for the source panel)
components/                 HoldingCard, SourcePanel, UploadDropzone, BudgetBadge...
lib/
  portfolio/                csv.ts, weights.ts, fx.ts
  resolve/                  sec-tickers.ts, openfigi.ts, gleif.ts
  sources/                  edgar.ts, amf.ts, esef.ts, types.ts
  extract/                  html-to-text.ts, pdf-to-text.ts, normalize.ts
  llm/                      client.ts, prices.ts, budget.ts, triage.ts, analyze.ts, schema.ts, prompts.ts
  verify/                   quotes.ts, numbers.ts
  guardrail/                advice.ts
  cache/                    cache.ts
fixtures/                   recorded documents + model outputs for samples/portfolio.csv
scripts/                    smoke.ts, record-fixtures.ts, cost-report.ts
tests/                      unit (vitest) + e2e (playwright)
```

---

## 3. Verified external APIs (what the builder can rely on)

### 3.1 Meta Model API (verified)

- Base URL `https://api.meta.ai/v1`. Auth: `Authorization: Bearer $MODEL_API_KEY`. Keys look like `LLM_<digits>_<secret>`. The OpenAI SDK does NOT read `MODEL_API_KEY` by itself: pass `apiKey` explicitly.
- Models on the API (text): `muse-spark-1.3` (recommended, Standard mode), `muse-spark-1.2`, `muse-spark-1.1`, Contributor mode variants `muse-spark-1.3-contributor`, `muse-spark-1.2-contributor`, and `muse-wonder-1.0` (preview, much pricier). Context window 1,048,576 tokens. Input: text, image, video, audio, PDF. Output: text. List what the key can use with `GET /v1/models`.
- Prices per 1M tokens, Muse Spark Standard: input $1.25, cached input $0.15, output $4.25. Contributor: input $0.10, cached $0.002, output $0.20. Muse Wonder: input $4.00, output $20.00. Reasoning tokens are billed as output tokens.
- Rate limits: `muse-spark-1.3` 3,000 RPM and 4M TPM; contributor variants 150 RPM and 3M TPM. Retry 429 and 5xx with exponential backoff plus jitter, honour `Retry-After`. Never retry a 400.
- Structured output on Chat Completions: `response_format: { type: "json_schema", json_schema: { name, schema, strict? } }`. Decoding is constrained to the schema. No recursive schemas; max nesting depth 10.
- Tool calling on Chat Completions: OpenAI nested format (`tools: [{ type: "function", function: { name, description, parameters } }]`). `tool_choice` supports only `"auto"` (anything else returns 400). Replay the assistant message with its `tool_calls` before sending `role: "tool"` results.
- Reasoning: top-level `reasoning_effort` on Chat Completions, values `minimal`, `low`, `medium`, `high`, `xhigh`, `max` (`none` returns 400 on Muse Spark). Output budget param on Chat Completions: `max_tokens` (reasoning counts toward it). The default effort is not stated on the pages read: **always set it explicitly**.
- PDF input: `{ type: "file", file: { filename, file_data: "data:application/pdf;base64,..." } }` in a user message. Inline limit 50 MB. The server converts a PDF to text (first 100 pages) plus page images (first 50 pages, counted against the 50 images per request budget).
- Prompt caching is automatic on a shared prefix. Put the long, constant system prompt first so it gets cached across holdings; usage reports `prompt_tokens_details.cached_tokens`.
- Billing: the hackathon credits only work once a card is on the Billing page; a spend limit notification can be set there.

### 3.2 SEC EDGAR (verified, keyless)

- Every request must send a declared `User-Agent` such as `Fynex Copilot hackathon contact@domain` (SEC webmaster FAQ). Max **10 requests per second** across all machines. Server-side only (no CORS needed since all calls are server-side).
- Ticker to CIK: `https://www.sec.gov/files/company_tickers.json` (fields `cik_str`, `ticker`, `title`). Cache it for 24 h.
- Filing list: `https://data.sec.gov/submissions/CIK##########.json` (10-digit zero-padded CIK). `filings.recent` holds parallel arrays: `accessionNumber`, `filingDate`, `form`, `items`, `primaryDocument`, `primaryDocDescription`...
- Earnings releases: US filers publish them as **8-K with item `2.02`**, the release itself being the **EX-99.1** exhibit. Foreign private issuers (ASML, SAP, TotalEnergies) publish **6-K** forms. Also consider `10-Q`, `10-K`, `20-F`.
- Filing folder listing: `https://www.sec.gov/Archives/edgar/data/<cik>/<accession-without-dashes>/index.json`. It gives file names but not exhibit types; the exhibit type (`EX-99.1`) is in the HTML index page `.../<accession>-index.html`. Either parse that page or pick the file whose name matches `/ex-?99/i`. Verified on Apple's 2026-07-30 8-K: exhibit `a8-kex991q3202606272026.htm`.
- Optional, numbers by code: `https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json` (all XBRL facts, a few MB). Stretch goal only.
- Optional: EDGAR full-text search JSON at `https://efts.sec.gov/LATEST/search-index?q=...&forms=8-K&dateRange=custom&startdt=...&enddt=...` answered 200 with hits on 2026-10-27, but SEC only documents the full-text search UI, not this JSON endpoint. Do not depend on it.

### 3.3 French AMF regulated information (verified, keyless)

- The official French storage mechanism (info-financiere.gouv.fr, run by DILA with the AMF) exposes an Opendatasoft Explore API v2.1: `https://info-financiere.gouv.fr/api/explore/v2.1/catalog/datasets/flux-amf-new-prod/records`. Licence Etalab 2.0.
- Filter by ISIN with ODSQL: `where=identificationsociete_iso_cd_isi="FR0000121014"`, sort with `order_by=informationdeposee_inf_dat_emt desc`, `limit<=100`.
- Useful fields: `identificationsociete_iso_nom_soc` (name), `identificationsociete_iso_cd_isi` (ISIN), `identificationsociete_iso_cd_lei` (LEI), `informationdeposee_inf_dat_emt` (date), `informationdeposee_inf_tit_inf` (title), `informationdeposee_inf_lng_inf` (`Anglais` or `Français`), `subtype_of_information`, `url_de_recuperation` (direct PDF URL on `fr.ftp.opendatasoft.com`).
- Keep subtypes `Inside Information`, `Quarterly financial reporting`, `Half yearly financial reports and audit reports/limited reviews`, `Annual financial and audit reports`. Drop `Total number of voting rights and capital` and `Acquisition or disposal of the issuer's own shares` (weekly buyback noise). Most releases are published twice (French and English): prefer `Anglais`, keep the French twin's URL as an alternate link.
- Titles are sometimes generic ("Inside Information / News release on accounts, results"), hence the triage step (5.4).
- Verified on 2026-10-27: LVMH Q3 release of 2026-10-12, Schneider Q3 revenue of 2026-10-16 and a EUR 6bn capital increase of 2026-10-19/20, L'Oreal sales at 30 September (2026-10-22), Safran Q3 revenue (2026-10-23), Vinci 9M (2026-10-22). The LVMH PDF downloaded and `pdftotext` extracted clean text.

### 3.4 ESEF annual reports for other European issuers (verified, keyless)

- `https://filings.xbrl.org/api/filings?filter=[{"name":"entity.identifier","op":"eq","val":"<LEI>"}]&sort=-date_added&page[size]=5` (JSON:API; URL-encode the filter). Each filing has `report_url` (XHTML annual report), `json_url` (xBRL-JSON facts), `viewer_url`, `period_end`, `published`. Paths are relative to `https://filings.xbrl.org`.
- These are **annual** reports only (one per year, hundreds of pages). Use them as the fallback "latest document" for EU holdings with no EDGAR or AMF source, and only send the most relevant sections (management report highlights, first 30 pages of text).

### 3.5 Identifier resolution (verified, keyless)

- **OpenFIGI** `POST https://api.openfigi.com/v3/mapping` with `[{"idType":"ID_ISIN","idValue":"US0378331005","exchCode":"US"}]` returns ticker and name. Without a key: 25 requests per minute, 10 jobs per request (OpenFIGI docs). Batch all ISINs in as few requests as possible.
- **GLEIF** `https://api.gleif.org/api/v1/lei-records?filter[isin]=NL0010273215` returns the LEI (ASML: `724500Y6DUVHQD6OXN27`).
- **ECB reference rates** `https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml` (EUR base, daily) for FX conversion of weights. Cache 12 h.
- No free keyless price feed was found working (Stooq returned 404). Weights are therefore computed **at cost** unless the CSV has a `last_price` column (section 5.2).

### 3.6 Baseten (optional, verified partially)

- OpenAI-compatible: base URL `https://inference.baseten.co/v1`, key `BASETEN_API_KEY`, `POST /v1/chat/completions`, `response_format` supported. Hackathon model id: **`meta-models/muse-spark-open-1026`** (the guide says not to use the doc's `meta-models/muse-spark-open`).
- (unverified) PDF `file` blocks and tool calling support for this model on Baseten. Our design sends extracted text, so PDFs are not needed there. Only enable Baseten if credits arrive; it also qualifies the project for the "Best Build on Meta Open Weight Models" bonus. Never block the main plan on it.

---

## 4. User flow and screens

1. **Upload screen.** Drop zone accepting `.csv` (max 100 KB, max 50 rows), a "Try the sample portfolio" button (loads `samples/portfolio.csv`), a one-line privacy note ("Your CSV is processed in memory and never stored. Only public filings are fetched."), and the disclaimer "Information, not investment advice."
2. **Portfolio preview.** Table of holdings: name, ticker, ISIN, value in EUR, weight %, resolved source badge (`SEC EDGAR`, `AMF`, `ESEF`, or `No source found`). Weights are code-computed with a footnote "weights at cost basis" when no price column. Button "Analyze N holdings" showing the cost estimate (section 8) and, on the public deployment, a passcode field.
3. **Feed "What changed".** One card per holding, sorted by weight descending. Cards appear as they finish. Each card: company, weight chip, document title and date, status chip (`Material change`, `Minor update`, `Nothing new`), headline, 1 to 5 claims. Each claim: statement, "why it matters for you" line, and numbered source chips `[1]`, `[2]`. A footer line per card: model id, tokens, cost, "all N quotes verified".
4. **Source panel.** Clicking a source chip opens a right-side panel (bottom sheet on mobile) showing the document text around the quote, the quote highlighted and scrolled into view, the page number for PDFs, and "Open original" (PDF link with `#page=N`, or the sec.gov URL with a `#:~:text=` text fragment).
5. **Follow-up box (per card).** One-line question input: "Ask about this document". Answers come only from that holding's documents, with verified quotes. Buy, sell or "should I" questions get a fixed refusal (section 6).
6. **States.** Skeleton cards while loading with the current step ("Finding documents", "Reading 14-page PDF", "Verifying 6 quotes"); per-card error state with retry; "No recent document found in the last 120 days" state; "Budget cap reached" banner; "Cached result from <date>" badge when served from fixtures.

Design: clean, neutral, dense, readable. Dark and light modes. No decorative gradients or glow. Must be usable at phone width.

---

## 5. Pipeline, step by step

### 5.1 CSV parsing (`lib/portfolio/csv.ts`)

- Accept delimiter `,` or `;` (auto-detect), UTF-8 with or without BOM, decimal comma or point.
- Header aliases (case and accent insensitive):
  - ticker: `ticker`, `symbol`, `mnémonique`
  - isin: `isin`
  - name: `name`, `nom`, `libellé`
  - quantity: `quantity`, `qty`, `shares`, `quantité`
  - cost price: `cost_price`, `avg_price`, `pru`, `prix de revient`
  - currency: `currency`, `devise`
  - optional `last_price`, `cours`
- This covers the sample format and the table layout used by Fynex (`Nom;ISIN;Quantité;Prix de revient;Devise`).
- Each row needs a ticker or an ISIN, and a positive quantity. Invalid rows are listed back to the user, never guessed.
- Validate ISIN check digits (Luhn on the converted string). Reject files over 100 KB or 50 rows.
- Sanitize text cells (strip leading `=`, `+`, `-`, `@` before display, CSV injection hygiene).

### 5.2 Weights (`lib/portfolio/weights.ts`, `fx.ts`)

- `value = quantity * (last_price ?? cost_price)` in the line currency, converted to EUR with ECB rates (`EUR` base: `value_eur = value / rate[currency]`).
- `weight = value_eur / sum(value_eur)`, rounded for display to 0.1%. Also compute rank by weight and the share of the portfolio covered by sources found.
- All of this is pure code with unit tests. These numbers are passed to the model as "allowed numbers" (5.6).

### 5.3 Resolution and document fetching (`lib/resolve`, `lib/sources`)

Resolution order per holding:

1. ISIN starts with `FR`: **AMF** by ISIN (primary). If the company also files with the SEC (e.g. TotalEnergies), keep EDGAR as a secondary source.
2. Ticker found in SEC `company_tickers.json`: **EDGAR** by CIK.
3. ISIN only: OpenFIGI (exchCode `US`) to get ticker and name, then SEC ticker map, then normalized-name match against SEC `title` (handles ASML mapping to the OTC ticker `ASMLF`).
4. Other EU ISIN with no EDGAR match: GLEIF to LEI, then **ESEF** via filings.xbrl.org.
5. Nothing found: card shows "No public source found for this identifier", no model call.

Candidate documents (last 120 days, newest first, max 8 per holding):

- EDGAR: 8-K with item 2.02 (take EX-99.1), 6-K (take the press-release exhibit, else the primary doc), 10-Q, 10-K, 20-F. Ignore forms 3, 4, 144, S-8, etc.
- AMF: the kept subtypes from 3.3, English preferred.
- ESEF: latest annual report.

Fetch rules: SEC client with the declared User-Agent, a token bucket at 5 req/s (half the SEC cap), and retries on 429/5xx. Every fetched document is cached by URL (content hash + fetch date). Max document size 15 MB; larger documents are skipped with a visible note.

### 5.4 Text extraction and triage

**Extraction (`lib/extract`).**

- HTML (EDGAR): cheerio, drop scripts and styles, keep table cells separated by ` | ` and rows by newlines, collapse whitespace.
- PDF (AMF): `unpdf` text extraction **per page**, keeping a `pageStarts[]` offset table so a quote offset maps back to a page number.
- Scanned PDF detection: fewer than 200 characters of text per page on average. Fallback: send the PDF itself to Muse Spark (`file` block, max 20 pages) and ask for a verbatim transcription of the pages into text, cache that transcription, and mark the document `ocr: true` (cards then show "Source text transcribed by the model from a scanned PDF"). Quotes are verified against that transcription. This also demonstrates Muse Spark's native PDF and vision input.
- Store for each document: `id` (stable hash), `source`, `url`, `title`, `date`, `language`, `text` (raw), `normalizedText`, `pageStarts`, `ocr`.

**Triage with tool calling (`lib/llm/triage.ts`).** Purpose: choose which document(s) to analyze, since titles are often generic. Skip triage when there is exactly one candidate.

- Tools given to the model:
  - `list_candidate_documents()` returns `[{document_id, source, form_or_subtype, title, date, language, pages}]`.
  - `read_document_start(document_id)` returns the first 3,000 characters of the document text.
  - `select_documents(primary_document_id, comparison_document_id | null, reason)` ends the triage.
- Loop: max 4 model turns, `reasoning_effort: "low"`, `max_tokens: 2000`. Instruction: pick the most recent document that contains company results, guidance, or a material corporate event; pick the previous results release of the same company as comparison if available.
- If the loop does not call `select_documents` within 4 turns, or picks an unknown id: deterministic fallback (newest document whose title matches `/result|revenue|sales|quarter|trimestre|chiffre d'affaires|earnings|semestriel|half/i`, else the newest document).

### 5.5 Analysis call and quote verification (`lib/llm/analyze.ts`, `lib/verify/quotes.ts`)

**Input to the model (Chat Completions):**

- System message (constant, long, first, so it is cached): role, rules (no advice, quote verbatim, numbers only from quotes or the allowed list, write for a non-expert, max 5 claims, English output even for French sources, quotes stay in the source language).
- User message: holding facts computed by code (name, weight %, rank, value in EUR, share of portfolio), the allowed-number list, then the documents as text blocks delimited `<document id="..." title="..." date="..."> ... </document>`. Per document text cap: 120,000 characters (about 30k tokens); if longer, keep the first 80,000 characters plus the 40,000 characters following the first match of `/outlook|guidance|perspectives|prévisions/i`.
- `reasoning_effort: "medium"`, `max_tokens: 6000`, `response_format` json_schema below.

**Output JSON schema (`lib/llm/schema.ts`)**, mirrored by a zod schema for a second validation:

```json
{
  "name": "holding_update",
  "strict": true,
  "schema": {
    "type": "object",
    "additionalProperties": false,
    "required": ["status", "headline", "claims", "portfolio_note"],
    "properties": {
      "status": { "type": "string", "enum": ["material_change", "minor_update", "no_new_information"] },
      "headline": { "type": "string", "description": "One sentence, max 140 characters, no advice." },
      "claims": {
        "type": "array",
        "minItems": 0,
        "maxItems": 5,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": ["category", "statement", "why_it_matters", "quotes"],
          "properties": {
            "category": { "type": "string", "enum": ["results", "guidance", "capital", "strategy", "risk", "other"] },
            "statement": { "type": "string", "description": "What changed, plain language, max 280 characters." },
            "why_it_matters": { "type": "string", "description": "Why this matters for a holder with the given weight, max 280 characters, no advice." },
            "quotes": {
              "type": "array",
              "minItems": 1,
              "maxItems": 3,
              "items": {
                "type": "object",
                "additionalProperties": false,
                "required": ["document_id", "text"],
                "properties": {
                  "document_id": { "type": "string" },
                  "text": { "type": "string", "description": "Exact verbatim passage copied from the document, 20 to 400 characters." }
                }
              }
            }
          }
        }
      },
      "portfolio_note": { "type": "string", "description": "One sentence on exposure using only the provided weight figures." }
    }
  }
}
```

(If the API rejects `strict: true` because of the strict subset rules, drop `strict`; Meta's doc says output stays schema-constrained either way.)

**Normalization (`lib/extract/normalize.ts`)**, applied identically to document text and quotes: Unicode NFKC (also splits ligatures like `ﬁ`), remove soft hyphens and zero-width characters, join words hyphenated across line breaks (`-\n` between letters), map curly quotes and apostrophes to straight ones, map every dash variant to `-`, map non-breaking and thin spaces to a space, collapse all whitespace to one space, compare case-insensitively. Keep an index map from normalized offsets to raw offsets so the UI can highlight the raw text.

**Verification (`lib/verify/quotes.ts`).** For each quote: length 20 to 400 normalized chars; `document_id` must be one of the documents sent; normalized quote must be a substring of that document's normalized text. Record `{start, end, page}`. A claim survives if all its quotes verify (a claim with one bad quote is dropped, not partially kept).

**Retry and fallback.**

1. Attempt 1. If at least one claim survives and no guardrail hit (section 6) and numbers check passes (5.6): done.
2. Otherwise attempt 2, same input plus a short message listing the rejected quotes and rules broken ("these quotes were not found verbatim: ...; copy text exactly").
3. Still failing: **fallback template**, built by code without the model: status `minor_update`, headline = document title, one pseudo-claim "Latest document: <title> (<date>)" with the first 2 sentences of the document as a verified quote, and a visible note "AI summary withheld: quotes could not be verified."
4. A card with `no_new_information` and zero claims is valid (no retry).

### 5.6 Numbers check (`lib/verify/numbers.ts`)

- Extract number tokens from `headline`, `statement`, `why_it_matters`, `portfolio_note` (regex covering `1,234.5`, `1 234,5`, `12%`, `€57.1 billion`, `-3.2`, `Q3`, years).
- Ignore years 1990 to 2100, quarter labels (`Q1` to `Q4`, `H1`, `H2`, `9M`), and numbers below 10 written as words.
- Every other number must match (after normalizing separators and units) a number found in that claim's verified quotes, or a number in the code-computed allowed list (weight, rank, value in EUR, number of holdings). Otherwise the claim is rejected (same retry path as quotes).

### 5.7 Caching

Cache keys: document by URL; extraction by document hash; triage and analysis by `(model_id, prompt_version, document ids, weight rounded to 0.1%)`. Bump `PROMPT_VERSION` when prompts change. A cached analysis costs $0 and is labelled as cached.

---

## 6. Guardrail against advice (`lib/guardrail/advice.ts`)

Three layers:

1. **System instruction** (in the constant system prompt): "You explain what a public document says and why it is relevant given the holding's weight. You never recommend buying, selling, holding, adding, reducing or rebalancing, never give a price target, rating, fair value or prediction of the share price, and never say whether the stock is a good or bad investment. If asked, reply that you only explain documents."
2. **Input filter** on follow-up questions (before any model call, so refusals cost $0). Case and accent insensitive regexes, English and French, for example: `\b(should|shall) i (buy|sell|hold|add|trim|exit|keep)\b`, `\b(buy|sell|hold)\b.*\?`, `\bprice target\b`, `\btarget price\b`, `\bovervalued|undervalued\b`, `\bgood (investment|buy)\b`, `\bwhen to (buy|sell)\b`, `\bdois[- ]je (acheter|vendre|garder|renforcer|alléger)\b`, `\b(acheter|vendre|renforcer|alléger|solder)\b`, `\bobjectif de cours\b`, `\bconseil(s)? (d'investissement|en investissement)\b`. Match gives the fixed refusal: "I can't give buy or sell advice. I can show you what the company's documents say, with sources."
3. **Output filter** on model-written fields only (`headline`, `statement`, `why_it_matters`, `portfolio_note`, follow-up `answer`), never on quotes (a filing may legitimately say "agreement to sell a subsidiary"). Refused phrases, e.g.: `we recommend`, `you should (buy|sell|hold|add|trim|consider)`, `\b(buy|sell|hold|outperform|underperform|overweight|underweight) (rating|recommendation)\b`, `\bstrong buy\b`, `\bprice target\b`, `\btime to (buy|sell)\b`, `\bconsider (buying|selling|adding|trimming|reducing)\b`, `\b(acheter|vendre|renforcer|alléger)\b`, `\bje (vous )?recommande\b`. A hit triggers the retry path (5.5), then the fallback template.

Unit tests must include at least 20 positive and 20 negative examples for each filter, including tricky negatives ("the company agreed to sell its unit", "sell-side analysts", "buyback program").

---

## 7. Follow-up questions (`app/api/ask`)

- Input: holding id + question (max 300 characters). Input filter first (6.2).
- Model: same documents as the card (cached prefix), `response_format` schema `{ answer: string (max 600 chars), quotes: [{document_id, text}] (1 to 3), answerable: boolean }`. If `answerable` is false, show "The documents don't say." Same quote and number verification, same output filter.
- Max 3 follow-up questions per holding per session (client side plus a server-side per-IP counter in memory).

---

## 8. Budget

**Estimate per holding with `muse-spark-1.3` (Standard):**

| Step | Input tokens | Output tokens (incl. reasoning) | Cost |
|---|---|---|---|
| Triage (0 to 4 short turns) | ~6,000 | ~1,500 | ~$0.014 |
| Analysis (1 or 2 docs, capped) | ~40,000 | ~5,000 | ~$0.071 |
| Expected retries (~30% of holdings) | ~12,000 | ~1,500 | ~$0.021 |
| **Total per holding** | | | **~$0.11** |

A 12-holding portfolio: about **$1.30** per fresh run (less with prompt caching), $0 when cached. Worst case with every holding retried and 2 long documents: about $2.50.

With `muse-spark-1.3-contributor` the same run costs about $0.08, but Meta may train on the content: allowed only for development on public filings and the fictional sample portfolio, never for a user-uploaded CSV.

**Hard caps in code (`lib/llm/budget.ts`):**

- Price table per model id in `lib/llm/prices.ts`; an unknown model id refuses to run.
- Before each call: estimate cost from character counts (chars / 4 tokens) and `max_tokens`; after each call: compute real cost from `usage`. Track per run.
- `MAX_USD_PER_RUN` (default 3): when the next call would exceed it, stop and return remaining cards in a "Budget cap reached" state.
- `BUDGET_USD_TOTAL` (default 100): ledger in `.cache/ledger.json` locally (append-only, cost per call with timestamp). On Vercel the ledger is per instance, so the real backstop there is: the deployed site defaults to fixtures, live runs need `LIVE_RUN_PASSCODE`, max 15 holdings per run, max 10 live runs per hour per instance.
- `scripts/cost-report.ts` prints spend from the ledger.
- CI and unit tests never call the model (recorded fixtures and a fake client).
- Louis also sets a spend alert on the Meta Billing page (section 11).

Development budget target: under $40 total (smoke tests, fixture recording, about 20 full sample runs). That leaves more than $100 of margin.

---

## 9. Milestones

Dates are in Paris time. Each milestone ends with: all tests green, PLAN.md boxes ticked, a commit pushed. Times are targets, the order is what matters.

### M0: Scaffold and smoke test (Tue Oct 27)
- [ ] Next.js App Router + TypeScript + Tailwind + vitest + playwright scaffold, `npm run dev`, `npm test`, `npm run e2e`, `npm run lint`, `npm run typecheck`.
- [ ] `lib/llm/client.ts` with provider switch (meta | baseten), retries (429/5xx/timeouts, exponential backoff with jitter, honour Retry-After), cost accounting.
- [ ] `scripts/smoke.ts`: `GET /v1/models` then one tiny chat completion with a 3-field json_schema (costs < $0.01). Prints model list, tokens, cost.
- [ ] GitHub Actions: lint, typecheck, unit tests on push (no secrets needed).
- **Done when:** `npm run smoke` prints a valid JSON object from `muse-spark-1.3` (or is skipped with a clear message when `MODEL_API_KEY` is missing), and CI is green.

### M1: Portfolio in, weights out (Wed Oct 28)
- [ ] CSV parser (5.1) with tests: sample file, `;` + decimal comma file, BOM, bad rows, wrong ISIN checksum, 51 rows rejected.
- [ ] ECB FX + weights (5.2) with tests (fixed FX fixture).
- [ ] Resolution (5.3 steps 1 to 5) with recorded HTTP fixtures for SEC tickers, OpenFIGI, GLEIF.
- [ ] `POST /api/portfolio` + portfolio preview screen.
- **Done when:** uploading `samples/portfolio.csv` shows 12 rows, weights summing to 100.0%, 6 `SEC EDGAR` badges (5 US + ASML) and 6 `AMF` badges.

### M2: Documents (Thu Oct 29)
- [ ] EDGAR source: submissions, candidate filter, exhibit picking, HTML to text. SEC rate limiter + User-Agent.
- [ ] AMF source: ODSQL query, subtype filter, English preference, PDF download, per-page extraction.
- [ ] ESEF source: filings.xbrl.org lookup by LEI, XHTML report to text, first 30 pages.
- [ ] Scanned-PDF detection + model transcription fallback (behind a flag, tested with a small scanned fixture).
- [ ] Cache layer (5.7).
- [ ] `scripts/record-fixtures.ts`: fetches and stores the sample portfolio's documents under `fixtures/` (public documents only).
- **Done when:** a script lists, for each of the 12 sample holdings, at least one candidate document from the last 120 days with title, date and extracted text length > 2,000 characters, and fixtures are committed.

### M3: Analysis, verification, guardrail (Fri Oct 30)
- [ ] Prompts (`lib/llm/prompts.ts`, with `PROMPT_VERSION`).
- [ ] Triage tool loop (5.4) + deterministic fallback, tested with a fake client.
- [ ] Analysis call with json_schema + zod validation.
- [ ] Normalization + quote verifier + numbers check, with tests (section 10).
- [ ] Retry once, then fallback template.
- [ ] Guardrail input and output filters with tests.
- [ ] `POST /api/analyze` (`maxDuration = 120`).
- **Done when:** `npm run analyze:sample` runs the 12 sample holdings live, and every produced card has 100% verified quotes or is a fallback template; cost printed and under $3.

### M4: UI (Sat Oct 31)
- [ ] Feed with streaming cards (parallel requests, concurrency 4), skeletons with step labels, error and empty states.
- [ ] Source panel with highlighted passage, page number, "Open original" link.
- [ ] Follow-up box with guarded answers.
- [ ] Budget badge (estimate before run, live spend during run).
- [ ] Mobile layout (source panel becomes a bottom sheet).
- **Done when:** on the sample portfolio, a user can go from upload to clicking a quote and seeing it highlighted in under 60 seconds with a warm cache, and the question "Should I sell LVMH?" shows the refusal without a model call.

### M5: Hardening and deploy (Sun Nov 1)
- [ ] Budget caps (section 8), passcode gate, `DEMO_READONLY`, rate limiting per IP.
- [ ] Demo cache: a recorded run of the sample portfolio replayable with no key (`fixtures/sample-run.json`), labelled "Cached result from <date>".
- [ ] End-to-end test (section 10) green in CI with fixtures.
- [ ] Vercel deploy config (`vercel.json` if needed, env var list in README). Deploy itself is done by Louis (section 11) or by the agent if a `VERCEL_TOKEN` secret is provided.
- **Done when:** a fresh clone with no `.env` runs `npm run dev`, loads the sample, and shows the cached run end to end; with a key, a live run works.

### M6: Polish and real run (Mon Nov 2)
- [ ] Live run on the sample portfolio with fresh documents (many Q3 releases land Oct 28 to 30), review every card by hand, fix prompt issues, re-record fixtures.
- [ ] README: screenshots (GIF optional), architecture diagram (mermaid), "Built during the hackathon" list updated with the real commit range.
- [ ] Optional stretch, only if everything above is done: (a) Baseten / Muse Spark Open provider toggle shown in the UI footer; (b) XBRL companyfacts for US holdings to show code-computed YoY revenue next to the model's claim; (c) "compare with previous release" diff view.
- **Done when:** README is complete, a stranger can follow it, and the demo script (section 12) runs start to finish without a hiccup twice in a row.

### M7: Freeze (Tue Nov 3, 21:00 Paris)
- [ ] Feature freeze. Only bug fixes after this point.
- [ ] Final fixture recording, tag `v1.0-hackathon`.
- [ ] Submission checklist (section 12.2) prepared, with all links filled in except the video.
- **Done when:** tag pushed, deployed URL works in a private window, checklist ready for Louis.

**Wed Nov 4: buffer day.** Louis records the video and submits. Deadline 21:00 ET = Thu Nov 5 03:00 Paris. Aim to submit by Wed Nov 4 22:00 Paris.

---

## 10. Tests

**Unit (vitest), no network, no model:**

- `normalize`: ligatures, soft hyphens, hyphenation across lines, curly quotes, dash variants, NBSP, whitespace, offset map back to raw text.
- `quotes`: exact match passes; match after normalization passes (curly vs straight quotes, line breaks inside the quote, `ﬁ`); a one-word substitution fails; a quote from another document id fails; too short (< 20) and too long (> 400) fail; page number mapping is correct across page boundaries; a claim with one bad quote out of two is dropped.
- `numbers`: number present in quote passes; `57.1` vs `€57.1 billion` passes; `1,234.5` vs `1 234,5` passes; invented `58.3` fails; weight `8.4%` from allowed list passes; years and `Q3` ignored.
- `advice`: at least 20 positive and 20 negative examples per filter, English and French (section 6).
- `csv`, `weights`, `fx`, resolution order, AMF subtype filter, EDGAR exhibit picking (fixture JSON and HTML).
- `budget`: run cap stops the run; unknown model refuses; cost math from `usage`.
- `analyze` with a fake client: good output accepted; bad quote triggers exactly one retry; two failures give the fallback template; guardrail hit triggers retry.

**End to end (playwright), on `samples/portfolio.csv` with fixtures and a fake model client returning recorded outputs:**

1. Open `/`, click "Try the sample portfolio".
2. Expect 12 rows, weights sum 100.0%, every row has a source badge.
3. Click "Analyze 12 holdings". Expect 12 cards within 30 s.
4. Every claim shows at least one source chip; click the first chip of the largest holding; expect the source panel with a `mark` element whose text equals the quote after normalization.
5. Type "Should I sell?" in a follow-up box; expect the refusal text and no network call to `/api/ask` model path (assert via a request counter).
6. Toggle dark mode, viewport 390x844: no horizontal scroll.

**Live check (manual script, costs money, not in CI):** `npm run analyze:sample -- --live` prints per-holding status, verified quote count, retries, cost, and the total.

---

## 11. Setup Louis must do

1. **Meta Model API account and key.** Go to dev.meta.ai, open the Model API dashboard, API keys, Create API key. Copy it once (keys start with `LLM_`).
2. **Billing.** On the Billing page, check the $150 hackathon credits are applied, and **add a card**: the guide says credits cannot be used without a payment method (a temporary pre-authorization charge appears, then is released).
3. **Spend alert.** On the same Billing page, set a "Spend Limit" notification at **$150** (and ideally a first alert at $50).
4. **Claim deadline.** Credits must be claimed by Wed Nov 4, 9:00 PM ET (already requested on 2026-10-27).
5. **Cloud session secrets.** In the Claude Code cloud session environment, add `MODEL_API_KEY` and `SEC_USER_AGENT` (format: `Fynex Copilot hackathon <your email>`). Optional: `BASETEN_API_KEY` if Baseten credits arrive, `VERCEL_TOKEN` if the agent should deploy.
6. **Vercel (optional but recommended for judges).** Import the GitHub repo at vercel.com/new, framework auto-detected. Set env vars: `MODEL_API_KEY`, `SEC_USER_AGENT`, `LIVE_RUN_PASSCODE` (pick one), `MAX_USD_PER_RUN=3`. Leave `DEMO_READONLY=false` only if the passcode is set.
7. **Review points.** Read the cards produced on M6 (about 10 minutes), record the video (section 12.1), submit (section 12.2).

---

## 12. Demo video and submission

### 12.1 Video script (3:00 max)

| Time | Shot | Voice-over (English, short) |
|---|---|---|
| 0:00 to 0:15 | Louis on camera or title card "Fynex Copilot" | "Retail investors own stocks but never read the filings. I'm Louis, founder of Fynex, a portfolio tracker for European investors. At this hackathon we built a copilot that reads them for you." |
| 0:15 to 0:35 | Upload `samples/portfolio.csv`, preview table | "Drop a portfolio: US and French stocks. Weights are computed by code, and each line is matched to its official source: SEC EDGAR, or the French regulator's database." |
| 0:35 to 1:10 | Click Analyze, cards stream in, step labels visible | "Muse Spark, through the Meta Model API, triages the latest documents with tool calls, reads them, PDFs included, and returns structured JSON for each holding." |
| 1:10 to 1:45 | Open the Schneider card (capital increase) then click source chip, panel with highlighted passage and page number | "Every claim carries the exact passage. Click it and you land on the highlighted sentence in the original release." |
| 1:45 to 2:10 | Split screen: log of a rejected quote then retry, footer "all quotes verified" | "The server checks every quote word for word against the document, and every number against the quotes. If the model paraphrases or invents, the claim is rejected and retried, or withheld." |
| 2:10 to 2:30 | Type "Should I sell LVMH?" then refusal | "And it never tells you to buy or sell. It explains documents. That's the line." |
| 2:30 to 2:50 | Quick architecture slide (mermaid diagram from README), cost footer | "Built in nine days on Muse Spark: tool calling, structured output, native PDF input. A full portfolio costs about a dollar." |
| 2:50 to 3:00 | URL + repo | "Fynex Copilot. What changed in your stocks, with the source." |

Recording tips: use the cached sample run (instant, no live dependency) but say it is a recorded run if asked; 1080p screen capture; zoom the browser to 125%; no personal data on screen.

### 12.2 Submission checklist (Cerebral Valley platform)

- [ ] Submit at `https://cerebralvalley.ai/e/meta-ai-developer-hackathon/hackathon/submit` before Wed Nov 4, 9:00 PM ET (Thu 03:00 Paris).
- [ ] Track: Startups. Representative: Louis.
- [ ] Repo URL public and opening in a private window.
- [ ] Video link (YouTube unlisted or Loom), public, 3:00 or less, checked in a private window.
- [ ] Live URL (Vercel) working, passcode not needed for the cached sample.
- [ ] Description states clearly what was built during the hackathon vs what existed before (Fynex the company existed; this repo and all its code were created from Oct 27, 2026).
- [ ] Meta models used: Muse Spark 1.3 via Meta Model API (and Muse Spark Open via Baseten if used).
- [ ] Everyone who worked on it listed (Louis).
- [ ] Optional: post the demo on X and add the post link (Most Viral bonus).

---

## 13. Risks and fallbacks

| Risk | Likelihood | Fallback |
|---|---|---|
| European sources incomplete (non-French EU issuer, no EDGAR) | Medium | ESEF annual report via filings.xbrl.org; card states the document is the annual report and its date. If nothing: "No public source found", no model call. Sample portfolio avoids this case on purpose. |
| AMF titles are generic or the latest item is noise | High | Subtype filter, then the triage tool loop reads the first page, then the regex fallback. |
| Scanned or image-only PDFs | Low for large caps | Detection by text density, then Muse Spark transcription via native PDF input, flagged in the UI. If transcription fails, card shows title and link only. |
| PDF tables extract badly, quotes do not match | Medium | Normalization (5.5), prompt asks for quotes from prose sentences rather than tables, retry with feedback, then fallback template. |
| SEC rate limit or block (cloud IPs, missing User-Agent) | Low | Declared User-Agent, 5 req/s limiter, 24 h cache, fixtures for the sample portfolio. |
| Meta API 429 or 5xx | Low | Backoff with jitter, honour Retry-After, concurrency 4, per-card retry button. |
| Credits not applied or card missing | Medium (needs Louis) | Smoke test in M0 reveals it on day one. Contributor model for dev reduces spend. Demo works from fixtures with no key. |
| Budget overrun | Low | Per-run cap, total ledger cap, passcode on live runs, Billing alert at $150. |
| Model returns advice | Low | System instruction + output filter + retry + fallback. |
| Vercel timeouts | Low | One request per holding, `maxDuration = 120`, Hobby max is 300 s. |
| Judges see "basic RAG" | Medium | Video and README emphasize the agentic triage, verification loop, multimodal PDF fallback and the no-advice line. |
| Baseten or other partner credits never arrive | High | Nothing depends on them. |

---

## 14. Documentation consulted (2026-10-27)

Meta (all reachable):

- Participant guide: https://cerebralvalley.ai/e/meta-ai-developer-hackathon/details
- Overview: https://dev.meta.ai/docs/overview
- Quickstart: https://dev.meta.ai/docs/quickstart
- Models: https://dev.meta.ai/docs/models
- Pricing and rate limits: https://dev.meta.ai/docs/pricing-rate-limits
- Authentication: https://dev.meta.ai/docs/authentication
- File handling (PDF): https://dev.meta.ai/docs/file-handling
- Structured output: https://dev.meta.ai/docs/structured-output
- Tool calling: https://dev.meta.ai/docs/tool-calling
- Reasoning: https://dev.meta.ai/docs/reasoning
- Prompt caching: https://dev.meta.ai/docs/prompt-caching
- Error handling: https://dev.meta.ai/docs/error-handling
- Cookbook, API fundamentals: https://github.com/meta-models/meta-model-cookbook/tree/main/01_api_fundamentals (notebooks 03 tool calling, 04 structured output, 09 error handling)
- Not readable as text: https://dev.meta.ai/docs/api-reference/responses/create-response (parameters render client-side). Not needed since we use Chat Completions.

SEC:

- EDGAR APIs: https://www.sec.gov/search-filings/edgar-application-programming-interfaces
- Fair access and User-Agent: https://www.sec.gov/about/webmaster-frequently-asked-questions and https://www.sec.gov/about/developer-resources
- Full-text search FAQ (UI only): https://www.sec.gov/edgar/search/efts-faq.html

Europe:

- AMF / DILA info-financiere API: https://info-financiere.gouv.fr/pages/api0/ and https://www.data.gouv.fr/dataservices/api-info-financiere (dataset `flux-amf-new-prod` tested live)
- filings.xbrl.org API: tested live at https://filings.xbrl.org/api/filings and /api/entities/{LEI}
- GLEIF: tested live at https://api.gleif.org/api/v1/lei-records
- OpenFIGI: https://www.openfigi.com/api/documentation
- ECB reference rates: https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml

Partners and hosting:

- Baseten chat completions: https://docs.baseten.co/reference/inference-api/chat-completions
- Vercel function duration: https://vercel.com/docs/functions/configuring-functions/duration

Not verified (builder must check before use): Baseten PDF and tool calling support for `meta-models/muse-spark-open-1026`; whether `strict: true` is accepted for our schema on Meta's API; the default `reasoning_effort` on Muse Spark; the exact rate limits of filings.xbrl.org and of the info-financiere API (be polite: cache, at most 2 req/s).
