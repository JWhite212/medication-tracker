/**
 * At or below the user's own low-stock alert level, which is the low-inventory
 * sweep's predicate (`reminders.ts`, in SQL) written once for TypeScript.
 * `refillChip` reads it to draw a row amber and `getRefillForecast` to list the
 * row at all, so the dashboard's Refills card and the medications card cannot
 * disagree about what needs reordering. No imports: a component and a server
 * module both read it.
 */
export function atOrBelowAlertThreshold(
  inventoryCount: number | null,
  inventoryAlertThreshold: number | null,
): boolean {
  return (
    inventoryCount !== null &&
    inventoryAlertThreshold !== null &&
    inventoryCount <= inventoryAlertThreshold
  );
}
