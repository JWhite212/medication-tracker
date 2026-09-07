import { describe, it, expect } from "vitest";
import { clampEffectiveDays, isActiveOn, lifecycleEnd } from "$lib/server/analytics/lifecycle";

const APR_15 = new Date("2026-04-15T00:00:00.000Z");
const APR_25 = new Date("2026-04-25T00:00:00.000Z");
const MAY_01 = new Date("2026-05-01T00:00:00.000Z");
const MAY_15 = new Date("2026-05-15T00:00:00.000Z");

describe("clampEffectiveDays", () => {
  it("returns full range when lifecycle fully contains it", () => {
    expect(clampEffectiveDays(APR_15, MAY_01, APR_15, null)).toBe(16);
  });

  it("clamps left edge when med started mid-range", () => {
    // Range is 16 days; med started 2026-04-25 → 6 effective days.
    expect(clampEffectiveDays(APR_15, MAY_01, APR_25, null)).toBe(6);
  });

  it("clamps right edge when med ended mid-range", () => {
    // Range is 16 days; med ended 2026-04-25 → 10 effective days.
    expect(clampEffectiveDays(APR_15, MAY_01, APR_15, APR_25)).toBe(10);
  });

  it("clamps both edges when lifecycle is interior to range", () => {
    expect(clampEffectiveDays(APR_15, MAY_15, APR_25, MAY_01)).toBe(6);
  });

  it("returns 0 when med started after the range ends", () => {
    expect(clampEffectiveDays(APR_15, MAY_01, MAY_15, null)).toBe(0);
  });

  it("returns 0 when med ended before the range starts", () => {
    expect(clampEffectiveDays(MAY_01, MAY_15, APR_15, APR_25)).toBe(0);
  });

  it("treats endedAt = null as still active (open right edge)", () => {
    expect(clampEffectiveDays(APR_15, MAY_01, APR_15, null)).toBe(16);
  });

  it("returns 0 for a zero-width range", () => {
    expect(clampEffectiveDays(APR_15, APR_15, APR_15, null)).toBe(0);
  });

  // Every fixture above sits on a whole number of days, so none of them can
  // tell one rounding mode from another — which is why the half-up skew
  // survived. These four pin the mode itself. Two are needed on the round
  // side: one at the 0.5 tie and one away from it, because a probe at the
  // tie alone leaves `Math.round` alive for 15.75.
  const HOUR = 3_600_000;
  const DAY = 86_400_000;

  it("counts a span of fifteen days and twelve hours as fifteen days", () => {
    // Math.round(15.5) === 16 — the skew arrives at local noon.
    const to = new Date(APR_15.getTime() + 15 * DAY + 12 * HOUR);
    expect(clampEffectiveDays(APR_15, to, APR_15, null)).toBe(15);
  });

  it("counts a span of fifteen days and eighteen hours as fifteen days", () => {
    const to = new Date(APR_15.getTime() + 15 * DAY + 18 * HOUR);
    expect(clampEffectiveDays(APR_15, to, APR_15, null)).toBe(15);
  });

  it("counts a span one millisecond short of thirty days as thirty", () => {
    // `export-pdf.ts` hands the breakdown `to - 1ms` so its summary counts
    // exactly the rows the dose table beneath it lists. Truncating instead
    // of rounding would silently drop the report's last day, so the range
    // is closed at its final millisecond.
    const to = new Date(APR_15.getTime() + 30 * DAY - 1);
    expect(clampEffectiveDays(APR_15, to, APR_15, null)).toBe(30);
  });

  it("counts a six-hour overlap as zero days", () => {
    const to = new Date(APR_15.getTime() + 6 * HOUR);
    expect(clampEffectiveDays(APR_15, to, APR_15, null)).toBe(0);
  });

  // The PDF export's bounds are LOCAL midnights (`parseDayRangeParam`), so a
  // civil range containing a spring-forward is one transition short of
  // `days * 24h`. Counted in flat 24-hour days it loses a whole day — the
  // clinician report printing "Expected events: 30" over 31 days of doses,
  // and adding an "Overuse" line to a patient with perfect adherence.
  it("counts a civil range shortened by a spring-forward as its full length", () => {
    // Europe/London, 1–31 March 2026: 31 civil days, one hour short of 31*24h,
    // less the millisecond `lastIncludedInstant` subtracts.
    const to = new Date(APR_15.getTime() + 31 * DAY - HOUR - 1);
    expect(clampEffectiveDays(APR_15, to, APR_15, null)).toBe(31);
  });

  it("counts a civil range shortened by a two-hour transition too", () => {
    // Antarctica/Troll moves UTC+0 to UTC+2 — the widest transition there is.
    const to = new Date(APR_15.getTime() + 31 * DAY - 2 * HOUR - 1);
    expect(clampEffectiveDays(APR_15, to, APR_15, null)).toBe(31);
  });

  it("counts a single civil day containing the transition as one day", () => {
    // The acute case: a one-day London report on 29 March 2026 spans 23h.
    // Truncating scored it 0, so the PDF read "Expected events: 0,
    // Adherence: 0%" for a patient who had taken their dose.
    const to = new Date(APR_15.getTime() + DAY - HOUR - 1);
    expect(clampEffectiveDays(APR_15, to, APR_15, null)).toBe(1);
  });

  // The other edge of the same slack, pinned so the trade is a recorded
  // decision rather than a side effect: 22h is the point at which a partial
  // overlap starts being charged. `Math.round` charged from 12h.
  it("does not charge a partial overlap of twenty-one hours", () => {
    const to = new Date(APR_15.getTime() + 21 * HOUR);
    expect(clampEffectiveDays(APR_15, to, APR_15, null)).toBe(0);
  });

  it("charges a partial overlap of twenty-three hours, and that is the accepted cost", () => {
    const to = new Date(APR_15.getTime() + 23 * HOUR);
    expect(clampEffectiveDays(APR_15, to, APR_15, null)).toBe(1);
  });

  // The slack is only as wide as the widest real transition, so it has to
  // fail if tzdata ever widens one — otherwise the day comes back silently.
  it("is at least as wide as every DST transition the runtime knows about", () => {
    const TOLERANCE_HOURS = 2;
    const YEAR_START = Date.UTC(2026, 0, 1);
    const YEAR_END = Date.UTC(2027, 0, 1);
    // A transition persists for months, so sampling twice a day finds every
    // one of them and measures each exactly — the offset is constant on
    // either side. One formatter per zone, not one per sample: constructing
    // them is the whole cost, and doing it inline takes this from 0.6s to 17.
    let widest = 0;
    let widestZone = "";
    for (const tz of Intl.supportedValuesOf("timeZone")) {
      const dtf = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hour12: false,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
      const offsetMs = (ms: number) => {
        const p: Record<string, string> = {};
        for (const part of dtf.formatToParts(new Date(ms))) {
          if (part.type !== "literal") p[part.type] = part.value;
        }
        return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute) - ms;
      };

      let prev = offsetMs(YEAR_START);
      for (let t = YEAR_START + 12 * HOUR; t <= YEAR_END; t += 12 * HOUR) {
        const cur = offsetMs(t);
        if (cur !== prev) {
          const shift = Math.abs(cur - prev) / HOUR;
          if (shift > widest) {
            widest = shift;
            widestZone = tz;
          }
          prev = cur;
        }
      }
    }
    // Antarctica/Troll (UTC+0 to UTC+2) at the time of writing. The assertion
    // is the BOUND, not the zone — a new three-hour transition anywhere would
    // make the clamp lose a day again, silently, and must fail here instead.
    expect(widest, `widest transition is in ${widestZone}`).toBeLessThanOrEqual(TOLERANCE_HOURS);
  });
});

