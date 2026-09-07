// @vitest-environment node
//
// Covers: the no-JS path and the SSR'd markup of
// src/routes/(app)/settings/appearance/+page.svelte -- one <form> per
// control, each targeting its own named action, each option/radio/checkbox
// carrying the server value as a real selected/checked attribute (not just
// a bound property), the no-JS Save buttons, and the single polite live
// region. All of that is deterministic between jsdom and a real browser,
// so it belongs in a unit test.
//
// Does NOT cover: any interactive behaviour (debounce coalescing, the
// single-flight queue, the revert-on-failure path, focus/blur flushing).
// Two of the four traps this page exists to avoid behave differently in
// jsdom than in a real browser -- a `<select>`'s dirtiness flag after the
// user touches it, and `form.reset()` stripping attributes post-hydration
// -- so a jsdom test of either would pass while production stayed broken.
// That half is verified by a human browser pass, not by anything here.
//
// `@vitest-environment node` is load-bearing, not decorative: the suite's
// default environment is jsdom, and under jsdom vite resolves `svelte` to
// its client entry, so `render()` from `svelte/server` throws
// `effect_orphan` before a single assertion runs.
import { describe, it, expect } from "vitest";
import { render } from "svelte/server";
import Page from "../../src/routes/(app)/settings/appearance/+page.svelte";

const preferences = {
  userId: "u1",
  accentColor: "#f59e0b",
  dateFormat: "YYYY-MM-DD",
  timeFormat: "24h",
  uiDensity: "compact",
  reducedMotion: true,
  overdueEmailReminders: true,
  overduePushReminders: true,
  lowInventoryEmailAlerts: true,
  lowInventoryPushAlerts: false,
  doseLogPageSize: 20,
  heatmapPeriod: 90,
  exportFormat: "pdf",
  updatedAt: new Date("2026-08-01T00:00:00Z"),
};

// The (app) layout load contributes `user` to this page's merged PageData
// -- svelte-check enforces the full type even though the page itself never
// reads it, so the fixture needs one to type-check clean.
const user = {
  id: "u1",
  email: "person@example.com",
  name: "Test Person",
  avatarUrl: null,
  timezone: "UTC",
  twoFactorEnabled: false,
  emailVerified: true,
};

const { body } = render(Page, { props: { data: { user, preferences }, form: null } });

// Findings 2: with no JavaScript, the action's result (`form`) is the ONLY
// feedback channel available -- `statusText`/`announcement` are populated
// exclusively inside the `use:enhance` callback, which never runs without
// JS. Each of these renders the page with a `form` value shaped like one
// of the three outcomes `+page.server.ts`'s `fieldAction` can actually
// return, gated to a single control (`uiDensity`) so cross-control leakage
// is also checked below.
const { body: successBody } = render(Page, {
  props: { data: { user, preferences }, form: { success: true, key: "uiDensity" } },
});

const { body: validationErrorBody } = render(Page, {
  props: {
    data: { user, preferences },
    form: { key: "uiDensity", errors: { uiDensity: ["Invalid enum value."] } },
  },
});

const { body: rateLimitedBody } = render(Page, {
  props: {
    data: { user, preferences },
    form: {
      key: "uiDensity",
      saveError: "Too many changes. Try again in 30 seconds.",
      retryAfterMs: 30_000,
    },
  },
});

