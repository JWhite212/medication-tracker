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
// The environment variable must be set before importing the db module.

import { eq, like, or } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";

if (process.env.E2E_DATABASE_URL && !process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.E2E_DATABASE_URL;
}

const { db } = await import("../src/lib/server/db");
const { users, medications, doseLogs, userPreferences, medicationSchedules } =
  await import("../src/lib/server/db/schema");
const { hashPassword } = await import("../src/lib/server/auth/password");

export const E2E_EMAIL = "e2e-seeded@e2e.medtracker.test";
export const E2E_PASSWORD = "e2e-medtracker-2026";
export const E2E_NAME = "E2E Seeded";
export const E2E_TZ = "Europe/London";
export const E2E_EMAIL_PATTERN = "%@e2e.medtracker.test";

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
  const matches = await db
    .select({ id: users.id })
    .from(users)
    .where(or(eq(users.email, E2E_EMAIL), like(users.email, E2E_EMAIL_PATTERN)));
  for (const u of matches) {
    await db.delete(users).where(eq(users.id, u.id));
  }
  return matches.length;
}

export async function seedE2EUser(): Promise<{ userId: string; email: string }> {
  await deleteE2EUsers();

  const userId = createId();
  const passwordHash = await hashPassword(E2E_PASSWORD);

  await db.insert(users).values({
    id: userId,
    email: E2E_EMAIL,
    name: E2E_NAME,
    passwordHash,
    timezone: E2E_TZ,
    emailVerified: true,
  });

  await db.insert(userPreferences).values({
    userId,
    accentColor: "#6366f1",
    timeFormat: "12h",
    dateFormat: "DD/MM/YYYY",
    uiDensity: "comfortable",
    reducedMotion: false,
    emailReminders: false,
    lowInventoryAlerts: true,
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

  return { userId, email: E2E_EMAIL };
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
