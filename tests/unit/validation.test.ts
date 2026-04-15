import { describe, it, expect } from "vitest";
import {
  registerSchema,
  loginSchema,
  medicationSchema,
  doseLogSchema,
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
