// Shared 25-field medication row fixture. `serializeMedication` takes an
// inline object literal with no default row to build on, so tests that
// need a realistic row (the API/import round-trip proof here, Task 18's
// timing fields later) share this one rather than each hand-rolling — and
// drifting from — their own copy.
export const BASE_MEDICATION_ROW = {
  id: "m1",
  userId: "u1",
  name: "Paracetamol",
  dosageAmount: "500",
  dosageUnit: "mg",
  form: "tablet",
  category: "pain relief",
  colour: "#ff0000",
  colourSecondary: null,
  pattern: "solid",
  notes: null,
  scheduleType: "scheduled",
  scheduleIntervalHours: "8",
  inventoryCount: 30,
  inventoryAlertThreshold: 5,
  sortOrder: 0,
  isArchived: false,
  archivedAt: null,
  startedAt: new Date("2026-01-01T00:00:00.000Z"),
  endedAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  notificationsEnabled: false,
  notifyOverdueEmail: true,
  notifyOverduePush: null,
  notifyLowInventoryEmail: false,
  notifyLowInventoryPush: null,
};
