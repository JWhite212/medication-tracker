// @vitest-environment node
//
// Alert: one box per tone with an aria-hidden icon and a headline, an
// optional body and action, no outer margin, and the announcement rule —
// errors interrupt, needs-you never claims role="alert".
import { describe, it, expect } from "vitest";
import { render } from "svelte/server";
import { createRawSnippet, type ComponentProps } from "svelte";
import Alert from "$lib/components/ui/Alert.svelte";
import { toneClass, type Tone } from "$lib/utils/status-tone";
import AlertGallery from "./helpers/AlertGallery.svelte";
import { evaluatedRules, runAxe, ssrDocument } from "./helpers/axe-ssr";
import { textOf } from "./helpers/dom-names";

const TONES: Tone[] = ["happened", "wrong", "needs-you", "neutral"];
const snippet = (html: string) => createRawSnippet(() => ({ render: () => html }));

function renderAlert(props: ComponentProps<typeof Alert>): { html: string; box: Element } {
  const html = render(Alert, { props }).body;
  const box = ssrDocument(html).querySelector("main > div");
  expect(box, "no alert rendered").not.toBeNull();
  return { html, box: box! };
}

const tokens = (classes: string) => classes.split(/\s+/).filter(Boolean);

describe("Alert announces by tone", () => {
  const ROLE: Record<Tone, string | null> = {
    wrong: "alert",
    happened: null,
    "needs-you": null,
    neutral: "note",
  };
  for (const tone of TONES) {
    it(`gives ${tone} ${ROLE[tone] ? `role="${ROLE[tone]}"` : "no role"} by default`, () => {
      expect(renderAlert({ tone, title: "x" }).box.getAttribute("role")).toBe(ROLE[tone]);
    });
  }

  it("lets live override the default in both directions", () => {
    expect(renderAlert({ tone: "wrong", title: "x", live: "off" }).box.hasAttribute("role")).toBe(
      false,
    );
    expect(
      renderAlert({ tone: "happened", title: "x", live: "assertive" }).box.getAttribute("role"),
    ).toBe("alert");
    expect(
      renderAlert({ tone: "neutral", title: "x", live: "assertive" }).box.getAttribute("role"),
    ).toBe("alert");
  });

  it("never makes needs-you a role=alert unless the caller asks", () => {
    // MedicationForm's focus fallback looks for [role="alert"]; a warning
    // that claimed the role caught the focus meant for the real error.
    const { html } = renderAlert({ tone: "needs-you", title: "Possible interaction" });
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("aria-live");
  });
});

describe("Alert markup", () => {
  it("renders id as the first attribute, ahead of role", () => {
    const { html, box } = renderAlert({
      tone: "wrong",
      title: "Too many attempts",
      id: "form-error",
    });
    expect(box.getAttributeNames()[0]).toBe("id");
    expect(html).toMatch(/<div id="form-error"[^>]*role="alert"/);
  });

  for (const tone of TONES) {
    it(`draws the ${tone} box from toneClass(tone, "alert") and owns no outer margin`, () => {
      const { box } = renderAlert({ tone, title: "x" });
      expect(new Set(box.classList)).toEqual(
        new Set([
          ...tokens("flex items-start gap-2.5 rounded-lg px-3.5 py-3 text-sm"),
          ...tokens(toneClass(tone, "alert")),
        ]),
      );
    });
  }

  it("appends the call site's class, which is where margin lives", () => {
    const { box } = renderAlert({ tone: "happened", title: "Saved.", class: "mt-4" });
    expect([...box.classList]).toContain("mt-4");
  });

  const GLYPHS: Record<Tone, { circles: number; paths: string[] }> = {
    happened: { circles: 0, paths: ["M20 6 9 17l-5-5"] },
    wrong: { circles: 1, paths: ["M12 8v5M12 16.5v.01"] },
    "needs-you": { circles: 0, paths: ["M12 3 2.5 20h19L12 3Z", "M12 10v4M12 17v.01"] },
    neutral: { circles: 1, paths: ["M12 11v5M12 8v.01"] },
  };
  for (const tone of TONES) {
    it(`gives ${tone} its own 18px aria-hidden icon in the tone's text colour`, () => {
      const svg = renderAlert({ tone, title: "x" }).box.firstElementChild;
      expect(svg?.tagName, "the icon is not the box's first child").toBe("svg");
      expect(svg!.getAttribute("aria-hidden")).toBe("true");
      expect(svg!.getAttribute("width")).toBe("18");
      expect(svg!.getAttribute("height")).toBe("18");
      expect(svg!.getAttribute("viewBox")).toBe("0 0 24 24");
      expect(svg!.getAttribute("stroke-width")).toBe("2.2");
      expect([...svg!.classList]).toEqual(expect.arrayContaining(tokens(toneClass(tone, "text"))));
      expect(svg!.querySelectorAll("circle").length).toBe(GLYPHS[tone].circles);
      expect([...svg!.querySelectorAll("path")].map((p) => p.getAttribute("d"))).toEqual(
        GLYPHS[tone].paths,
      );
    });
  }

  for (const tone of TONES) {
    it(`sets the ${tone} headline in semibold ${tone === "neutral" ? "primary text" : "the tone's text colour"}`, () => {
      const { box } = renderAlert({ tone, title: "Couldn't save." });
      const headline = box.querySelector("p")!;
      expect(textOf(headline)).toBe("Couldn't save.");
      const expected = tone === "neutral" ? ["text-text-primary"] : tokens(toneClass(tone, "text"));
      expect([...headline.classList]).toEqual(
        expect.arrayContaining(["font-semibold", ...expected]),
      );
    });
  }

  it("is the headline and nothing else when given only a title", () => {
    const { box } = renderAlert({ tone: "happened", title: "Settings saved." });
    expect(textOf(box)).toBe("Settings saved.");
    expect(box.querySelectorAll("p")).toHaveLength(1);
    expect(box.querySelector(".text-\\[13px\\]")).toBeNull();
  });

  it("puts the body in 13px secondary text and the action after it", () => {
    const { box } = renderAlert({
      tone: "needs-you",
      title: "Verify your email.",
      children: snippet("<span>We sent a link.</span>"),
      action: snippet(`<a href="/settings/notifications">Resend</a>`),
    });
    const body = box.querySelector(".text-\\[13px\\]")!;
    expect([...body.classList]).toContain("text-text-secondary");
    expect(textOf(body)).toBe("We sent a link.");
    const link = box.querySelector("a")!;
    expect(textOf(link)).toBe("Resend");
    expect(body.compareDocumentPosition(link) & 4 /* FOLLOWING */).toBeTruthy();
    expect(body.contains(link)).toBe(false);
  });

  it("carries tabindex=-1 only when asked", () => {
    expect(renderAlert({ tone: "wrong", title: "x" }).box.hasAttribute("tabindex")).toBe(false);
    expect(
      renderAlert({ tone: "wrong", title: "x", tabindex: -1 }).box.getAttribute("tabindex"),
    ).toBe("-1");
  });
});

describe("every Alert in the gallery", () => {
  it("passes axe: aria-roles, aria-allowed-role, aria-hidden-focus, button-name", async () => {
    const doc = ssrDocument(render(AlertGallery).body);
    expect(doc.querySelectorAll("main > div")).toHaveLength(8);
    const rules = ["aria-roles", "aria-allowed-role", "aria-hidden-focus", "button-name"];
    const results = await runAxe(doc, rules);
    expect(results.violations).toEqual([]);
    const ran = evaluatedRules(results);
    for (const rule of rules) expect(ran, `${rule} evaluated nothing`).toContain(rule);
  });
});
