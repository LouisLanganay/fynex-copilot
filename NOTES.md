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

## 2026-11-02 (improvements before the new video)

### Opening block and feed hierarchy

- `lib/lead.ts` picks up to 3 `ok` cards with `material_change`, heaviest first (missing weights last, ties on rank then name). `components/LeadChanges.tsx` renders them under the "What changed" heading. No new model call, the recording is untouched. In the sample all 12 cards are material, so the block shows LVMH, TotalEnergies, NVIDIA (Schneider ties NVIDIA at 9.1% and is rank 4).
- The block waits until no card is loading: during a live run a heavier line may still be pending.
- Once a run starts, the upload zone and the holdings table fold away (a "Show holdings" button brings them back) and the page returns to the top, so the results are the first screen. On a phone the Analyze button is far below the fold: without the scroll reset the user landed in the middle of the feed.
- Font: Inter from `@fontsource-variable/inter` through `next/font/local`, bundled at build time, no network at build or at runtime (OFL). Latin subset only.
- Selectors kept for `../video/scripts/`: `try-sample`, `analyze`, `holding-row`, `source-badge`, `weight-sum`, `card`, `claim`, `source-chip`, `quote-mark`, `source-panel`, `card-footer`, `ask-input`, `ask-submit`, `ask-answer`, `article[data-holding]`, `p.font-medium` as the card headline, the heading "What changed", `claim.locator('p').nth(1)`. Behavior changes for the capture script: `holding-row`, `analyze` and "Drop your portfolio CSV" leave the DOM once a run starts, and the page scrolls to the top on Analyze. The status label in a card is now plain text, still "Material change".

### Earnings call audio: feasibility test, GO

The four conditions, each checked for real on 2026-11-02:

