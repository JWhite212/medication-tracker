import { describe, expect, it } from "vitest";
import { moveFocusTarget } from "$lib/dashboard/move-focus";

describe("moveFocusTarget", () => {
  it("keeps focus on the pressed arrow when the section is not at an end", () => {
    expect(moveFocusTarget("settings-move", "later", "up", false)).toBe("settings-move-later-up");
    expect(moveFocusTarget("settings-move", "later", "down", false)).toBe(
      "settings-move-later-down",
    );
  });

  it("moves focus to the opposite arrow when the section reached an end", () => {
    expect(moveFocusTarget("settings-move", "quickLog", "up", true)).toBe(
      "settings-move-quickLog-down",
    );
    expect(moveFocusTarget("editor-move", "quickLog", "down", true)).toBe(
      "editor-move-quickLog-up",
    );
  });
});
