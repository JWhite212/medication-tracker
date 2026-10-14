// The dashboard as the walkthrough draws it, at the four story moments: the
// desktop at 08:02 before and after Lisinopril's Log now, and the phone at
// 10:12 before and after Vitamin D's.
//
// These are values, not a computation. The stage is client code and never
// imports the server composer, so the moments are written out here, and
// tests/unit/walkthrough-dashboard-fidelity.test.ts runs the real
// composeDashboardPageData over DEMO_DOSES at each moment and asserts that
// each constant equals its output. Editing a row here, or changing the
// matcher in a way that would make the video untrue, fails that test.
//
// A row that appears in both halves of a before/after pair is the same
// object in both, so it is identical by construction: the scene grows a row
// only in AFTER, collapses a row only in BEFORE, and leaves the rest alone.

import type { DashboardStatus, DoneRow, DueCard, LaterRow } from "$lib/types";
import {
  DESKTOP_NOW,
  MEDICATION_BY_ID,
  MEDICATIONS,
  PHONE_NOW,
  type MedicationId,
} from "./demo-data";

export type StageDone = Pick<DoneRow, "key" | "covers" | "dayLabel"> & {
  dose: {
    id: string;
    medicationId: string;
    takenAt: Date;
    quantity: number;
    status: "taken" | "skipped";
    name: string;
    dosageAmount: string;
    dosageUnit: string;
    colour: string;
    colourSecondary: string | null;
    pattern: string;
  };
};

export type StageMedication = {
  id: string;
  name: string;
  dosageAmount: string;
  dosageUnit: string;
  colour: string;
  colourSecondary: string | null;
  pattern: string;
};

/** The part of the dashboard payload the stage draws, at one instant. */
export type StageMoment = {
  now: Date;
  todayStart: Date;
  status: DashboardStatus;
  earlier: DueCard[];
  today: DueCard[];
  done: StageDone[];
  later: LaterRow[];
  medications: StageMedication[];
};

/** The story day's UTC midnight: `dashboardWindow(now, "UTC").todayStart` at both clocks. */
const STORY_DAY_START = new Date("2026-09-24T00:00:00.000Z");

/** The label fields every dashboard row carries, copied from the demo medication. */
function label(id: MedicationId): Omit<StageMedication, "id"> {
  const m = MEDICATION_BY_ID[id];
  return {
    name: m.name,
    dosageAmount: m.amount,
    dosageUnit: m.unit,
    colour: m.colour,
    colourSecondary: m.colourSecondary,
    pattern: m.pattern,
  };
}

/** The chip list: every medication, in the demo's order. */
const STAGE_MEDICATIONS: StageMedication[] = MEDICATIONS.map((m) => ({ id: m.id, ...label(m.id) }));

function done(
  id: string,
  medicationId: MedicationId,
  takenAt: string,
  covers: string[],
): StageDone {
  return {
    key: id,
    covers,
    dayLabel: null,
    dose: {
      id,
      medicationId,
      takenAt: new Date(takenAt),
      quantity: 1,
      status: "taken",
      ...label(medicationId),
    },
  };
}

function later(medicationId: MedicationId, expectedTime: string): LaterRow {
  return {
    key: `${medicationId}:${expectedTime}`,
    medicationId,
    ...label(medicationId),
    expectedTime,
  };
}

// ── Rows, each shared by every moment that shows it ──

/** 08:02: Lisinopril's 08:00 slot, two minutes ago. Log now and Skip; Took it at is hidden beside Log now. */
const DUE_LISINOPRIL_0800: DueCard = {
  key: "today:lis",
  medicationId: "lis",
  ...label("lis"),
  rows: [
    {
      key: "lis:2026-09-24T08:00:00.000Z",
      kind: "fixed_time",
      expectedTime: "2026-09-24T08:00:00.000Z",
      state: "due-now",
      logNow: true,
      tookItAt: null,
      skipAt: "2026-09-24T08:00:00.000Z",
    },
  ],
};

/** 10:12: Vitamin D's 09:05 slot, 67 minutes ago, so overdue. Log now, Took it at 09:05 and Skip. */
const DUE_VITAMIN_D_0905: DueCard = {
  key: "today:vitd",
  medicationId: "vitd",
  ...label("vitd"),
  rows: [
    {
      key: "vitd:2026-09-24T09:05:00.000Z",
      kind: "interval",
      expectedTime: "2026-09-24T09:05:00.000Z",
      state: "overdue",
      logNow: true,
      tookItAt: "2026-09-24T09:05:00.000Z",
      skipAt: "2026-09-24T09:05:00.000Z",
    },
  ],
};

