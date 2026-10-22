// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * The counts the confirmation dialog states ("This deletes 1,204 doses for 6
 * medications."), from the page loads that supply them.
 *
 * PGlite, not fake-db: `count(distinct …)`, the join to archived medications
 * and the per-user scope are SQL semantics a fixture cannot evaluate
 * (CLAUDE.md's test-seam rule). A fake would hand back whatever it was
 * seeded with, whichever of those three the query got wrong. The same goes
 * for the providers the sign-in prompt offers: the user's own oauth_accounts
 * rows, filtered by what this deployment has configured.
 */

vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);
vi.mock("$lib/server/auth/lucia", () => ({ lucia: {} }));
// Google configured, GitHub not: a linked GitHub account must not be offered.
vi.mock("$env/dynamic/private", () => ({
  env: { GOOGLE_CLIENT_ID: "google-id", GOOGLE_CLIENT_SECRET: "google-secret" },
}));
vi.mock("$lib/server/preferences", () => ({
  getOrCreatePreferences: async () => ({ exportFormat: "pdf" }),
  updatePreferences: async () => ({}),
}));

import { pgDb } from "../helpers/pg-db";
import { oauthAccounts } from "../../../src/lib/server/db/schema";

/** Signed in a moment ago, as the deleting user's session would be. */
const locals = (id: string, authenticatedAt: Date | null = new Date()) => ({
  user: { id },
  session: { id: "s1", authenticatedAt },
});

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
    const data = await privacyLoad({ locals: locals("u1") } as never);
    expect(data).toMatchObject({
      counts: {
        doseLogs: 5,
        doseMedications: 2,
        activeMedications: 2,
        archivedMedications: 1,
        archivedDoses: 2,
      },
      confirmation: { kind: "recentSignIn", recent: true, providers: [] },
    });
  });

  it("asks a password account for its password", async () => {
    await pgDb.seedUser({ id: "u3", email: "u3@example.com", passwordHash: "$argon2id$x" });
    expect(await privacyLoad({ locals: locals("u3") } as never)).toMatchObject({
      confirmation: { kind: "password" },
    });
  });

  it("offers this user's linked providers that are configured here, and says when the sign-in is old", async () => {
    await pgDb.db.insert(oauthAccounts).values([
      { provider: "github", providerUserId: "gh-1", userId: "u1" },
      { provider: "google", providerUserId: "g-1", userId: "u1" },
      { provider: "google", providerUserId: "g-2", userId: "u2" },
    ]);
    expect(await privacyLoad({ locals: locals("u1", null) } as never)).toMatchObject({
      confirmation: { kind: "recentSignIn", recent: false, providers: ["google"] },
    });
    // u2's own Google link, not u1's GitHub one.
    expect(await privacyLoad({ locals: locals("u2") } as never)).toMatchObject({
      confirmation: { kind: "recentSignIn", recent: true, providers: ["google"] },
    });
  });
});

describe("data load", () => {
  it("counts what deleting the account removes", async () => {
    expect(await dataLoad({ locals: locals("u1") } as never)).toMatchObject({
      counts: { medications: 3, doses: 5 },
      confirmation: { kind: "recentSignIn", recent: true, providers: [] },
    });
  });
});
