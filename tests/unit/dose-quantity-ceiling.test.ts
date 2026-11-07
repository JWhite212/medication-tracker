import { describe, expect, it } from "vitest";
import { doseEditSchema, doseLogSchema } from "$lib/utils/validation";

// The dashboard's ?/logDose door and the edit dialog's door bound the same
// quantity. A dose the log door accepts must be one the edit door can save,
// or a x50 dose (hand-built POST, stale client) is stored, takes 50 from
// stock, fills every slot in the window, and then cannot even have its note
// edited until its quantity is lowered.
describe("dose quantity ceiling", () => {
  const logBody = (quantity: string) => ({ medicationId: "med-1", quantity });
  const editBody = (quantity: string) => ({
    doseId: "dose-1",
    takenAt: "2026-04-15T08:00",
    quantity,
  });

  it("logDose accepts the edit door's maximum", () => {
    expect(doseLogSchema.safeParse(logBody("10")).success).toBe(true);
    expect(doseEditSchema.safeParse(editBody("10")).success).toBe(true);
  });

  it.each(["11", "50"])("logDose rejects quantity %s, as the edit door does", (q) => {
    expect(doseEditSchema.safeParse(editBody(q)).success).toBe(false);
    expect(doseLogSchema.safeParse(logBody(q)).success).toBe(false);
  });
});
