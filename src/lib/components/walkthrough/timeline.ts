// The walkthrough is one element tree rendered as a pure function of a single
// time axis, T (seconds since the start of the loop). Nothing here touches the
// DOM: WalkthroughVideo.svelte measures a handful of elements once, hands the
// rects in as `Measurements`, and renders whatever `computeFrame` returns. That
// keeps every shot, cursor path and fade unit-testable without a browser.

export type Rect = { x: number; y: number; w: number; h: number };
export type Point = { x: number; y: number };
export type Camera = { x: number; y: number; s: number };
export type Measurements = Partial<Record<string, Rect>>;

// ── Scenes ──
// Order and durations are the storyboard. Cue times are derived from this list
// so there is exactly one place that decides when anything happens.
export const SCENES = [
  { name: "Title", dur: 2.5 },
  { name: "MyDay", dur: 3.5 },
  { name: "QuickLog", dur: 4 },
  { name: "Medications", dur: 3.5 },
  { name: "Timers", dur: 3.5 },
  { name: "AddMedication", dur: 4 },
  { name: "History", dur: 3.5 },
  { name: "Analytics", dur: 4 },
  { name: "Security", dur: 3.5 },
  { name: "Export", dur: 3.5 },
  { name: "Reminders", dur: 5 },
  { name: "Outro", dur: 3 },
] as const;

export type SceneName = (typeof SCENES)[number]["name"];

function deriveCues(): { cues: Record<SceneName, number>; total: number } {
  const cues = {} as Record<SceneName, number>;
  let start = 0;
  for (const scene of SCENES) {
    // Rounded to the millisecond so float drift from summing 0.5s steps
    // cannot push a cue a hair past the frame it should land on.
    cues[scene.name] = Math.round(start * 1000) / 1000;
    start += scene.dur;
  }
  return { cues, total: Math.round(start * 1000) / 1000 };
}

const derived = deriveCues();
export const CUES: Readonly<Record<SceneName, number>> = derived.cues;
export const TOTAL_DURATION = derived.total;

// ── Motion ──
// The only three easing helpers in the piece. `enter` eases out (things
// arriving), `move` eases in and out (camera pans, cursor travel) and `drift`
// is linear (slow push-ins that should not visibly accelerate).
export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export const MOTION = {
  enter: (T: number, start: number, dur: number) => easeOut(clamp01((T - start) / dur)),
  move: (T: number, start: number, dur: number) => easeInOut(clamp01((T - start) / dur)),
  drift: (T: number, start: number, dur: number) => clamp01((T - start) / dur),
};

// ── Stage and camera geometry ──
export const STAGE_W = 1920;
export const STAGE_H = 1080;
export const WIN_W = 1440;
export const WIN_H = 984;
// The fake Chrome window's tab bar (44) plus toolbar (40). Measured rects are
// relative to the app shell, so they are shifted down by this much to land in
// window space.
export const BROWSER_BAR = 84;
// The stage point a shot centres on. It sits above the middle so the lower
// third has room underneath.
const CX = 960;
const CY = 421;
const SAFE_W = 1700;
const SAFE_H = 730;
const WIDE: Camera = { x: 720, y: 492 - (540 - CY) / 0.96, s: 0.96 };

const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
const lerpCam = (a: Camera, b: Camera, p: number): Camera => ({
  x: lerp(a.x, b.x, p),
  y: lerp(a.y, b.y, p),
  s: lerp(a.s, b.s, p),
});
const zoom = (c: Camera, k: number): Camera => ({ x: c.x, y: c.y, s: c.s * k });

/**
 * Keep the frame inside the browser window. When the window is smaller than
 * the frame on an axis, centre it on that axis instead of letting the stage
 * background show on one side only.
 */
export function clampCamera({ x, y, s }: Camera): Camera {
  const left = CX / s;
  const right = (STAGE_W - CX) / s;
  const top = CY / s;
  const bottom = (STAGE_H - CY) / s;
  return {
    x:
      WIN_W >= left + right
        ? Math.min(Math.max(x, left), WIN_W - right)
        : WIN_W / 2 + (left - right) / 2,
    y:
      WIN_H >= top + bottom
        ? Math.min(Math.max(y, top), WIN_H - bottom)
        : WIN_H / 2 + (top - bottom) / 2,
    s,
  };
}

/** Frame a rect inside the safe area, capped so small targets are not blown up. */
export function fitCamera(r: Rect | null, pad = 32, cap = 2.2): Camera {
  if (!r) return WIDE;
  return {
    x: r.x + r.w / 2,
    y: r.y + r.h / 2,
    s: Math.min(SAFE_W / (r.w + pad * 2), SAFE_H / (r.h + pad * 2), cap),
  };
}

