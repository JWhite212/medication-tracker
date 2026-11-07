// @vitest-environment node
//
// Opening the edit form on a stored schedule and saving it untouched must post
// the stored schedule back. The hidden `schedules` field is what `?/update`
// parses and hands to `updateMedicationWithSchedules`, which replaces every
// row, so the server-rendered value of that field IS the save.
//
// The form models one shape: a single interval row, a single as-needed row, or
// fixed times that all share one set of days. `/api/v1` and import can store
// more (per-row days, interval and fixed rows together). Those used to be
// flattened on save: every fixed row took the first row's days, and interval
// rows beside fixed ones were dropped. They are now shown read-only and posted
// back as stored, while a schedule the form can represent is edited exactly
// as before.
import { describe, it, expect, vi } from "vitest";
import { render } from "svelte/server";

vi.mock("$app/forms", () => ({ enhance: () => ({ destroy() {} }) }));

import MedicationForm from "../../src/lib/components/MedicationForm.svelte";
import {
  isRepresentableByForm,
  serialiseFormSchedules,
} from "../../src/lib/medications/medication-form-state";
import type { MedicationSchedule } from "../../src/lib/server/schedules";
import { BASE_MEDICATION_ROW } from "./fixtures/medication-row";
import { ssrDocument } from "./helpers/axe-ssr";

const MEDICATION = { ...BASE_MEDICATION_ROW, lowInventoryEpisodeAt: null };

let nextSort = 0;
function row(
  over: Partial<MedicationSchedule> & Pick<MedicationSchedule, "scheduleKind">,
): MedicationSchedule {
  return {
    id: `s${nextSort}`,
    medicationId: "m1",
    userId: "u1",
    timeOfDay: null,
    intervalHours: null,
    daysOfWeek: null,
    sortOrder: nextSort++,
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    effectiveTo: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...over,
  };
}

function renderEdit(schedules: MedicationSchedule[], medication = MEDICATION) {
  return ssrDocument(render(MedicationForm, { props: { medication, schedules } }).body);
}

function hidden(doc: Document, name: string): string {
  const input = doc.querySelector(`input[type="hidden"][name="${name}"]`);
  expect(input, name).not.toBeNull();
  return input!.getAttribute("value") ?? "";
}

const posted = (doc: Document) => JSON.parse(hidden(doc, "schedules"));
const scheduleToggles = (doc: Document) =>
  doc.querySelector('[role="group"][aria-label="Schedule"]');
const lockedNotice = (doc: Document) => doc.querySelector("[data-locked-schedule]");

describe("a schedule the form cannot represent is posted back unchanged", () => {
  it("keeps each fixed-time row's own days (08:00 daily + 20:00 Mon/Wed/Fri)", () => {
    const doc = renderEdit([
      row({ scheduleKind: "fixed_time", timeOfDay: "08:00", daysOfWeek: null }),
      row({ scheduleKind: "fixed_time", timeOfDay: "20:00", daysOfWeek: [1, 3, 5] }),
    ]);
    expect(posted(doc)).toEqual([
      { scheduleKind: "fixed_time", timeOfDay: "08:00", daysOfWeek: null },
      { scheduleKind: "fixed_time", timeOfDay: "20:00", daysOfWeek: [1, 3, 5] },
    ]);
  });

  it("keeps an interval row alongside a fixed-time row, in stored order", () => {
    const doc = renderEdit([
      row({ scheduleKind: "interval", intervalHours: "8" }),
      row({ scheduleKind: "fixed_time", timeOfDay: "22:00" }),
    ]);
    expect(posted(doc)).toEqual([
      { scheduleKind: "interval", intervalHours: 8 },
      { scheduleKind: "fixed_time", timeOfDay: "22:00", daysOfWeek: null },
    ]);
  });

  it("keeps two interval rows, which the form's single interval field cannot hold", () => {
    const doc = renderEdit([
      row({ scheduleKind: "interval", intervalHours: "8" }),
      row({ scheduleKind: "interval", intervalHours: "12" }),
    ]);
    expect(posted(doc)).toEqual([
      { scheduleKind: "interval", intervalHours: 8 },
      { scheduleKind: "interval", intervalHours: 12 },
    ]);
  });

  it("shows the rows read-only with a notice instead of the editor", () => {
    const doc = renderEdit([
      row({ scheduleKind: "fixed_time", timeOfDay: "08:00", daysOfWeek: null }),
      row({ scheduleKind: "fixed_time", timeOfDay: "20:00", daysOfWeek: [1, 3, 5] }),
    ]);
    const locked = lockedNotice(doc);
    expect(locked).not.toBeNull();
    expect([...locked!.querySelectorAll("li")].map((li) => li.textContent?.trim())).toEqual([
      "08:00, every day",
      "20:00, Mon, Wed, Fri",
    ]);
    const note = locked!.querySelector('[role="note"]');
    expect(note?.textContent).toContain("This schedule is managed elsewhere");
    expect(note?.textContent).toContain("Saving keeps it exactly as it is.");
    expect(scheduleToggles(doc)).toBeNull();
    expect(doc.querySelector('input[type="time"]')).toBeNull();
    // The rest of the form is still there to edit.
    expect(doc.querySelector('input[name="name"]')).not.toBeNull();
  });

  it("keeps the legacy columns the medication already has", () => {
    const doc = renderEdit(
      [
        row({ scheduleKind: "interval", intervalHours: "6" }),
        row({ scheduleKind: "fixed_time", timeOfDay: "09:00" }),
      ],
      { ...MEDICATION, scheduleType: "scheduled", scheduleIntervalHours: "6" },
    );
    expect(hidden(doc, "scheduleType")).toBe("scheduled");
    expect(hidden(doc, "scheduleIntervalHours")).toBe("6");
  });
});

