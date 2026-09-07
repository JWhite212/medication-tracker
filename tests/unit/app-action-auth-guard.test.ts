import { describe, it, expect, vi } from "vitest";

/**
 * SvelteKit runs form actions BEFORE layout load functions, so the `(app)`
 * group's auth guard in `+layout.server.ts` has NOT executed when an action
 * body starts. Every action that dereferences `locals.user!` must therefore
 * check for itself — otherwise an anonymous POST reads `.id` off `null` and
 * the browser gets a 500 where it should get a 401.
 *
 * Two things make these tests honest rather than decorative:
 *
 *   1. Each case posts a body that is VALID for its action. A body that
 *      failed Zod would return `fail(400)` before ever touching
 *      `locals.user`, so the test would still pass with the guard deleted
 *      and would prove nothing.
 *
 *   2. Every server dependency below THROWS when called. The guard is only
 *      correct if it runs before any work, so reaching a mock at all is a
 *      failure — the same reasoning as `unusedDb` in helpers/fake-db.ts.
 */

function never(name: string) {
  return vi.fn(() => {
    throw new Error(`${name}() must not run for an anonymous request`);
  });
}

/** What `hooks.server.ts` actually puts on `locals` with no session cookie:
 *  both fields present and null, never absent. */
const anon = { user: null, session: null };

class FakeError extends Error {}

vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).unusedDb);
vi.mock("@vercel/analytics/server", () => ({ track: never("track") }));
vi.mock("$lib/server/medications", () => ({
  getActiveMedications: never("getActiveMedications"),
  getMedicationsWithStats: never("getMedicationsWithStats"),
  getArchivedMedications: never("getArchivedMedications"),
  swapSortOrder: never("swapSortOrder"),
  getMedicationById: never("getMedicationById"),
  createMedicationWithSchedules: never("createMedicationWithSchedules"),
  updateMedicationWithSchedules: never("updateMedicationWithSchedules"),
  archiveMedication: never("archiveMedication"),
  unarchiveMedication: never("unarchiveMedication"),
}));
vi.mock("$lib/server/inventory", () => ({ getRefillForecast: never("getRefillForecast") }));
vi.mock("$lib/server/inventory-events", () => ({
  getInventoryHistory: never("getInventoryHistory"),
  refillMedication: never("refillMedication"),
  adjustInventory: never("adjustInventory"),
  InvalidRefillQuantityError: FakeError,
  InvalidAdjustmentError: FakeError,
  MedicationNotFoundError: FakeError,
}));
vi.mock("$lib/server/doses", () => ({
  getTodaysDoses: never("getTodaysDoses"),
  getLastDosePerMedication: never("getLastDosePerMedication"),
  logDose: never("logDose"),
  logSkippedDose: never("logSkippedDose"),
  deleteDose: never("deleteDose"),
  updateDose: never("updateDose"),
  MedicationNotFoundError: FakeError,
}));
vi.mock("$lib/server/schedules", () => ({
  getSchedulesForUser: never("getSchedulesForUser"),
  getSchedulesForMedication: never("getSchedulesForMedication"),
}));
vi.mock("$lib/server/preferences", () => ({
  getOrCreatePreferences: never("getOrCreatePreferences"),
  updatePreferences: never("updatePreferences"),
}));
vi.mock("$lib/server/audit", () => ({
  logAudit: never("logAudit"),
  computeChanges: never("computeChanges"),
}));
vi.mock("$lib/server/auth/lucia", () => ({
  lucia: {
    invalidateSession: never("lucia.invalidateSession"),
    invalidateUserSessions: never("lucia.invalidateUserSessions"),
    createSession: never("lucia.createSession"),
    createSessionCookie: never("lucia.createSessionCookie"),
    createBlankSessionCookie: never("lucia.createBlankSessionCookie"),
  },
}));
vi.mock("$lib/server/auth/reauth", () => ({ confirmReauth: never("confirmReauth") }));
vi.mock("$lib/server/auth/rate-limit", async (importActual) => {
  const actual = await importActual<typeof import("$lib/server/auth/rate-limit")>();
  // Every callable throws: an anonymous POST must be refused BEFORE it can
  // spend anyone's budget. LIMITS is the real table so the policies a door
  // names still resolve.
  return {
    LIMITS: actual.LIMITS,
    checkRateLimit: never("checkRateLimit"),
    enforceLimit: never("enforceLimit"),
    peekLimit: never("peekLimit"),
    recordFailure: never("recordFailure"),
  };
});
vi.mock("$lib/server/auth/password", () => ({ hashPassword: never("hashPassword") }));
vi.mock("$lib/server/auth/totp", () => ({
  generateTOTPSecret: never("generateTOTPSecret"),
  getTOTPUri: never("getTOTPUri"),
  generateQRDataUrl: never("generateQRDataUrl"),
  verifyAndConsumeTOTPCode: never("verifyAndConsumeTOTPCode"),
  encryptTOTPSecret: never("encryptTOTPSecret"),
}));
vi.mock("$lib/server/api/wipe", () => ({
  wipeDoseHistory: never("wipeDoseHistory"),
  wipeArchivedMedications: never("wipeArchivedMedications"),
}));
vi.mock("$lib/server/push", () => ({
  getVapidPublicKey: never("getVapidPublicKey"),
  getPushHealth: never("getPushHealth"),
  sendTestPush: never("sendTestPush"),
  describeTestPushResult: never("describeTestPushResult"),
}));
vi.mock("$lib/server/email", () => ({
  isEmailConfigured: never("isEmailConfigured"),
  sendVerificationEmail: never("sendVerificationEmail"),
}));
vi.mock("$lib/server/import/apply", () => ({ applyImport: never("applyImport") }));
vi.mock("$lib/server/import/pipeline", () => ({ buildPlanFromFile: never("buildPlanFromFile") }));
vi.mock("$lib/server/import/plan", () => ({ planIsEmpty: never("planIsEmpty") }));

