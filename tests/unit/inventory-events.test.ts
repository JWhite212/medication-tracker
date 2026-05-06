import { describe, it, expect, vi, beforeEach } from "vitest";

type Insert = { table: string; values: unknown };
const inserts: Insert[] = [];
let nextSelectRow: { inventoryCount: number | null } | undefined;

const tableNames = new WeakMap<object, string>();
const inventoryEventsTable = {};
const medicationsTable = {};
tableNames.set(inventoryEventsTable, "inventory_events");
tableNames.set(medicationsTable, "medications");

vi.mock("$lib/server/db/schema", () => ({
  inventoryEvents: inventoryEventsTable,
  medications: medicationsTable,
  // Other tables unused here; placeholders keep the import happy.
  users: {},
  doseLogs: {},
  userPreferences: {},
  pushSubscriptions: {},
  reminderEvents: {},
  auditLogs: {},
}));

function buildClient() {
  return {
    insert: (tableRef: object) => ({
      values: (rows: unknown) => {
        inserts.push({ table: tableNames.get(tableRef) ?? "unknown", values: rows });
        return Promise.resolve();
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(nextSelectRow ? [nextSelectRow] : []),
          orderBy: () => ({ limit: () => Promise.resolve([]) }),
        }),
      }),
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  };
}

vi.mock("$lib/server/db", () => ({
  db: buildClient(),
  dbTx: {
    transaction: <T>(cb: (tx: ReturnType<typeof buildClient>) => Promise<T>) => cb(buildClient()),
  },
}));

const {
  recordInventoryEvent,
  refillMedication,
  InvalidRefillQuantityError,
  MedicationNotFoundError,
} = await import("../../src/lib/server/inventory-events");

beforeEach(() => {
  inserts.length = 0;
  nextSelectRow = undefined;
});

describe("recordInventoryEvent", () => {
  it("inserts a row with the supplied event payload", async () => {
    const client = buildClient() as unknown as Parameters<typeof recordInventoryEvent>[0];
    await recordInventoryEvent(client, {
      userId: "u1",
      medicationId: "med-A",
      eventType: "dose_taken",
      quantityChange: -1,
      previousCount: 30,
      newCount: 29,
    });

    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe("inventory_events");
    const row = inserts[0].values as Record<string, unknown>;
    expect(row.userId).toBe("u1");
    expect(row.eventType).toBe("dose_taken");
    expect(row.quantityChange).toBe(-1);
    expect(row.previousCount).toBe(30);
    expect(row.newCount).toBe(29);
    expect(row.note).toBeNull();
  });

  it("preserves the supplied note when present", async () => {
    const client = buildClient() as unknown as Parameters<typeof recordInventoryEvent>[0];
    await recordInventoryEvent(client, {
      userId: "u1",
      medicationId: "med-A",
      eventType: "refill",
      quantityChange: 30,
      previousCount: 5,
      newCount: 35,
      note: "picked up at pharmacy",
    });
    const row = inserts[0].values as Record<string, unknown>;
    expect(row.note).toBe("picked up at pharmacy");
  });
});

describe("refillMedication", () => {
  it("rejects non-positive integer quantities", async () => {
    await expect(refillMedication("u1", "med-A", 0)).rejects.toBeInstanceOf(
      InvalidRefillQuantityError,
    );
    await expect(refillMedication("u1", "med-A", -3)).rejects.toBeInstanceOf(
      InvalidRefillQuantityError,
    );
    await expect(refillMedication("u1", "med-A", 1.5)).rejects.toBeInstanceOf(
      InvalidRefillQuantityError,
    );
  });

  it("throws MedicationNotFoundError when the medication doesn't belong to the user", async () => {
    nextSelectRow = undefined;
    await expect(refillMedication("u1", "missing", 30)).rejects.toBeInstanceOf(
      MedicationNotFoundError,
    );
  });

  it("records a refill event with previous and new counts on success", async () => {
    nextSelectRow = { inventoryCount: 5 };
    const result = await refillMedication("u1", "med-A", 30, "pharmacy run");
    expect(result).toEqual({ previousCount: 5, newCount: 35 });

    const eventInsert = inserts.find((i) => i.table === "inventory_events");
    expect(eventInsert).toBeDefined();
    const row = eventInsert!.values as Record<string, unknown>;
    expect(row.eventType).toBe("refill");
    expect(row.quantityChange).toBe(30);
    expect(row.previousCount).toBe(5);
    expect(row.newCount).toBe(35);
    expect(row.note).toBe("pharmacy run");
  });

  it("seeds the count from null when inventory tracking was never enabled", async () => {
    nextSelectRow = { inventoryCount: null };
    const result = await refillMedication("u1", "med-A", 30);
    expect(result).toEqual({ previousCount: null, newCount: 30 });
    const eventInsert = inserts.find((i) => i.table === "inventory_events");
    const row = eventInsert!.values as Record<string, unknown>;
    expect(row.previousCount).toBeNull();
    expect(row.newCount).toBe(30);
  });
});
