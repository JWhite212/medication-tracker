// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  CUES,
  LOWER_THIRDS,
  SCENES,
  STAGE_H,
  STAGE_W,
  TOTAL_DURATION,
  WIN_H,
  WIN_W,
  activeCaption,
  clampCamera,
  computeFrame,
  fitCamera,
  trackPath,
  unionRects,
  type Measurements,
} from "$lib/components/walkthrough/timeline";
import {
  HEATMAP_WEEKS,
  HISTORY,
  MEDICATIONS,
  storyClock,
} from "$lib/components/walkthrough/demo-data";

// Stage point shots centre on; mirrors CX/CY in timeline.ts.
const CX = 960;
const CY = 421;

/** Sample every 20ms across the loop. */
const samples = Array.from({ length: Math.ceil(TOTAL_DURATION / 0.02) }, (_, i) => i * 0.02);

// A plausible measured layout, so framing code runs its real branches rather
// than the wide-shot fallback.
const MEASURED: Measurements = {
  "d.page": { x: 288, y: 0, w: 1152, h: 1500 },
  "d.strip": { x: 528, y: 88, w: 672, h: 54 },
  "d.morning": { x: 528, y: 290, w: 672, h: 170 },
  "d.evening": { x: 528, y: 580, w: 672, h: 80 },
  "d.night": { x: 528, y: 672, w: 672, h: 110 },
  "d.quick": { x: 528, y: 810, w: 672, h: 150 },
  "d.lisPill": { x: 720, y: 850, w: 120, h: 36 },
  "o.toast": { x: 1250, y: 830, w: 170, h: 46 },
  "m.card0": { x: 320, y: 110, w: 1080, h: 150 },
  "m.card1": { x: 320, y: 272, w: 1080, h: 150 },
  "m.card2": { x: 320, y: 434, w: 1080, h: 150 },
  "m.card3": { x: 320, y: 596, w: 1080, h: 150 },
  "a.h1": { x: 528, y: 32, w: 672, h: 32 },
  "a.name": { x: 553, y: 146, w: 622, h: 46 },
  "a.dose": { x: 553, y: 212, w: 622, h: 72 },
  "a.amount": { x: 553, y: 238, w: 303, h: 46 },
  "a.unit": { x: 872, y: 238, w: 303, h: 46 },
  "a.category": { x: 553, y: 390, w: 622, h: 72 },
  "l.h1": { x: 528, y: 32, w: 672, h: 32 },
  "l.form": { x: 528, y: 88, w: 672, h: 110 },
  "l.check": { x: 780, y: 160, w: 16, h: 16 },
  "n.stats": { x: 480, y: 170, w: 768, h: 170 },
  "n.heatTitle": { x: 505, y: 390, w: 200, h: 28 },
  "n.heatGrid": { x: 505, y: 434, w: 155, h: 83 },
  "s.twofa": { x: 528, y: 420, w: 672, h: 330 },
  "x.export": { x: 528, y: 120, w: 672, h: 380 },
  "x.download": { x: 553, y: 380, w: 140, h: 42 },
  "p.vitdLog": { x: 330, y: 400, w: 40, h: 20 },
};

describe("walkthrough scenes", () => {
  it("derives cues from the scene list, in order, with no gaps", () => {
    let expected = 0;
    for (const scene of SCENES) {
      expect(CUES[scene.name]).toBeCloseTo(expected, 6);
      expected += scene.dur;
    }
    expect(TOTAL_DURATION).toBeCloseTo(expected, 6);
    expect(TOTAL_DURATION).toBe(43.5);
  });
});

