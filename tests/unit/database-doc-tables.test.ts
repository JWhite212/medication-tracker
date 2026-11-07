// @vitest-environment node
//
// docs/database.md describes the tables one `###` heading each. Three tables
// (inventory_events, sync_tombstones, api_commands) shipped without one and
// nothing noticed, because prose is not a check. This holds every table the
// real schema defines to a heading that names it, and every table heading to
// a table that still exists.
import { readFileSync } from "node:fs";
import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "$lib/server/db/schema";

const doc = readFileSync(new URL("../../docs/database.md", import.meta.url), "utf8");

// Backticked names on `### ` lines, e.g. "### `email_verification_tokens`,
// `password_reset_tokens`" names two tables.
function documentedTables(markdown: string): Set<string> {
  const names = new Set<string>();
  for (const line of markdown.split("\n")) {
    if (!line.startsWith("### ")) continue;
    for (const match of line.matchAll(/`([a-z_]+)`/g)) names.add(match[1]);
  }
  return names;
}

const schemaTables = Object.values(schema)
  .filter((value) => is(value, PgTable))
  .map((table) => getTableName(table as PgTable))
  .sort();

describe("docs/database.md table headings", () => {
  it("finds the schema's tables (guards against an empty, vacuous list)", () => {
    expect(schemaTables.length).toBeGreaterThan(15);
    expect(schemaTables).toContain("users");
  });

  it("documents every table schema.ts defines", () => {
    const documented = documentedTables(doc);
    expect(schemaTables.filter((name) => !documented.has(name))).toEqual([]);
  });

  it("documents no table schema.ts no longer defines", () => {
    const defined = new Set(schemaTables);
    expect([...documentedTables(doc)].filter((name) => !defined.has(name))).toEqual([]);
  });
});
