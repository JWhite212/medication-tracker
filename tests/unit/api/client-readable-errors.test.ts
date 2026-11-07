import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

// Every module below imports `db`; none of these constructors touches it.
vi.mock("$lib/server/db", async () => (await import("../helpers/fake-db")).unusedDb);

const commands = await import("$lib/server/api/commands");
const doses = await import("$lib/server/doses");
const inventory = await import("$lib/server/inventory-events");
const schedules = await import("$lib/server/schedules");

/**
 * runCommands lets a refusal through to the client by `e.name` and redacts
 * everything else as `command_failed`. A class on the allowlist that never
 * sets `this.name` reads "Error" at runtime, so its refusal was silently
 * redacted and logged as a crash — which is what MedicationOwnershipError
 * did. Construct every listed class and check its runtime name is listed.
 */
const instances: Error[] = [
  new ZodError([]),
  new commands.UnknownCommandError("x"),
  new commands.ReauthRequiredError("x"),
  new doses.MedicationNotFoundError("m1"),
  new inventory.MedicationNotFoundError(),
  new schedules.MedicationOwnershipError(),
  new inventory.InvalidRefillQuantityError(),
  new inventory.InvalidAdjustmentError(
    ...([] as unknown as ConstructorParameters<typeof inventory.InvalidAdjustmentError>),
  ),
  new doses.SlotAlreadyTakenError(),
  new doses.SlotTargetChangedError(),
];

describe("CLIENT_READABLE_ERRORS matches the classes' runtime names", () => {
  it.each(instances.map((e) => [e.constructor.name, e] as const))(
    "%s is passed through by its runtime name",
    (_label, error) => {
      expect(commands.CLIENT_READABLE_ERRORS.has(error.name)).toBe(true);
    },
  );

  it("lists no name that no class produces", () => {
    const produced = new Set(instances.map((e) => e.name));
    expect([...commands.CLIENT_READABLE_ERRORS].filter((n) => !produced.has(n))).toEqual([]);
  });
});
