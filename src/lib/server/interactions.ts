import { eq } from "drizzle-orm";
import { db } from "$lib/server/db";
import { medications } from "$lib/server/db/schema";

export async function checkInteractions(userId: string, drugName: string): Promise<string[]> {
  const existingMeds = await db
    .select({ name: medications.name })
    .from(medications)
    .where(eq(medications.userId, userId));

  const existingNames = existingMeds.map((m) => m.name);
  if (existingNames.length === 0) return [];

  const warnings: string[] = [];
  try {
    const res = await fetch(
      `https://api.fda.gov/drug/label.json?search=drug_interactions:"${encodeURIComponent(drugName)}"&limit=1`,
    );
    if (!res.ok) return [];
    const data = await res.json();
    const interactionText: string = data.results?.[0]?.drug_interactions?.[0] ?? "";
    const lowerText = interactionText.toLowerCase();

    for (const existing of existingNames) {
      if (lowerText.includes(existing.toLowerCase())) {
        warnings.push(`${drugName} may interact with ${existing}`);
      }
    }
  } catch {
    // OpenFDA unavailable — degrade gracefully
  }
  return warnings;
}
