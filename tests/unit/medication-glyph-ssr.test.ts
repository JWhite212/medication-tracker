// @vitest-environment node
//
// The capsule that replaces full-colour pills. Medication colours never sit
// behind text again, so this is decorative and hidden from AT.
import { describe, it, expect } from "vitest";
import { render } from "svelte/server";
import MedicationGlyph from "$lib/components/dashboard/MedicationGlyph.svelte";
import { getMedicationBackground } from "$lib/utils/medication-style";
import { ssrDocument } from "./helpers/axe-ssr";

type GlyphProps = {
  colour: string;
  colourSecondary: string | null;
  pattern: string;
  size?: "sm" | "md";
};

function glyph(props: GlyphProps): HTMLElement {
  const el = ssrDocument(render(MedicationGlyph, { props }).body).querySelector<HTMLElement>(
    "[data-medication-glyph]",
  );
  if (!el) throw new Error("no glyph rendered");
  return el;
}

describe("MedicationGlyph", () => {
  it("is a 28×14 capsule by default", () => {
    const el = glyph({ colour: "#ff0000", colourSecondary: null, pattern: "solid" });
    expect(el.dataset.medicationGlyph).toBe("md");
    expect([...el.classList]).toEqual(expect.arrayContaining(["h-3.5", "w-7", "rounded-full"]));
  });

  it("is a 20×10 capsule at size sm", () => {
    const el = glyph({ colour: "#ff0000", colourSecondary: null, pattern: "solid", size: "sm" });
    expect(el.dataset.medicationGlyph).toBe("sm");
    expect([...el.classList]).toEqual(expect.arrayContaining(["h-2.5", "w-5", "rounded-full"]));
  });

  it("is hidden from assistive technology", () => {
    expect(
      glyph({ colour: "#ff0000", colourSecondary: null, pattern: "solid" }).getAttribute(
        "aria-hidden",
      ),
    ).toBe("true");
  });

  it("draws its edge with border-strong, since a medication colour can match the card", () => {
    const el = glyph({ colour: "#ff0000", colourSecondary: null, pattern: "solid" });
    expect([...el.classList]).toEqual(expect.arrayContaining(["ring-1", "ring-border-strong"]));
  });

  it("paints the small-size background, so stripes become a gradient rather than noise", () => {
    const style =
      glyph({ colour: "#ff0000", colourSecondary: "#0000ff", pattern: "stripes" }).getAttribute(
        "style",
      ) ?? "";
    expect(style).toContain(getMedicationBackground("#ff0000", "#0000ff", "stripes", true));
    expect(style).not.toContain("repeating-linear-gradient");
  });

  it("paints a single-colour medication solid", () => {
    const style =
      glyph({ colour: "#ff0000", colourSecondary: null, pattern: "solid" }).getAttribute("style") ??
      "";
    expect(style).toContain("#ff0000");
  });
});
