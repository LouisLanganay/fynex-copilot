# Demo video plan (3:00 max)

Goal: show only what was built during the hackathon (Startups track rule). Record on the cached sample run (`npm run demo`), which is instant and identical to the live run of 2026-10-29; say it is a recorded run if asked. Browser zoom 125%, 1080p, no personal data on screen, light mode then one dark-mode phone shot.

Before recording: `npm install && npm run demo`, open http://localhost:3000 in a private window.

| Time | Shot | Voice-over (English, short) |
|---|---|---|
| 0:00 to 0:15 | Title card "Fynex Copilot: what changed in your stocks, with the source" | "Retail investors own stocks but rarely read the filings. I'm Louis, founder of Fynex, a portfolio tracker for European investors. Here we built a copilot that reads them for you." |
| 0:15 to 0:35 | Click "Try the sample portfolio": 12 rows, weights, source badges | "Drop a portfolio: US and French stocks. Weights are computed by code, never by the model, and each line is matched to its regulator: SEC EDGAR or the French AMF." |
| 0:35 to 1:05 | Click "Analyze 12 holdings": skeletons with step labels, then cards | "For each holding, Muse Spark on the Meta Model API acts as a triage agent: with tool calls it lists the recent filings, reads the start of the unclear ones and picks what to analyze. Then it returns a structured card through a strict JSON schema." |
| 1:05 to 1:40 | Scroll to Schneider Electric (material change: record quarter, bond for the PTC acquisition). Click chip [5]: side panel opens on the highlighted sentence, page 1, "Open original" | "Every claim carries the exact passage. Click it and you land on the highlighted sentence in the regulator's PDF, with the page number." |
| 1:40 to 2:05 | Card footer "all 7 quotes verified, 1 rejected and retried". Cut to `examples/sample-run.md` or to the test `analyze retries exactly once after a bad quote` | "The server checks every quote word for word against the document, and every number against the quotes. If the model paraphrases or invents a figure, the claim is rejected and retried once, or withheld. 116 quotes in this run, 116 verified." |
| 2:05 to 2:25 | In the LVMH card, type "Should I sell LVMH?" then the refusal | "And it never tells you to buy or sell. The question is filtered before any model call. It explains documents. That's the line." |
| 2:25 to 2:50 | README architecture diagram, then the measured cost table | "Built in a week on Muse Spark: tool calling, structured output, reasoning, native PDF input. The whole 12-stock portfolio costs 67 cents to analyze." |
| 2:50 to 3:00 | Repo URL on screen | "Fynex Copilot. What changed in your stocks, with the source." |

Fallback shots if something breaks: `npm run analyze:sample -- --mock --offline` in a terminal shows the whole pipeline with verified quotes and no network.

## Submission checklist (Cerebral Valley platform)

- [ ] Submit at https://cerebralvalley.ai/e/meta-ai-developer-hackathon/hackathon/submit before Wed Nov 4, 9:00 PM ET (Thu Nov 5, 03:00 Paris).
- [ ] Track: Startups. Representative: Louis.
- [ ] Repo URL https://github.com/LouisLanganay/fynex-copilot, public, opened in a private window.
- [ ] Video link (YouTube unlisted or Loom), public, 3:00 or less, checked in a private window.
- [ ] Live URL if deployed (optional; the repo runs locally without a key).
- [ ] Description: Fynex the company existed before; this repository and all its code were created from Oct 27, 2026; no Fynex code is used.
- [ ] Meta models used: Muse Spark 1.3 via the Meta Model API (tool calling, structured output, reasoning, native PDF input, prompt caching).
- [ ] Team: Louis Langanay.
