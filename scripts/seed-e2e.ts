// Deterministic E2E seed.
//
//   tsx scripts/seed-e2e.ts
//
// Creates (or refreshes) a single seeded user with predictable data so
// the Playwright suite can rely on its presence. Idempotent: any user
// matching the seeded email or the *@e2e.medtracker.test pattern is
// deleted first, which cascades to medications, dose logs, sessions,
// and preferences.
//
// Reads E2E_DATABASE_URL when set, otherwise falls back to DATABASE_URL.
// The DB module is instantiated lazily inside getDb() so importing
// this file from Playwright's global-setup/global-teardown does not
// construct the Neon driver before the env-var guard runs.

import { eq, like, or } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { createScriptDb, loadDotEnv } from "./db";
import {
  users,
  medications,
  doseLogs,
  userPreferences,
  medicationSchedules,
} from "../src/lib/server/db/schema";
import { hashPassword } from "../src/lib/server/auth/password";

export const E2E_EMAIL = "e2e-seeded@e2e.medtracker.test";
export const E2E_PASSWORD = "e2e-medtracker-2026";
export const E2E_NAME = "E2E Seeded";
export const E2E_TZ = "Europe/London";
export const E2E_EMAIL_PATTERN = "%@e2e.medtracker.test";

// A second user, identical to the one above except `theme: "light"`. The
// light-mode accessibility scan needs its own row rather than flipping the
// shared seeded user's theme mid-suite: playwright.config.ts sets no
// `workers: 1`, so mutating the shared row would pollute whatever anon-project
// test happens to be running concurrently against the same account.
export const E2E_LIGHT_EMAIL = "e2e-light@e2e.medtracker.test";
export const E2E_LIGHT_PASSWORD = E2E_PASSWORD;
export const E2E_LIGHT_NAME = "E2E Seeded (Light)";

async function getDb() {
  loadDotEnv();
  const url = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error("Set E2E_DATABASE_URL (or DATABASE_URL) before running the E2E seed.");
  }
  return createScriptDb(url);
}

type SeedSchedule =
  | { kind: "interval"; intervalHours: string }
  | { kind: "fixed_time"; timesOfDay: string[] };

type SeedMed = {
  name: string;
  dosageAmount: string;
  dosageUnit: string;
  form: string;
  category: string;
  colour: string;
  pattern: string;
  schedule: SeedSchedule;
  inventoryCount: number;
  inventoryAlertThreshold: number;
  /** Approximate dose interval used to lay out the dose-log history. */
  approxIntervalHours: number;
  takeRate: number;
};

const SEED_MEDS: SeedMed[] = [
  {
    name: "Vitamin D",
    dosageAmount: "1000",
    dosageUnit: "IU",
    form: "tablet",
    category: "supplement",
    colour: "#f59e0b",
    pattern: "solid",
    schedule: { kind: "interval", intervalHours: "24" },
    approxIntervalHours: 24,
    inventoryCount: 60,
    inventoryAlertThreshold: 14,
    takeRate: 0.95,
  },
  {
    name: "Lisinopril",
    dosageAmount: "10",
    dosageUnit: "mg",
    form: "tablet",
    category: "prescription",
    colour: "#3b82f6",
    pattern: "solid",
    schedule: { kind: "fixed_time", timesOfDay: ["08:00"] },
    approxIntervalHours: 24,
    inventoryCount: 28,
    inventoryAlertThreshold: 7,
    takeRate: 0.92,
  },
  {
    name: "Ibuprofen",
    dosageAmount: "200",
    dosageUnit: "mg",
    form: "tablet",
    category: "otc",
    colour: "#ef4444",
    pattern: "solid",
    schedule: { kind: "interval", intervalHours: "8" },
    approxIntervalHours: 8,
    inventoryCount: 24,
    inventoryAlertThreshold: 6,
    takeRate: 0.7,
  },
];

export async function deleteE2EUsers(): Promise<number> {
  const db = await getDb();
  // Single cascading DELETE replaces the previous select+loop. The ON
  // DELETE CASCADE on the user-id foreign keys clears medications,
  // doses, sessions, etc. in the same statement.
  const deleted = await db
    .delete(users)
    .where(or(eq(users.email, E2E_EMAIL), like(users.email, E2E_EMAIL_PATTERN)))
    .returning({ id: users.id });
  return deleted.length;
}

type SeedUserOptions = {
  email: string;
  password: string;
  name: string;
  theme: "dark" | "light";
};

/**
 * Seeds one fully-populated E2E account: user row, preferences (with the
 * given theme), the three canonical medications, their schedules, and 14
 * days of synthetic dose history. Shared by the primary (dark) and light
 * seeded users so their data is identical apart from `theme`.
 */
