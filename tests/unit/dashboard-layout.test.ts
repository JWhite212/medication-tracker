import { describe, expect, it } from "vitest";
import {
  DASHBOARD_SECTIONS,
  DEFAULT_ORDER,
  HIDEABLE_SECTIONS,
  SECTION_LABELS,
  moveSection,
  normaliseAgainst,
  normaliseSectionOrder,
  orderValue,
  resolveDashboardLayout,
  type DashboardSectionId,
  type DashboardVariant,
} from "$lib/dashboard/layout";
import { preferenceFieldTypes } from "$lib/preferences/schema";

const ALL_ON = { showLater: true, showQuickLog: true, showRefills: true, hasUrgentRefill: false };

describe("resolveDashboardLayout defaults", () => {
  it("defaults reproduce today's two pages", () => {
    expect(resolveDashboardLayout({ order: null, ...ALL_ON, variant: "scheduled" })).toEqual({
      pinned: "due",
      sections: ["done", "later", "quickLog", "refills"],
      hidden: [],
      refillsUrgentOnly: false,
    });
    expect(resolveDashboardLayout({ order: null, ...ALL_ON, variant: "as-needed-only" })).toEqual({
      pinned: "quickLog",
      sections: ["done", "refills"],
      hidden: [],
      refillsUrgentOnly: false,
    });
  });

  it("[] behaves as the default", () => {
    for (const variant of ["scheduled", "as-needed-only"] as const) {
      expect(resolveDashboardLayout({ order: [], ...ALL_ON, variant })).toEqual(
        resolveDashboardLayout({ order: null, ...ALL_ON, variant }),
      );
    }
  });

  it("exposes labels and the hideable set", () => {
    expect(SECTION_LABELS).toEqual({
      done: "Done today",
      later: "Later today",
      quickLog: "Log something else",
      refills: "Refills",
    });
    expect([...HIDEABLE_SECTIONS]).toEqual(["later", "quickLog", "refills"]);
  });
});

describe("normalisation", () => {
  it("drops unknown, duplicate and non-string ids and inserts missing ids after their default predecessor", () => {
    expect(normaliseSectionOrder(["refills", "x", 3, "refills", "done"], "scheduled")).toEqual([
      "refills",
      "done",
      "later",
      "quickLog",
    ]);
  });

  it("a section added to the defaults later slots in after its predecessor", () => {
    expect(normaliseAgainst(["c", "a"], ["a", "b", "c", "d", "e"])).toEqual([
      "c",
      "d",
      "e",
      "a",
      "b",
    ]);
    expect(normaliseAgainst(["b"], ["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("returns the defaults for null or a non-array", () => {
    expect(normaliseAgainst(null, ["a", "b"])).toEqual(["a", "b"]);
    expect(normaliseAgainst("a", ["a", "b"])).toEqual(["a", "b"]);
    expect(normaliseAgainst({}, ["a", "b"])).toEqual(["a", "b"]);
  });
});

function subsetsWithPermutations<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  const permute = (rest: T[], acc: T[]) => {
    out.push(acc);
    for (let i = 0; i < rest.length; i++) {
      permute([...rest.slice(0, i), ...rest.slice(i + 1)], [...acc, rest[i]]);
    }
  };
  permute([...items], []);
  return out;
}

describe("property: every ordered subset x flags x variant x urgent", () => {
  const orders = subsetsWithPermutations(DASHBOARD_SECTIONS);
  it("enumerates 65 ordered subsets", () => {
    expect(orders).toHaveLength(65);
  });

  it("holds every invariant", () => {
    let cases = 0;
    for (const order of orders) {
      for (let mask = 0; mask < 8; mask++) {
        const showLater = !!(mask & 1);
        const showQuickLog = !!(mask & 2);
        const showRefills = !!(mask & 4);
        for (const variant of ["scheduled", "as-needed-only"] as const) {
          for (const hasUrgentRefill of [false, true]) {
            cases++;
            const r = resolveDashboardLayout({
              order,
              showLater,
              showQuickLog,
              showRefills,
              variant,
              hasUrgentRefill,
            });
            const label = JSON.stringify({ order, mask, variant, hasUrgentRefill });
            expect(r.sections, label).toContain("done");
            expect(new Set(r.sections).size, label).toBe(r.sections.length);
            if (variant === "as-needed-only") {
              expect(r.sections, label).not.toContain("later");
              expect(r.sections, label).not.toContain("quickLog");
            }
            expect(r.pinned, label).toBe(variant === "scheduled" ? "due" : "quickLog");
            expect(r.sections.includes("refills"), label).toBe(showRefills || hasUrgentRefill);
            expect(r.refillsUrgentOnly, label).toBe(!showRefills && hasUrgentRefill);

            const present = new Set<DashboardSectionId>(DEFAULT_ORDER[variant]);
            const expectedHidden = DASHBOARD_SECTIONS.filter((id) => {
              if (!present.has(id)) return false;
              if (id === "later") return !showLater;
              if (id === "quickLog") return !showQuickLog;
              if (id === "refills") return !showRefills && !hasUrgentRefill;
              return false;
            });
            expect([...r.hidden].sort(), label).toEqual([...expectedHidden].sort());
            for (const id of r.hidden) expect(r.sections, label).not.toContain(id);
          }
        }
      }
    }
    expect(cases).toBe(65 * 8 * 2 * 2);
  });
});

describe("seeded fuzz", () => {
  function prng(seed: number) {
    let s = seed >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 0x100000000;
    };
  }

  it("never throws and always yields a door-valid order", () => {
    const rand = prng(20261103);
    const pool: unknown[] = [
      ...DASHBOARD_SECTIONS,
      "x",
      "",
      "DONE",
      3,
      null,
      undefined,
      true,
      {},
      [],
      ["done"],
    ];
    const pick = () => pool[Math.floor(rand() * pool.length)];
    for (let i = 0; i < 500; i++) {
      const kind = Math.floor(rand() * 4);
      let raw: unknown;
      if (kind === 0) raw = pick();
      else if (kind === 1) raw = null;
      else raw = Array.from({ length: Math.floor(rand() * 8) }, pick);
      for (const variant of ["scheduled", "as-needed-only"] as DashboardVariant[]) {
        const out = normaliseSectionOrder(raw, variant);
        expect(preferenceFieldTypes.dashboardSectionOrder.safeParse(out).success).toBe(true);
        expect([...out].sort()).toEqual([...DEFAULT_ORDER[variant]].sort());
        const layout = resolveDashboardLayout({
          order: raw,
          ...ALL_ON,
          variant,
        });
        expect(preferenceFieldTypes.dashboardSectionOrder.safeParse(layout.sections).success).toBe(
          true,
        );
      }
    }
  });
});

describe("moveSection and orderValue", () => {
  it("moves a section and is a no-op at either end", () => {
    expect(moveSection(["done", "later"], "later", "up")).toEqual(["later", "done"]);
    expect(moveSection(["done", "later"], "done", "down")).toEqual(["later", "done"]);
    expect(moveSection(["done", "later"], "done", "up")).toEqual(["done", "later"]);
    expect(moveSection(["done", "later"], "later", "down")).toEqual(["done", "later"]);
  });

  it("does not mutate its input", () => {
    const o = ["done", "later"] as const;
    moveSection(o, "later", "up");
    expect([...o]).toEqual(["done", "later"]);
  });

  it("comma-joins", () => {
    expect(orderValue(["done", "refills"])).toBe("done,refills");
    expect(orderValue([])).toBe("");
  });
});
