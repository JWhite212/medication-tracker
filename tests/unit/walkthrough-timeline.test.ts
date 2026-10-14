// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { render } from "svelte/server";
import WalkthroughVideo from "$lib/components/walkthrough/WalkthroughVideo.svelte";
import { DOSE_UNDO_WINDOW_MS } from "$lib/utils/dose-undo";
import { ssrDocument } from "./helpers/axe-ssr";
import { textOf } from "./helpers/dom-names";
import {
  CUES,
  LOWER_THIRDS,
  REQUIRED_MARKS,
  SCENES,
  STAGE_H,
  STAGE_W,
  TOTAL_DURATION,
  T_LOG,
  T_TAP,
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

/**
 * The measurements, wrapped so every key read off them lands in `read`. Reads
 * are recorded rather than grepped from timeline.ts, because a key built at
 * runtime ("m.card" + i) never appears in the source as a literal.
 */
function recordingMeasurements(base: Measurements, read: Set<string>): Measurements {
  return new Proxy(base, {
    get(target, key, receiver) {
      if (typeof key === "string") read.add(key);
      return Reflect.get(target, key, receiver);
    },
    has(target, key) {
      if (typeof key === "string") read.add(key);
      return Reflect.has(target, key);
    },
  });
}

/** A repo file's text with whitespace squashed, so prettier's wrapping cannot matter. */
function source(rel: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8").replace(
    /\s+/g,
    " ",
  );
}

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

  // Spec D2: the same twelve scenes, durations and 43.5s loop. Two are renamed
  // for what they now show, the Today page and its Log now button.
  it("keeps twelve scenes and their durations, named for what each one shows", () => {
    expect(SCENES.map((s) => [s.name, s.dur])).toEqual([
      ["Title", 2.5],
      ["Today", 3.5],
      ["LogNow", 4],
      ["Medications", 3.5],
      ["Timers", 3.5],
      ["AddMedication", 4],
      ["History", 3.5],
      ["Analytics", 4],
      ["Security", 3.5],
      ["Export", 3.5],
      ["Reminders", 5],
      ["Outro", 3],
    ]);
  });

  it("keys the two log beats to their own scenes", () => {
    expect(T_LOG).toBeCloseTo(CUES.LogNow + 1.45, 9);
    expect(T_TAP).toBeCloseTo(CUES.Reminders + 3.0, 9);
    expect(T_LOG).toBeLessThan(CUES.Medications);
    expect(T_TAP).toBeLessThan(CUES.Outro);
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
    expect(computeFrame(CUES.Today + 0.1, MEASURED).kind).toBe("desk");
    expect(computeFrame(CUES.Export + 1, MEASURED).kind).toBe("desk");
    expect(computeFrame(CUES.Reminders + 0.1, MEASURED).kind).toBe("phone");
    expect(computeFrame(CUES.Outro + 0.1, MEASURED).kind).toBe("title");
  });

  it("shows each desktop page during its own scenes", () => {
    const pageAt = (t: number) => computeFrame(t, MEASURED).page;
    expect(pageAt(CUES.LogNow + 1)).toBe("dash");
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

  it("logs Lisinopril exactly once, during Log now", () => {
    const before = computeFrame(CUES.LogNow + 1, MEASURED).dashboard;
    const after = computeFrame(CUES.LogNow + 2.5, MEASURED).dashboard;
    expect(before.count).toBe(2);
    expect(before.lisinoprilDone).toBe(0);
    expect(after.count).toBe(3);
    expect(after.lisinoprilDone).toBeCloseTo(1, 3);
  });

  // T_LOG and T_TAP are the instants computeFrame animates around, not two
  // numbers that merely agree with it: the click lands on one, the tap on the other.
  it("clicks to log at T_LOG on the desktop and taps at T_TAP on the phone", () => {
    expect(computeFrame(T_LOG - 0.01, MEASURED).cursor?.ripple).toBeNull();
    expect(computeFrame(T_LOG, MEASURED).cursor?.ripple?.p).toBe(0);
    expect(computeFrame(T_TAP - 0.2, MEASURED).phone.touch?.press).toBe(0);
    expect(computeFrame(T_TAP, MEASURED).phone.touch?.press).toBe(1);
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
    expect(withCursor(CUES.Today + 1)).toBe(false);
    expect(withCursor(CUES.LogNow + 1)).toBe(true);
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
      if (t < CUES.Today || t >= CUES.Outro) {
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

  // Spec Section 1's table, verbatim. Captions 03 and 05-09 were checked and are true.
  it("says what the redrawn walkthrough shows", () => {
    const byNumber = new Map(LOWER_THIRDS.map((l) => [l.number, l]));
    expect(byNumber.get("01")).toMatchObject({
      scene: "Today",
      until: "LogNow",
      title: "Today",
      line: "What's due now, what's done and what's next.",
      tech: "Every row on the page decided by one matcher, on the server",
    });
    expect(byNumber.get("02")).toMatchObject({
      scene: "LogNow",
      until: "Medications",
      title: "Log now",
      line: "One tap to log, and Undo for ten minutes.",
      tech: "Single-fire writes, re-checked under a row lock on the server",
    });
    expect(byNumber.get("04")).toMatchObject({
      title: "Live timers",
      line: "When each medication was last taken, always current.",
      tech: "Recomputed every minute, with a visibilitychange catch-up",
    });
    expect(byNumber.get("10")).toMatchObject({
      title: "Reminders",
      line: "Overdue reminders by push and email.",
      tech: "Web Push on a half-hourly daytime sweep, with idempotent dedupe keys",
    });
  });

  // Review Focus 3. Each phrase was true once and is not now: since #170 the
  // dashboard has no "My Day" grouping and calls its chips "Log something
  // else", no page has shown a next-due time since 0b8c95f, and the reminder
  // sweep is GitHub Actions' reminder-tick, with Vercel Cron a daily backstop.
  it("never names a feature the app no longer has", () => {
    for (const item of LOWER_THIRDS) {
      const said = `${item.title} ${item.line} ${item.tech}`.toLowerCase();
      for (const stale of ["my day", "quick log", "next due", "vercel cron"]) {
        expect(said, `caption ${item.number} says "${stale}"`).not.toContain(stale);
      }
    }
  });

  // Two captions make claims about the code. Each is tied to the thing it
  // describes, so changing that thing fails here until the caption follows.
  it("keeps its claims about the Undo window and the reminder sweep true", () => {
    const logNow = LOWER_THIRDS.find((l) => l.number === "02");
    expect(logNow?.line).toContain("Undo for ten minutes");
    expect(DOSE_UNDO_WINDOW_MS).toBe(10 * 60_000);
    const reminders = LOWER_THIRDS.find((l) => l.number === "10");
    expect(reminders?.tech).toContain("half-hourly daytime sweep");
    expect(source(".github/workflows/reminder-tick.yml")).toContain('cron: "*/30 6-22 * * *"');
  });
});

describe("REQUIRED_MARKS", () => {
  // A mark computeFrame reads but nobody registered sends the camera to the
  // wide shot and the cursor to the window centre, silently. The list is the
  // contract between computeFrame and the stage's use:mark registrations, so it
  // must be exactly the keys computeFrame reads: measured or not, because a key
  // read only on the fallback path is still a key the frame depends on.
  it("lists exactly the mark keys computeFrame reads, over the whole loop", () => {
    const read = new Set<string>();
    const bases: Measurements[] = [MEASURED, {}];
    for (const base of bases) {
      const measurements = recordingMeasurements(base, read);
      for (const t of samples) computeFrame(t, measurements);
    }
    expect([...read].sort()).toEqual([...REQUIRED_MARKS].sort());
  });

  it("lists each key once", () => {
    expect(new Set(REQUIRED_MARKS).size).toBe(REQUIRED_MARKS.length);
  });

  // Otherwise a framing test could be running on the wide-shot fallback.
  it("is exactly what the MEASURED fixture measures", () => {
    expect(Object.keys(MEASURED).sort()).toEqual([...REQUIRED_MARKS].sort());
  });
});

describe("the screen-reader text", () => {
  // Review Focus 3: the sr-only figcaption is the walkthrough for anyone not
  // watching it, and it is built from LOWER_THIRDS. Rendered, not read from
  // source, so a change to how the list is built is caught too.
  it("lists every lower third as its title and line, in order", () => {
    const doc = ssrDocument(render(WalkthroughVideo).body);
    const items = [...doc.querySelectorAll("figcaption ol > li")].map(textOf);
    expect(items).toEqual(LOWER_THIRDS.map((l) => `${l.title}: ${l.line}`));
  });
});

describe("the landing page", () => {
  // The sentence under "See it in action" claims the loop's length and feature count.
  it("says the walkthrough is under a minute and ten features, which it is", () => {
    const intro = /See it in action <\/h2> <p[^>]*> (.*?) <\/p>/.exec(
      source("src/routes/+page.svelte"),
    )?.[1];
    expect(intro).toBe(
      "Under a minute, ten features, from the first dose of the day to an overdue reminder.",
    );
    expect(TOTAL_DURATION).toBeLessThan(60);
    expect(LOWER_THIRDS).toHaveLength(10);
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