describe("computeFrame", () => {
  it("renders every sampled frame without throwing, measured or not", () => {
    for (const t of samples) {
      expect(() => computeFrame(t, {})).not.toThrow();
      expect(() => computeFrame(t, MEASURED)).not.toThrow();
    }
  });

  it("follows the shot list: title, desktop, phone, title", () => {
    expect(computeFrame(0, MEASURED).kind).toBe("title");
    expect(computeFrame(CUES.MyDay + 0.1, MEASURED).kind).toBe("desk");
    expect(computeFrame(CUES.Export + 1, MEASURED).kind).toBe("desk");
    expect(computeFrame(CUES.Reminders + 0.1, MEASURED).kind).toBe("phone");
    expect(computeFrame(CUES.Outro + 0.1, MEASURED).kind).toBe("title");
  });

  it("shows each desktop page during its own scenes", () => {
    const pageAt = (t: number) => computeFrame(t, MEASURED).page;
    expect(pageAt(CUES.QuickLog + 1)).toBe("dash");
    expect(pageAt(CUES.Medications + 1)).toBe("meds");
    expect(pageAt(CUES.Timers + 1)).toBe("meds");
    expect(pageAt(CUES.AddMedication + 1)).toBe("add");
    expect(pageAt(CUES.History + 1)).toBe("log");
    expect(pageAt(CUES.Analytics + 1)).toBe("ana");
    expect(pageAt(CUES.Security + 1)).toBe("sec");
    expect(pageAt(CUES.Export + 1)).toBe("data");
  });

  // The loop restarts from T=0, so the last frame must match the first or
  // the seam shows as a jump.
  it("ends on the frame it starts with", () => {
    const first = computeFrame(0, MEASURED);
    const last = computeFrame(TOTAL_DURATION - 1e-6, MEASURED);
    expect(last.kind).toBe(first.kind);
    expect(last.titleScale).toBeCloseTo(first.titleScale, 4);
    expect(last.outroExtras).toBeCloseTo(0, 3);
  });

  it("keeps every desktop shot inside the browser window", () => {
    for (const t of samples) {
      const frame = computeFrame(t, MEASURED);
      if (frame.kind !== "desk") continue;
      const { x, y, s } = frame.camera;
      const visibleW = STAGE_W / s;
      const visibleH = STAGE_H / s;
      // Only an axis on which the window is larger than the frame is bound.
      if (WIN_W >= visibleW) {
        expect(x - CX / s).toBeGreaterThanOrEqual(-1e-6);
        expect(x + (STAGE_W - CX) / s).toBeLessThanOrEqual(WIN_W + 1e-6);
      }
      if (WIN_H >= visibleH) {
        expect(y - CY / s).toBeGreaterThanOrEqual(-1e-6);
        expect(y + (STAGE_H - CY) / s).toBeLessThanOrEqual(WIN_H + 1e-6);
      }
    }
  });

  it("logs Lisinopril exactly once, during Quick Log", () => {
    const before = computeFrame(CUES.QuickLog + 1, MEASURED).dashboard;
    const after = computeFrame(CUES.QuickLog + 2.5, MEASURED).dashboard;
    expect(before.count).toBe(2);
    expect(before.lisinoprilDone).toBe(0);
    expect(after.count).toBe(3);
    expect(after.lisinoprilDone).toBeCloseTo(1, 3);
  });

  it("types the new medication a character at a time and never past its end", () => {
    const A = CUES.AddMedication;
    expect(computeFrame(A + 0.5, MEASURED).addForm.name).toBe("");
    const partial = computeFrame(A + 1.0, MEASURED).addForm.name;
    expect("Atorvastatin".startsWith(partial)).toBe(true);
    expect(partial.length).toBeGreaterThan(0);
    expect(partial.length).toBeLessThan("Atorvastatin".length);
    const done = computeFrame(CUES.History - 0.01, MEASURED).addForm;
    expect(done).toMatchObject({ name: "Atorvastatin", amount: "20", unit: "mg", focus: "unit" });
  });

  it("only shows a cursor on the shots that click something", () => {
    const withCursor = (t: number) => computeFrame(t, MEASURED).cursor !== null;
    expect(withCursor(CUES.MyDay + 1)).toBe(false);
    expect(withCursor(CUES.QuickLog + 1)).toBe(true);
    expect(withCursor(CUES.Medications + 1)).toBe(false);
    expect(withCursor(CUES.AddMedication + 1)).toBe(true);
    expect(withCursor(CUES.History + 1)).toBe(true);
    expect(withCursor(CUES.Analytics + 1)).toBe(false);
    expect(withCursor(CUES.Export + 1)).toBe(true);
    expect(withCursor(CUES.Reminders + 1)).toBe(false);
  });

  it("keeps every progress value within 0..1", () => {
    for (const t of samples) {
      const f = computeFrame(t, MEASURED);
      for (const v of [
        f.dashboard.lisinoprilDone,
        f.dashboard.entry,
        f.dashboard.flash,
        f.toast,
        f.tick,
        f.history.filtered,
        f.heat,
        f.phone.vitaminDDone,
        f.phone.toast,
        f.outroExtras,
      ]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("lower thirds", () => {
  it("covers each of the ten features in order", () => {
    expect(LOWER_THIRDS.map((l) => l.number)).toEqual([
      "01",
      "02",
      "03",
      "04",
      "05",
      "06",
      "07",
      "08",
      "09",
      "10",
    ]);
  });

  it("never shows a caption on the title card or across a cut", () => {
    for (const t of samples) {
      const caption = activeCaption(t);
      if (t < CUES.MyDay || t >= CUES.Outro) {
        expect(caption).toBeNull();
        continue;
      }
      if (!caption) continue;
      expect(t).toBeGreaterThanOrEqual(CUES[caption.item.scene]);
      expect(t).toBeLessThan(CUES[caption.item.until]);
      expect(caption.opacity).toBeGreaterThanOrEqual(0);
      expect(caption.opacity).toBeLessThanOrEqual(1);
    }
  });
});

describe("camera helpers", () => {
  it("unions rects and ignores missing ones", () => {
    expect(unionRects(null, null)).toBeNull();
    expect(unionRects({ x: 10, y: 20, w: 30, h: 40 }, null, { x: 0, y: 50, w: 10, h: 10 })).toEqual(
      { x: 0, y: 20, w: 40, h: 40 },
    );
  });

  it("caps how far a small target is zoomed", () => {
    expect(fitCamera({ x: 0, y: 0, w: 10, h: 10 }, 0, 2.2).s).toBe(2.2);
  });

  it("centres the frame on an axis where the window is too small to fill it", () => {
    const zoomedOut = clampCamera({ x: 0, y: 0, s: 0.5 });
    const left = CX / 0.5;
    const right = (STAGE_W - CX) / 0.5;
    expect(zoomedOut.x).toBeCloseTo(WIN_W / 2 + (left - right) / 2, 6);
  });

  it("holds a path at both ends and eases between keys", () => {
    const keys = [
      [1, { x: 0, y: 0 }],
      [2, { x: 100, y: 50 }],
    ] as const;
    expect(trackPath(0, keys)).toEqual({ x: 0, y: 0 });
    expect(trackPath(3, keys)).toEqual({ x: 100, y: 50 });
    expect(trackPath(1.5, keys)).toEqual({ x: 50, y: 25 });
  });
});

describe("walkthrough demo data", () => {
  // Pinned rather than recomputed: the seed AND the draw order decide every
  // number on the analytics shot, so reordering the loop must fail here.
  it("is seeded, so every visitor and every prerender sees the same numbers", () => {
    expect(HISTORY.total).toBe(602);
    expect(HISTORY.averageAdherence).toBe(84);
  });

  it("has 90 days of history laid out as Sunday-first week columns", () => {
    expect(HISTORY.daily).toHaveLength(90);
    expect(HEATMAP_WEEKS.flat()).toHaveLength(90);
    for (const week of HEATMAP_WEEKS) {
      const rows = week.map((c) => c.row);
      expect(rows).toEqual([...rows].sort((a, b) => a - b));
    }
    // The story day, Thursday 24 September 2026, is the last cell.
    expect(HEATMAP_WEEKS.at(-1)?.at(-1)?.row).toBe(4);
  });

  it("keeps adherence figures as percentages", () => {
    for (const value of [
      HISTORY.averageAdherence,
      ...HISTORY.weeklyAdherence,
      ...HISTORY.perMedication.map((m) => m.adherence),
    ]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
    expect(HISTORY.sparklines).toHaveLength(MEDICATIONS.length);
  });

  it("formats story times in either clock format, independent of the viewer's timezone", () => {
    // ICU versions disagree on the leading zero for en-GB numeric hours.
    expect(storyClock("08:02", "24h")).toMatch(/^0?8:02$/);
    expect(storyClock("22:05", "12h")).toMatch(/^10:05\s?pm$/i);
  });
});