const dashboard = await import("../../src/routes/(app)/dashboard/+page.server");
const log = await import("../../src/routes/(app)/log/+page.server");
const medications = await import("../../src/routes/(app)/medications/+page.server");
const medication = await import("../../src/routes/(app)/medications/[id]/+page.server");
const newMedication = await import("../../src/routes/(app)/medications/new/+page.server");
const settings = await import("../../src/routes/(app)/settings/+page.server");
const appearance = await import("../../src/routes/(app)/settings/appearance/+page.server");
const data = await import("../../src/routes/(app)/settings/data/+page.server");
const dataImport = await import("../../src/routes/(app)/settings/data/import/+page.server");
const notifications = await import("../../src/routes/(app)/settings/notifications/+page.server");
const privacy = await import("../../src/routes/(app)/settings/privacy/+page.server");
const security = await import("../../src/routes/(app)/settings/security/+page.server");

function post(fields: Record<string, string> = {}) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return new Request("http://x", { method: "POST", body });
}

/** A payload that satisfies medicationSchema + schedulesSchema, so the
 *  guardless action would reach `locals.user!` rather than stopping at 400. */
const medicationFields = {
  name: "Test",
  dosageAmount: "1",
  dosageUnit: "mg",
  form: "tablet",
  category: "otc",
  colour: "#6366f1",
  schedules: JSON.stringify([{ scheduleKind: "prn" }]),
};

const doseEditFields = { doseId: "d1", takenAt: "2026-08-04T10:00", quantity: "1" };

type ActionMap = Record<string, (event: never) => unknown>;

type Case = {
  route: string;
  action: string;
  actions: ActionMap;
  fields?: Record<string, string>;
  params?: Record<string, string>;
};

