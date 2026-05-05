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
    const before = await getInventoryCount(userId!, VITAMIN_D);
    expect(before).not.toBeNull();

    await page.goto("/dashboard");
    await page
      .getByRole("button", { name: new RegExp(`^${VITAMIN_D} `) })
      .first()
      .click();

    // The toast confirms server roundtrip; wait for it before reading
    // the DB so we don't race the transaction.
    await expect(page.getByText(/logged/i)).toBeVisible();

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

    await page.getByRole("button", { name: "Delete dose" }).first().click();
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
    await page.getByRole("button", { name: "Delete dose" }).first().click();
    await expect(page.getByText(/dose removed/i)).toBeVisible();

    const inventoryAfter = await getInventoryCount(userId!, VITAMIN_D);
    const skippedAfter = await countDoseLogs(userId!, VITAMIN_D, "skipped");
    expect(skippedAfter).toBe(skippedBefore - 1);
    expect(inventoryAfter).toBe(inventoryBefore);
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
