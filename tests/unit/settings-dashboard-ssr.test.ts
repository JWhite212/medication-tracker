// @vitest-environment node
//
// The no-JS half of /settings/dashboard: every control is a real submit that
// carries the complete resulting value, computed at render from the
// server-confirmed preferences, so the page works before (and without)
// hydration. The pressed-then-reloaded half is in
// settings-dashboard-mount.svelte.test.ts.
//
// `@vitest-environment node` is load-bearing: under jsdom vite resolves
// `svelte` to its client entry and `render()` throws. Svelte's server
// `render()` is also lazy, so every case below reads `.body`.
import { describe, it, expect, vi } from "vitest";
import { render } from "svelte/server";
import { JSDOM } from "jsdom";
import {
  HIDEABLE_SECTIONS,
  SECTION_LABELS,
  mergeVisibleOrder,
  moveSection,
  normaliseSectionOrder,
  orderValue,
  type DashboardSectionId,
  type DashboardVariant,
} from "../../src/lib/dashboard/layout";
import type { UserPreferences } from "../../src/lib/types";
import { formatTimeSince, formatUserTime } from "../../src/lib/utils/time";
import { preferencesFixture } from "./helpers/preferences-fixture";
import { accessibleName, textOf } from "./helpers/dom-names";

// Mocked once and repointed between renders: re-mocking reloads svelte's
// server internals, whose SSR context is module-level state.
const pageState = { url: new URL("https://medtracker.test/settings/dashboard") };
vi.mock("$app/state", () => ({ page: pageState }));
vi.mock("$app/forms", () => ({ enhance: () => ({ destroy() {} }), applyAction: async () => {} }));
vi.mock("$app/navigation", () => ({ invalidateAll: async () => {} }));
vi.mock("$lib/components/ui/Toast.svelte", () => ({ showToast: () => {} }));

const { default: Page } = await import("../../src/routes/(app)/settings/dashboard/+page.svelte");

const user = {
  id: "u1",
  email: "person@example.com",
  name: "Test Person",
  avatarUrl: null,
  timezone: "UTC",
  twoFactorEnabled: false,
  emailVerified: true,
};

type Overrides = Partial<UserPreferences>;

function renderPage(
  overrides: Overrides = {},
  variant: DashboardVariant = "scheduled",
  url = "https://medtracker.test/settings/dashboard",
): Document {
  pageState.url = new URL(url);
  const preferences: UserPreferences = { ...preferencesFixture, ...overrides };
  const { body } = render(Page, {
    props: { data: { user, preferences, variant } },
  });
  return new JSDOM(`<!doctype html><body>${body}</body>`).window.document;
}

const FLAG_KEY = {
  later: "dashboardShowLater",
  quickLog: "dashboardShowQuickLog",
  refills: "dashboardShowRefills",
} as const;

function rows(doc: Document) {
  return [...doc.querySelectorAll<HTMLLIElement>("ol[data-sections] > li[data-section]")];
}

function moveButton(doc: Document, id: DashboardSectionId, dir: "up" | "down") {
  return doc.getElementById(`move-section-${id}-${dir}`) as HTMLButtonElement | null;
}

