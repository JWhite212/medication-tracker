import { test, expect } from "@playwright/test";

test("login page loads", async ({ page }) => {
  await page.goto("/auth/login");
  await expect(page.locator("h1")).toHaveText("Welcome back");
  await expect(page.locator('input[name="email"]')).toBeVisible();
  await expect(page.locator('input[name="password"]')).toBeVisible();
});

test("register page loads", async ({ page }) => {
  await page.goto("/auth/register");
  await expect(page.locator("h1")).toHaveText("Create account");
});

test("unauthenticated redirect to login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/.*\/auth\/login/);
});
