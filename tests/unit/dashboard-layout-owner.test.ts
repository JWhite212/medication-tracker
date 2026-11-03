// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * `dashboardSectionOrder` is the stored order of the dashboard's sections.
 * Dashboard layout is presentational: `resolveDashboardLayout` owns the order
 * and the dashboard page makes the single call that reads the preference.
 * Nothing under `components/dashboard/` and no `load` may read it, or a
 * section would reorder itself behind the resolver's back.
 *
 * Who may name it:
 *
 *   - `db/schema.ts` defines the column;
 *   - `preferences/schema.ts` owns the domain of the value;
 *   - `utils/validation.ts` is the form door;
 *   - `(app)/settings/dashboard/` reads it to show and save the order;
 *   - `(app)/dashboard/+page.svelte` hands it to the resolver, once.
 *
 * `dashboard/layout.ts` is NOT on the list: the resolver takes the order as
 * an `order` argument and never names the preference.
 *
 * Checked in both directions, like `dose-log-trash-owners.test.ts`: no other
 * file names it, and every entry still does, so the list cannot rot into a
 * licence. A comment naming the field counts too.
 */

const OWNERS = [
  "src/lib/server/db/schema.ts",
  "src/lib/preferences/schema.ts",
  "src/lib/utils/validation.ts",
  "src/routes/(app)/settings/dashboard/+page.server.ts",
  "src/routes/(app)/settings/dashboard/+page.svelte",
  "src/routes/(app)/dashboard/+page.svelte",
];

const NAMES_THE_ORDER = /\bdashboardSectionOrder\b/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|js|svelte)$/.test(entry)) out.push(full.split(/[\\/]/).join("/"));
  }
  return out;
}

describe("dashboardSectionOrder has exactly its owners", () => {
  it("walks the source tree, so a scan that finds nothing cannot pass", () => {
    const files = walk("src");
    expect(files.length).toBeGreaterThan(50);
    expect(files).toContain("src/lib/dashboard/layout.ts");
    expect(files).toContain("src/routes/(app)/settings/dashboard/+page.svelte");
  });

  it("no module outside the owners names it", () => {
    const outsiders = walk("src")
      .filter((file) => !OWNERS.includes(file))
      .filter((file) => NAMES_THE_ORDER.test(readFileSync(file, "utf8")));

    expect(outsiders).toEqual([]);
  });

  it("every owner still names it, so the list cannot rot", () => {
    const stillOwning = OWNERS.filter((file) => NAMES_THE_ORDER.test(readFileSync(file, "utf8")));

    expect(stillOwning.sort()).toEqual([...OWNERS].sort());
  });

  it("the dashboard page reads it exactly once", () => {
    const source = readFileSync("src/routes/(app)/dashboard/+page.svelte", "utf8");
    expect(source.match(/\bdashboardSectionOrder\b/g)).toHaveLength(1);
  });
});
