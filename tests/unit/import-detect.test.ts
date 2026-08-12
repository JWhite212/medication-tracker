import { describe, it, expect } from "vitest";

// detect.ts imports nothing but types, so it needs no db stub — the
// whole point of keeping the parse layer DB-free (same reason
// audit-csv.ts is split out from audit-export.ts).
import {
  detectFormat,
  stripBom,
  DOSE_CSV_HEADER,
  AUDIT_CSV_HEADER,
} from "../../src/lib/server/import/detect";

describe("stripBom", () => {
  it("removes a leading UTF-8 BOM", () => {
    expect(stripBom("﻿{}")).toBe("{}");
  });

  it("leaves text without a BOM untouched", () => {
    expect(stripBom("{}")).toBe("{}");
  });
});

describe("detectFormat", () => {
  it("recognises a versioned JSON backup", () => {
    const result = detectFormat(JSON.stringify({ version: 1, medications: [] }));
    expect(result).toEqual({ ok: true, format: "backup-json" });
  });

  it("recognises a backup behind a BOM", () => {
    const result = detectFormat("﻿" + JSON.stringify({ version: 1 }));
    expect(result).toEqual({ ok: true, format: "backup-json" });
  });

  it("recognises the dose CSV by its exact header", () => {
    const result = detectFormat(`${DOSE_CSV_HEADER}\r\n2026-01-01,08:00,taken,A,1mg,1,,`);
    expect(result).toEqual({ ok: true, format: "dose-csv" });
  });

  it("REJECTS an audit CSV — importing one would fabricate history", () => {
    const result = detectFormat(`${AUDIT_CSV_HEADER}\r\n2026-01-01,08:00:00,medication,x,create,`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/audit/i);
  });

  it("REJECTS a PDF by its magic bytes", () => {
    const result = detectFormat("%PDF-1.7\n%âãÏÓ\n");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/PDF/);
  });

  it("REJECTS JSON with no version field", () => {
    const result = detectFormat(JSON.stringify({ medications: [] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/version/);
  });

  it("REJECTS a top-level JSON array", () => {
    const result = detectFormat("[]");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/object/);
  });

  it("REJECTS malformed JSON with a JSON-specific message", () => {
    const result = detectFormat('{"version": 1,,}');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/valid JSON/);
  });

  it("REJECTS an empty file", () => {
    expect(detectFormat("   \n  ").ok).toBe(false);
  });

  it("names the expected columns when CSV headers don't match", () => {
    const result = detectFormat("When,What,How Many\n2026-01-01,A,1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain(DOSE_CSV_HEADER);
  });
});
