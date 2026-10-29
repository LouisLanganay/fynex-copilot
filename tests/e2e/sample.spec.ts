import { expect, test } from "@playwright/test";

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
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
