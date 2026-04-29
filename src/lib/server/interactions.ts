import { eq } from "drizzle-orm";
import { db } from "$lib/server/db";
import { medications } from "$lib/server/db/schema";
import { env } from "$env/dynamic/private";

// Experimental drug-interaction notice powered by openFDA's drug
// labelling endpoint. NOT clinically reliable — see the disclaimer
// surfaced in MedicationForm.
//
// Gated by INTERACTIONS_ENABLED env so the feature can be disabled in
// production without a deploy if openFDA misbehaves or false positives
// become a problem.

const FETCH_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const cache = new Map<string, { text: string; expiresAt: number }>();

export function isInteractionsEnabled(): boolean {
  // Treat any value other than "true" (case-insensitive) as disabled.
  return (env.INTERACTIONS_ENABLED ?? "false").toLowerCase() === "true";
}

async function fetchInteractionText(drugName: string): Promise<string> {
  const cached = cache.get(drugName);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.text;
  }

  const params = new URLSearchParams({
    search: `drug_interactions:"${drugName}"`,
    limit: "1",
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(`https://api.fda.gov/drug/label.json?${params.toString()}`, {
      signal: controller.signal,
    });
    if (!res.ok) {
      cache.set(drugName, { text: "", expiresAt: Date.now() + CACHE_TTL_MS });
      return "";
    }
    const data = await res.json();
    const text: string = data.results?.[0]?.drug_interactions?.[0] ?? "";
    cache.set(drugName, { text, expiresAt: Date.now() + CACHE_TTL_MS });
    return text;
  } catch {
    // openFDA unavailable, timed out, or aborted — treat as no signal.
    return "";
  } finally {
    clearTimeout(timer);
  }
}

export async function checkInteractions(userId: string, drugName: string): Promise<string[]> {
  if (!isInteractionsEnabled()) return [];

  const existingMeds = await db
    .select({ name: medications.name })
    .from(medications)
    .where(eq(medications.userId, userId));

  const existingNames = existingMeds.map((m) => m.name);
  if (existingNames.length === 0) return [];

  const interactionText = await fetchInteractionText(drugName);
  if (!interactionText) return [];
  const lowerText = interactionText.toLowerCase();

  const warnings: string[] = [];
  for (const existing of existingNames) {
    if (lowerText.includes(existing.toLowerCase())) {
      warnings.push(`${drugName} may interact with ${existing}`);
    }
  }
  return warnings;
}

// Exported for testing.
export const __testing__ = {
  clearCache: () => cache.clear(),
};
