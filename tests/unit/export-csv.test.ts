import { describe, it, expect } from "vitest";
import { escapeCsvCell } from "../../src/lib/server/export-csv";

describe("escapeCsvCell", () => {
  it("passes through plain values", () => {
    expect(escapeCsvCell("hello")).toBe("hello");
    expect(escapeCsvCell(42)).toBe("42");
    expect(escapeCsvCell(true)).toBe("true");
  });

  it("renders null and undefined as an empty cell", () => {
    expect(escapeCsvCell(null)).toBe("");
    expect(escapeCsvCell(undefined)).toBe("");
  });

  it("doubles embedded double-quotes and wraps the cell", () => {
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it("wraps cells containing commas", () => {
    expect(escapeCsvCell("one, two")).toBe('"one, two"');
  });

  it("wraps cells containing newlines and CRLF", () => {
    expect(escapeCsvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(escapeCsvCell("line1\r\nline2")).toBe('"line1\r\nline2"');
  });

  it("neutralises formula injection prefixes", () => {
    expect(escapeCsvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(escapeCsvCell("+1234")).toBe("'+1234");
    expect(escapeCsvCell("-1234")).toBe("'-1234");
    expect(escapeCsvCell("@cmd")).toBe("'@cmd");
  });

  it("neutralises whitespace-prefixed formulas (tab)", () => {
    // Tab is in the prefix regex but not the wrap regex.
    expect(escapeCsvCell("\t=evil")).toBe("'\t=evil");
  });

  it("CR-prefixed input is both prefix-neutralised and quote-wrapped", () => {
    // Cells containing CR or LF must be wrapped per RFC 4180.
    expect(escapeCsvCell("\rnope")).toBe('"\'\rnope"');
  });

  it("combines prefix-neutralisation with quote-wrapping", () => {
    // Cell that needs both: starts with `=` AND contains a comma.
    const result = escapeCsvCell("=cmd,arg");
    expect(result.startsWith("\"'")).toBe(true);
    expect(result.endsWith('"')).toBe(true);
    expect(result).toContain("=cmd,arg");
  });
});
