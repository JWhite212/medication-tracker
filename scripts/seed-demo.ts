// Demo account seed.
//
//   tsx scripts/seed-demo.ts
//
// Creates (or refreshes) the demo@medtracker.app account with
// realistic medications and ~30 days of dose history. Idempotent —
// the existing demo user is deleted first, which cascade-clears
// medications, dose logs, sessions, and preferences.
//
// Credentials are intentionally fixed and visible in the repo; the
// account is read-only-in-spirit and may be reset on every deploy.

import { eq } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { db } from "../src/lib/server/db";
import {
  users,
  medications,
  doseLogs,
  userPreferences,
  medicationSchedules,
} from "../src/lib/server/db/schema";
import { hashPassword } from "../src/lib/server/auth/password";

const DEMO_EMAIL = "demo@medtracker.app";
const DEMO_PASSWORD = "demo-medtracker-2026";
const DEMO_NAME = "Demo User";
const DEMO_TZ = "Europe/London";

type SeedSchedule =
  | { kind: "interval"; intervalHours: string }
  | { kind: "fixed_time"; timesOfDay: string[]; daysOfWeek?: number[] };

type SeedMed = {
  name: string;
  dosageAmount: string;
  dosageUnit: string;
  form: string;
  category: string;
  colour: string;
  colourSecondary: string | null;
  pattern: string;
  schedule: SeedSchedule;
  /**
   * Approximate dose interval (hours) used by the synthetic dose-log
   * generator to lay out history. For fixed_time meds this matches
   * 24 / timesOfDay.length so the timeline still looks plausible.
   */
  approxIntervalHours: number;
  inventoryCount: number;
  inventoryAlertThreshold: number;
  /**
   * Probability (0-1) that any given expected dose was actually taken
   * vs skipped. Lets us paint a realistic adherence picture.
   */
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
    colourSecondary: null,
    pattern: "solid",
    schedule: { kind: "interval", intervalHours: "24" },
    approxIntervalHours: 24,
    inventoryCount: 60,
    inventoryAlertThreshold: 14,
    takeRate: 0.92,
  },
  {
    name: "Lisinopril",
    dosageAmount: "10",
    dosageUnit: "mg",
    form: "tablet",
    category: "prescription",
    colour: "#3b82f6",
    colourSecondary: null,
    pattern: "solid",
    schedule: { kind: "fixed_time", timesOfDay: ["08:00"] },
    approxIntervalHours: 24,
    inventoryCount: 28,
    inventoryAlertThreshold: 7,
    takeRate: 0.96,
  },
  {
    name: "Metformin",
    dosageAmount: "500",
    dosageUnit: "mg",
    form: "tablet",
    category: "prescription",
    colour: "#10b981",
    colourSecondary: "#06b6d4",
    pattern: "stripes",
    schedule: { kind: "interval", intervalHours: "12" },
    approxIntervalHours: 12,
    inventoryCount: 56,
    inventoryAlertThreshold: 14,
    takeRate: 0.88,
  },
  {
    name: "Ibuprofen",
    dosageAmount: "200",
    dosageUnit: "mg",
    form: "tablet",
    category: "otc",
    colour: "#ef4444",
    colourSecondary: null,
    pattern: "solid",
    schedule: { kind: "interval", intervalHours: "8" },
    approxIntervalHours: 8,
    inventoryCount: 24,
    inventoryAlertThreshold: 6,
    takeRate: 0.7,
  },
  {
    name: "Magnesium Glycinate",
    dosageAmount: "300",
    dosageUnit: "mg",
    form: "capsule",
    category: "supplement",
    colour: "#8b5cf6",
    colourSecondary: null,
    pattern: "solid",
    schedule: { kind: "interval", intervalHours: "24" },
    approxIntervalHours: 24,
    inventoryCount: 90,
    inventoryAlertThreshold: 21,
    takeRate: 0.85,
  },
];

function jitterMinutes(): number {
  // ±20 minutes around the expected slot so the timeline looks natural.
  return Math.round((Math.random() - 0.5) * 40);
}

async function deleteDemoUserIfExists(): Promise<void> {
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, DEMO_EMAIL))
    .limit(1);
  if (!existing) return;
  // Cascade deletes medications, dose logs, sessions, preferences,
  // tokens, audit logs.
  await db.delete(users).where(eq(users.id, existing.id));
  console.log(`Deleted existing demo user ${existing.id}`);
}

async function main() {
  await deleteDemoUserIfExists();

  const userId = createId();
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  await db.insert(users).values({
    id: userId,
    email: DEMO_EMAIL,
    name: DEMO_NAME,
    passwordHash,
    timezone: DEMO_TZ,
    emailVerified: true,
  });

  await db.insert(userPreferences).values({
    userId,
    accentColor: "#6366f1",
    timeFormat: "12h",
    dateFormat: "DD/MM/YYYY",
    uiDensity: "comfortable",
    reducedMotion: false,
    emailReminders: false, // demo account shouldn't email anyone
    lowInventoryAlerts: true,
    doseLogPageSize: 20,
    heatmapPeriod: 90,
    exportFormat: "pdf",
  });

  // Insert medications with stable sortOrder. Legacy
  // scheduleType/scheduleIntervalHours columns are still populated
  // for one PR cycle for rollback safety; the canonical schedule
  // shape lives in medication_schedules below.
  const medRows = SEED_MEDS.map((m, idx) => ({
    id: createId(),
    userId,
    name: m.name,
    dosageAmount: m.dosageAmount,
    dosageUnit: m.dosageUnit,
    form: m.form,
    category: m.category,
    colour: m.colour,
    colourSecondary: m.colourSecondary,
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
          daysOfWeek:
            m.schedule.kind === "fixed_time" && m.schedule.daysOfWeek
              ? m.schedule.daysOfWeek
              : null,
          sortOrder: idx,
        });
      });
    }
  }
  if (scheduleRows.length > 0) {
    await db.insert(medicationSchedules).values(scheduleRows);
  }

  // Generate ~30 days of dose log history.
  const now = new Date();
  const start = new Date(now.getTime() - 30 * 86400000);
  const doseInserts: Array<typeof doseLogs.$inferInsert> = [];

  for (let i = 0; i < SEED_MEDS.length; i++) {
    const med = SEED_MEDS[i];
    const medId = medRows[i].id;
    const intervalMs = med.approxIntervalHours * 60 * 60 * 1000;

    for (let t = start.getTime(); t < now.getTime(); t += intervalMs) {
      const expectedAt = new Date(t + jitterMinutes() * 60 * 1000);
      // Don't backfill into the future
      if (expectedAt > now) continue;

      const roll = Math.random();
      const status: "taken" | "skipped" = roll < med.takeRate ? "taken" : "skipped";

      doseInserts.push({
        id: createId(),
        userId,
        medicationId: medId,
        quantity: 1,
        takenAt: expectedAt,
        loggedAt: expectedAt,
        notes: null,
        sideEffects:
          status === "taken" && med.name === "Ibuprofen" && Math.random() < 0.15
            ? [{ name: "Upset stomach", severity: "mild" as const }]
            : null,
        status,
      });
    }
  }

  // Batch insert in chunks to avoid hitting parameter limits on Neon.
  const CHUNK = 200;
  for (let i = 0; i < doseInserts.length; i += CHUNK) {
    await db.insert(doseLogs).values(doseInserts.slice(i, i + CHUNK));
  }

  console.log(
    `Seeded demo account: ${DEMO_EMAIL} (${userId}) with ` +
      `${medRows.length} medications and ${doseInserts.length} dose logs.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
