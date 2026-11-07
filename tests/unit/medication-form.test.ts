import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * `medications/new` (create) and `medications/[id]` (`?/update`) read the same
 * form. Each used to carry its own byte-identical copy of `parseSchedules` and
 * of the medicationSchema → schedulesSchema → `fail(400)` block, so a fix to
 * one door could miss the other with nothing to notice. The reader now lives
 * once, in `$lib/server/medication-form`. This file holds both halves:
 *
 *   1. Both doors return the SAME failure for the same body, through the real
 *      owner and the real Zod schemas, and neither reaches its service on a
 *      400.
 *   2. A source scan: no file under `src/` other than the owner defines
 *      `parseSchedules` or spells the schedule failure message, so a door
 *      cannot quietly grow its own copy again.
 */

const createMedicationWithSchedules = vi.fn();
const updateMedicationWithSchedules = vi.fn();

vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).unusedDb);
vi.mock("$lib/server/medications", () => ({
  getMedicationById: vi.fn(),
  createMedicationWithSchedules: (...args: unknown[]) => createMedicationWithSchedules(...args),
  updateMedicationWithSchedules: (...args: unknown[]) => updateMedicationWithSchedules(...args),
  archiveMedication: vi.fn(),
  unarchiveMedication: vi.fn(),
}));
vi.mock("$lib/server/schedules", () => ({ getSchedulesForMedication: vi.fn() }));
vi.mock("$lib/server/inventory-events", () => ({
  getInventoryHistory: vi.fn(),
  refillMedication: vi.fn(),
  adjustInventory: vi.fn(),
  InvalidRefillQuantityError: class extends Error {},
  InvalidAdjustmentError: class extends Error {},
  MedicationNotFoundError: class extends Error {},
}));

const newMedication = await import("../../src/routes/(app)/medications/new/+page.server");
const editMedication = await import("../../src/routes/(app)/medications/[id]/+page.server");

const locals = { user: { id: "u1" }, session: { id: "s1" } };

function post(fields: Record<string, string>) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return new Request("http://x", { method: "POST", body });
}

type Handler = (event: never) => unknown;

const DOORS: { name: string; run: (fields: Record<string, string>) => Promise<unknown> }[] = [
  {
    name: "medications/new ?/default",
    run: async (fields) =>
      (newMedication.actions.default as Handler)({
        request: post(fields),
        locals,
        params: {},
      } as never),
  },
  {
    name: "medications/[id] ?/update",
    run: async (fields) =>
      (editMedication.actions.update as Handler)({
        request: post(fields),
        locals,
        params: { id: "m1" },
      } as never),
  },
];

/** Settles a call that may return or throw (redirect throws). */
async function outcome(p: Promise<unknown>) {
  try {
    return { returned: await p };
  } catch (thrown) {
    return { thrown };
  }
}

const valid = {
  name: "Test",
  dosageAmount: "1",
  dosageUnit: "mg",
  form: "tablet",
  category: "otc",
  colour: "#6366f1",
  schedules: JSON.stringify([{ scheduleKind: "prn" }]),
};

const SCHEDULE_FAILURE = ["Add at least one valid schedule row"];

beforeEach(() => {
  createMedicationWithSchedules.mockReset().mockResolvedValue(undefined);
  updateMedicationWithSchedules.mockReset().mockResolvedValue({ id: "m1" });
});

