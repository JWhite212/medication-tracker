import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { login, SEEDED_EMAIL, SEEDED_PASSWORD } from "./helpers/auth";

// Only fail on serious or critical issues. Minor / moderate issues are
// surfaced in the report but don't gate the build — the site is still
// being polished and chasing every Tailwind contrast warning would
// produce noise without value.
const BLOCKING_SEVERITY = ["serious", "critical"] as const;

async function scan(page: import("@playwright/test").Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter((v) => BLOCKING_SEVERITY.includes(v.impact as never));
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
  });
});
