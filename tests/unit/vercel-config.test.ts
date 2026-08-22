import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// vercel.json is deployment configuration, so nothing in the app imports it
// and no other test would notice it rotting. It is worth a test anyway
// because a mistake here is invisible locally — `npm run build` and `npm run
// preview` never read it, so the only feedback is production behaviour.
//
// The specific regression this guards: the security-header rule was written
// with `"source": "/"`, which in Vercel's path-to-regexp dialect is an exact
// match on the root path. Every asset served straight from the edge —
// favicons, PWA icons, manifest.json, the immutable build output — bypassed
// both this rule and hooks.server.ts and shipped with no security headers at
// all. It read as a site-wide rule and behaved as a single-page one.

// process.cwd() is the vitest root. import.meta.url is not usable here —
// the suite runs under jsdom, where it is not a file: URL.
const config = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8"));

type HeaderRule = {
  source: string;
  headers: { key: string; value: string }[];
};

/**
 * Approximates Vercel's `source` matching for the patterns this file
 * actually uses (literals and a trailing `(.*)` group). It is deliberately
 * not a full path-to-regexp implementation — if a rule ever needs `:param`
 * or `?` syntax, this helper must grow with it rather than silently
 * returning a wrong answer.
 */
function matches(source: string, path: string): boolean {
  if (!/^[/\w.\-()*\\]*$/.test(source)) {
    throw new Error(
      `matches() does not model the syntax in "${source}". Extend the helper rather than trusting it.`,
    );
  }
  return new RegExp(`^${source}$`).test(path);
}

function ruleFor(predicate: (r: HeaderRule) => boolean): HeaderRule {
  const found = (config.headers as HeaderRule[]).find(predicate);
  if (!found) throw new Error("no matching header rule in vercel.json");
  return found;
}

const securityRule = ruleFor((r) => r.headers.some((h) => h.key === "Strict-Transport-Security"));

describe("vercel.json security headers", () => {
  // The actual bug. `/` alone passes every other assertion in this file.
  it.each([
    ["/", "the root page"],
    ["/dashboard", "an authenticated page"],
    ["/api/health", "an API route"],
    ["/manifest.json", "a static file served by the edge, not the function"],
    ["/favicon.svg", "a static favicon"],
    ["/icons/icon-192.png", "a nested static asset"],
    ["/_app/immutable/entry/app.js", "hashed build output"],
  ])("covers %s (%s)", (path) => {
    expect(matches(securityRule.source, path)).toBe(true);
  });

  it.each([
    "X-Content-Type-Options",
    "X-Frame-Options",
    "Referrer-Policy",
    "Permissions-Policy",
    "Strict-Transport-Security",
  ])("sets %s", (key) => {
    expect(securityRule.headers.map((h) => h.key)).toContain(key);
  });

  it("denies framing outright rather than same-origin", () => {
    // frame-ancestors in the CSP is ignored inside the <meta> tag SvelteKit
    // emits for prerendered pages, so this header is the only thing
    // protecting them from being framed.
    const xfo = securityRule.headers.find((h) => h.key === "X-Frame-Options");
    expect(xfo?.value).toBe("DENY");
  });

  it("sets an HSTS max-age of at least one year", () => {
    const hsts = securityRule.headers.find((h) => h.key === "Strict-Transport-Security");
    const maxAge = Number(/max-age=(\d+)/.exec(hsts?.value ?? "")?.[1] ?? 0);
    expect(maxAge).toBeGreaterThanOrEqual(31536000);
  });
});

describe("vercel.json schema shape", () => {
  // Vercel validates vercel.json strictly and fails the *deployment* on an
  // unrecognised property — including a well-meant "comment" key, since JSON
  // has no comments. That failure surfaces at deploy time, not build time,
  // so it is worth catching here.
  const ALLOWED_RULE_KEYS = new Set(["source", "headers", "has", "missing"]);

  it("uses only keys Vercel accepts on header rules", () => {
    for (const rule of config.headers as HeaderRule[]) {
      for (const key of Object.keys(rule)) {
        expect(ALLOWED_RULE_KEYS, `unexpected key "${key}" on rule ${rule.source}`).toContain(key);
      }
    }
  });

  it("uses only key/value pairs inside each rule's headers array", () => {
    for (const rule of config.headers as HeaderRule[]) {
      for (const header of rule.headers) {
        expect(Object.keys(header).sort()).toEqual(["key", "value"]);
      }
    }
  });
});

describe("vercel.json caching", () => {
  it("caches content-hashed build output immutably", () => {
    const rule = ruleFor((r) => r.source.includes("_app/immutable"));
    const cc = rule.headers.find((h) => h.key === "Cache-Control")?.value ?? "";
    expect(cc).toContain("immutable");
    expect(cc).toContain("max-age=31536000");
  });

  it.each(["/icons/(.*)", "/favicon.svg", "/favicon-32.png"])(
    "gives %s a real cache window without marking it immutable",
    (source) => {
      const rule = ruleFor((r) => r.source === source);
      const cc = rule.headers.find((h) => h.key === "Cache-Control")?.value ?? "";
      const maxAge = Number(/max-age=(\d+)/.exec(cc)?.[1] ?? 0);
      // These filenames are not content-addressed — a rebrand reuses them —
      // so `immutable` would strand the old icon in caches for a year.
      expect(cc).not.toContain("immutable");
      expect(maxAge).toBeGreaterThan(0);
    },
  );
});

describe("vercel.json cron", () => {
  it("still schedules the reminder tick", () => {
    const paths = (config.crons as { path: string }[]).map((c) => c.path);
    expect(paths).toContain("/api/cron/reminders");
  });
});
