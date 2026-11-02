import { expect, test, type Page } from "@playwright/test";

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

test("sample portfolio: upload, cards, source panel, refusal, mobile dark mode", async ({ page }) => {
  let askCalls = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/ask")) askCalls++;
  });

  await page.goto("/");
  await page.getByTestId("try-sample").click();

  // 12 rows, weights sum to 100.0%, every row has a source badge.
  await expect(page.getByTestId("holding-row")).toHaveCount(12);
  await expect(page.getByTestId("weight-sum")).toHaveText("100.0%");
  await expect(page.getByTestId("source-badge")).toHaveCount(12);
  await expect(page.locator("[data-testid=source-badge]", { hasText: "SEC EDGAR" })).toHaveCount(7); // 6 primary + TotalEnergies secondary
  await expect(page.locator("[data-testid=source-badge]", { hasText: "AMF" })).toHaveCount(6);

  // Analyze: 12 cards within 30 s.
  await page.getByTestId("analyze").click();
  await expect(page.getByTestId("card")).toHaveCount(12, { timeout: 30_000 });

  // The opening block: the 3 heaviest material changes, in weight order, computed from the cards.
  const lead = page.getByTestId("lead-row");
  await expect(lead).toHaveCount(3);
  const weights = (await page.getByTestId("lead-weight").allTextContents()).map((w) => parseFloat(w));
  expect(weights).toEqual([...weights].sort((a, b) => b - a));
  await expect(lead.first()).toContainText("LVMH");
  await expect(page.getByTestId("lead-summary")).toContainText("12 of 12 lines report a material change");
  await expect(lead.first()).toBeInViewport();

  // A row leads to its card...
  await lead.nth(1).getByTestId("lead-link").click();
  await expect(page.locator(`article[data-holding="${await lead.nth(1).getAttribute("data-holding")}"]`)).toBeInViewport();
  await expect(page.locator(`article[data-holding="${await lead.nth(1).getAttribute("data-holding")}"]`)).toBeFocused();
  // ...and to its source.
  await lead.first().getByTestId("lead-source").click();
  await expect(page.getByTestId("source-panel")).toContainText("LVMH");
  await expect(page.getByTestId("quote-mark")).toBeVisible();
  await page.keyboard.press("Escape");

  // Holdings are folded out of the way once the run started, and can come back.
  await expect(page.getByTestId("holding-row")).toHaveCount(0);
  await page.getByTestId("toggle-setup").click();
  await expect(page.getByTestId("holding-row")).toHaveCount(12);
  await page.getByTestId("toggle-setup").click();

  // Every claim shows at least one source chip.
  const claims = page.getByTestId("claim");
  const n = await claims.count();
  expect(n).toBeGreaterThan(12);
  for (let i = 0; i < n; i++) await expect(claims.nth(i).getByTestId("source-chip").first()).toBeVisible();

  // Click the first chip of the largest holding: the panel highlights the quote.
  const first = page.getByTestId("card").first();
  const chip = first.getByTestId("source-chip").first();
  const quoteText = (await chip.getAttribute("title")) ?? "";
  await chip.click();
  await expect(page.getByTestId("source-panel")).toBeVisible();
  const mark = page.getByTestId("quote-mark");
  await expect(mark).toBeVisible();
  expect(norm((await mark.textContent()) ?? "")).toBe(norm(quoteText));
  await page.keyboard.press("Escape");

  // Advice question: fixed refusal and no request to /api/ask.
  await first.getByTestId("ask-input").fill("Should I sell?");
  await first.getByTestId("ask-submit").click();
  await expect(first.getByTestId("ask-answer")).toContainText("I can't give buy or sell advice");
  expect(askCalls).toBe(0);

  // Dark mode at phone width: no horizontal scroll.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("theme-toggle").click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByTestId("lead")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

const MSFT = 'article[data-holding="US5949181045"]';