describe("isActiveOn", () => {
  it("is true when date is exactly at startedAt", () => {
    expect(isActiveOn(APR_25, APR_25, null)).toBe(true);
  });

  it("is false when date is before startedAt", () => {
    expect(isActiveOn(APR_15, APR_25, null)).toBe(false);
  });

  it("is true when date is between startedAt and endedAt", () => {
    expect(isActiveOn(APR_25, APR_15, MAY_01)).toBe(true);
  });

  it("is false when date is after endedAt", () => {
    expect(isActiveOn(MAY_15, APR_15, MAY_01)).toBe(false);
  });

  it("treats endedAt = null as open on the right", () => {
    expect(isActiveOn(MAY_15, APR_15, null)).toBe(true);
  });

  it("is true at the exact endedAt instant (inclusive boundary)", () => {
    expect(isActiveOn(MAY_01, APR_15, MAY_01)).toBe(true);
  });
});

describe("regression — the user-facing scenarios from the plan", () => {
  it("'med added yesterday' → today's adherence denominator is 1 day, not 30", () => {
    const today = new Date("2026-05-01T12:00:00.000Z");
    const thirtyDaysAgo = new Date(today.getTime() - 30 * 86_400_000);
    const yesterday = new Date(today.getTime() - 1 * 86_400_000);
    expect(clampEffectiveDays(thirtyDaysAgo, today, yesterday, null)).toBe(1);
  });

  it("'ended med' → days after endedAt don't drag adherence down", () => {
    const today = new Date("2026-05-01T12:00:00.000Z");
    const thirtyDaysAgo = new Date(today.getTime() - 30 * 86_400_000);
    const fiveDaysAgo = new Date(today.getTime() - 5 * 86_400_000);
    // Med was active for the first 25 days of the 30-day window.
    expect(clampEffectiveDays(thirtyDaysAgo, today, thirtyDaysAgo, fiveDaysAgo)).toBe(25);
  });
});