const CASES: Case[] = [
  { route: "dashboard", action: "logDose", actions: dashboard.actions, fields: { medicationId: "m1" } }, // prettier-ignore
  {
    route: "dashboard",
    action: "deleteDose",
    actions: dashboard.actions,
    fields: { doseId: "d1" },
  },
  { route: "dashboard", action: "editDose", actions: dashboard.actions, fields: doseEditFields },
  { route: "dashboard", action: "skipDose", actions: dashboard.actions, fields: { medicationId: "m1" } }, // prettier-ignore

  { route: "log", action: "editDose", actions: log.actions, fields: doseEditFields },
  { route: "log", action: "deleteDose", actions: log.actions, fields: { doseId: "d1" } },

  { route: "medications", action: "reorder", actions: medications.actions, fields: { medicationId: "m1", direction: "up" } }, // prettier-ignore

  { route: "medications/[id]", action: "update", actions: medication.actions, fields: medicationFields, params: { id: "m1" } }, // prettier-ignore
  {
    route: "medications/[id]",
    action: "archive",
    actions: medication.actions,
    params: { id: "m1" },
  },
  { route: "medications/[id]", action: "unarchive", actions: medication.actions, params: { id: "m1" } }, // prettier-ignore
  { route: "medications/[id]", action: "refill", actions: medication.actions, fields: { quantity: "5" }, params: { id: "m1" } }, // prettier-ignore
  { route: "medications/[id]", action: "adjust", actions: medication.actions, fields: { newCount: "5" }, params: { id: "m1" } }, // prettier-ignore

  { route: "medications/new", action: "default", actions: newMedication.actions, fields: medicationFields }, // prettier-ignore

  // Not "UTC": settingsSchema checks the zone against Intl.supportedValuesOf,
  // which does not list it, and a 400 would stop short of locals.user.
  { route: "settings", action: "default", actions: settings.actions, fields: { name: "A", timezone: "Europe/London" } }, // prettier-ignore

  // The appearance page has no `default` action: it exposes one named action
  // per option (spec decision 7), so each gets its own case. Each schema is a
  // `strictObject` with exactly ONE required key, so a body carrying all five
  // fields — as the single `default` case used to — now fails validation and
  // would 400 before ever reaching the guard, proving nothing.
  { route: "settings/appearance", action: "accentColor", actions: appearance.actions, fields: { accentColor: "#4f46e5" } }, // prettier-ignore
  { route: "settings/appearance", action: "theme", actions: appearance.actions, fields: { theme: "light" } }, // prettier-ignore
  { route: "settings/appearance", action: "dateFormat", actions: appearance.actions, fields: { dateFormat: "DD/MM/YYYY" } }, // prettier-ignore
  { route: "settings/appearance", action: "timeFormat", actions: appearance.actions, fields: { timeFormat: "24h" } }, // prettier-ignore
  { route: "settings/appearance", action: "uiDensity", actions: appearance.actions, fields: { uiDensity: "comfortable" } }, // prettier-ignore
  { route: "settings/appearance", action: "reducedMotion", actions: appearance.actions, fields: { reducedMotion: "on" } }, // prettier-ignore

  { route: "settings/data", action: "updateFormat", actions: data.actions, fields: { exportFormat: "csv" } }, // prettier-ignore
  { route: "settings/data", action: "deleteAccount", actions: data.actions, fields: { password: "hunter2" } }, // prettier-ignore

  // Already guarded before this change — kept here so the guard that the
  // rest of this file was modelled on cannot be removed without a failure.
  { route: "settings/data/import", action: "preview", actions: dataImport.actions },
  { route: "settings/data/import", action: "commit", actions: dataImport.actions },

  { route: "settings/notifications", action: "savePrefs", actions: notifications.actions },
  { route: "settings/notifications", action: "sendTest", actions: notifications.actions },
  { route: "settings/notifications", action: "resendVerification", actions: notifications.actions }, // prettier-ignore

  { route: "settings/privacy", action: "wipeDoseHistory", actions: privacy.actions, fields: { password: "hunter2" } }, // prettier-ignore
  { route: "settings/privacy", action: "wipeArchivedMedications", actions: privacy.actions, fields: { password: "hunter2" } }, // prettier-ignore
  { route: "settings/privacy", action: "revokeOtherSessions", actions: privacy.actions, fields: { password: "hunter2" } }, // prettier-ignore

  { route: "settings/security", action: "changePassword", actions: security.actions, fields: { currentPassword: "hunter2", newPassword: "correcthorse", confirmPassword: "correcthorse" } }, // prettier-ignore
  { route: "settings/security", action: "revokeSession", actions: security.actions, fields: { sessionId: "s2" } }, // prettier-ignore
  { route: "settings/security", action: "setupTwoFactor", actions: security.actions, fields: { currentPassword: "hunter2" } }, // prettier-ignore
  { route: "settings/security", action: "verifyTwoFactor", actions: security.actions, fields: { code: "123456" } }, // prettier-ignore
  { route: "settings/security", action: "disableTwoFactor", actions: security.actions, fields: { code: "123456", currentPassword: "hunter2" } }, // prettier-ignore
];

/**
 * `?/logout` is the one grep hit for `locals.user!` inside an actions object
 * that an anonymous request cannot reach: its whole body already sits behind
 * `if (locals.session)`, and `hooks.server.ts` sets `user` and `session`
 * together. Adding a 401 there would be a regression, not a fix — the page's
 * `use:enhance` sends the user to /auth/login on success, so an expired
 * session gets a clean redirect today instead of an error. Pinned by its own
 * test at the bottom of this file.
 */
const EXEMPT = new Set(["settings/security ?/logout"]);

describe("every (app) form action rejects an anonymous POST with 401", () => {
  for (const c of CASES) {
    it(`${c.route} ?/${c.action} 401s an anonymous POST instead of 500ing on locals.user!`, async () => {
      const handler = c.actions[c.action];
      expect(handler, `${c.route} has no ?/${c.action} action`).toBeTypeOf("function");

      await expect(
        (async () =>
          handler({
            request: post(c.fields),
            locals: anon,
            params: c.params ?? {},
            cookies: { set: never("cookies.set"), get: never("cookies.get") },
            url: new URL("http://x"),
          } as never))(),
      ).rejects.toMatchObject({ status: 401 });
    });
  }

  it("covers every action defined under (app)", () => {
    const declared = new Set(CASES.map((c) => `${c.route} ?/${c.action}`));
    const all = [
      ["dashboard", dashboard.actions],
      ["log", log.actions],
      ["medications", medications.actions],
      ["medications/[id]", medication.actions],
      ["medications/new", newMedication.actions],
      ["settings", settings.actions],
      ["settings/appearance", appearance.actions],
      ["settings/data", data.actions],
      ["settings/data/import", dataImport.actions],
      ["settings/notifications", notifications.actions],
      ["settings/privacy", privacy.actions],
      ["settings/security", security.actions],
    ] as const;

    const missing = all
      .flatMap(([route, actions]) => Object.keys(actions).map((name) => `${route} ?/${name}`))
      .filter((key) => !declared.has(key) && !EXEMPT.has(key));

    expect(missing).toEqual([]);
  });
});

describe("settings/security ?/logout", () => {
  it("reports success to a session-less POST rather than 401ing", async () => {
    const result = await security.actions.logout({
      request: post(),
      locals: anon,
      params: {},
      cookies: { set: never("cookies.set") },
    } as never);

    expect(result).toEqual({ loggedOut: true });
  });
});
