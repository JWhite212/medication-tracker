import { test, expect, type Page } from "@playwright/test";
import { login, SEEDED_EMAIL, SEEDED_PASSWORD } from "./helpers/auth";

/**
 * The `:root:root` specificity fix exists for a divergence no unit test can
 * see: on the SSR path SvelteKit emits rendered head content BEFORE
 * stylesheet links, so at equal specificity the stylesheet's unlayered
 * `prefers-contrast` block wins; on a client-side navigation Svelte appends
 * the theme block after it, and the theme wins. Same user, same URL — a
 * plain F5 used to flip the palette, and on the SSR path the losing side was
 * the accessible one.
 */
const token = (page: Page, name: string) =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

test.describe("theme resolution", () => {
  // `test.use({ contrast: "more" })` does not typecheck against Playwright
  // 1.59.1: `contrast` is a `BrowserContextOptions` / `Page.emulateMedia`
  // field, not one of `PlaywrightTestOptions` (verified against
  // node_modules/playwright/types/test.d.ts — no `contrast` key on that
  // interface). Applying it in `beforeEach`, before each test's first
  // navigation, reproduces the same effect.
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ contrast: "more" });
  });

  test("resolves the same token on a hard load and a client-side nav", async ({ page }) => {
    await login(page, SEEDED_EMAIL, SEEDED_PASSWORD);

    await page.goto("/dashboard");
    const onLoad = await token(page, "--color-text-secondary");

    await page.goto("/medications");
    await page
      .getByRole("link", { name: /dashboard/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/dashboard/);
    const onNav = await token(page, "--color-text-secondary");

    expect(onLoad).toBe(onNav);
    // The high-contrast arm must win over the base, in both directions.
    expect(onLoad).toBe("#d4d4e0");
  });

  test("an explicit light theme beats a dark OS preference", async ({ page }) => {
    await login(page, SEEDED_EMAIL, SEEDED_PASSWORD);
    await page.goto("/settings/appearance");
    await page.selectOption("#theme", "light");
    await expect(page.locator("#theme")).toHaveValue("light");

    await page.emulateMedia({ colorScheme: "dark", contrast: "no-preference" });
    await page.goto("/dashboard");

    // Asserted as a resolved token, not as an attribute: nothing in the app
    // sets data-theme, so the computed value IS the observable.
    expect(await token(page, "--color-surface")).toBe("#eef0f6");
  });
});