1. **Official public recording: yes.** Microsoft FY27 Q1 call, 2026-10-28, sample holding MSFT. Event page https://www.microsoft.com/en-us/investor/events/fy-2027/earnings-fy-2027-q1 (no login, replay announced through 2027-10-28 in the press release), which embeds Microsoft's own player. The player's configuration lists a resource titled "Download URL": an MP4 on Microsoft's storage, signed for reading until 2031 (200, 3.53 GB, H.264 and AAC, 57:28, range requests accepted). The player's HLS stream has a separate audio rendition. No wall crossed: both are what the public page hands to any browser. curl gets 403 on Apple's, NVIDIA's, ASML's and Schneider's investor sites: not pursued, and not needed.
2. **Transcription API: yes.** Docs read first: https://dev.meta.ai/docs/speech-to-text, /docs/api-reference/voice/transcribe. `POST https://api.meta.ai/v1/asr/transcribe`, multipart: `request` (JSON: `model` `muse-voice-transcribe-1.0`, `audioEncoding` `WAV` required, `mode` `PUSH_TO_TALK` default, `ENDPOINTING` or `DIARIZATION`, `languageBias`, `keywords`) and `audio`. Mono 16-bit PCM WAV at 16 or 24 kHz only, 10 minutes and 32 MB at most per request. $0.18 per hour of audio, whole seconds rounded down; failed and 429 requests not billed; 256 concurrent streams, 16,000 per hour. No contributor mode for this model. Response: `audioDurationMs`, `turns[]` with `startMs`, `endMs`, `transcript`. Test call on 60 s: 200. A vocabulary keyword can backfire: with "Amy Hood" in `keywords`, "MAI Transcribe" came back as "Amy Hood", so no person's name is biased.
3. **Timestamps: yes, derived from timed clips.** The API gives turn-level times only, documented as approximate, and a 60 s clip of continuous speech came back as one 59.5 s turn. So the recording is cut at its pauses (`silencedetect`) into 173 clips of 15 s or more, 40 s at most, each keeping its offset. Result: 247 turns, 52,159 characters. Checked three ways against sources that are not ours:
   - Microsoft's own English captions from the same player. Turn starts against the caption of the same words (158 turns matched exactly on 6 words): median error 0.39 s, 90th percentile 1.9 s, maximum 4.2 s.
   - A passage's time inside a turn, by proportion of characters, against the captions, on 988 unique phrases: median error 1.0 s, 90th percentile 2.8 s, maximum 5.5 s. Using the turn start alone gives a median of 5.7 s and up to 36 s, hence the proportion, minus a 3 s lead.
   - For every timestamp of the recorded card: `ffmpeg -ss` on the official MP4 itself at that second, 30 s transcribed again. 4 of 4 passages come back, starting in the first words (word 0 to 4 of about 80), all words matching but one (the transcript's "capex expenditures" comes back as "capital expenditures", which is what the official transcript has). Caption times for the same passages are 0.9 to 3.6 s after the recorded time, so playback starts just before them.
   Words: 14.0% word difference against Microsoft's official transcript (punctuation-free comparison; much of it is number and term formatting, plus repeated words: 9,139 words against 8,712). Numbers: 88 distinct numbers in each, 1 different ("2027" against "2026"). Two stutters on figures in the whole call ("97.1 1 billion", "16.4 16.4 billion"), now rejected by the verifier.
4. **Player: yes.** `<audio src="...VOD001.mp4?...#t=1634">` in Chromium: seeks to 1634, plays on (1636.9 three seconds later), Microsoft's server allows it without CORS. Three chips measured: metadata in about 2.8 s, playing at the exact second about 6 s after the player appears. The panel says so while it waits. On failure the panel falls back to a link with the time displayed.

Choices:

- The audio for transcription comes from the HLS audio rendition (165 MB of WAV) rather than the MP4 (3.5 GB of video). The third check above is what shows both share a timeline.
- `fixtures/cache/doc/a790d54cd21d1a38.json` holds only the quoted passages (`excerpt: true`). The full transcript lives under `.cache/transcript/`, audio under `.cache/calls/`, both gitignored. A call is a live candidate only once `npm run record-call` has cached its transcript. `readDocument` serves the excerpt in replay mode, as the recorded offsets point into it.
- `lib/sources/calls.ts` carries Microsoft's signed media URL in this public repository. It is not our secret: Microsoft publishes it to anyone who opens the page. It does expire in 2031 and could be reissued.
- `TRANSCRIPT_RULES` is added to the user message only when a transcript is read, so the prompt of the 11 other holdings is unchanged. PROMPT_VERSION bumped for the new triage line.
- The card reads the call as primary and the release of the same day as comparison. The triage chose that on all 4 runs, following one added line in its prompt. Figures come from the release; the outlook only exists on the call (the release says so itself).
- The Microsoft card was recorded on the portfolio of the Oct 29 run. A first attempt with today's ECB rates gave 8.8% where the table shows 8.9%.
- No speaker is named: `ENDPOINTING` has no labels, and the prompt forbids a name unless the transcript says who speaks.
- Only Microsoft: it is rank 5, so it is not in the opening block's 3 rows. Not forced.

Replay numbers after the addition: 12 of 12 cards `ok`, 51 claims (52 before), 118 quotes (116 before), all verified, 281,491 input tokens (37,875 cached), 86,173 output tokens of which 73,062 reasoning, $0.84 (of which $0.17 speech to text, Microsoft card $0.23 against $0.05 before).

### Spend (2026-11-02)

| Item | Model | Cost |
|---|---|---|
| Test call, 60 s, by curl (not in the ledger) | muse-voice-transcribe-1.0 | $0.003 |
| Whole call, 173 clips, cached clip by clip | muse-voice-transcribe-1.0 | $0.168 |
| Dev run of the card | contributor | $0.003 |
| Recorded card, 3 runs (2 discarded: stuttered number, today's FX) | muse-spark-1.3 | $0.17 |
| Re-listening at the recorded timestamps, 2 rounds | muse-voice-transcribe-1.0 | $0.012 |
| **Total** (ledger `../cost-log.jsonl`: $0.35) | | **about $0.36** |

### Still to do (M6 and M7)

- Re-run the sample live around Nov 2 to pick up the releases of Oct 30 onwards (Apple's quarter, more Q3 releases), review every card by hand, re-record (`npm run analyze:sample -- --record`, about $0.70). Not done on Nov 2: the brief keeps the Oct 29 run for the other holdings. `--record` would also replace the Microsoft card and its excerpt: `npm run record-call -- --analyze --record` puts them back.
- Optional Vercel deploy (Louis), then the video (docs/demo-video.md) and the submission.
- Tag `v1.0-hackathon` at the freeze.
