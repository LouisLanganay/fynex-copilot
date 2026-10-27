# Instructions for the building agent

You are building Fynex Copilot for a hackathon. The human owner (Louis) has very little time: he only adds keys, reviews, and records the demo video. You work autonomously.

## Before anything

1. Read `PLAN.md` in full. It is the spec and the source of truth. It contains verified API details (section 3) and the docs it was based on (section 14).
2. Read `NOTES.md` if it exists (your own log of deviations and decisions).
3. Work milestone by milestone (PLAN.md section 9), in order. Do not start M(n+1) before M(n)'s "Done when" is met.

## Rules

- **Commits**: small and frequent, in English, imperative mood (`Add AMF source fetcher`). One logical change per commit. Push after each milestone at least. End every commit message with the trailer `Co-Authored-By: Claude <noreply@anthropic.com>`.
- **Tick PLAN.md** checkboxes as you finish items, in the same commit as the work.
- **Update the "Built during the hackathon" list** in `README.md` when a feature lands.
- **Tests**: every module in `lib/` has unit tests. Quote verification, numbers check and the advice guardrail must have the test cases listed in PLAN.md section 10. Never commit with failing tests or type errors. Tests and CI never call the paid model: use the fake client and fixtures.
- **Secrets**: never commit a key, token or `.env*` file (only `.env.example` with empty values). Never print a key in logs. Run `git diff --cached` before each commit and check for `LLM_`, `sk-`, `Bearer `.
- **Spending**: live model calls only through `lib/llm/client.ts`, which enforces the caps in PLAN.md section 8. Use `muse-spark-1.3-contributor` for development runs on public filings and the sample portfolio; `muse-spark-1.3` for the demo and for any user-uploaded CSV. Keep total development spend under $40; report spend in `NOTES.md` at the end of each milestone (`npm run cost-report`).
- **Verify APIs, do not guess**: before using an endpoint or parameter that PLAN.md marks as unverified, or one not in PLAN.md, check the official docs or make a cheap test call, and record the result in `NOTES.md`.
- **Data**: public data only. SEC requests always carry `SEC_USER_AGENT` and stay under 5 requests per second. Be polite with the AMF and filings.xbrl.org APIs (cache, max 2 requests per second).
- **No advice, ever**: nothing in the UI, prompts, README or fixtures may recommend buying, selling or holding a security.
- **No Fynex code**: do not copy code from any other repository of the Fynex organization.
- **Style**: never use the em dash or en dash characters anywhere (code comments, UI copy, docs, commits). Use commas, colons, parentheses or separate sentences.

## When something does not fit the plan

Stop and write it in `NOTES.md` before deviating: date, what the plan says, what you found, the option you chose and why, and the impact on the milestones. Then continue with the safest option that keeps the demo working. Examples: an API behaves differently from PLAN.md, a dependency does not work on Vercel, a milestone is slipping by more than half a day (then cut stretch goals first, never the verifier or the guardrail).

If you are blocked by something only Louis can do (missing key, credits not applied, Vercel access), write it at the top of `NOTES.md` under `## Blocked on Louis`, keep working on everything that does not depend on it (fixtures and the fake client let you build most of the app without a key), and mention it in your next summary.

## Definition of done for the whole project

PLAN.md milestone M7 is met: tag `v1.0-hackathon` pushed, all tests green, the app runs from a fresh clone without a key (cached sample run) and with a key (live run), README complete, submission checklist ready for Louis.
