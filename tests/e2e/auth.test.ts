import { test, expect } from "@playwright/test";
import { registerUser, login, SEEDED_EMAIL, SEEDED_PASSWORD } from "./helpers/auth";
import { SEL, HEADING } from "./helpers/selectors";

test.describe("authentication", () => {
  test("registering a new user redirects to the empty dashboard", async ({ page }) => {
    await registerUser(page);
    await expect(page).toHaveURL(/\/dashboard$/);
    // A brand-new account has no medications, so the onboarding surface
    // ("No medications yet") should be visible.
    await expect(page.getByText(/no medications yet/i)).toBeVisible();
  });

  test("the seeded user can log in with the canonical credentials", async ({ page }) => {
    await login(page, SEEDED_EMAIL, SEEDED_PASSWORD);
    await expect(page.getByRole("heading", { name: HEADING.dashboard })).toBeVisible();
  });

  test("login fails on bad password and shows the standard error", async ({ page }) => {
    await page.goto("/auth/login");
    await page.locator(SEL.emailInput).fill(SEEDED_EMAIL);
    await page.locator(SEL.passwordInput).fill("definitely-not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/auth\/login/);
    await expect(page.getByText(/invalid email or password/i)).toBeVisible();
  });

  test("logged-out access to /dashboard redirects to login", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/auth\/login/);
  });
});
