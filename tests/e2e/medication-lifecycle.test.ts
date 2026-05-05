import { test, expect } from "@playwright/test";
import { HEADING } from "./helpers/selectors";

// Each test uses a unique medication name so they don't collide if
// re-run against the same seeded user without a teardown in between.
function uniqueMedName(prefix: string): string {
  return `${prefix}-${Date.now().toString(36).slice(-6)}-${Math.random().toString(36).slice(2, 5)}`;
}

async function fillCommonFields(
  page: import("@playwright/test").Page,
  name: string,
  amount: string,
  unit: string,
  form: string,
  category: string,
): Promise<void> {
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Dosage Amount").fill(amount);
  await page.getByLabel("Dosage Unit").fill(unit);
  await page.getByLabel("Form").selectOption(form);
  await page.getByLabel("Category").selectOption(category);
}

test.describe("medication lifecycle", () => {
  test("can add an interval-scheduled medication", async ({ page }) => {
    const name = uniqueMedName("Interval");

    await page.goto("/medications/new");
    await expect(page.getByRole("heading", { name: HEADING.addMedication })).toBeVisible();

    await fillCommonFields(page, name, "250", "mg", "tablet", "supplement");
    // Interval is the default schedule mode; the input is exposed only
    // when interval is selected.
    await page.getByLabel("Every N hours").fill("12");
    await page.getByRole("button", { name: "Add Medication" }).click();

    await expect(page).toHaveURL(/\/medications$/);
    await expect(page.getByText(name)).toBeVisible();
  });

  test("can add a fixed-time medication", async ({ page }) => {
    const name = uniqueMedName("Fixed");

    await page.goto("/medications/new");
    await fillCommonFields(page, name, "5", "mg", "capsule", "prescription");
    await page.getByRole("button", { name: "Fixed time" }).click();
    await page.getByLabel("Time of day 1").fill("09:30");
    await page.getByRole("button", { name: "Add Medication" }).click();

    await expect(page).toHaveURL(/\/medications$/);
    await expect(page.getByText(name)).toBeVisible();
  });

  test("editing a medication updates its name on the list", async ({ page }) => {
    const original = uniqueMedName("Original");
    const renamed = `${original}-renamed`;

    await page.goto("/medications/new");
    await fillCommonFields(page, original, "100", "mg", "tablet", "otc");
    await page.getByLabel("Every N hours").fill("24");
    await page.getByRole("button", { name: "Add Medication" }).click();
    await expect(page.getByText(original)).toBeVisible();

    await page.getByText(original).first().click();
    await page.getByLabel("Name").fill(renamed);
    await page.getByRole("button", { name: "Update Medication" }).click();
    await expect(page).toHaveURL(/\/medications$/);
    await expect(page.getByText(renamed)).toBeVisible();
  });

  test("archiving a medication moves it under Archived", async ({ page }) => {
    const name = uniqueMedName("Archivable");

    await page.goto("/medications/new");
    await fillCommonFields(page, name, "50", "mg", "tablet", "otc");
    await page.getByLabel("Every N hours").fill("24");
    await page.getByRole("button", { name: "Add Medication" }).click();

    await page.getByText(name).first().click();
    await page.getByRole("button", { name: /archive/i }).click();
    await expect(page).toHaveURL(/\/medications$/);

    // The Archived disclosure is a <details> on the medications list.
    const archived = page.locator("details", { hasText: /^Archived/ });
    await archived.first().click();
    await expect(archived.getByText(name)).toBeVisible();
  });
});
