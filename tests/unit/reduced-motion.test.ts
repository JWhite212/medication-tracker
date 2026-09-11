// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const css = readFileSync(fileURLToPath(new URL("../../src/app.css", import.meta.url)), "utf8");

/** Declarations of a rule whose body contains no nested braces. */
function declarations(pattern: RegExp): Record<string, string> {
  const body = css.match(pattern)?.[1];
  if (body === undefined) throw new Error(`reduced-motion rule not found: ${pattern}`);
  const out: Record<string, string> = {};
  for (const decl of body.split(";")) {
    const [prop, ...rest] = decl.split(":");
    if (!prop?.trim() || rest.length === 0) continue;
    out[prop.trim()] = rest.join(":").replace("!important", "").trim();
  }
  return out;
}

const osArm = () =>
  declarations(
    /@media \(prefers-reduced-motion: reduce\) \{\s*\*,\s*\*::before,\s*\*::after \{([^}]*)\}/,
  );

const preferenceArm = () =>
  declarations(
    /\[data-reduced-motion="true"\] \*,\s*\[data-reduced-motion="true"\] \*::before,\s*\[data-reduced-motion="true"\] \*::after \{([^}]*)\}/,
  );

describe("reduced motion", () => {
  // THE regression. Tailwind's animate-pulse and animate-spin are `infinite`.
  // Squashing only animation-duration left them cycling forever at 0.01ms —
  // resolving to a different phase on every paint, so enabling reduced motion
  // turned a 2s pulse into a per-frame strobe. Capping iterations is what
  // actually stops them.
  it.each([
    ["OS media query", osArm],
    ["in-app preference", preferenceArm],
  ])("%s caps infinite animations at one iteration", (_name, arm) => {
    expect(arm()["animation-iteration-count"]).toBe("1");
  });

  it.each([
    ["OS media query", osArm],
    ["in-app preference", preferenceArm],
  ])("%s zeroes animation-delay so fill-mode:both cannot hold content hidden", (_name, arm) => {
    expect(arm()["animation-delay"]).toBe("0ms");
  });

  // The two arms are independent switches with no shared source, so they can
  // drift silently — which is exactly how one of them would end up fixed and the
  // other not. Whatever one suppresses, the other must suppress identically.
  it("keeps both arms in exact parity", () => {
    expect(preferenceArm()).toEqual(osArm());
  });

  it("still suppresses durations", () => {
    for (const arm of [osArm(), preferenceArm()]) {
      expect(arm["animation-duration"]).toBe("0.01ms");
      expect(arm["transition-duration"]).toBe("0.01ms");
    }
  });
});
