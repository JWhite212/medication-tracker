// Ties the pipeline together: bytes -> detect -> parse -> snapshot ->
// plan. The route calls this for both the preview and the commit, so the
// two can never diverge in how they read a file.
import { parseBackup } from "./backup";
import { parseDoseCsv } from "./csv";
import { detectFormat } from "./detect";
import { buildImportPlan, type PlanOptions } from "./plan";
import { loadAccountSnapshot } from "./snapshot";
import type { ImportBundle, ImportPlan } from "./types";

export type BuildPlanResult = { ok: true; plan: ImportPlan } | { ok: false; reason: string };

/** Parse only — pure, no DB. Split out so tests can exercise format
 * dispatch without a database. */
export function parseImportFile(
  text: string,
  timezone: string,
): { ok: true; bundle: ImportBundle } | { ok: false; reason: string } {
  const detected = detectFormat(text);
  if (!detected.ok) return { ok: false, reason: detected.reason };

  return detected.format === "backup-json" ? parseBackup(text) : parseDoseCsv(text, timezone);
}

export async function buildPlanFromFile(
  userId: string,
  text: string,
  timezone: string,
  options: PlanOptions,
): Promise<BuildPlanResult> {
  const parsed = parseImportFile(text, timezone);
  if (!parsed.ok) return parsed;

  const snapshot = await loadAccountSnapshot(userId, options.mode);
  return { ok: true, plan: buildImportPlan(parsed.bundle, snapshot, options) };
}
