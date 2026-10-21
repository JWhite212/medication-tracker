// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { STATUS_TOKEN, maskFieldErrors } from "./helpers/status-token";

/**
 * Status colour has one owner, `src/lib/utils/status-tone.ts`, and this scan
 * keeps it that way. Before the owner, every component chose its own amber,
 * which is how amber came to mean about twenty things and a 35% adherence
 * printed green. It is a scan rather than prose for the reason
 * server-log.test.ts gives: a rule that is only written down re-accumulates.
 *
 * What counts as a status colour, and which field-error lines the spec keeps
 * as they are, is decided by `helpers/status-token.ts`. Both lists below are
 * two-way: a file that stops matching must leave its list, so a stale entry
 * fails as loudly as a new offender.
 */

/** Permanent. Each entry says which part of the spec keeps it. */
const EXEMPT: { file: string; why: string }[] = [
  {
    file: "src/lib/utils/status-tone.ts",
    why: "The owner: every status class is spelled here and nowhere else.",
  },
  {
    file: "src/lib/components/ui/Button.svelte",
    why: "The danger variant (bg-danger text-danger-fg), used only inside DestructiveConfirm.",
  },
  {
    file: "src/lib/components/ui/Toast.svelte",
    why: "Spec Non-goals: Toast is unchanged. Its colours already obey the rules and its markup is pinned.",
  },
  {
    file: "src/lib/components/ui/Input.svelte",
    why: "The field's error border and the required asterisk. Spec Non-goals keep form inputs and field errors as they are.",
  },
  {
    file: "src/lib/components/walkthrough/parts/FieldBox.svelte",
    why: "Draws Input's required asterisk on the landing stage, so it follows Input's exemption.",
  },
  {
    file: "src/lib/components/walkthrough/parts/dashboard/StageUndoOffer.svelte",
    why: "Draws Toast's Undo offer with Toast.svelte's own classes, so it follows Toast's exemption.",
  },
];

/**
 * Temporary. Every file that wrote a status class when the owner landed.
 * A task that removes a file's last status class deletes its line here in the
 * same commit (the stale check below fails otherwise). Task 13 deletes the list.
 */
const PENDING_MIGRATION: string[] = [
  "src/lib/components/DoseEditForm.svelte",
  "src/lib/components/MedicationForm.svelte",
  "src/lib/components/medication-form/InteractionWarningPanel.svelte",
  "src/lib/components/medication-form/MedicationScheduleSection.svelte",
  "src/lib/components/medication-form/MedicationStylePicker.svelte",
  "src/lib/components/walkthrough/parts/dashboard/StageDueCard.svelte",
  "src/lib/components/walkthrough/scenes/AnalyticsScene.svelte",
  "src/lib/components/walkthrough/scenes/MedicationsScene.svelte",
  "src/lib/components/walkthrough/scenes/SecurityScene.svelte",
  "src/routes/(app)/medications/[id]/+page.svelte",
  "src/routes/(app)/settings/+page.svelte",
  "src/routes/(app)/settings/appearance/+page.svelte",
  "src/routes/(app)/settings/data/import/+page.svelte",
  "src/routes/(app)/settings/notifications/+page.svelte",
  "src/routes/(app)/settings/security/+page.svelte",
  "src/routes/+page.svelte",
  "src/routes/auth/2fa/+page.svelte",
  "src/routes/auth/login/+page.svelte",
  "src/routes/auth/register/+page.svelte",
  "src/routes/auth/reset-password/+page.svelte",
  "src/routes/auth/reset-password/confirm/+page.svelte",
  "src/routes/auth/verify/+page.svelte",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|svelte)$/.test(entry)) out.push(full.split(/[\\/]/).join("/"));
  }
  return out;
}

/** file -> the status classes it writes, field-error lines masked. */
const MATCHING = new Map(
  walk("src")
    .map(
      (file) =>
        [file, maskFieldErrors(readFileSync(file, "utf8")).match(STATUS_TOKEN) ?? []] as const,
    )
    .filter(([, found]) => found.length > 0),
);
const EXEMPT_FILES = new Set(EXEMPT.map((e) => e.file));
const PENDING = new Set(PENDING_MIGRATION);

describe("the field-error mask", () => {
  it("hides a field-error line in each of its spellings", () => {
    for (const tag of [
      '<p id="email-error" class="text-danger-ink mt-1 text-sm" role="alert">',
      '<p\n        id="schedules-error"\n        class="text-danger-ink mt-1 text-sm"\n        role="alert"\n      >',
      '<p id={`${id}-error`} class="text-danger-ink mt-1 text-sm" role="alert">',
    ]) {
      expect(maskFieldErrors(tag).match(STATUS_TOKEN)).toBeNull();
    }
  });

  it("leaves a banner that happens to carry an -error id", () => {
    const banner =
      '<p\n  id="totp-error"\n  class="bg-danger/10 text-danger-ink mb-4 rounded-lg px-4 py-2 text-sm"\n  role="alert"\n>';
    expect(maskFieldErrors(banner).match(STATUS_TOKEN)).toEqual([
      "bg-danger/10",
      "text-danger-ink",
    ]);
  });

  it("does not hide an inline status colour, which a class regex alone would miss", () => {
    expect(
      'color: "var(--color-success)", ring: "var(--color-danger-ink)"'.match(STATUS_TOKEN),
    ).toEqual(["var(--color-success)", "var(--color-danger-ink)"]);
  });
});

describe("status colour is written only by its owner", () => {
  it("every file that writes a status class is exempt or pending migration", () => {
    const offenders = [...MATCHING]
      .filter(([file]) => !EXEMPT_FILES.has(file) && !PENDING.has(file))
      .map(([file, found]) => `${file}: ${[...new Set(found)].join(" ")}`);
    expect(offenders).toEqual([]);
  });

  it("every exemption still writes one, so the list cannot rot", () => {
    expect(EXEMPT.map((e) => e.file).filter((file) => !MATCHING.has(file))).toEqual([]);
  });

  it("every pending file still writes one: a task that finishes a file deletes its line", () => {
    expect(PENDING_MIGRATION.filter((file) => !MATCHING.has(file))).toEqual([]);
  });

  it("no file is both exempt and pending", () => {
    expect(PENDING_MIGRATION.filter((file) => EXEMPT_FILES.has(file))).toEqual([]);
  });

  it("each exemption says why", () => {
    expect(EXEMPT.filter((e) => e.why.trim() === "")).toEqual([]);
  });

  it("the pending list is sorted and unique, so tasks deleting lines in parallel merge cleanly", () => {
    expect(PENDING_MIGRATION).toEqual([...new Set(PENDING_MIGRATION)].sort());
  });
});
