import { test, expect, type Page } from "@playwright/test";
import { SEEDED_EMAIL } from "./helpers/auth";
import {
  getUserIdByEmail,
  getMedicationIdByName,
  getSchedulesForMedication,
  deleteMedicationCascade,
} from "./helpers/db";

// Unique names keep tests safely parallelisable and independent of run
// order: each test owns the row it creates and deletes.
function uniqueMedName(prefix: string): string {
  return `${prefix}-${Date.now().toString(36).slice(-6)}-${Math.random().toString(36).slice(2, 5)}`;
}

async function fillRequiredFields(
  page: Page,
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

test.describe("schedule editor", () => {
  test("creates a fixed-time daily schedule (no day restriction)", async ({ page }) => {
    const userId = await getUserIdByEmail(SEEDED_EMAIL);
    expect(userId).not.toBeNull();

    const name = uniqueMedName("FixedDaily");
    let medId: string | null = null;
    try {
      await page.goto("/medications/new");
      await fillRequiredFields(page, name, "10", "mg", "tablet", "supplement");
      await page.getByRole("button", { name: "Fixed time" }).click();
      await page.getByLabel("Time of day 1").fill("08:00");
      await page.getByRole("button", { name: "Add Medication" }).click();

      // Server redirects to /medications on success — wait for that
      // before reading the DB so we don't race the transaction.
      await expect(page).toHaveURL(/\/medications$/);
      await expect(page.getByText(name)).toBeVisible();

      medId = await getMedicationIdByName(userId!, name);
      expect(medId).not.toBeNull();
      const schedules = await getSchedulesForMedication(medId!);
      expect(schedules).toHaveLength(1);
      expect(schedules[0].scheduleKind).toBe("fixed_time");
      expect(schedules[0].timeOfDay).toBe("08:00");
      // No days selected → stored as null (every day).
      expect(schedules[0].daysOfWeek == null || schedules[0].daysOfWeek.length === 0).toBe(true);
      expect(schedules[0].intervalHours).toBeNull();
    } finally {
      if (medId) await deleteMedicationCascade(medId);
    }
  });

  test("creates an interval schedule (every 8h)", async ({ page }) => {
    const userId = await getUserIdByEmail(SEEDED_EMAIL);
    expect(userId).not.toBeNull();

    const name = uniqueMedName("Interval8h");
    let medId: string | null = null;
    try {
      await page.goto("/medications/new");
      await fillRequiredFields(page, name, "200", "mg", "tablet", "prescription");
      // Interval is the default mode; the input is already exposed.
      await page.getByLabel("Every N hours").fill("8");
      await page.getByRole("button", { name: "Add Medication" }).click();

      await expect(page).toHaveURL(/\/medications$/);
      await expect(page.getByText(name)).toBeVisible();

      medId = await getMedicationIdByName(userId!, name);
      expect(medId).not.toBeNull();
      const schedules = await getSchedulesForMedication(medId!);
      expect(schedules).toHaveLength(1);
      expect(schedules[0].scheduleKind).toBe("interval");
      // Drizzle `numeric` columns surface as strings in JS — see
      // CLAUDE.md gotcha. Coerce on the assertion side.
      expect(Number(schedules[0].intervalHours)).toBe(8);
      expect(schedules[0].timeOfDay).toBeNull();
      expect(schedules[0].daysOfWeek).toBeNull();
    } finally {
      if (medId) await deleteMedicationCascade(medId);
    }
  });

  test("creates a PRN schedule (as-needed)", async ({ page }) => {
    const userId = await getUserIdByEmail(SEEDED_EMAIL);
    expect(userId).not.toBeNull();

    const name = uniqueMedName("PRN");
    let medId: string | null = null;
    try {
      await page.goto("/medications/new");
      await fillRequiredFields(page, name, "50", "mg", "tablet", "otc");
      await page.getByRole("button", { name: "As needed (PRN)" }).click();
      await page.getByRole("button", { name: "Add Medication" }).click();

      await expect(page).toHaveURL(/\/medications$/);
      await expect(page.getByText(name)).toBeVisible();

      medId = await getMedicationIdByName(userId!, name);
      expect(medId).not.toBeNull();
      // PRN persists as a single schedule row (see buildScheduleRows
      // in src/lib/server/schedules.ts) — kind "prn", all other
      // schedule-detail columns null.
      const schedules = await getSchedulesForMedication(medId!);
      expect(schedules).toHaveLength(1);
      expect(schedules[0].scheduleKind).toBe("prn");
      expect(schedules[0].timeOfDay).toBeNull();
      expect(schedules[0].intervalHours).toBeNull();
      expect(schedules[0].daysOfWeek).toBeNull();
    } finally {
      if (medId) await deleteMedicationCascade(medId);
    }
  });

  test("editing a fixed-time medication restricts days to Mon/Wed/Fri", async ({ page }) => {
    const userId = await getUserIdByEmail(SEEDED_EMAIL);
    expect(userId).not.toBeNull();

    const name = uniqueMedName("MWF");
    let medId: string | null = null;
    try {
      // Step 1: create a fixed-time daily medication (no day filter).
      await page.goto("/medications/new");
      await fillRequiredFields(page, name, "5", "mg", "capsule", "prescription");
      await page.getByRole("button", { name: "Fixed time" }).click();
      await page.getByLabel("Time of day 1").fill("09:00");
      await page.getByRole("button", { name: "Add Medication" }).click();
      await expect(page).toHaveURL(/\/medications$/);
      await expect(page.getByText(name)).toBeVisible();

      medId = await getMedicationIdByName(userId!, name);
      expect(medId).not.toBeNull();

      // Step 2: open the edit page and toggle Mon/Wed/Fri.
      await page.goto(`/medications/${medId}`);
      await page.getByRole("button", { name: "Mon", exact: true }).click();
      await page.getByRole("button", { name: "Wed", exact: true }).click();
      await page.getByRole("button", { name: "Fri", exact: true }).click();
      await page.getByRole("button", { name: "Update Medication" }).click();

      await expect(page).toHaveURL(/\/medications$/);

      // Step 3: assert the schedule row reflects [1,3,5] (Sun=0).
      const schedules = await getSchedulesForMedication(medId!);
      expect(schedules).toHaveLength(1);
      expect(schedules[0].scheduleKind).toBe("fixed_time");
      expect(schedules[0].timeOfDay).toBe("09:00");
      expect(schedules[0].daysOfWeek).toEqual([1, 3, 5]);
    } finally {
      if (medId) await deleteMedicationCascade(medId);
    }
  });
});
