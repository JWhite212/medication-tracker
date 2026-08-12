// Dose-history CSV -> ImportBundle. Pure — no DB, no I/O.
//
// This format is lossy by construction (see src/lib/server/export-csv.ts):
// no IDs, no schedules, dosage fused into one cell, and timestamps
// reduced to timezone-less local minutes. Everything this module does is
// a documented reconstruction of what the exporter threw away, and every
// row it can't reconstruct becomes a warning rather than a silent drop.
import { parseDateTimeLocal } from "$lib/utils/time";
import { IMPORT_MAX_MEDICATIONS, isImportableTime } from "$lib/utils/validation";
import { stripBom } from "./detect";
import { DOSE_CSV_HEADER } from "./detect";
import type { ImportBundle, ImportDose, ImportMedication } from "./types";
import type { DoseLogStatus } from "$lib/server/db/schema";
import type { SideEffect } from "$lib/types";

export type CsvParseResult = { ok: true; bundle: ImportBundle } | { ok: false; reason: string };

/** Hard cap so a hostile CSV can't build an unbounded row array before
 * the Zod caps get a chance to apply. */
const MAX_CSV_ROWS = 50_000;

/**
 * RFC 4180 reader. Handles quoted fields containing commas, CRLF and
 * doubled quotes. Bare CR, LF and CRLF are all accepted as row
 * terminators because the exporter emits CRLF but hand-edited files
 * routinely arrive with LF.
 */
export function parseCsv(input: string, maxRows = MAX_CSV_ROWS): string[][] {
  const text = stripBom(input);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let sawAnyChar = false;
  // A quote only opens a quoted section at the START of a field. Without
  // this, one stray unescaped `"` mid-cell (common in hand-edited files)
  // opens a quoted run that swallows every comma and newline to the next
  // quote or EOF — merging the rest of the file into a single cell while
  // the skipped-row count reports nothing wrong.
  let atFieldStart = true;

  const pushRow = () => {
    row.push(field);
    rows.push(row);
    row = [];
    field = "";
    sawAnyChar = false;
    atFieldStart = true;
  };

  for (let i = 0; i < text.length && rows.length < maxRows; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && atFieldStart) {
      inQuotes = true;
      sawAnyChar = true;
      atFieldStart = false;
      continue;
    }

    if (char === ",") {
      row.push(field);
      field = "";
      sawAnyChar = true;
      atFieldStart = true;
      continue;
    }

    if (char === "\r" || char === "\n") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      pushRow();
      continue;
    }

    field += char;
    sawAnyChar = true;
    atFieldStart = false;
  }

  // Trailing field/row, unless the file simply ended with a newline.
  if (rows.length < maxRows && (field.length > 0 || sawAnyChar || row.length > 0)) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/**
 * Inverse of `escapeCsvCell`'s formula-injection guard.
 *
 * The exporter prepends `'` to any cell starting with `= + - @ \t \r`
 * (CWE-1236). Stripping it unconditionally would corrupt a genuine
 * leading apostrophe, so this only strips when the *next* character is
 * one of the guarded set — an exact inverse of the escape, ambiguous
 * only for a real cell like `'-5`, which round-trips to `-5`.
 *
 * Kept here rather than in export-csv.ts so this module stays DB-free
 * and unit-testable without DATABASE_URL. The escape itself lives in
 * two byte-identical copies (export-csv.ts, audit-csv.ts).
 */
export function unescapeCsvCell(value: string): string {
  return /^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value;
}

/**
 * Parse the exporter's time cell back to `HH:mm`.
 *
 * `formatUserTime` uses `Intl.DateTimeFormat("en-GB", { hour: "numeric",
 * minute: "2-digit", hour12 })`, which yields "15:45" in 24h mode and
 * "3:45 pm" in 12h mode. Recent ICU versions separate the day period
 * with U+202F (narrow no-break space) rather than a plain space, so
 * whitespace is normalised before matching.
 */
export function parseClockTime(raw: string): { hours: number; minutes: number } | null {
  const cleaned = raw.replace(/[\u202f\u00a0\u2009]/g, " ").trim();
  const match = /^(\d{1,2}):(\d{2})(?:\s*([ap])\.?\s*m\.?)?$/i.exec(cleaned);
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const period = match[3]?.toLowerCase();

  if (minutes > 59) return null;

  if (period) {
    if (hours < 1 || hours > 12) return null;
    if (period === "a") hours = hours === 12 ? 0 : hours;
    else hours = hours === 12 ? 12 : hours + 12;
  } else if (hours > 23) {
    return null;
  }

  return { hours, minutes };
}