async function openCallChip(page: Page) {
  await page.goto("/");
  await page.getByTestId("try-sample").click();
  await page.getByTestId("analyze").click();
  await expect(page.getByTestId("card")).toHaveCount(12, { timeout: 30_000 });
  const card = page.locator(MSFT);
  await expect(card.getByTestId("transcript-label")).toContainText("Automatic transcript");
  await expect(card.getByRole("link", { name: "Original recording" })).toHaveAttribute("href", /microsoft\.com\/en-us\/investor/);
  // Filings keep their pages; the call reads as a timestamp.
  const chip = card.locator("[data-testid=source-chip]", { hasText: /\d+:\d\d$/ }).first();
  const label = (await chip.textContent())!.match(/(\d+):(\d\d)$/)!;
  const quote = (await chip.getAttribute("title")) ?? "";
  await chip.click();
  await expect(page.getByTestId("quote-mark")).toHaveText(quote);
  await expect(page.getByTestId("source-panel")).toContainText(`at ${label[0]}`);
  await expect(page.getByTestId("transcript-note")).toContainText("may contain errors");
  return { seconds: Number(label[1]) * 60 + Number(label[2]), label: label[0] };
}

test("earnings call: a chip reads as a timestamp and the panel opens the recording there", async ({ page }) => {
  // Hold the media request: no network in the test, and the player stays in place.
  await page.route("**/*.mp4*", () => {});
  const { seconds, label } = await openCallChip(page);
  const src = await page.getByTestId("call-audio").getAttribute("src");
  expect(src).toMatch(new RegExp(`\\.mp4\\?.*#t=${seconds}$`));
  const link = page.getByRole("link", { name: `Open original recording at ${label}` });
  await expect(link).toHaveAttribute("href", new RegExp(`#t=${seconds}$`));
  await expect(page.getByRole("link", { name: "Company's page for the call" })).toBeVisible();
});

test("earnings call: an unreachable recording leaves the link out with the timestamp", async ({ page }) => {
  await page.route("**/*.mp4*", (r) => r.abort());
  const { label } = await openCallChip(page);
  await expect(page.getByTestId("call-audio-failed")).toContainText(label);
  await expect(page.getByRole("link", { name: `Open original recording at ${label}` })).toBeVisible();
});

/** Replays the recording with the cards rewritten, to reach states the sample does not have. */
async function withCards(page: Page, rewrite: (card: Record<string, unknown>, index: number) => Record<string, unknown>) {
  const seen = new Map<string, number>();
  await page.route("**/api/analyze", async (route) => {
    const res = await route.fetch();
    const j = await res.json();
    const id = j.card.holdingId as string;
    if (!seen.has(id)) seen.set(id, seen.size);
    await route.fulfill({ response: res, json: { ...j, card: rewrite(j.card, seen.get(id)!) } });
  });
  await page.goto("/");
  await page.getByTestId("try-sample").click();
  await page.getByTestId("analyze").click();
  await expect(page.getByTestId("card")).toHaveCount(12, { timeout: 30_000 });
}

const NOT_MATERIAL = { status: "minor_update" };

test("opening block: no material change hides the rows and groups the feed", async ({ page }) => {
  await withCards(page, (c) => ({ ...c, ...NOT_MATERIAL }));
  await expect(page.getByTestId("lead-row")).toHaveCount(0);
  await expect(page.getByTestId("lead-none")).toBeVisible();
});

test("opening block: one and two material changes shorten it", async ({ page }) => {
  await withCards(page, (c, i) => (i === 0 ? c : { ...c, ...NOT_MATERIAL }));
  await expect(page.getByTestId("lead-row")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Largest line with a material change" })).toBeVisible();
  await expect(page.getByTestId("feed-group")).toHaveText(["Material changes", "Minor updates"]);
});

test("opening block: missing weight and long unbroken name stay on the phone screen", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  const long = "Compagnie-Generale-Des-Etablissements-Internationaux-De-Participations-Financieres-Et-Industrielles-SA";
  await withCards(page, (c, i) => (i === 0 ? { ...c, name: long, weightPct: null } : i < 2 ? c : { ...c, ...NOT_MATERIAL }));
  const rows = page.getByTestId("lead-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.last()).toContainText("Weight unknown");
  await expect(rows.last()).toContainText(long);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  // overflow-x is hidden on the body, so also check that nothing is wider than the viewport.
  const wide = await rows.evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().right > window.innerWidth).length);
  expect(wide).toBe(0);
});
