// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * The counts the confirmation dialog states ("This deletes 1,204 doses for 6
 * medications."), from the page loads that supply them.
 *
 * PGlite, not fake-db: `count(distinct …)`, the join to archived medications
 * and the per-user scope are SQL semantics a fixture cannot evaluate
 * (CLAUDE.md's test-seam rule). A fake would hand back whatever it was
 * seeded with, whichever of those three the query got wrong.
 */

vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);
vi.mock("$lib/server/auth/lucia", () => ({ lucia: {} }));
vi.mock("$lib/server/preferences", () => ({
  getOrCreatePreferences: async () => ({ exportFormat: "pdf" }),
  updatePreferences: async () => ({}),
}));

import { pgDb } from "../helpers/pg-db";

const { load: privacyLoad } =
  await import("../../../src/routes/(app)/settings/privacy/+page.server");
const { load: dataLoad } = await import("../../../src/routes/(app)/settings/data/+page.server");

beforeEach(async () => {
  await pgDb.reset();
  await pgDb.seedUser({ id: "u1", email: "u1@example.com" });
  await pgDb.seedUser({ id: "u2", email: "u2@example.com" });
  await pgDb.seedMedication({ id: "m1", userId: "u1" });
  await pgDb.seedMedication({ id: "m2", userId: "u1", isArchived: true });
  await pgDb.seedMedication({ id: "m3", userId: "u1" });
  await pgDb.seedMedication({ id: "m4", userId: "u2", isArchived: true });
  for (let i = 0; i < 3; i++) await pgDb.seedDose({ medicationId: "m1" });
  for (let i = 0; i < 2; i++) await pgDb.seedDose({ medicationId: "m2" });
  for (let i = 0; i < 4; i++) await pgDb.seedDose({ medicationId: "m4", userId: "u2" });
});

describe("privacy load", () => {
  it("counts the dose history and the medications it spans, for this user only", async () => {
    const data = await privacyLoad({ locals: { user: { id: "u1" } } } as never);
    expect(data).toMatchObject({
      counts: {
        doseLogs: 5,
        doseMedications: 2,
        activeMedications: 2,
        archivedMedications: 1,
        archivedDoses: 2,
      },
      hasPassword: false,
    });
  });

  it("reports hasPassword for an account with a hash", async () => {
    await pgDb.seedUser({ id: "u3", email: "u3@example.com", passwordHash: "$argon2id$x" });
    expect(
      ((await privacyLoad({ locals: { user: { id: "u3" } } } as never)) as { hasPassword: boolean })
        .hasPassword,
    ).toBe(true);
  });
});

describe("data load", () => {
  it("counts what deleting the account removes", async () => {
    expect(await dataLoad({ locals: { user: { id: "u1" } } } as never)).toMatchObject({
      counts: { medications: 3, doses: 5 },
      hasPassword: false,
    });
  });
});
