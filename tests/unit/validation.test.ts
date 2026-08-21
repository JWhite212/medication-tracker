import { describe, it, expect } from "vitest";
import {
  registerSchema,
  loginSchema,
  medicationSchema,
  doseLogSchema,
  doseEditSchema,
  settingsSchema,
} from "$lib/utils/validation";

describe("registerSchema", () => {
  it("accepts valid registration", () => {
    const result = registerSchema.safeParse({
      email: "test@example.com",
      password: "securepass123",
      name: "Test User",
    });
    expect(result.success).toBe(true);
  });

  it("rejects short password", () => {
    const result = registerSchema.safeParse({
      email: "test@example.com",
      password: "short",
      name: "Test User",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid email", () => {
    const result = registerSchema.safeParse({
      email: "not-an-email",
      password: "securepass123",
      name: "Test User",
    });
    expect(result.success).toBe(false);
  });
});

describe("medicationSchema", () => {
  it("accepts valid medication", () => {
    const result = medicationSchema.safeParse({
      name: "Ibuprofen",
      dosageAmount: "200",
      dosageUnit: "mg",
      form: "tablet",
      category: "otc",
      colour: "#6366f1",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid colour hex", () => {
    const result = medicationSchema.safeParse({
      name: "Ibuprofen",
      dosageAmount: "200",
      dosageUnit: "mg",
      form: "tablet",
      category: "otc",
      colour: "not-a-hex",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid category", () => {
    const result = medicationSchema.safeParse({
      name: "Ibuprofen",
      dosageAmount: "200",
      dosageUnit: "mg",
      form: "tablet",
      category: "invalid",
      colour: "#6366f1",
    });
    expect(result.success).toBe(false);
  });

  const BASE_MED = {
    name: "Ibuprofen",
    dosageAmount: "200",
    dosageUnit: "mg",
    form: "tablet",
    category: "otc",
    colour: "#6366f1",
  };

  // serializeMedication spreads the medication row verbatim, so an unset
  // colourSecondary / notes / scheduleIntervalHours / inventoryCount /
  // inventoryAlertThreshold arrives here as an explicit `null`, not
  // omission — a client that reads a medication and writes it straight
  // back must not have its whole upsert rejected over a field it never
  // touched. See medication-notification-schema.test.ts for the full
  // round-trip through serializeMedication.
  describe("null handling on optional fields", () => {
    it("accepts an explicit null for colourSecondary", () => {
      const result = medicationSchema.safeParse({ ...BASE_MED, colourSecondary: null });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.colourSecondary).toBeNull();
    });

    it("accepts an explicit null for notes", () => {
      const result = medicationSchema.safeParse({ ...BASE_MED, notes: null });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.notes).toBeNull();
    });

    it("accepts an explicit null for scheduleIntervalHours", () => {
      const result = medicationSchema.safeParse({ ...BASE_MED, scheduleIntervalHours: null });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.scheduleIntervalHours).toBeNull();
    });

    it("accepts an explicit null for inventoryCount and does NOT coerce it to 0", () => {
      // z.coerce.number() runs Number(null), which is 0 — the trap that
      // silently turns "not tracked" into "0 doses left".
      const result = medicationSchema.safeParse({ ...BASE_MED, inventoryCount: null });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.inventoryCount).toBeNull();
        expect(result.data.inventoryCount).not.toBe(0);
      }
    });

    it("accepts an explicit null for inventoryAlertThreshold and does NOT coerce it to 0", () => {
      const result = medicationSchema.safeParse({ ...BASE_MED, inventoryAlertThreshold: null });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.inventoryAlertThreshold).toBeNull();
        expect(result.data.inventoryAlertThreshold).not.toBe(0);
      }
    });

    it('treats "" for inventoryCount as not-set, NOT zero', () => {
      // Reachable from the web UI today: a cleared number input submits
      // "". z.coerce.number() would turn that into 0.
      const result = medicationSchema.safeParse({ ...BASE_MED, inventoryCount: "" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.inventoryCount).toBeNull();
        expect(result.data.inventoryCount).not.toBe(0);
      }
    });

    it('treats "" for inventoryAlertThreshold as not-set, NOT zero', () => {
      const result = medicationSchema.safeParse({ ...BASE_MED, inventoryAlertThreshold: "" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.inventoryAlertThreshold).toBeNull();
        expect(result.data.inventoryAlertThreshold).not.toBe(0);
      }
    });

    it("still parses valid values for all five fields unchanged", () => {
      const result = medicationSchema.safeParse({
        ...BASE_MED,
        colourSecondary: "#22d3ee",
        notes: "Take with food",
        scheduleIntervalHours: "8",
        inventoryCount: "30",
        inventoryAlertThreshold: "5",
      });
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.colourSecondary).toBe("#22d3ee");
      expect(result.data.notes).toBe("Take with food");
      expect(result.data.scheduleIntervalHours).toBe("8");
      expect(result.data.inventoryCount).toBe(30);
      expect(result.data.inventoryAlertThreshold).toBe(5);
    });

    it("still rejects an invalid colourSecondary hex", () => {
      expect(medicationSchema.safeParse({ ...BASE_MED, colourSecondary: "blue" }).success).toBe(
        false,
      );
    });

    it("still rejects a negative inventoryCount and inventoryAlertThreshold", () => {
      expect(medicationSchema.safeParse({ ...BASE_MED, inventoryCount: "-1" }).success).toBe(false);
      expect(
        medicationSchema.safeParse({ ...BASE_MED, inventoryAlertThreshold: "-1" }).success,
      ).toBe(false);
    });

    it("still rejects a non-numeric inventoryCount instead of coercing to NaN", () => {
      expect(medicationSchema.safeParse({ ...BASE_MED, inventoryCount: "abc" }).success).toBe(
        false,
      );
    });
  });
});

