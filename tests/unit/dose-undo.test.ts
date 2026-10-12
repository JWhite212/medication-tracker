// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DOSE_UNDO_WINDOW_MS } from "$lib/utils/dose-undo";

/**
 * The Undo window is one number read on both sides of the wire. The server
 * refuses a restore and purges the trash on it; the client sizes its Undo
 * offer from it. It can be shared only because its module imports nothing, so
 * a client bundle can take it without pulling anything else in.
 */

const SOURCE = readFileSync(
  fileURLToPath(new URL("../../src/lib/utils/dose-undo.ts", import.meta.url)),
  "utf8",
);

describe("DOSE_UNDO_WINDOW_MS", () => {
  it("is ten minutes (spec D6)", () => {
    expect(DOSE_UNDO_WINDOW_MS).toBe(10 * 60 * 1000);
  });

  it("lives in a module that imports and re-exports nothing", () => {
    expect(SOURCE).not.toMatch(/^\s*import\b/m);
    expect(SOURCE).not.toMatch(/\bimport\s*\(/);
    expect(SOURCE).not.toMatch(/^\s*export\s[^;]*\bfrom\s/m);
  });
});
