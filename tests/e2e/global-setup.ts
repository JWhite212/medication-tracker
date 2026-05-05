import { chromium, type FullConfig } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { seedE2EUser, E2E_EMAIL, E2E_PASSWORD } from "../../scripts/seed-e2e";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const SEEDED_STORAGE_STATE = resolve(__dirname, ".auth/seeded.json");

export default async function globalSetup(config: FullConfig): Promise<void> {
  if (!process.env.DATABASE_URL && !process.env.E2E_DATABASE_URL) {
    throw new Error("E2E setup needs DATABASE_URL or E2E_DATABASE_URL to seed the test user.");
  }

  await seedE2EUser();

  const baseURL = config.projects[0]?.use?.baseURL ?? "http://localhost:5173";
  const browser = await chromium.launch();
  // Try/finally guards against Chromium leaking when any of the auth
  // steps below throws (Vite dev not yet ready, login form regression,
  // mkdir EACCES, etc.).
  try {
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();

    await page.goto("/auth/login");
    await page.locator('input[name="email"]').fill(E2E_EMAIL);
    await page.locator('input[name="password"]').fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/dashboard$/);

    await mkdir(dirname(SEEDED_STORAGE_STATE), { recursive: true });
    await context.storageState({ path: SEEDED_STORAGE_STATE });
  } finally {
    await browser.close();
  }
}
