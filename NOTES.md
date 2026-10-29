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
