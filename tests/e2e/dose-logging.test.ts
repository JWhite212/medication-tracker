import { test, expect } from "@playwright/test";
import { SEEDED_EMAIL } from "./helpers/auth";
import { getUserIdByEmail, getInventoryCount, countDoseLogs } from "./helpers/db";

const VITAMIN_D = "Vitamin D";

async function getMedIdByName(userId: string, name: string): Promise<string> {
  const { db } = await import("../../src/lib/server/db");
  const { medications } = await import("../../src/lib/server/db/schema");
  const { eq, and } = await import("drizzle-orm");
  const [row] = await db
    .select({ id: medications.id })
    .from(medications)
    .where(and(eq(medications.userId, userId), eq(medications.name, name)))
    .limit(1);
  if (!row) throw new Error(`No medication ${name} for user ${userId}`);
  return row.id;
}

test.describe("dose logging", () => {
  test("logging a dose via QuickLogBar decrements inventory by one", async ({ page }) => {
    const userId = await getUserIdByEmail(SEEDED_EMAIL);
    expect(userId).not.toBeNull();
    const medId = await getMedIdByName(userId!, VITAMIN_D);
    const before = await getInventoryCount(userId!, VITAMIN_D);
    expect(before).not.toBeNull();

    await page.goto("/dashboard");
    // The chip's form, found by medication id. A Due card can name Vitamin D
    // too, and its "Took it at" records a past instant, so matching a button
    // by its visible name could press the wrong control.
    await page
      .locator(`form[data-quick-log]:has(input[name="medicationId"][value="${medId}"])`)
      .locator('button[type="submit"]')
      .click();

    // The toast confirms the server round trip; wait for it before reading
    // the DB so we don't race the transaction. Scoped to the toast region:
    // "logged" also appears in the page's own copy ("Nothing logged yet
    // today", "2 doses logged today").
    await expect(page.getByRole("status").getByText(/logged at/i)).toBeVisible();

    const after = await getInventoryCount(userId!, VITAMIN_D);
    expect(after).toBe((before ?? 0) - 1);
  });

  test("deleting a taken dose restores inventory", async ({ page }) => {
    const userId = await getUserIdByEmail(SEEDED_EMAIL);
    expect(userId).not.toBeNull();
    const medId = await getMedIdByName(userId!, VITAMIN_D);

    await page.goto(`/log?status=taken&medication=${medId}`);

    const before = await getInventoryCount(userId!, VITAMIN_D);
    const beforeCount = await countDoseLogs(userId!, VITAMIN_D, "taken");
    expect(beforeCount).toBeGreaterThan(0);

    // One tap: × deletes at once and the toast offers Undo. It used to open
    // an inline confirmation, which existed only because nothing could put a
    // deleted dose back.
    const deleteButton = page.getByRole("button", { name: "Delete dose" }).first();
    // × is an inert type="button" until the row has hydrated, so a click
    // before then does nothing (TimelineEntry). Wait for the submit.
    await expect(deleteButton).toHaveAttribute("type", "submit");
    await deleteButton.click();
    await expect(page.getByText(/dose removed/i)).toBeVisible();

    const after = await getInventoryCount(userId!, VITAMIN_D);
    const afterCount = await countDoseLogs(userId!, VITAMIN_D, "taken");
    expect(afterCount).toBe(beforeCount - 1);
    expect(after).toBe((before ?? 0) + 1);
  });

  test("deleting a skipped dose does not restore inventory", async ({ page }) => {
    const userId = await getUserIdByEmail(SEEDED_EMAIL);
    expect(userId).not.toBeNull();
    const skippedBefore = await countDoseLogs(userId!, VITAMIN_D, "skipped");
    test.skip(skippedBefore === 0, "no skipped Vitamin D doses in seed");

    const medId = await getMedIdByName(userId!, VITAMIN_D);
    await page.goto(`/log?status=skipped&medication=${medId}`);

    const inventoryBefore = await getInventoryCount(userId!, VITAMIN_D);
    const deleteButton = page.getByRole("button", { name: "Delete dose" }).first();
    // Inert until hydrated: see the test above.
    await expect(deleteButton).toHaveAttribute("type", "submit");
    await deleteButton.click();
    await expect(page.getByText(/dose removed/i)).toBeVisible();

    const inventoryAfter = await getInventoryCount(userId!, VITAMIN_D);
    const skippedAfter = await countDoseLogs(userId!, VITAMIN_D, "skipped");
    expect(skippedAfter).toBe(skippedBefore - 1);
    expect(inventoryAfter).toBe(inventoryBefore);
  });

  test("Undo after a one-tap delete brings the same dose, and its stock, back", async ({
    page,
  }) => {
    const userId = await getUserIdByEmail(SEEDED_EMAIL);
    expect(userId).not.toBeNull();
    const medId = await getMedIdByName(userId!, VITAMIN_D);

    await page.goto(`/log?status=taken&medication=${medId}`);

    const before = await getInventoryCount(userId!, VITAMIN_D);
    const beforeCount = await countDoseLogs(userId!, VITAMIN_D, "taken");
    expect(beforeCount).toBeGreaterThan(0);

    // By the row's own id: × is named by time of day only, and another day's
    // dose at the same time would satisfy a check by name.
    const row = page.locator("[data-dose-id]").first();
    const doseId = await row.getAttribute("data-dose-id");
    expect(doseId).not.toBeNull();

    const deleteButton = row.getByRole("button", { name: "Delete dose" });
    // Inert until hydrated: a click before then would send nothing.
    await expect(deleteButton).toHaveAttribute("type", "submit");
    await deleteButton.click();
    await expect(page.getByText(/dose removed/i)).toBeVisible();
    await expect(page.locator(`[data-dose-id="${doseId}"]`)).toHaveCount(0);
    expect(await countDoseLogs(userId!, VITAMIN_D, "taken")).toBe(beforeCount - 1);

    // The offer's button is named "Undo" plus its message (aria-labelledby).
    await page.getByRole("button", { name: /^Undo Dose removed/ }).click();
    await expect(page.getByText("Dose restored")).toBeVisible();
    // A restore puts back the same id.
    await expect(page.locator(`[data-dose-id="${doseId}"]`)).toHaveCount(1);

    expect(await countDoseLogs(userId!, VITAMIN_D, "taken")).toBe(beforeCount);
    expect(await getInventoryCount(userId!, VITAMIN_D)).toBe(before);
  });

  test("editing a dose's notes persists across reload", async ({ page }) => {
    const userId = await getUserIdByEmail(SEEDED_EMAIL);
    const medId = await getMedIdByName(userId!, VITAMIN_D);
    const note = `e2e-note-${Date.now().toString(36)}`;

    await page.goto(`/log?status=taken&medication=${medId}`);
    // Click the entry (not the inline buttons) to open the edit modal.
    await page.getByRole("listitem").first().click();
    await page.getByLabel("Notes").fill(note);
    await page.getByRole("button", { name: "Save Changes" }).click();
    await expect(page.getByText(/dose updated/i)).toBeVisible();

    await page.reload();
    await expect(page.getByText(note)).toBeVisible();
  });
});