describe("both medication form doors read the form through one owner", () => {
  const FAILING: { label: string; fields: Record<string, string>; errors: unknown }[] = [
    {
      label: "an invalid medication field",
      fields: { ...valid, name: "" },
      errors: { name: ["Name is required"] },
    },
    {
      label: "invalid medication fields AND invalid schedules (fields win)",
      fields: { ...valid, colour: "red", schedules: "not json" },
      errors: { colour: ["Must be a valid hex colour"] },
    },
    {
      label: "schedules that are not JSON",
      fields: { ...valid, schedules: "{not json" },
      errors: { schedules: SCHEDULE_FAILURE },
    },
    {
      label: "an empty schedules string",
      fields: { ...valid, schedules: "" },
      errors: { schedules: SCHEDULE_FAILURE },
    },
    {
      label: "no schedules field at all",
      fields: (({ schedules: _omit, ...rest }) => rest)(valid),
      errors: { schedules: SCHEDULE_FAILURE },
    },
    {
      label: "an empty schedule list",
      fields: { ...valid, schedules: "[]" },
      errors: { schedules: SCHEDULE_FAILURE },
    },
  ];

  for (const c of FAILING) {
    it(`returns the same 400 from both doors for ${c.label}`, async () => {
      const results = [];
      for (const door of DOORS) {
        const r = (await door.run(c.fields)) as { status: number; data: Record<string, unknown> };
        expect(r.status, door.name).toBe(400);
        expect(r.data.errors, door.name).toEqual(c.errors);
        // The posted values are echoed so the form re-renders what was typed.
        expect(r.data.values, door.name).toEqual(c.fields);
        results.push(r.data);
      }
      expect(results[0]).toEqual(results[1]);
      expect(createMedicationWithSchedules).not.toHaveBeenCalled();
      expect(updateMedicationWithSchedules).not.toHaveBeenCalled();
    });
  }

  it("hands both services the same parsed medication and schedules on a valid body", async () => {
    for (const door of DOORS) {
      const r = await outcome(door.run(valid));
      expect(r.thrown, door.name).toMatchObject({ status: 302, location: "/medications" });
    }
    expect(createMedicationWithSchedules).toHaveBeenCalledTimes(1);
    expect(updateMedicationWithSchedules).toHaveBeenCalledTimes(1);
    const [createUser, createMed, createSchedules] = createMedicationWithSchedules.mock.calls[0];
    const [updateUser, updateId, updateMed, updateSchedules] =
      updateMedicationWithSchedules.mock.calls[0];
    expect(createUser).toBe("u1");
    expect(updateUser).toBe("u1");
    expect(updateId).toBe("m1");
    expect(createMed).toEqual(updateMed);
    expect(createMed).toMatchObject({ name: "Test", dosageAmount: "1", form: "tablet" });
    expect(createSchedules).toEqual(updateSchedules);
    expect(createSchedules).toEqual([expect.objectContaining({ scheduleKind: "prn" })]);
  });
});

describe("the medication form reader has one owner", () => {
  // Relative to the repo root, where vitest runs (as server-log.test.ts does);
  // `import.meta.url` is not a file: URL under the jsdom environment.
  const SRC = "src";
  const OWNER = "lib/server/medication-form.ts";

  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return walk(path);
      return /\.(ts|js|svelte)$/.test(name) ? [path] : [];
    });
  }

  const files = walk(SRC).map((path) => ({
    file: relative(SRC, path).split("\\").join("/"),
    text: readFileSync(path, "utf8"),
  }));

  it("defines parseSchedules and the schedule failure message only in the owner", () => {
    const defines = files
      .filter(({ text }) => /function\s+parseSchedules\b|const\s+parseSchedules\b/.test(text))
      .map(({ file }) => file);
    const spells = files
      .filter(({ text }) => text.includes("valid schedule row"))
      .map(({ file }) => file);
    expect(defines).toEqual([OWNER]);
    expect(spells).toEqual([OWNER]);
  });

  it("is what both medication form routes call", () => {
    for (const route of [
      "routes/(app)/medications/new/+page.server.ts",
      "routes/(app)/medications/[id]/+page.server.ts",
    ]) {
      const text = files.find(({ file }) => file === route)?.text ?? "";
      expect(text, route).toMatch(/from "\$lib\/server\/medication-form"/);
      expect(text, route).toContain("parseMedicationForm(formData)");
      expect(text, route).not.toContain("schedulesSchema");
    }
  });
});
