// @vitest-environment node
//
// `kit.version.pollInterval` is what lets `updated.current` (from $app/state)
// ever become true (spec D9). An installed PWA can stay open for days across
// deploys. Without polling, a 409 can refresh its data but never its
// JavaScript, and the tab keeps re-posting a request shape the server no
// longer accepts. reloadDocumentIfUpdated() reads the flag this turns on.
import { describe, it, expect } from "vitest";
import config from "../../svelte.config.js";

describe("svelte.config.js", () => {
  it("polls for a new deploy every five minutes", () => {
    expect(config.kit.version?.pollInterval).toBe(300_000);
  });
});