export function unionRects(...rects: Array<Rect | null>): Rect | null {
  const rs = rects.filter((r): r is Rect => r !== null);
  if (rs.length === 0) return null;
  const x0 = Math.min(...rs.map((r) => r.x));
  const y0 = Math.min(...rs.map((r) => r.y));
  return {
    x: x0,
    y: y0,
    w: Math.max(...rs.map((r) => r.x + r.w)) - x0,
    h: Math.max(...rs.map((r) => r.y + r.h)) - y0,
  };
}

/** Piecewise eased path through timed keyframes. Holds at both ends. */
export function trackPath(T: number, keys: ReadonlyArray<readonly [number, Point]>): Point {
  if (T <= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, a] = keys[i];
    const [t1, b] = keys[i + 1];
    if (T <= t1) {
      const p = MOTION.move(T, t0, Math.max(t1 - t0, 1e-6));
      return { x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p) };
    }
  }
  return keys[keys.length - 1][1];
}

// ── Lower thirds ──
// Feature number, one plain line and one technical fact from the README.
// `delay` is how long after the scene's cue the caption appears.
export type LowerThird = {
  scene: SceneName;
  until: SceneName;
  delay: number;
  number: string;
  title: string;
  line: string;
  tech: string;
};

export const LOWER_THIRDS: readonly LowerThird[] = [
  {
    scene: "MyDay",
    until: "QuickLog",
    delay: 0.9,
    number: "01",
    title: "My Day",
    line: "Today's doses, grouped by time of day.",
    tech: "Interval, fixed-time and as-needed schedules",
  },
  {
    scene: "QuickLog",
    until: "Medications",
    delay: 0.15,
    number: "02",
    title: "Quick Log",
    line: "Log a dose with a single tap.",
    tech: "Server-first SvelteKit form actions",
  },
  {
    scene: "Medications",
    until: "Timers",
    delay: 0.15,
    number: "03",
    title: "Medications",
    line: "Adherence, supply and a 14-day trend for each one.",
    tech: "Inline-SVG sparklines, no chart library",
  },
  {
    scene: "Timers",
    until: "AddMedication",
    delay: 0.15,
    number: "04",
    title: "Live timers",
    line: "Last taken and next due for every medication.",
    tech: "Recomputed every minute, with a visibilitychange catch-up",
  },
  {
    scene: "AddMedication",
    until: "History",
    delay: 0.15,
    number: "05",
    title: "Add medication",
    line: "Dose, form and schedule in one form.",
    tech: "Medication, schedules and audit row in one transaction",
  },
  {
    scene: "History",
    until: "Analytics",
    delay: 0.15,
    number: "06",
    title: "Dose history",
    line: "Filter by medication, status, date or side effects.",
    tech: "A plain GET form that works without JavaScript",
  },
  {
    scene: "Analytics",
    until: "Security",
    delay: 0.15,
    number: "07",
    title: "Analytics",
    line: "Streaks, adherence and a 90-day heatmap.",
    tech: "Pure, unit-tested analytics functions",
  },
  {
    scene: "Security",
    until: "Export",
    delay: 0.15,
    number: "08",
    title: "Security",
    line: "Two-factor sign-in with an authenticator app.",
    tech: "Argon2id passwords · TOTP secrets in AES-256-GCM",
  },
  {
    scene: "Export",
    until: "Reminders",
    delay: 0.15,
    number: "09",
    title: "Export",
    line: "Download your history as a PDF or CSV report.",
    tech: "CSV cells escaped against formula injection",
  },
  {
    scene: "Reminders",
    until: "Outro",
    delay: 0.3,
    number: "10",
    title: "Reminders",
    line: "Overdue reminders by push and email.",
    tech: "Web Push via Vercel Cron, with idempotent dedupe keys",
  },
];

const CAPTION_FADE = 0.18;

/** The lower third on screen at T, with its fade-in/out opacity. */
export function activeCaption(T: number): { item: LowerThird; opacity: number } | null {
  for (const item of LOWER_THIRDS) {
    const start = CUES[item.scene] + item.delay;
    // Ends a hair before the next cue so two captions never overlap a cut.
    const end = CUES[item.until] - 0.02;
    if (T >= start && T < end) {
      const opacity = clamp01(Math.min((T - start) / CAPTION_FADE, (end - T) / CAPTION_FADE));
      return { item, opacity };
    }
  }
  return null;
}

