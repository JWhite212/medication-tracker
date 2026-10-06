// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * `dose_log_trash` holds the full content of every deleted dose, notes
 * included, for up to ten minutes. Exactly three modules may name it:
 *
 *   - `db/schema.ts` defines it;
 *   - `doses.ts` writes it (delete), reads and removes it (restore), and
 *     purges it (`purgeExpiredTrash`, which retention calls);
 *   - `api/wipe.ts` empties it for "Delete dose history".
 *
 * Retention is deliberately NOT an owner. It calls `purgeExpiredTrash`, so
 * the non-blocking `SKIP LOCKED` purge exists once. A reader anywhere else
 * would be the first path by which deleted notes could reach an export or a
 * page, and a writer anywhere else would be one that skips the medication
 * lock (D7).
 *
 * Checked in both directions, like `server-log.test.ts`: no other file names
 * the table, and every owner still does, so the list cannot rot into a
 * licence. A comment naming `doseLogTrash` counts too; write "the trash".
 */

const OWNERS = new Set([
  "src/lib/server/db/schema.ts",
  "src/lib/server/doses.ts",
  "src/lib/server/api/wipe.ts",
]);

const NAMES_THE_TRASH = /\bdoseLogTrash\b/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|js|svelte)$/.test(entry)) out.push(full.split(/[\\/]/).join("/"));
  }
  return out;
}

describe("dose_log_trash has exactly three owners", () => {
  it("no module outside the owners names doseLogTrash", () => {
    const outsiders = walk("src")
      .filter((file) => !OWNERS.has(file))
      .filter((file) => NAMES_THE_TRASH.test(readFileSync(file, "utf8")));

    expect(outsiders).toEqual([]);
  });

  it("every owner still names it, so the list cannot rot", () => {
    const stillOwning = [...OWNERS].filter((file) =>
      NAMES_THE_TRASH.test(readFileSync(file, "utf8")),
    );

    expect(stillOwning.sort()).toEqual([...OWNERS].sort());
  });
});