describe("appearance page SSR (no-JS path)", () => {
  it("emits one form per control, each targeting its own named action", () => {
    for (const key of ["accentColor", "dateFormat", "timeFormat", "uiDensity", "reducedMotion"]) {
      expect(body, `missing form for ${key}`).toContain(`action="?/${key}"`);
    }
    expect(body.match(/<form/g) ?? []).toHaveLength(5);
    expect(body).not.toContain('action="?/default"');
  });

  it("marks the stored option selected on every select — the no-JS POST sends the stored value", () => {
    // bind:value must SSR `selected` onto the right option. If it does not,
    // a no-JS save silently posts the first option instead of the stored one.
    expect(body).toMatch(/<option[^>]*value="YYYY-MM-DD"[^>]*selected/);
    expect(body).toMatch(/<option[^>]*value="24h"[^>]*selected/);
    expect(body).toMatch(/<option[^>]*value="compact"[^>]*selected/);
    expect(body.match(/selected/g) ?? []).toHaveLength(3);
  });

  it("checks the stored accent radio", () => {
    expect(body).toMatch(/<input[^>]*value="#f59e0b"[^>]*checked/);
  });

  it("gives every accent swatch an accessible name from the registry's optionLabelTemplate", () => {
    // Finding 1: a bare hex in the sr-only span ("#4f46e5") announces as
    // "#4f46e5, radio button, 1 of 10" to a screen reader. The name must
    // come from entryFor("accentColor").optionLabelTemplate with "{value}"
    // substituted, which is also the field's only consumer.
    expect(body).toContain("Select colour #f59e0b");
    expect(body).toContain("Select colour #4f46e5");
    expect(body).not.toMatch(/<span class="sr-only">#f59e0b<\/span>/);
  });

  it("checks the reduce-motion box and precedes it with the hidden off pair", () => {
    expect(body).toMatch(/<input[^>]*type="checkbox"[^>]*checked/);
    const hidden = body.indexOf('name="reducedMotion" value="off"');
    const box = body.indexOf('type="checkbox"');
    expect(hidden, "hidden off input missing").toBeGreaterThan(-1);
    expect(hidden, "hidden off must precede the checkbox so 'on' wins").toBeLessThan(box);
  });

  it("ships the no-JS save buttons in the SSR'd HTML", () => {
    // $effect does not run during SSR, so `hydrated` is false and the
    // buttons must be present for a browser with no JS.
    expect(body.match(/type="submit"/g) ?? []).toHaveLength(5);
  });

  it("gives the accent group a real label and drops the orphaned one", () => {
    expect(body).toContain("<fieldset");
    expect(body).toContain("<legend");
    expect(body).toContain("Accent Colour");
  });

  it("renders exactly one polite live region, outside every form", () => {
    expect(body.match(/role="status"/g) ?? []).toHaveLength(1);
    expect(body.indexOf('role="status"')).toBeLessThan(body.indexOf("<form"));
  });

  it("no longer renders the shared success banner", () => {
    expect(body).not.toContain("Appearance settings saved");
  });
});

describe("appearance page SSR (no-JS feedback from the form prop)", () => {
  it("renders success feedback for the control the result belongs to", () => {
    expect(successBody).toContain("Display Density saved.");
  });

  it("does not leak success feedback onto any other control", () => {
    expect(successBody.match(/saved\./g) ?? []).toHaveLength(1);
    expect(successBody).not.toContain("Accent Colour saved.");
    expect(successBody).not.toContain("Reduce motion saved.");
  });

  it("renders the 400 validation message for the control the result belongs to", () => {
    expect(validationErrorBody).toContain("Invalid enum value.");
  });

  it("renders the formatted 429 message for the control the result belongs to", () => {
    // The action builds this exact sentence server-side
    // (+page.server.ts:52) -- a silent no-JS 429 was the concrete bug.
    expect(rateLimitedBody).toContain("Too many changes. Try again in 30 seconds.");
  });
});

describe("appearance page SSR (date format samples)", () => {
  // The Date Format control has to show what each option actually renders,
  // or it is a menu of three opaque strings. This has been lost three times
  // -- #130 reverted by #132, re-landed by #135, then dropped again when
  // #136's merge repair took the rewritten page wholesale -- so it is
  // pinned here rather than left to survive the next conflict on its own.
  it("labels each date option with a live sample of its own format", () => {
    expect(body).toContain("DD/MM/YYYY — 15 Apr 2026");
    expect(body).toContain("MM/DD/YYYY — Apr 15, 2026");
    expect(body).toContain("YYYY-MM-DD — 2026-04-15");
  });

  it("generates the samples with the formatter the option configures", async () => {
    // Not a restatement of the assertion above: this proves the label is
    // produced BY formatUserDate, so a change to the formatter moves the
    // label with it. A hardcoded label would pass the test above forever.
    const { formatUserDate } = await import("../../src/lib/utils/time");
    const { entryFor } = await import("../../src/lib/appearance/registry");
    const sample = new Date(Date.UTC(2026, 3, 15));

    for (const option of entryFor("dateFormat").options) {
      expect(body).toContain(`${option.label} — ${formatUserDate(sample, "UTC", option.value)}`);
    }
  });

  it("leaves the other selects' labels alone", () => {
    // Only dateFormat gets a sample; appending one to every select would
    // read as "24h — 24h".
    expect(body).toContain(">24-hour (14:30)<");
    expect(body).toContain(">Compact<");
    expect(body).not.toMatch(/24-hour \(14:30\) —/);
  });

  it("keeps the stored enum as the option's value, not the rendered sample", () => {
    // The column, both API-door zod schemas, the backup round trip and the
    // Mac client all key off the bare enum. Formatting the label must not
    // leak into what the form posts.
    expect(body).toMatch(/<option[^>]*value="YYYY-MM-DD"/);
    expect(body).not.toMatch(/<option[^>]*value="[^"]*—/);
  });
});