// ── Frame ──
export type DesktopPage = "dash" | "meds" | "add" | "log" | "ana" | "sec" | "data";
export type ShotKind = "title" | "desk" | "phone";
export type CursorState = {
  x: number;
  y: number;
  press: number;
  ripple: { x: number; y: number; p: number } | null;
};

export type Frame = {
  kind: ShotKind;
  page: DesktopPage;
  scroll: number;
  camera: Camera;
  cursor: CursorState | null;
  dashboard: {
    count: number;
    lisinoprilDone: number;
    labelGone: number;
    entry: number;
    pillHover: boolean;
    pillPress: number;
    flash: number;
    pulse: number;
  };
  toast: number;
  medicationsLoad: number;
  tick: number;
  addForm: {
    focus: "name" | "amount" | "unit" | null;
    name: string;
    amount: string;
    unit: string;
    caret: boolean;
  };
  history: { checked: boolean; filtered: number };
  analyticsLoad: number;
  heat: number;
  downloadHover: boolean;
  phone: {
    bannerY: number;
    vitaminDDone: number;
    toast: number;
    touch: { x: number; y: number; opacity: number; press: number } | null;
    scale: number;
  };
  titleScale: number;
  outroExtras: number;
};

/** Press-in over 150ms before a click, release over 150ms after it. */
function pressAt(T: number, click: number): number {
  if (T < click - 0.15 || T >= click + 0.15) return 0;
  return T < click ? MOTION.enter(T, click - 0.15, 0.15) : 1 - MOTION.enter(T, click, 0.15);
}

/**
 * Everything on screen at time T, given element rects measured from the
 * rendered app shell (keys prefixed "d.", "m.", "a.", "l.", "n.", "s.", "x.",
 * "o.") and phone ("p."). Missing rects fall back to the wide shot, so the
 * first frame before measurement still renders sensibly.
 */