/**
 * Split the exporter's fused `Dosage` cell (`${dosageAmount}${dosageUnit}`,
 * e.g. "500mg", "2.5ml") back into its parts. Returns sane defaults when
 * the cell is unparseable — a wrong-looking dosage on a stub medication
 * is recoverable, losing the dose history is not.
 */
export function splitDosage(raw: string): { amount: string; unit: string } {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(.*?)\s*$/.exec(raw);
  if (!match) return { amount: "1", unit: "dose" };
  const unit = match[2].slice(0, 20);
  return { amount: match[1], unit: unit || "dose" };
}

/** Reverse of `` `${e.name} (${e.severity})` `` joined with "; ". */
export function parseSideEffects(raw: string): SideEffect[] | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const effects: SideEffect[] = [];
  for (const part of trimmed.split(";")) {
    const piece = part.trim();
    if (!piece) continue;
    const match = /^(.*)\s+\((mild|moderate|severe)\)$/i.exec(piece);
    if (match) {
      const name = match[1].trim().slice(0, 100);
      if (name) {
        effects.push({ name, severity: match[2].toLowerCase() as SideEffect["severity"] });
      }
    } else {
      // No severity recorded — keep the name so the note isn't lost.
      effects.push({ name: piece.slice(0, 100), severity: "mild" });
    }
    if (effects.length >= 20) break;
  }

  return effects.length > 0 ? effects : null;
}

/**
 * Strict YYYY-MM-DD, validated as a real calendar date rather than just
 * a shape. `/^\d{4}-\d{2}-\d{2}$/` happily accepts "2026-13-45", which
 * then reaches Intl and throws.
 */
export function parseIsoDate(raw: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));

  // Round-trip check catches both out-of-range components (month 13) and
  // dates that don't exist (31 February).
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

/** Deterministic colour so re-importing the same medication name twice
 * doesn't produce two differently-coloured pills. */
const STUB_COLOURS = [
  "#6366f1",
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#a855f7",
  "#ec4899",
  "#14b8a6",
];

export function colourForName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return STUB_COLOURS[hash % STUB_COLOURS.length];
}

const HEADER_COLUMNS = DOSE_CSV_HEADER.split(",");

/**
 * @param timezone IANA zone the file's local wall-clock times are read
 * in. The CSV carries no offset, so this is necessarily an assumption —
 * the UI states which zone is being used.
 */