async function seedOneUser(
  db: Awaited<ReturnType<typeof getDb>>,
  { email, password, name, theme }: SeedUserOptions,
): Promise<{ userId: string; email: string }> {
  const userId = createId();
  const passwordHash = await hashPassword(password);

  await db.insert(users).values({
    id: userId,
    email,
    name,
    passwordHash,
    timezone: E2E_TZ,
    emailVerified: true,
  });

  await db.insert(userPreferences).values({
    userId,
    accentColor: "#4f46e5",
    theme,
    timeFormat: "12h",
    dateFormat: "DD/MM/YYYY",
    uiDensity: "comfortable",
    reducedMotion: false,
    overdueEmailReminders: false,
    overduePushReminders: false,
    lowInventoryEmailAlerts: false,
    lowInventoryPushAlerts: false,
    doseLogPageSize: 20,
    heatmapPeriod: 90,
    exportFormat: "pdf",
  });

  const medRows = SEED_MEDS.map((m, idx) => ({
    id: createId(),
    userId,
    name: m.name,
    dosageAmount: m.dosageAmount,
    dosageUnit: m.dosageUnit,
    form: m.form,
    category: m.category,
    colour: m.colour,
    colourSecondary: null,
    pattern: m.pattern,
    scheduleType: "scheduled",
    scheduleIntervalHours: m.schedule.kind === "interval" ? m.schedule.intervalHours : null,
    inventoryCount: m.inventoryCount,
    inventoryAlertThreshold: m.inventoryAlertThreshold,
    sortOrder: idx,
  }));
  await db.insert(medications).values(medRows);

  const scheduleRows: Array<typeof medicationSchedules.$inferInsert> = [];
  for (let i = 0; i < SEED_MEDS.length; i++) {
    const m = SEED_MEDS[i];
    const medId = medRows[i].id;
    if (m.schedule.kind === "interval") {
      scheduleRows.push({
        id: createId(),
        medicationId: medId,
        userId,
        scheduleKind: "interval",
        intervalHours: m.schedule.intervalHours,
        timeOfDay: null,
        daysOfWeek: null,
        sortOrder: 0,
      });
    } else {
      m.schedule.timesOfDay.forEach((tod, idx) => {
        scheduleRows.push({
          id: createId(),
          medicationId: medId,
          userId,
          scheduleKind: "fixed_time",
          intervalHours: null,
          timeOfDay: tod,
          daysOfWeek: null,
          sortOrder: idx,
        });
      });
    }
  }
  if (scheduleRows.length > 0) {
    await db.insert(medicationSchedules).values(scheduleRows);
  }

  // 14 days of synthetic dose history. Mulberry32 with a fixed seed
  // keeps the suite's analytics assertions stable across runs.
  const now = new Date();
  const start = new Date(now.getTime() - 14 * 86400000);
  const doseInserts: Array<typeof doseLogs.$inferInsert> = [];
  let prngState = 17;
  const rand = () => {
    prngState = (prngState + 0x6d2b79f5) | 0;
    let t = prngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  for (let i = 0; i < SEED_MEDS.length; i++) {
    const med = SEED_MEDS[i];
    const medId = medRows[i].id;
    const intervalMs = med.approxIntervalHours * 60 * 60 * 1000;

    for (let t = start.getTime(); t < now.getTime(); t += intervalMs) {
      const jitter = Math.round((rand() - 0.5) * 40) * 60 * 1000;
      const expectedAt = new Date(t + jitter);
      if (expectedAt > now) continue;
      const status: "taken" | "skipped" = rand() < med.takeRate ? "taken" : "skipped";
      doseInserts.push({
        id: createId(),
        userId,
        medicationId: medId,
        quantity: 1,
        takenAt: expectedAt,
        loggedAt: expectedAt,
        notes: null,
        sideEffects: null,
        status,
      });
    }
  }

  const CHUNK = 200;
  for (let i = 0; i < doseInserts.length; i += CHUNK) {
    await db.insert(doseLogs).values(doseInserts.slice(i, i + CHUNK));
  }

  return { userId, email };
}

export async function seedE2EUser(): Promise<{ userId: string; email: string }> {
  await deleteE2EUsers();

  const db = await getDb();
  const primary = await seedOneUser(db, {
    email: E2E_EMAIL,
    password: E2E_PASSWORD,
    name: E2E_NAME,
    theme: "dark",
  });
  // Seeded alongside the primary user (not lazily, on first use) so that
  // global-setup's single seedE2EUser() call leaves both accounts ready
  // before any test runs.
  await seedOneUser(db, {
    email: E2E_LIGHT_EMAIL,
    password: E2E_LIGHT_PASSWORD,
    name: E2E_LIGHT_NAME,
    theme: "light",
  });

  return primary;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedE2EUser()
    .then(({ userId, email }) => {
      console.log(`Seeded E2E user ${email} (${userId})`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
