# Build notes

Log of deviations from PLAN.md, verified API facts and spend, kept by the building agent.

## Blocked on Louis

- Nothing blocking. Optional: a Vercel deployment (PLAN.md section 11, step 6) and the demo video.

## 2026-10-29 (night build)

### Verified facts

- `GET /v1/models` with our key lists: `muse-spark-1.3`, `muse-spark-1.3-contributor`, `muse-spark-1.2`, `muse-spark-1.2-contributor`, `muse-spark-1.1`, `muse-wonder-1.0`, `muse-image-1.0`, `muse-voice-transcribe-1.0`, `sam-3.1`.
- Prices re-checked on https://dev.meta.ai/docs/pricing-rate-limits: Muse Spark 1.3 Standard $1.25 input, $0.15 cached input, $4.25 output per 1M tokens; Contributor $0.10, $0.002, $0.20.
- Reasoning tokens are counted inside `usage.completion_tokens` (live call: 410 completion tokens of which 388 reasoning for a 3-field JSON). We bill them at the output price. A `max_tokens` too low leaves `content` null: the client raises `EmptyOutputError` (the call is still billed and logged).
- `response_format` with `json_schema` and `strict: true` is accepted on Chat Completions for our schemas (smoke test and the analysis schema).
- Tool calling: a parameter typed `["string", "null"]` is accepted; the model calls `list_candidate_documents`, `read_document_start` and `select_documents` as designed.
- An analysis call (1 or 2 documents) uses about 9k to 17k input tokens and 5k to 6k output tokens, of which 4k to 5k are reasoning. `max_tokens` is set to 8000 for the analysis.

### Deviations

- **unpdf 1.9.1 instead of 2.x**: unpdf 2 requires Node 24; Vercel and the dev machine run Node 22.
- **TypeScript 5.9** instead of 7: Next 16 tooling is not yet validated on the TS 7 native compiler.
- **SEC exhibit picking** uses the `-index.html` page (the "Type" column gives `EX-99.1`). File-name heuristics failed on real filings (Coca-Cola names its release `a2026q3earningsreleaseex-9.htm`, ASML `pressreleasefinancialresul.htm`).
- **Ticker collisions**: `SU` is Suncor on the SEC map, `MC` Moelis, `DG` Dollar General, `OR` Osisko. The SEC ticker map is trusted directly only for US ISINs or when the company name agrees; FR ISINs always go to the AMF first.
- **8-K items kept**: 2.02 (results) plus 1.01, 2.01, 5.02, 7.01, 8.01 (material events), so a capital or M&A event is visible to the triage.
- **Numbers check**: bare single digits (counts such as "2 documents") are tolerated; a single digit followed by `%` is checked. Ambiguous `1,234` / `1.234` is accepted under both readings.
- **Retries**: the `openai` SDK's built-in retry (3 retries, exponential backoff with jitter, honours `Retry-After`, never retries a 400) replaces a hand-written loop.
- **SEC User-Agent**: `SEC_USER_AGENT` if set, else `fynex-copilot (contact@fynexapp.com)`.
- **Ledger**: JSONL (`.cache/ledger.jsonl` by default, `COST_LEDGER_PATH` to move it). The night build used a ledger outside the repository with a total cap of $18.
- **Scanned PDF fallback** is behind `ENABLE_PDF_TRANSCRIPTION=true`. No scanned PDF exists in the sample, so it was validated live on a text PDF (Schneider bond release, 2 pages, contributor model, $0.0004): Muse Spark read the native `file` block and its transcription matched the extracted text sentence for sentence (4 of 5 sampled sentences verified, the fifth spanned a page header). Unit tests cover the request shape with a fake client.
- **Client-side input filter**: the advice filter also runs in the browser, so "Should I sell?" produces the refusal with no request at all (the end-to-end test counts requests to `/api/ask`). The server applies the same filter.
- **No Vercel deploy** tonight (needs Louis's account). The app runs with `npm run demo` from a fresh clone without a key.

### Spend (night of 2026-10-29)

| Item | Model | Cost |
|---|---|---|
| Smoke calls | contributor | $0.0001 |
| Dev run, 2 holdings (MSFT, SU) | contributor | $0.0052 |
| Full sample run, 12 holdings, then re-recording (triage and one new KO analysis) | muse-spark-1.3 | $0.80 |
| Live web test: one follow-up question | muse-spark-1.3 | $0.0135 |
| Native PDF transcription check | contributor | $0.0004 |
| **Total** | | **about $0.82** |

Recorded run (fixtures/sample-run.json): 12 of 12 cards `ok`, 52 claims, 116 quotes, all verified; one card (Schneider) needed the retry because its first answer hit `max_tokens` (fixed by raising it). 277k input tokens (38k cached), 85k output tokens of which 72k reasoning, $0.67.

### Still to do (M6 and M7)

- Re-run the sample live around Nov 2 to pick up the releases of Oct 30 onwards (Apple's quarter, more Q3 releases), review every card by hand, re-record (`npm run analyze:sample -- --record`, about $0.70).
- Optional Vercel deploy (Louis), then the video (docs/demo-video.md) and the submission.
- Tag `v1.0-hackathon` at the freeze.
