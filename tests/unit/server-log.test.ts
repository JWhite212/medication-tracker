import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { logWarn, logError } from "$lib/server/log";

/**
 * One shape for every server-side log line, and a boundary test so it stays
 * that way.
 */

const lines: Array<{ level: "warn" | "error"; record: Record<string, unknown> }> = [];

beforeEach(() => {
  lines.length = 0;
  vi.spyOn(console, "warn").mockImplementation((line: string) =>
    lines.push({ level: "warn", record: JSON.parse(line) }),
  );
  vi.spyOn(console, "error").mockImplementation((line: string) =>
    lines.push({ level: "error", record: JSON.parse(line) }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the emitted record", () => {
  it("is a single parseable JSON line", () => {
    // Vercel's drain parses JSON and treats anything else as opaque text, so
    // a multi-line or interpolated message is unsearchable.
    logWarn("something happened", { scope: "test" });

    expect(lines).toHaveLength(1);
    expect(lines[0].record).toMatchObject({
      level: "warn",
      message: "something happened",
      scope: "test",
    });
    expect(typeof lines[0].record.timestamp).toBe("string");
  });

  it("routes by level, so a drain can filter", () => {
    logWarn("w", { scope: "test" });
    logError("e", { scope: "test" });

    expect(lines.map((l) => l.level)).toEqual(["warn", "error"]);
  });

  it("carries arbitrary fields alongside the fixed ones", () => {
    logWarn("x", { scope: "test", userId: "u1", medicationId: "m1", attempt: 3 });

    expect(lines[0].record).toMatchObject({ userId: "u1", medicationId: "m1", attempt: 3 });
  });

  it("unpacks an Error into message and stack", () => {
    logError("failed", { scope: "test" }, new Error("boom"));

    expect(lines[0].record.error).toBe("boom");
    expect(String(lines[0].record.stack)).toContain("Error: boom");
  });

  it.each([
    ["a string", "plain failure", "plain failure"],
    ["an object", { code: "ETIMEDOUT" }, '{"code":"ETIMEDOUT"}'],
  ])("renders %s thrown value legibly", (_label, thrown, expected) => {
    logError("failed", { scope: "test" }, thrown);
    expect(lines[0].record.error).toBe(expected);
  });

  it("survives a value that cannot be stringified", () => {
    // This path only runs because something already went wrong. A logger that
    // throws while reporting an error destroys the report.
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => logError("failed", { scope: "test" }, circular)).not.toThrow();
    expect(lines).toHaveLength(1);
  });

  it("omits the error key entirely when none was passed", () => {
    logWarn("just a note", { scope: "test" });
    expect("error" in lines[0].record).toBe(false);
  });
});

/**
 * The boundary. Server code logs through this module; nothing else reaches
 * for `console` directly. Written as a scan rather than prose because the
 * previous state — fifteen ad-hoc calls across seven files, each formatted
 * differently — is exactly what re-accumulates when the rule is only written
 * down.
 */
describe("no server module logs around this one", () => {
  /**
   * The three exemptions, each because the module is CLIENT-REACHABLE and so
   * cannot import `$lib/server/*` without pulling server code into the
   * bundle. Their output goes to the user's devtools, where there is nothing
   * to correlate anyway.
   */
  const CLIENT_REACHABLE = new Set(["src/lib/utils/contrast.ts", "src/routes/+layout.ts"]);

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(ts|svelte)$/.test(entry)) out.push(full);
    }
    return out;
  }

  it("finds console calls only in the logger itself and the client-reachable pair", () => {
    const offenders = walk("src")
      .filter((file) => file !== join("src", "lib", "server", "log.ts"))
      .filter((file) => !CLIENT_REACHABLE.has(file.split(/[\\/]/).join("/")))
      .filter((file) => /\bconsole\.(log|warn|error)\s*\(/.test(readFileSync(file, "utf8")));

    expect(offenders).toEqual([]);
  });

  it("the exempt files really are the ones named, so the list cannot rot", () => {
    // If one of these stops logging, the exemption should be deleted rather
    // than left as a licence for the next person.
    const stillLogging = [...CLIENT_REACHABLE].filter((file) =>
      /\bconsole\.(log|warn|error)\s*\(/.test(readFileSync(file, "utf8")),
    );

    expect(stillLogging.sort()).toEqual([...CLIENT_REACHABLE].sort());
  });
});