export function parseDoseCsv(rawText: string, timezone: string): CsvParseResult {
  // +1 so a file that is exactly at the cap still has room for its header.
  const rows = parseCsv(rawText, MAX_CSV_ROWS + 1);
  // Leading blank lines are skipped the same way detectFormat's
  // firstNonEmptyLine does, so the two can't disagree about whether a
  // file is a valid dose CSV.
  const headerIndex = rows.findIndex((row) => row.some((cell) => cell.trim() !== ""));
  if (headerIndex === -1) return { ok: false, reason: "The CSV file is empty." };

  const header = rows[headerIndex].map((cell) => cell.trim());
  if (header.join(",") !== DOSE_CSV_HEADER) {
    return {
      ok: false,
      reason: `Unexpected CSV columns. Expected: ${DOSE_CSV_HEADER}`,
    };
  }

  const dataRows = rows
    .slice(headerIndex + 1)
    .filter((row) => row.some((cell) => cell.trim() !== ""));
  if (dataRows.length >= MAX_CSV_ROWS) {
    return {
      ok: false,
      reason: `That CSV has at least ${MAX_CSV_ROWS.toLocaleString()} rows, which is over the limit.`,
    };
  }

  const warnings: string[] = [];
  const doses: ImportDose[] = [];
  /** name (as displayed) -> earliest dose + dosage seen, for stubs. */
  const medicationsByKey = new Map<
    string,
    { name: string; amount: string; unit: string; earliest: Date }
  >();

  let skipped = 0;
  const skipReasons = new Set<string>();

  dataRows.forEach((row, index) => {
    // +2: one for the header, one for 1-based line numbers.
    const lineNumber = index + 2;

    const cell = (columnIndex: number) => unescapeCsvCell(row[columnIndex] ?? "").trim();
    if (row.length < HEADER_COLUMNS.length) {
      skipped++;
      skipReasons.add(`line ${lineNumber}: too few columns`);
      return;
    }

    const dateRaw = cell(0);
    const timeRaw = cell(1);
    const statusRaw = cell(2).toLowerCase();
    const nameRaw = cell(3);
    const dosageRaw = cell(4);
    const quantityRaw = cell(5);
    const notesRaw = cell(6);
    const sideEffectsRaw = cell(7);

    if (!nameRaw) {
      skipped++;
      skipReasons.add(`line ${lineNumber}: no medication name`);
      return;
    }

    // Strict ISO only. Accepting DD/MM/YYYY as well would make
    // 03/04/2026 silently ambiguous with MM/DD/YYYY and could shift
    // real dose history by months.
    const calendar = parseIsoDate(dateRaw);
    if (!calendar) {
      skipped++;
      skipReasons.add(`line ${lineNumber}: date must be a real YYYY-MM-DD`);
      return;
    }

    const clock = parseClockTime(timeRaw);
    if (!clock) {
      skipped++;
      skipReasons.add(`line ${lineNumber}: unreadable time "${timeRaw}"`);
      return;
    }

    const stamp = `${dateRaw}T${String(clock.hours).padStart(2, "0")}:${String(clock.minutes).padStart(2, "0")}`;
    // parseDateTimeLocal runs Intl.DateTimeFormat.formatToParts, which
    // throws RangeError on an out-of-range date rather than returning an
    // Invalid Date — an uncaught throw here would 500 the whole import
    // over one bad row.
    let takenAt: Date;
    try {
      takenAt = parseDateTimeLocal(stamp, timezone);
    } catch {
      skipped++;
      skipReasons.add(`line ${lineNumber}: unreadable date/time`);
      return;
    }

    // The JSON path gets these bounds from `importDate`; the CSV path has
    // to apply them itself, or a row dated 9999-12-31 would stretch every
    // future analytics range.
    if (!isImportableTime(takenAt.getTime())) {
      skipped++;
      skipReasons.add(`line ${lineNumber}: date outside the supported range`);
      return;
    }

    const status: DoseLogStatus =
      statusRaw === "skipped" || statusRaw === "missed" || statusRaw === "taken"
        ? (statusRaw as DoseLogStatus)
        : "taken";

    const parsedQuantity = Number(quantityRaw);
    const quantity =
      Number.isFinite(parsedQuantity) && parsedQuantity >= 1
        ? Math.min(1000, Math.floor(parsedQuantity))
        : 1;

    const key = nameRaw.trim().toLowerCase();
    const { amount, unit } = splitDosage(dosageRaw);
    const existing = medicationsByKey.get(key);
    if (!existing) {
      medicationsByKey.set(key, {
        name: nameRaw.slice(0, 200),
        amount,
        unit,
        earliest: takenAt,
      });
    } else if (takenAt < existing.earliest) {
      existing.earliest = takenAt;
    }

    doses.push({
      sourceMedicationId: null,
      medicationName: nameRaw.slice(0, 200),
      quantity,
      takenAt,
      loggedAt: null,
      notes: notesRaw ? notesRaw.slice(0, 500) : null,
      sideEffects: parseSideEffects(sideEffectsRaw),
      status,
    });
  });

  // The JSON path gets this cap from backupEnvelopeSchema; the CSV path
  // has to apply it itself, or a file of 50,000 distinct names would
  // create 50,000 stub medications.
  if (medicationsByKey.size > IMPORT_MAX_MEDICATIONS) {
    return {
      ok: false,
      reason: `That CSV names ${medicationsByKey.size.toLocaleString()} different medications, which is over the ${IMPORT_MAX_MEDICATIONS.toLocaleString()} limit.`,
    };
  }

  if (skipped > 0) {
    const detail = [...skipReasons].slice(0, 5).join("; ");
    warnings.push(
      `${skipped} ${skipped === 1 ? "row was" : "rows were"} skipped (${detail}${skipReasons.size > 5 ? "; …" : ""}).`,
    );
  }

  // A dose CSV carries no schedule information at all. Stubs are created
  // as PRN rather than guessing an interval: a wrong "scheduled" rate
  // would feed `dailyRateFor`, skewing refill forecasts and inventing an
  // adherence denominator the data can't support.
  const medications: ImportMedication[] = [...medicationsByKey.values()].map((med, index) => ({
    sourceId: null,
    name: med.name,
    dosageAmount: med.amount,
    dosageUnit: med.unit,
    form: "other",
    category: "otc",
    colour: colourForName(med.name),
    colourSecondary: null,
    pattern: "solid",
    notes: null,
    scheduleType: "as_needed",
    scheduleIntervalHours: null,
    inventoryCount: null,
    inventoryAlertThreshold: null,
    sortOrder: index,
    isArchived: false,
    archivedAt: null,
    startedAt: med.earliest,
    endedAt: null,
    schedules: [
      {
        scheduleKind: "prn",
        timeOfDay: null,
        intervalHours: null,
        daysOfWeek: null,
        sortOrder: 0,
        effectiveFrom: med.earliest,
        effectiveTo: null,
      },
    ],
  }));

  return {
    ok: true,
    bundle: {
      format: "dose-csv",
      exportedAt: null,
      profile: null,
      preferences: null,
      medications,
      doses,
      inventoryEvents: [],
      warnings,
    },
  };
}
