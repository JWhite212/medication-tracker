// Format sniffing for uploaded files. Pure — no DB, no I/O.
//
// Deliberately strict. The export route's `?format=` handling silently
// falls through to PDF for anything that isn't exactly "csv"; an import
// that mirrored that laxness would misparse a file rather than tell the
// user what went wrong. Every unrecognised input gets a specific reason.
import type { ImportFormat } from "./types";

/** Header line emitted by `generateCsvReport` (src/lib/server/export-csv.ts). */
export const DOSE_CSV_HEADER = "Date,Time,Status,Medication,Dosage,Quantity,Notes,Side Effects";

/** Header line emitted by `buildAuditCsv` (src/lib/server/audit-csv.ts). */
export const AUDIT_CSV_HEADER = "Date,Time,Entity,Entity ID,Action,Changes";

export type DetectResult = { ok: true; format: ImportFormat } | { ok: false; reason: string };

/** Strip a UTF-8 BOM, which Excel adds and `JSON.parse` chokes on. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function firstNonEmptyLine(text: string): string {
  for (const line of text.split(/\r\n|\n|\r/)) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

export function detectFormat(rawText: string): DetectResult {
  const text = stripBom(rawText).trim();

  if (!text) {
    return { ok: false, reason: "The file is empty." };
  }

  // PDFs are binary; the magic bytes survive a lossy UTF-8 decode.
  if (text.startsWith("%PDF-")) {
    return {
      ok: false,
      reason:
        "PDF exports are formatted reports, not data — there's nothing in them to import. Use a JSON backup or the dose CSV instead.",
    };
  }

  if (text.startsWith("{") || text.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, reason: "This looks like JSON but it isn't valid JSON." };
    }
    if (Array.isArray(parsed) || parsed === null || typeof parsed !== "object") {
      return { ok: false, reason: "A backup file must be a JSON object." };
    }
    if (!("version" in parsed)) {
      return {
        ok: false,
        reason: "This JSON file has no `version` field, so it isn't a MedTracker backup.",
      };
    }
    return { ok: true, format: "backup-json" };
  }

  const header = firstNonEmptyLine(text);

  if (header === DOSE_CSV_HEADER) {
    return { ok: true, format: "dose-csv" };
  }

  if (header === AUDIT_CSV_HEADER) {
    return {
      ok: false,
      reason:
        "This is an audit-log export. The audit log is a read-only record of what happened to your account — importing one would fabricate history, so it can't be used as an import source.",
    };
  }

  if (header.includes(",")) {
    return {
      ok: false,
      reason: `Unrecognised CSV columns. A dose export starts with: ${DOSE_CSV_HEADER}`,
    };
  }

  return {
    ok: false,
    reason: "Unrecognised file. Import accepts a MedTracker JSON backup or a dose-history CSV.",
  };
}
