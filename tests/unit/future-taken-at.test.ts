// "Is this dose time in the future?" has ONE owner, utils/future-taken-at.ts,
// which the edit dialog's `?/editDose` and `/api/v1`'s `log_dose` and
// `edit_dose` all call. The edit dialog refused a future time before the API
// did, with its own grace and its own words. Written as a scan, in the style
// of page-heading-owner.test.ts, because a single owner that is only written
// down re-accumulates copies.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  FUTURE_TAKEN_AT_CODE,
  FUTURE_TAKEN_AT_GRACE_MS,
  FUTURE_TAKEN_AT_MESSAGE,
  isFutureTakenAt,
} from "../../src/lib/utils/future-taken-at";

const OWNER = join("src", "lib", "utils", "future-taken-at.ts");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|js|svelte)$/.test(entry)) out.push(full);
  }
  return out;
}

const sources = walk("src").map((file) => ({ file, text: readFileSync(file, "utf8") }));
const filesContaining = (needle: string) =>
  sources.filter((s) => s.text.includes(needle)).map((s) => s.file);

const NOW = Date.UTC(2026, 10, 3, 12, 0, 0);

describe("isFutureTakenAt", () => {
  it("allows five minutes past the server's clock, and not a millisecond more", () => {
    // Literal, not FUTURE_TAKEN_AT_GRACE_MS: the grace is part of the
    // `/api/v1` contract, so changing it has to fail here and in the docs.
    expect(FUTURE_TAKEN_AT_GRACE_MS).toBe(5 * 60_000);
    expect(isFutureTakenAt(new Date(NOW), NOW)).toBe(false);
    expect(isFutureTakenAt(new Date(NOW + 5 * 60_000), NOW)).toBe(false);
    expect(isFutureTakenAt(new Date(NOW + 5 * 60_000 + 1), NOW)).toBe(true);
  });

  it("refuses the reported case, a dose edited onto tomorrow", () => {
    expect(isFutureTakenAt(new Date(NOW + 23 * 60 * 60_000), NOW)).toBe(true);
  });

  it("never refuses a time in the past", () => {
    expect(isFutureTakenAt(new Date(NOW - 1), NOW)).toBe(false);
    expect(isFutureTakenAt(new Date(Date.UTC(2020, 0, 1)), NOW)).toBe(false);
  });
});

describe("the future-time rule has one owner", () => {
  it("pins the wire code, which a client branches on", () => {
    expect(FUTURE_TAKEN_AT_CODE).toBe("future_taken_at");
  });

  it("spells the refusal's words only in the owner", () => {
    expect(filesContaining(FUTURE_TAKEN_AT_MESSAGE)).toEqual([OWNER]);
  });

  it("spells the wire code only in the owner", () => {
    expect(filesContaining(`"${FUTURE_TAKEN_AT_CODE}"`)).toEqual([OWNER]);
  });
});
