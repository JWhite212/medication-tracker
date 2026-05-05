import { test, expect } from "@playwright/test";
import { HEADING } from "./helpers/selectors";

test.describe("analytics and history filters", () => {
  test("analytics renders core stats and a sparkline for the seeded user", async ({ page }) => {
    await page.goto("/analytics?period=30");
    await expect(page.getByRole("heading", { name: HEADING.analytics })).toBeVisible();

    // Avg adherence stat-card is the second of three; assert a number
    // followed by a percent sign is shown.
    await expect(page.getByText(/^\d{1,3}%$/).first()).toBeVisible();

    // Sparklines and other charts render inline SVG.
    await expect(page.locator("svg").first()).toBeVisible();
  });

  test("status filter on /log narrows results to taken doses", async ({ page }) => {
    await page.goto("/log?status=taken");
    await expect(page).toHaveURL(/status=taken/);
    await expect(page.getByRole("heading", { name: HEADING.doseHistory })).toBeVisible();

    // The Skipped/Missed pill badges should be absent under a taken-only
    // filter.
    await expect(page.locator("text=/^Skipped$/")).toHaveCount(0);
    await expect(page.locator("text=/^Missed$/")).toHaveCount(0);
  });

  test("a search query that matches no notes shows the empty filter state", async ({ page }) => {
    await page.goto("/log?q=zzz-no-match-zzz");
    await expect(page.getByText(/no doses match these filters/i)).toBeVisible();
  });
});
