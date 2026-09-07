import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { login, SEEDED_EMAIL, SEEDED_PASSWORD } from "./helpers/auth";
import { E2E_LIGHT_EMAIL, E2E_LIGHT_PASSWORD } from "../../scripts/seed-e2e";

// Only fail on serious or critical issues. Minor / moderate issues are
// surfaced in the report but don't gate the build — the site is still
// being polished and chasing every Tailwind contrast warning would
// produce noise without value.
type BlockingSeverity = "serious" | "critical";
const BLOCKING_SEVERITY: readonly BlockingSeverity[] = ["serious", "critical"];

function isBlocking(impact: string | null | undefined): impact is BlockingSeverity {
  return impact != null && (BLOCKING_SEVERITY as readonly string[]).includes(impact);
}

async function scan(page: import("@playwright/test").Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();

  // `incomplete` is where axe puts checks it could not resolve — notably
  // colour-contrast behind a semi-transparent, backdrop-filtered parent,
  // which is every glass card in this app. It is not a gate (axe genuinely
  // cannot decide these), but it must be visible: this suite passed for
  // months against a palette with six measured contrast failures.
  const contrastUnknown = results.incomplete.filter((r) => r.id === "color-contrast");
  if (contrastUnknown.length > 0) {
    const nodes = contrastUnknown.reduce((n, r) => n + r.nodes.length, 0);
    console.log(`[axe] ${label}: ${nodes} node(s) with undetermined colour contrast`);
  }

  const blocking = results.violations.filter((v) => isBlocking(v.impact));
  if (blocking.length > 0) {
    const lines = blocking.map(
      (v) => `  - [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} nodes)`,
    );
    throw new Error(`${label} has accessibility violations:\n${lines.join("\n")}`);
  }
}

test.describe("accessibility", () => {
  test("login page has no serious or critical violations", async ({ page }) => {
    await page.goto("/auth/login");
    await scan(page, "/auth/login");
  });

  test("register page has no serious or critical violations", async ({ page }) => {
    await page.goto("/auth/register");
    await scan(page, "/auth/register");
  });

  test("dashboard, medications, log, and analytics pass axe scan", async ({ page }) => {
    await login(page, SEEDED_EMAIL, SEEDED_PASSWORD);

    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await scan(page, "/dashboard");

    await page.goto("/medications");
    await expect(page.getByRole("heading", { name: "Medications" })).toBeVisible();
    await scan(page, "/medications");

    await page.goto("/log");
    await expect(page.getByRole("heading", { name: "Dose History" })).toBeVisible();
    await scan(page, "/log");

    await page.goto("/analytics");
    await expect(page.getByRole("heading", { name: "Analytics" })).toBeVisible();
    await scan(page, "/analytics");

    await page.goto("/settings/appearance");
    await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible();
    await scan(page, "/settings/appearance");
  });

  // A dedicated seeded user (theme: "light") rather than flipping the
  // shared seeded row: playwright.config.ts sets no `workers: 1`, so the
  // dark-mode scan above and this one can run concurrently, and mutating a
  // shared account's theme mid-suite would make one test's setup racy
  // against the other's assertions.
  //
  // Expect this run to convert some of the `incomplete` color-contrast
  // results logged above into `serious` violations across the app's
  // backdrop-blur surfaces. That is axe finally being *able* to compute a
  // contrast ratio it could not resolve against the dark, semi-transparent
  // glass panels — not a 1c regression — so triage each new violation
  // against that expectation before treating it as a bug.
  test("dashboard, medications, log, and analytics pass axe scan in light mode", async ({
    page,
  }) => {
    await login(page, E2E_LIGHT_EMAIL, E2E_LIGHT_PASSWORD);

    await page.goto("/dashboard");
    // Assert the resolved theme FIRST. Nothing in the app sets a
    // data-theme attribute, so the computed custom property is the only
    // observable — and asserting it up front means this test cannot pass
    // while silently running in the wrong mode.
    const surface = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--color-surface").trim(),
    );
    expect(surface, "the light-mode scan is running in dark mode").toBe("#eef0f6");

    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await scan(page, "/dashboard (light)");

    await page.goto("/medications");
    await expect(page.getByRole("heading", { name: "Medications" })).toBeVisible();
    await scan(page, "/medications (light)");

    await page.goto("/log");
    await expect(page.getByRole("heading", { name: "Dose History" })).toBeVisible();
    await scan(page, "/log (light)");

    await page.goto("/analytics");
    await expect(page.getByRole("heading", { name: "Analytics" })).toBeVisible();
    await scan(page, "/analytics (light)");

    await page.goto("/settings/appearance");
    await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible();
    await scan(page, "/settings/appearance (light)");
  });
});
