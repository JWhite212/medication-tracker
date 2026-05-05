import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { SEL, HEADING } from "./selectors";

export const SEEDED_EMAIL = "e2e-seeded@e2e.medtracker.test";
export const SEEDED_PASSWORD = "e2e-medtracker-2026";

/**
 * Build a unique email under the e2e test domain so the global-teardown
 * picks it up regardless of which test created it.
 */
export function uniqueEmail(prefix = "user"): string {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${stamp}-${rand}@e2e.medtracker.test`;
}

/**
 * Submit the login form. Asserts redirect to /dashboard on success;
 * caller is responsible for any failure-path assertions.
 */
export async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/auth/login");
  await page.locator(SEL.emailInput).fill(email);
  await page.locator(SEL.passwordInput).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: HEADING.dashboard })).toBeVisible();
}

/**
 * Submit the register form including the required disclaimer checkbox.
 * Returns the credentials used so the caller can re-login if needed.
 */
export async function registerUser(
  page: Page,
  options: { email?: string; password?: string; name?: string } = {},
): Promise<{ email: string; password: string; name: string }> {
  const email = options.email ?? uniqueEmail();
  const password = options.password ?? "e2e-strong-pass-2026";
  const name = options.name ?? "E2E Tester";

  await page.goto("/auth/register");
  await page.locator(SEL.nameInput).fill(name);
  await page.locator(SEL.emailInput).fill(email);
  await page.locator(SEL.passwordInput).fill(password);
  await page.locator(SEL.disclaimerCheckbox).check();
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/dashboard$/);
  return { email, password, name };
}