describe("/settings/dashboard SSR", () => {
  it("is headed by a focusable h1 reading Dashboard", () => {
    const h1s = renderPage().querySelectorAll("h1");
    expect(h1s).toHaveLength(1);
    expect(textOf(h1s[0])).toBe("Dashboard");
    expect(h1s[0].getAttribute("tabindex")).toBe("-1");
  });

  it("has exactly one role=status, before the first form", () => {
    const doc = renderPage();
    const statuses = doc.querySelectorAll('[role="status"]');
    expect(statuses).toHaveLength(1);
    const form = doc.querySelector("form")!;
    expect(statuses[0].compareDocumentPosition(form) & 4).toBeTruthy();
  });

  it("pins Due first on a scheduled account", () => {
    const doc = renderPage();
    const pinned = doc.querySelector("[data-pinned]");
    expect(textOf(pinned!)).toBe(
      "Due now: always first whenever something is due, so nothing overdue sits below the fold.",
    );
    expect(pinned!.querySelector("button, a, input")).toBeNull();
    // A paragraph directly above the list, not an item in it, so the list's
    // own numbering matches the visible positions and the announcements.
    expect(pinned!.tagName).toBe("P");
    expect(pinned!.nextElementSibling).toBe(doc.querySelector("ol[data-sections]"));
  });

  it("numbers only the movable sections in the list (Review Minor 8)", () => {
    const list = renderPage().querySelector("ol[data-sections]")!;
    expect(list.querySelector("[data-pinned]")).toBeNull();
    const items = [...list.children];
    expect(items).toHaveLength(4);
    expect(items.every((li) => li.tagName === "LI" && li.hasAttribute("data-section"))).toBe(true);
  });

  it("lists the four sections in the confirmed order", () => {
    const order: DashboardSectionId[] = ["refills", "done", "later", "quickLog"];
    const doc = renderPage({ dashboardSectionOrder: order });
    expect(rows(doc).map((r) => r.dataset.section)).toEqual(order);
    expect(rows(doc).map((r) => textOf(r.querySelector("[data-position]")!))).toEqual([
      "1",
      "2",
      "3",
      "4",
    ]);
  });

  for (const confirmed of [
    null,
    ["refills", "quickLog", "later", "done"],
    ["later", "done"],
  ] as Array<DashboardSectionId[] | null>) {
    it(`every live ↑/↓ posts moveSection of the confirmed order (${JSON.stringify(confirmed)})`, () => {
      const doc = renderPage({ dashboardSectionOrder: confirmed });
      const resolved = normaliseSectionOrder(confirmed, "scheduled");
      let live = 0;
      resolved.forEach((id, index) => {
        for (const dir of ["up", "down"] as const) {
          const button = moveButton(doc, id, dir)!;
          expect(button, `${id} ${dir}`).not.toBeNull();
          expect(button.getAttribute("aria-label")).toBe(`Move ${SECTION_LABELS[id]} ${dir}`);
          const atEnd = dir === "up" ? index === 0 : index === resolved.length - 1;
          if (atEnd) {
            expect(button.getAttribute("type")).toBe("button");
            expect(button.getAttribute("aria-disabled")).toBe("true");
            expect(button.hasAttribute("value")).toBe(false);
            expect(button.hasAttribute("name")).toBe(false);
          } else {
            live++;
            expect(button.getAttribute("type")).toBe("submit");
            expect(button.getAttribute("aria-disabled")).toBeNull();
            expect(button.getAttribute("name")).toBe("dashboardSectionOrder");
            expect(button.getAttribute("value")).toBe(orderValue(moveSection(resolved, id, dir)));
            expect(button.closest("form")!.getAttribute("action")).toBe("?/dashboardSectionOrder");
            expect(button.closest("form")!.getAttribute("method")).toBe("POST");
          }
        }
      });
      expect(live).toBe((resolved.length - 1) * 2);
    });
  }

  it("Later's ↑ from the default posts later,done,quickLog,refills", () => {
    expect(moveButton(renderPage(), "later", "up")!.getAttribute("value")).toBe(
      "later,done,quickLog,refills",
    );
  });

  for (const shown of [true, false]) {
    it(`each hideable Toggle posts the opposite of its confirmed flag (shown: ${shown})`, () => {
      const doc = renderPage({
        dashboardShowLater: shown,
        dashboardShowQuickLog: shown,
        dashboardShowRefills: shown,
      });
      for (const id of HIDEABLE_SECTIONS) {
        const row = doc.querySelector(`li[data-section="${id}"]`)!;
        const toggle = row.querySelector<HTMLButtonElement>("button[aria-pressed]")!;
        expect(accessibleName(toggle)).toBe(`Show ${SECTION_LABELS[id]}`);
        expect(toggle.getAttribute("type")).toBe("submit");
        expect(toggle.getAttribute("aria-pressed")).toBe(String(shown));
        expect(toggle.getAttribute("name")).toBe(FLAG_KEY[id]);
        expect(toggle.getAttribute("value")).toBe(shown ? "off" : "on");
        expect(toggle.closest("form")!.getAttribute("action")).toBe(`?/${FLAG_KEY[id]}`);
      }
    });
  }

  it("Done has no visibility control and reads Always shown", () => {
    const row = renderPage().querySelector('li[data-section="done"]')!;
    expect(row.querySelector("button[aria-pressed]")).toBeNull();
    expect(textOf(row)).toContain("Always shown");
  });

  it("explains what hiding Quick log and Refills does", () => {
    const off = renderPage({ dashboardShowQuickLog: false });
    expect(textOf(off.querySelector('li[data-section="quickLog"]')!)).toContain(
      "1–9 shortcuts are off while hidden",
    );
    const on = renderPage();
    expect(textOf(on.querySelector('li[data-section="quickLog"]')!)).not.toContain(
      "1–9 shortcuts are off while hidden",
    );
    // The Refills hint shows only while Refills is hidden, like the Quick log hint.
    expect(textOf(on.querySelector('li[data-section="refills"]')!)).not.toContain(
      "Urgent refills still appear",
    );
    const refillsOff = renderPage({ dashboardShowRefills: false });
    expect(textOf(refillsOff.querySelector('li[data-section="refills"]')!)).toContain(
      "Urgent refills still appear",
    );
  });

  describe("as-needed-only", () => {
    const stored: DashboardSectionId[] = ["refills", "later", "quickLog", "done"];

    it("pins Log a dose and lists only Done and Refills, normalised for the variant", () => {
      const doc = renderPage({ dashboardSectionOrder: stored }, "as-needed-only");
      expect(textOf(doc.querySelector("p[data-pinned]")!)).toBe("Log a dose: always first");
      const expected = normaliseSectionOrder(stored, "as-needed-only");
      expect(expected).toEqual(["refills", "done"]);
      expect(rows(doc).map((r) => r.dataset.section)).toEqual(expected);
      const full = normaliseSectionOrder(stored, "scheduled");
      expect(moveButton(doc, "done", "up")!.getAttribute("value")).toBe(
        orderValue(mergeVisibleOrder(moveSection(expected, "done", "up"), full)),
      );
      expect(moveButton(doc, "refills", "down")!.getAttribute("value")).toBe(
        orderValue(mergeVisibleOrder(moveSection(expected, "refills", "down"), full)),
      );
      expect(moveButton(doc, "refills", "up")!.getAttribute("aria-disabled")).toBe("true");
      expect(moveButton(doc, "done", "down")!.getAttribute("aria-disabled")).toBe("true");
    });

    it("posts every stored id, moving only Done and Refills within their own slots (Review Minor 4)", () => {
      const doc = renderPage(
        { dashboardSectionOrder: ["later", "refills", "quickLog", "done"] },
        "as-needed-only",
      );
      expect(rows(doc).map((r) => r.dataset.section)).toEqual(["refills", "done"]);
      // Later keeps slot 1 and Quick log slot 3; Done and Refills swap.
      expect(moveButton(doc, "refills", "down")!.getAttribute("value")).toBe(
        "later,done,quickLog,refills",
      );
      expect(moveButton(doc, "done", "up")!.getAttribute("value")).toBe(
        "later,done,quickLog,refills",
      );
    });

    it("posts every id from the default order too", () => {
      const doc = renderPage({}, "as-needed-only");
      expect(rows(doc).map((r) => r.dataset.section)).toEqual(["done", "refills"]);
      expect(moveButton(doc, "done", "down")!.getAttribute("value")).toBe(
        "refills,later,quickLog,done",
      );
    });
  });

  describe("option groups", () => {
    const group = (doc: Document, key: string) =>
      doc.querySelector<HTMLFieldSetElement>(`fieldset[data-option-group="${key}"]`)!;
    const toggles = (fieldset: Element) => [
      ...fieldset.querySelectorAll<HTMLButtonElement>("button[aria-pressed]"),
    ];

    it("Later today: Next few / Whole day post dashboardLaterMode and follow the stored value", () => {
      for (const stored of ["next", "all"] as const) {
        const fieldset = group(renderPage({ dashboardLaterMode: stored }), "dashboardLaterMode");
        expect(textOf(fieldset.querySelector("legend")!)).toBe("Later today");
        const buttons = toggles(fieldset);
        expect(buttons.map((b) => accessibleName(b))).toEqual(["Next few", "Whole day"]);
        expect(buttons.map((b) => b.getAttribute("value"))).toEqual(["next", "all"]);
        for (const b of buttons) {
          expect(b.getAttribute("type")).toBe("submit");
          expect(b.getAttribute("name")).toBe("dashboardLaterMode");
          expect(b.closest("form")!.getAttribute("action")).toBe("?/dashboardLaterMode");
        }
        expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(
          stored === "next" ? ["true", "false"] : ["false", "true"],
        );
      }
    });

    it("Done today: three options post dashboardDoneTime and follow the stored value", () => {
      const values = ["both", "since", "clock"] as const;
      for (const stored of values) {
        const fieldset = group(renderPage({ dashboardDoneTime: stored }), "dashboardDoneTime");
        expect(textOf(fieldset.querySelector("legend")!)).toBe("Done today");
        const buttons = toggles(fieldset);
        expect(buttons.map((b) => accessibleName(b))).toEqual([
          "Time and how long ago",
          "How long ago",
          "Time only",
        ]);
        expect(buttons.map((b) => b.getAttribute("value"))).toEqual([...values]);
        for (const b of buttons) {
          expect(b.getAttribute("name")).toBe("dashboardDoneTime");
          expect(b.closest("form")!.getAttribute("action")).toBe("?/dashboardDoneTime");
        }
        expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(
          values.map((v) => String(v === stored)),
        );
      }
    });

    it("reads an unknown stored value as the default", () => {
      const doc = renderPage({
        dashboardLaterMode: "off",
        dashboardDoneTime: 7,
      } as unknown as Overrides);
      expect(
        toggles(group(doc, "dashboardLaterMode")).map((b) => b.getAttribute("aria-pressed")),
      ).toEqual(["true", "false"]);
      expect(
        toggles(group(doc, "dashboardDoneTime")).map((b) => b.getAttribute("aria-pressed")),
      ).toEqual(["true", "false", "false"]);
    });

    it("draws the Done sample from formatTimeSince and formatUserTime for a 2h15m-old dose", () => {
      const now = new Date("2026-04-15T12:00:00.000Z");
      const taken = new Date(now.getTime() - (2 * 60 + 15) * 60_000);
      const since = formatTimeSince(taken, now, preferencesFixture.timeSinceDaysFromHours);
      const clock = formatUserTime(taken, user.timezone, preferencesFixture.timeFormat as "12h");
      expect(since).toBe("2h 15m ago");
      const sample = (stored: UserPreferences["dashboardDoneTime"]) =>
        textOf(
          group(renderPage({ dashboardDoneTime: stored }), "dashboardDoneTime").querySelector(
            "[data-done-sample]",
          )!,
        );
      expect(sample("since")).toBe(`Looks like: ${since}`);
      expect(sample("clock")).toBe(`Looks like: ${clock}`);
      expect(sample("both")).toBe(`Looks like: ${clock}, ${since}`);
    });

    it("keeps the Later group, with a hint, while Later is hidden", () => {
      const hidden = renderPage({ dashboardShowLater: false });
      const fieldset = group(hidden, "dashboardLaterMode");
      expect(toggles(fieldset)).toHaveLength(2);
      expect(textOf(fieldset)).toContain("Later today is hidden");
      expect(textOf(group(renderPage(), "dashboardLaterMode"))).not.toContain(
        "Later today is hidden",
      );
    });
  });

  it("links to Appearance for when time since switches to days", () => {
    const doc = renderPage();
    const link = doc.querySelector<HTMLAnchorElement>('a[href="/settings/appearance"]');
    expect(link).not.toBeNull();
    expect(textOf(link!.closest("p")!)).toContain("Show days instead of hours after");
    // Below the Sections card, not inside it.
    const sections = doc.querySelector("ol[data-sections]")!;
    expect(sections.contains(link)).toBe(false);
    expect(sections.compareDocumentPosition(link!) & 4).toBeTruthy();
  });

  describe("Reset", () => {
    const resetIn = (doc: Document) =>
      [...doc.querySelectorAll("button")].find(
        (b) => textOf(b) === "Default: Done, Later, Quick log, Refills",
      );
    const resetButton = (doc: Document) =>
      doc.querySelector<HTMLButtonElement>('form[action="?/resetDashboardLayout"] button');

    it("names a scheduled account's default sections", () => {
      const reset = resetButton(renderPage({ dashboardShowLater: false }));
      expect(textOf(reset!)).toBe("Default: Done, Later, Quick log, Refills");
    });

    it("names only Done and Refills on an as-needed-only account (Review Important 3)", () => {
      const reset = resetButton(
        renderPage({ dashboardSectionOrder: ["refills", "done"] }, "as-needed-only"),
      );
      expect(textOf(reset!)).toBe("Default: Done, Refills");
    });

    it("is absent at the defaults", () => {
      expect(resetIn(renderPage())).toBeUndefined();
    });

    for (const [name, overrides] of [
      ["an empty stored order (Review Focus 1)", { dashboardSectionOrder: [] }],
      [
        "the default order stored explicitly",
        {
          dashboardSectionOrder: ["done", "later", "quickLog", "refills"],
        },
      ],
      ["a stored order", { dashboardSectionOrder: ["refills"] }],
      ["Later hidden", { dashboardShowLater: false }],
      ["Quick log hidden", { dashboardShowQuickLog: false }],
      ["Refills hidden", { dashboardShowRefills: false }],
    ] as Array<[string, Overrides]>) {
      it(`is present for ${name}`, () => {
        const reset = resetIn(renderPage(overrides));
        expect(reset).toBeDefined();
        expect(reset!.getAttribute("type")).toBe("submit");
        expect(reset!.closest("form")!.getAttribute("action")).toBe("?/resetDashboardLayout");
      });
    }

    it("renders the default page for an empty stored order", () => {
      expect(rows(renderPage({ dashboardSectionOrder: [] })).map((r) => r.dataset.section)).toEqual(
        ["done", "later", "quickLog", "refills"],
      );
    });
  });

  describe("back link", () => {
    it("reads ← Back to dashboard when arriving from the dashboard", () => {
      const doc = renderPage(
        {},
        "scheduled",
        "https://medtracker.test/settings/dashboard?from=dashboard",
      );
      const back = doc.querySelector<HTMLAnchorElement>('a[href="/dashboard"]');
      expect(back).not.toBeNull();
      expect(textOf(back!)).toBe("← Back to dashboard");
    });

    it("is the ordinary Settings link otherwise", () => {
      const doc = renderPage();
      expect(doc.querySelector('a[href="/dashboard"]')).toBeNull();
      expect(doc.body.textContent).not.toContain("Back to dashboard");
      expect(textOf(doc.querySelector('a[href="/settings"]')!)).toBe("← Settings");
    });
  });
});