describe("doseLogSchema", () => {
  it("accepts valid dose log with defaults", () => {
    const result = doseLogSchema.safeParse({
      medicationId: "abc123",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.quantity).toBe(1);
    }
  });

  it("accepts dose log with custom quantity and time", () => {
    const result = doseLogSchema.safeParse({
      medicationId: "abc123",
      quantity: 2,
      takenAt: "2026-04-15T10:00:00Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects zero quantity", () => {
    const result = doseLogSchema.safeParse({
      medicationId: "abc123",
      quantity: 0,
    });
    expect(result.success).toBe(false);
  });
});

describe("settingsSchema", () => {
  it("accepts valid timezone", () => {
    const result = settingsSchema.safeParse({
      name: "Test User",
      timezone: "Europe/London",
    });
    expect(result.success).toBe(true);
  });
});

describe("sideEffects validation", () => {
  it("accepts dose log without sideEffects", () => {
    const result = doseLogSchema.safeParse({
      medicationId: "abc123",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sideEffects).toBeUndefined();
    }
  });

  it("accepts dose log with empty sideEffects string", () => {
    const result = doseLogSchema.safeParse({
      medicationId: "abc123",
      sideEffects: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sideEffects).toBeUndefined();
    }
  });

  it("accepts valid sideEffects JSON in doseLogSchema", () => {
    const effects = JSON.stringify([
      { name: "Nausea", severity: "mild" },
      { name: "Headache", severity: "severe" },
    ]);
    const result = doseLogSchema.safeParse({
      medicationId: "abc123",
      sideEffects: effects,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sideEffects).toHaveLength(2);
      expect(result.data.sideEffects![0].name).toBe("Nausea");
      expect(result.data.sideEffects![0].severity).toBe("mild");
      expect(result.data.sideEffects![1].severity).toBe("severe");
    }
  });

  it("accepts valid sideEffects JSON in doseEditSchema", () => {
    const effects = JSON.stringify([{ name: "Dizziness", severity: "moderate" }]);
    const result = doseEditSchema.safeParse({
      doseId: "dose123",
      takenAt: "2026-04-16T10:00",
      quantity: 1,
      sideEffects: effects,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sideEffects).toHaveLength(1);
      expect(result.data.sideEffects![0].severity).toBe("moderate");
    }
  });

  it("rejects invalid severity value", () => {
    const effects = JSON.stringify([{ name: "Nausea", severity: "extreme" }]);
    const result = doseLogSchema.safeParse({
      medicationId: "abc123",
      sideEffects: effects,
    });
    expect(result.success).toBe(false);
  });

  it("rejects side effect with empty name", () => {
    const effects = JSON.stringify([{ name: "", severity: "mild" }]);
    const result = doseLogSchema.safeParse({
      medicationId: "abc123",
      sideEffects: effects,
    });
    expect(result.success).toBe(false);
  });

  it("treats invalid JSON as undefined", () => {
    const result = doseLogSchema.safeParse({
      medicationId: "abc123",
      sideEffects: "not-json",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sideEffects).toBeUndefined();
    }
  });

  it("rejects more than 20 side effects", () => {
    const effects = JSON.stringify(
      Array.from({ length: 21 }, (_, i) => ({
        name: `Effect ${i}`,
        severity: "mild",
      })),
    );
    const result = doseLogSchema.safeParse({
      medicationId: "abc123",
      sideEffects: effects,
    });
    expect(result.success).toBe(false);
  });
});