export function computeFrame(T: number, M: Measurements): Frame {
  const c = CUES;
  // Shell rects are relative to the app shell; shift them into window space
  // and optionally compensate for the dashboard's scroll offset.
  const R = (k: string, scroll = 0): Rect | null => {
    const r = M[k];
    return r ? { x: r.x, y: r.y + BROWSER_BAR - scroll, w: r.w, h: r.h } : null;
  };
  const at = (r: Rect | null, fx = 0.5, fy = 0.5): Point =>
    r ? { x: r.x + r.w * fx, y: r.y + r.h * fy } : { x: 720, y: 492 };

  // Key moments, all keyed to scene cues.
  const tLog = c.QuickLog + 1.45;
  const tCheck = c.History + 1.3;
  const tDownload = c.Export + 1.5;
  const tTap = c.Reminders + 3.0;
  const A = c.AddMedication;

  const dPage = M["d.page"];
  const dQuick = M["d.quick"];
  // Scroll that brings Quick Log up to the middle of the window.
  const quickScroll = dPage && dQuick ? Math.max(0, Math.min(dPage.h - 900, dQuick.y - 540)) : 0;

  // ── Shot list: hard cuts, and each shot drifts or pans ──
  let kind: ShotKind = "desk";
  let page: DesktopPage = "dash";
  let scroll = 0;
  let camera = WIDE;
  let cursorPath: { keys: Array<readonly [number, Point]>; clicks: number[] } | null = null;

  if (T < c.MyDay || T >= c.Outro) {
    kind = "title";
  } else if (T >= c.Reminders) {
    kind = "phone";
  } else if (T < c.MyDay + 0.9) {
    camera = lerpCam(WIDE, zoom(WIDE, 1.04), MOTION.drift(T, c.MyDay, 0.9));
  } else if (T < c.QuickLog) {
    // Open on the summary and morning group, then pan down the timeline.
    const myDayScroll = dPage ? Math.max(0, Math.min(dPage.h - 900, 220)) : 0;
    const p = MOTION.move(T, c.MyDay + 1.1, c.QuickLog - c.MyDay - 1.2);
    scroll = myDayScroll * p;
    const from = fitCamera(unionRects(R("d.strip"), R("d.morning")), 28, 1.9);
    const to = fitCamera(
      unionRects(R("d.evening", myDayScroll), R("d.night", myDayScroll)),
      28,
      1.9,
    );
    camera = lerpCam(from, to, p);
  } else if (T < c.Medications) {
    scroll = quickScroll;
    const base = fitCamera(unionRects(R("d.quick", quickScroll), R("o.toast")), 30, 2.0);
    camera = lerpCam(
      base,
      zoom(base, 1.05),
      MOTION.drift(T, c.QuickLog, c.Medications - c.QuickLog),
    );
    const pill = at(R("d.lisPill", quickScroll), 0.42, 0.62);
    cursorPath = {
      keys: [
        [c.QuickLog, { x: pill.x + 230, y: pill.y + 170 }],
        [c.QuickLog + 1.05, pill],
        [tLog + 0.35, pill],
        [tLog + 1.3, { x: pill.x + 70, y: pill.y + 95 }],
      ],
      clicks: [tLog],
    };
  } else if (T < c.Timers) {
    page = "meds";
    const from = fitCamera(unionRects(R("m.card0"), R("m.card2")), 24, 1.6);
    const to = fitCamera(unionRects(R("m.card1"), R("m.card3")), 24, 1.6);
    camera = lerpCam(from, to, MOTION.move(T, c.Medications + 0.4, c.Timers - c.Medications - 0.4));
  } else if (T < A) {
    page = "meds";
    const r1 = R("m.card1");
    const r2 = R("m.card2");
    // Only the left of the two cards, where the "Last taken" timers sit.
    const base = fitCamera(
      r1 && r2 ? { x: r1.x, y: r1.y, w: 620, h: r2.y + r2.h - r1.y } : null,
      24,
      2.2,
    );
    camera = lerpCam(base, zoom(base, 1.08), MOTION.drift(T, c.Timers, A - c.Timers));
  } else if (T < c.History) {
    page = "add";
    const from = fitCamera(unionRects(R("a.h1"), R("a.category")), 30, 1.8);
    const to = fitCamera(unionRects(R("a.name"), R("a.dose")), 40, 2.1);
    camera = lerpCam(from, to, MOTION.move(T, A + 0.3, 1.3));
    const name = at(R("a.name"), 0.62, 0.8);
    const amount = at(R("a.amount"), 0.55, 0.8);
    const unit = at(R("a.unit"), 0.45, 0.8);
    cursorPath = {
      keys: [
        [A, { x: name.x + 240, y: name.y + 150 }],
        [A + 0.5, name],
        [A + 1.75, name],
        [A + 2.05, amount],
        [A + 2.75, amount],
        [A + 3.05, unit],
        [c.History, { x: unit.x + 30, y: unit.y + 60 }],
      ],
      clicks: [A + 0.55, A + 2.1, A + 3.1],
    };
  } else if (T < c.Analytics) {
    page = "log";
    const form = R("l.form");
    const heading = R("l.h1");
    const base = fitCamera(
      form && heading
        ? { x: form.x, y: heading.y, w: form.w, h: form.y + form.h + 250 - heading.y }
        : null,
      28,
      1.8,
    );
    camera = lerpCam(zoom(base, 1.06), base, MOTION.drift(T, c.History, c.Analytics - c.History));
    const check = at(R("l.check"));
    cursorPath = {
      keys: [
        [c.History, { x: check.x + 220, y: check.y + 160 }],
        [tCheck - 0.2, check],
        [tCheck + 0.6, check],
        [c.Analytics, { x: check.x + 60, y: check.y + 90 }],
      ],
      clicks: [tCheck],
    };
  } else if (T < c.Analytics + 1.9) {
    page = "ana";
    const base = fitCamera(R("n.stats"), 40, 2.1);
    camera = lerpCam(base, zoom(base, 1.06), MOTION.drift(T, c.Analytics, 1.9));
  } else if (T < c.Security) {
    page = "ana";
    const base = fitCamera(unionRects(R("n.heatTitle"), R("n.heatGrid")), 36, 3.2);
    camera = lerpCam(
      base,
      zoom(base, 1.07),
      MOTION.drift(T, c.Analytics + 1.9, c.Security - c.Analytics - 1.9),
    );
  } else if (T < c.Export) {
    page = "sec";
    const base = fitCamera(R("s.twofa"), 36, 2.0);
    camera = lerpCam(zoom(base, 1.08), base, MOTION.drift(T, c.Security, c.Export - c.Security));
  } else {
    page = "data";
    const base = fitCamera(R("x.export"), 36, 2.0);
    camera = lerpCam(base, zoom(base, 1.06), MOTION.drift(T, c.Export, c.Reminders - c.Export));
    const button = at(R("x.download"), 0.5, 0.62);
    cursorPath = {
      keys: [
        [c.Export, { x: button.x + 240, y: button.y + 150 }],
        [tDownload - 0.25, button],
        [c.Reminders, button],
      ],
      clicks: [tDownload],
    };
  }

  camera = clampCamera(camera);

  let cursor: CursorState | null = null;
  if (cursorPath) {
    const pos = trackPath(T, cursorPath.keys);
    let press = 0;
    let ripple: CursorState["ripple"] = null;
    for (const click of cursorPath.clicks) {
      press = Math.max(press, pressAt(T, click));
      if (T >= click && T < click + 0.5) {
        ripple = { x: pos.x, y: pos.y, p: MOTION.enter(T, click, 0.5) };
      }
    }
    cursor = { ...pos, press, ripple };
  }

  // ── Per-page state, all pure functions of T ──
  const typed = (text: string, t0: number, rate: number) =>
    T < t0 ? "" : text.slice(0, Math.min(text.length, Math.floor((T - t0) / rate) + 1));

  const R0 = c.Reminders;
  const phoneLog = M["p.vitdLog"];
  const touch = phoneLog
    ? {
        x: phoneLog.x + phoneLog.w / 2,
        y: phoneLog.y + phoneLog.h / 2,
        opacity: MOTION.enter(T, tTap - 0.4, 0.2) * (1 - MOTION.enter(T, tTap + 0.1, 0.3)),
        press: T < tTap ? MOTION.enter(T, tTap - 0.15, 0.15) : 1 - MOTION.enter(T, tTap, 0.15),
      }
    : null;

  return {
    kind,
    page,
    scroll,
    camera,
    cursor,
    dashboard: {
      count: T >= tLog + 0.15 ? 3 : 2,
      lisinoprilDone: MOTION.enter(T, tLog + 0.15, 0.3),
      labelGone: MOTION.enter(T, tLog + 0.15, 0.3),
      entry: MOTION.enter(T, tLog + 0.2, 0.4),
      pillHover: T >= c.QuickLog + 1.0 && T < tLog + 0.45,
      pillPress: pressAt(T, tLog),
      flash: T >= tLog && T < tLog + 0.6 ? MOTION.enter(T, tLog, 0.6) : 0,
      // Tailwind's animate-pulse (2s cycle) on the "Due now" label, driven by
      // T so it stays frame-accurate and pauses with the video.
      pulse: kind === "desk" && page === "dash" ? 0.75 + 0.25 * Math.cos(Math.PI * T) : 1,
    },
    toast:
      T < tLog + 0.2
        ? 0
        : T < tLog + 5.2
          ? MOTION.enter(T, tLog + 0.2, 0.3)
          : 1 - MOTION.enter(T, tLog + 5.2, 0.3),
    medicationsLoad: Math.max(0, Math.min(3, T - c.Medications)),
    tick: MOTION.enter(T, c.Timers + 1.6, 0.35),
    addForm: {
      focus: T >= A + 3.1 ? "unit" : T >= A + 2.1 ? "amount" : T >= A + 0.55 ? "name" : null,
      name: typed("Atorvastatin", A + 0.75, 0.07),
      amount: typed("20", A + 2.3, 0.12),
      unit: typed("mg", A + 3.3, 0.12),
      // Blinks, except while the name is being typed, when a real caret holds.
      caret: Math.floor((T - A) * 2.2) % 2 === 0 || (T > A + 0.7 && T < A + 1.65),
    },
    history: { checked: T >= tCheck, filtered: MOTION.enter(T, tCheck + 0.35, 0.3) },
    analyticsLoad: Math.max(0, Math.min(3, T - c.Analytics)),
    heat: MOTION.drift(T, c.Analytics + 2.1, 1.3),
    downloadHover: T >= tDownload - 0.3,
    phone: {
      // Slides down from above the status bar, then back up out of view.
      bannerY: -150 * (1 - MOTION.enter(T, R0 + 0.5, 0.45)) - 170 * MOTION.move(T, R0 + 2.3, 0.35),
      vitaminDDone: MOTION.enter(T, tTap, 0.3),
      toast: T < tTap + 0.15 ? 0 : MOTION.enter(T, tTap + 0.15, 0.3),
      touch,
      scale: 1.08 + 0.04 * MOTION.drift(T, R0, c.Outro - R0),
    },
    // The outro ends at 1.0, exactly where the title starts, so the loop is seamless.
    titleScale:
      T < c.MyDay
        ? 1 + 0.03 * MOTION.drift(T, 0, c.MyDay)
        : 0.97 + 0.03 * MOTION.drift(T, c.Outro, TOTAL_DURATION - c.Outro),
    outroExtras:
      T >= c.Outro
        ? MOTION.enter(T, c.Outro + 0.3, 0.5) * (1 - MOTION.enter(T, c.Outro + 2.1, 0.6))
        : 0,
  };
}
