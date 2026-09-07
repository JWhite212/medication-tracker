import { test, expect, type Page } from "@playwright/test";
import { login, SEEDED_EMAIL, SEEDED_PASSWORD } from "./helpers/auth";
import { E2E_LIGHT_EMAIL, E2E_LIGHT_PASSWORD } from "../../scripts/seed-e2e";

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
  test("resolves the same token on a hard load and a client-side nav", async ({ page }) => {
    // `test.use({ contrast: "more" })` does not typecheck against Playwright
    // 1.59.1: `contrast` is a `BrowserContextOptions` / `Page.emulateMedia`
    // field, not one of `PlaywrightTestOptions` (verified against
    // node_modules/playwright/types/test.d.ts — no `contrast` key on that
    // interface). Applied here, before the first navigation, instead.
    await page.emulateMedia({ contrast: "more" });
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
    // Logs in as the DEDICATED light-mode user rather than flipping the shared
    // row. playwright.config.ts sets no `workers: 1`, so mutating the seeded
    // user's theme here would leave it on light for whatever ran next — most
    // damagingly the dark-mode axe scan in accessibility.test.ts. It is also a
    // better test: it does not depend on the appearance page's save path,
    // which is a different unit's job to prove.
    await login(page, E2E_LIGHT_EMAIL, E2E_LIGHT_PASSWORD);

    await page.emulateMedia({ colorScheme: "dark", contrast: "no-preference" });
    await page.goto("/dashboard");

    // Asserted as a resolved token, not an attribute: nothing in the app sets
    // data-theme, so the computed value IS the observable.
    expect(await token(page, "--color-surface")).toBe("#eef0f6");
  });
});
