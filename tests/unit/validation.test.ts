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
    const effects = JSON.stringify([
      { name: "Dizziness", severity: "moderate" },
    ]);
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
