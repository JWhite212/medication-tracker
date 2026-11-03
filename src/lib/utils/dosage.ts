/**
 * Units written straight after the number: "30mg", "5000IU", "5ml". Every
 * other unit is a word the user typed ("Serving", "tablets", "puffs") and
 * takes a space, or a 1-serving multivitamin reads "1Serving". Compared
 * lower-cased, so "mL" and "ML" match "ml".
 */
const ATTACHED_UNITS = new Set([
  "mg",
  "mcg",
  "µg",
  "μg",
  "ug",
  "ng",
  "g",
  "kg",
  "ml",
  "l",
  "iu",
  "mmol",
  "meq",
  "%",
]);

/**
 * A medication's dose as it is printed on screen and in the PDF: "30mg",
 * "5000IU", "1 Serving". The unit is free text (`dosageUnit` is any 1–20
 * character string), so the spacing rule lives here rather than at each
 * call site.
 *
 * Display only. The CSV export keeps its fused `${amount}${unit}` cell,
 * because `import/csv.ts` splits that exact shape when the file comes back.
 */
export function formatDosage(dosageAmount: string, dosageUnit: string): string {
  const unit = dosageUnit.trim();
  if (unit === "") return dosageAmount;
  return ATTACHED_UNITS.has(unit.toLowerCase())
    ? `${dosageAmount}${unit}`
    : `${dosageAmount} ${unit}`;
}