describe("a schedule the form can represent is edited exactly as before", () => {
  it.each([
    [
      "a single interval row",
      [row({ scheduleKind: "interval", intervalHours: "8" })],
      '[{"scheduleKind":"interval","intervalHours":8}]',
    ],
    [
      "fixed times sharing one set of days",
      [
        row({ scheduleKind: "fixed_time", timeOfDay: "08:00", daysOfWeek: [1, 2, 3, 4, 5] }),
        row({ scheduleKind: "fixed_time", timeOfDay: "20:00", daysOfWeek: [1, 2, 3, 4, 5] }),
      ],
      '[{"scheduleKind":"fixed_time","timeOfDay":"08:00","daysOfWeek":[1,2,3,4,5]},' +
        '{"scheduleKind":"fixed_time","timeOfDay":"20:00","daysOfWeek":[1,2,3,4,5]}]',
    ],
    [
      "fixed times every day",
      [row({ scheduleKind: "fixed_time", timeOfDay: "07:30" })],
      '[{"scheduleKind":"fixed_time","timeOfDay":"07:30","daysOfWeek":null}]',
    ],
    ["a single as-needed row", [row({ scheduleKind: "prn" })], '[{"scheduleKind":"prn"}]'],
  ] as const)("%s: the editor, and the same bytes posted", (_name, schedules, json) => {
    expect(isRepresentableByForm([...schedules])).toBe(true);
    const doc = renderEdit([...schedules]);
    expect(lockedNotice(doc)).toBeNull();
    expect(scheduleToggles(doc)).not.toBeNull();
    expect(hidden(doc, "schedules")).toBe(json);
  });

  it("a new medication opens the editor on the default interval row", () => {
    const doc = ssrDocument(render(MedicationForm, { props: {} }).body);
    expect(lockedNotice(doc)).toBeNull();
    expect(scheduleToggles(doc)).not.toBeNull();
    expect(hidden(doc, "schedules")).toBe('[{"scheduleKind":"interval","intervalHours":0}]');
  });
});

describe("isRepresentableByForm is the form's own round trip", () => {
  it("is false for exactly the shapes the editor's seeded state would rewrite", () => {
    const cases: MedicationSchedule[][] = [
      [
        row({ scheduleKind: "fixed_time", timeOfDay: "08:00", daysOfWeek: [1] }),
        row({ scheduleKind: "fixed_time", timeOfDay: "20:00", daysOfWeek: [2] }),
      ],
      [row({ scheduleKind: "prn" }), row({ scheduleKind: "fixed_time", timeOfDay: "08:00" })],
      [row({ scheduleKind: "prn" }), row({ scheduleKind: "prn" })],
    ];
    for (const schedules of cases) expect(isRepresentableByForm(schedules)).toBe(false);
  });

  it("treats a stored empty day list as every day, as buildScheduleRows does", () => {
    expect(
      isRepresentableByForm([
        row({ scheduleKind: "fixed_time", timeOfDay: "08:00", daysOfWeek: [] }),
        row({ scheduleKind: "fixed_time", timeOfDay: "20:00", daysOfWeek: null }),
      ]),
    ).toBe(true);
  });

  it("serialises the editor's state the way the form always has", () => {
    expect(
      serialiseFormSchedules({
        mode: "fixed_time",
        intervalHours: "",
        fixedTimes: ["08:00", "bad", "21:15"],
        daysOfWeek: [],
      }),
    ).toEqual([
      { scheduleKind: "fixed_time", timeOfDay: "08:00", daysOfWeek: null },
      { scheduleKind: "fixed_time", timeOfDay: "21:15", daysOfWeek: null },
    ]);
    expect(
      serialiseFormSchedules({
        mode: "interval",
        intervalHours: "-1",
        fixedTimes: [],
        daysOfWeek: [],
      }),
    ).toEqual([{ scheduleKind: "interval", intervalHours: 0 }]);
  });
});