// Two columns can close a medication's window, written by different things:
// `endedAt` arrives only via import or the API, while archiving is the sole
// "I stopped taking this" signal the app itself writes — and it sets
// `archivedAt` alone. Reading either one on its own gets a real user wrong.
describe("lifecycleEnd", () => {
  it("is null while the medication is still running", () => {
    expect(lifecycleEnd({ endedAt: null, archivedAt: null })).toBeNull();
  });

  it("uses endedAt when that is the only bound", () => {
    expect(lifecycleEnd({ endedAt: MAY_01, archivedAt: null })).toBe(MAY_01);
  });

  it("uses archivedAt when that is the only bound", () => {
    // The case that mattered in practice: no UI writes endedAt, so for a
    // web-app user this is the ONLY signal that a medication stopped.
    expect(lifecycleEnd({ endedAt: null, archivedAt: APR_25 })).toBe(APR_25);
  });

  it("takes the earlier bound when a medication was ended before archiving", () => {
    expect(lifecycleEnd({ endedAt: APR_25, archivedAt: MAY_01 })).toBe(APR_25);
  });

  it("takes the earlier bound when a medication was archived before ending", () => {
    expect(lifecycleEnd({ endedAt: MAY_15, archivedAt: MAY_01 })).toBe(MAY_01);
  });

  it("closes the adherence window at the archive date", () => {
    const life = { endedAt: null, archivedAt: MAY_01 };
    // Archived on 1 May, asked about 15 April - 15 May: 16 of those 30
    // days were expected of you. Not all 30 (which would score archiving
    // as two weeks of missed doses) and not none (which would erase the
    // fortnight you were actually taking it).
    expect(clampEffectiveDays(APR_15, MAY_15, APR_15, lifecycleEnd(life))).toBe(16);
    expect(isActiveOn(APR_25, APR_15, lifecycleEnd(life))).toBe(true);
    expect(isActiveOn(MAY_15, APR_15, lifecycleEnd(life))).toBe(false);
  });
});