const DONE_IBUPROFEN_0610 = done("dose-ibu-20260924-0610", "ibu", "2026-09-24T06:10:00.000Z", []);
const DONE_METFORMIN_0748 = done("dose-met-20260924-0748", "met", "2026-09-24T07:48:00.000Z", []);
/** The desktop beat's dose. Two minutes after its slot, so it says "for 08:00". */
const DONE_LISINOPRIL_0802 = done("dose-lis-20260924-0802", "lis", "2026-09-24T08:02:00.000Z", [
  "2026-09-24T08:00:00.000Z",
]);
/** The phone beat's dose. The interval re-anchors on it, so it covers no other slot. */
const DONE_VITAMIN_D_1012 = done("dose-vitd-20260924-1012", "vitd", "2026-09-24T10:12:00.000Z", []);

const LATER_VITAMIN_D_0905 = later("vitd", "2026-09-24T09:05:00.000Z");
const LATER_IBUPROFEN_1410 = later("ibu", "2026-09-24T14:10:00.000Z");
const LATER_METFORMIN_1948 = later("met", "2026-09-24T19:48:00.000Z");
const LATER_MAGNESIUM_2205 = later("mag", "2026-09-24T22:05:00.000Z");
const LATER_IBUPROFEN_2210 = later("ibu", "2026-09-24T22:10:00.000Z");

// ── The four moments ──

export const DESKTOP_BEFORE: StageMoment = {
  now: DESKTOP_NOW,
  todayStart: STORY_DAY_START,
  status: { kind: "due", dueCount: 1, doneToday: 2, totalToday: 8, loggedToday: 2, next: null },
  earlier: [],
  today: [DUE_LISINOPRIL_0800],
  done: [DONE_IBUPROFEN_0610, DONE_METFORMIN_0748],
  later: [
    LATER_VITAMIN_D_0905,
    LATER_IBUPROFEN_1410,
    LATER_METFORMIN_1948,
    LATER_MAGNESIUM_2205,
    LATER_IBUPROFEN_2210,
  ],
  medications: STAGE_MEDICATIONS,
};

export const DESKTOP_AFTER: StageMoment = {
  now: DESKTOP_NOW,
  todayStart: STORY_DAY_START,
  status: {
    kind: "caught-up",
    dueCount: 0,
    doneToday: 3,
    totalToday: 8,
    loggedToday: 3,
    next: {
      name: "Vitamin D",
      dosageAmount: "1000",
      dosageUnit: "IU",
      expectedTime: "2026-09-24T09:05:00.000Z",
      alsoCount: 0,
    },
  },
  earlier: [],
  today: [],
  done: [DONE_IBUPROFEN_0610, DONE_METFORMIN_0748, DONE_LISINOPRIL_0802],
  later: [
    LATER_VITAMIN_D_0905,
    LATER_IBUPROFEN_1410,
    LATER_METFORMIN_1948,
    LATER_MAGNESIUM_2205,
    LATER_IBUPROFEN_2210,
  ],
  medications: STAGE_MEDICATIONS,
};

export const PHONE_BEFORE: StageMoment = {
  now: PHONE_NOW,
  todayStart: STORY_DAY_START,
  status: { kind: "due", dueCount: 1, doneToday: 3, totalToday: 8, loggedToday: 3, next: null },
  earlier: [],
  today: [DUE_VITAMIN_D_0905],
  done: [DONE_IBUPROFEN_0610, DONE_METFORMIN_0748, DONE_LISINOPRIL_0802],
  later: [LATER_IBUPROFEN_1410, LATER_METFORMIN_1948, LATER_MAGNESIUM_2205, LATER_IBUPROFEN_2210],
  medications: STAGE_MEDICATIONS,
};

export const PHONE_AFTER: StageMoment = {
  now: PHONE_NOW,
  todayStart: STORY_DAY_START,
  status: {
    kind: "caught-up",
    dueCount: 0,
    doneToday: 4,
    totalToday: 8,
    loggedToday: 4,
    next: {
      name: "Ibuprofen",
      dosageAmount: "200",
      dosageUnit: "mg",
      expectedTime: "2026-09-24T14:10:00.000Z",
      alsoCount: 0,
    },
  },
  earlier: [],
  today: [],
  done: [DONE_IBUPROFEN_0610, DONE_METFORMIN_0748, DONE_LISINOPRIL_0802, DONE_VITAMIN_D_1012],
  later: [LATER_IBUPROFEN_1410, LATER_METFORMIN_1948, LATER_MAGNESIUM_2205, LATER_IBUPROFEN_2210],
  medications: STAGE_MEDICATIONS,
};

/**
 * How many of the phone's Later rows PhoneScene shows: `later.slice(0, PHONE_LATER_ROWS)`.
 * A whole-row prefix, so no row is cut through; the phone's 732px content box
 * has room below it. The phone-before screenshot confirms it fits; the number
 * is chosen, not derived.
 */
export const PHONE_LATER_ROWS = 2;
