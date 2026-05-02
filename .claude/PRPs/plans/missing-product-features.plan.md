# Plan: Missing Product Features — Unarchive, Skip Overdue, Drug Interactions

## Summary

Add three missing product features: (1) unarchive medications (reverse the existing archive action), (2) skip/dismiss overdue dose reminders on the dashboard, and (3) drug interaction checking via the OpenFDA API when adding medications. Scoped to avoid over-engineering — each feature follows existing patterns closely.

## User Story

As a MedTracker user,
I want to restore archived medications, dismiss overdue reminders I've intentionally skipped, and see warnings about drug interactions,
So that I can manage edge cases and make informed decisions about my medications.

## Metadata

- **Complexity**: Medium
- **Source PRD**: N/A (from opportunity map Theme A)
- **Estimated Files**: 10

---

## UX Design

### Interaction Changes

| Touchpoint           | Before                  | After                                                   | Notes                           |
| -------------------- | ----------------------- | ------------------------------------------------------- | ------------------------------- |
| Archived medication  | No way to restore       | "Unarchive" button on medication detail page            | Mirrors existing archive button |
| Overdue on dashboard | Must log dose to clear  | "Skip" button dismisses until next interval             | Logs a skip event               |
| New medication form  | No interaction warnings | Banner if OpenFDA finds interactions with existing meds | Non-blocking advisory           |

---

## Files to Change

| File                                                | Action | Justification                                    |
| --------------------------------------------------- | ------ | ------------------------------------------------ |
| `src/lib/server/medications.ts`                     | UPDATE | Add unarchiveMedication + getArchivedMedications |
| `src/routes/(app)/medications/[id]/+page.server.ts` | UPDATE | Add unarchive action                             |
| `src/routes/(app)/medications/[id]/+page.svelte`    | UPDATE | Show unarchive button when archived              |
| `src/routes/(app)/medications/+page.svelte`         | UPDATE | Add "Archived" toggle/section                    |
| `src/routes/(app)/medications/+page.server.ts`      | UPDATE | Load archived medications too                    |
| `src/routes/(app)/dashboard/+page.svelte`           | UPDATE | Add skip button to overdue section               |
| `src/routes/(app)/dashboard/+page.server.ts`        | UPDATE | Add skipDose action                              |
| `src/lib/server/doses.ts`                           | UPDATE | Add logSkippedDose function                      |
| `src/lib/server/interactions.ts`                    | CREATE | OpenFDA drug interaction check                   |
| `src/lib/components/MedicationForm.svelte`          | UPDATE | Show interaction warnings                        |

## NOT Building

- Adherence goals UI (analytics theme handles this)
- Medication duplication/reorder (sort order is in Theme E)
- Full drug interaction database (OpenFDA is advisory only)
- Automatic interaction blocking (warnings only, not enforcement)

---

## Step-by-Step Tasks

### Task 1: Unarchive Medication

- **ACTION**: Add `unarchiveMedication` function to medications.ts. Add `unarchive` action to [id]/+page.server.ts. Show unarchive button in [id]/+page.svelte when medication is archived. Add archived section to medications list.
- **IMPLEMENT**:
  `medications.ts`:

  ```typescript
  export async function unarchiveMedication(userId: string, medicationId: string) {
    const [med] = await db
      .update(medications)
      .set({ isArchived: false, updatedAt: new Date() })
      .where(and(eq(medications.id, medicationId), eq(medications.userId, userId)))
      .returning();
    await logAudit(userId, "medication", medicationId, "update", {
      isArchived: { from: true, to: false },
    });
    return med;
  }

  export async function getArchivedMedications(userId: string) {
    return db
      .select()
      .from(medications)
      .where(and(eq(medications.userId, userId), eq(medications.isArchived, true)))
      .orderBy(medications.name);
  }
  ```

  `[id]/+page.server.ts` — add unarchive action.
  `[id]/+page.svelte` — conditional archive/unarchive button.
  `medications/+page.server.ts` — load archived list.
  `medications/+page.svelte` — collapsible archived section.

- **GOTCHA**: The medication detail page load must NOT filter by isArchived so the unarchive page works. Verify `getMedicationById` doesn't filter.
- **VALIDATE**: Archive → navigate to medication → Unarchive → appears in active list.

### Task 2: Skip/Dismiss Overdue Dose

- **ACTION**: Add a "skip" concept — logging a dose with quantity 0 and a "Skipped" note. Add skip button to dashboard overdue section.
- **IMPLEMENT**:
  `doses.ts` — add `logSkippedDose(userId, medicationId)` that inserts with `quantity: 0, notes: "Skipped"`.
  `dashboard/+page.server.ts` — add `skipDose` action.
  `dashboard/+page.svelte` — add skip button next to each overdue med.
- **GOTCHA**: quantity=0 means skip shows in history but doesn't decrement inventory. The timing system treats it as a "dose taken" and resets the overdue timer. No schema changes needed.
- **VALIDATE**: Overdue → Skip → overdue clears → history shows "Skipped".

### Task 3: Drug Interaction Check (OpenFDA)

- **ACTION**: Create `src/lib/server/interactions.ts` that queries OpenFDA. Show advisory warnings in MedicationForm.
- **IMPLEMENT**:
  `interactions.ts` — fetch OpenFDA drug label endpoint, search interaction text for existing medication names.
  `medications/new/+page.server.ts` — pass existing medication names to form.
  `MedicationForm.svelte` — check interactions on name input blur via API route.
- **GOTCHA**: OpenFDA rate-limited (240 req/min). Text matching is fuzzy. Advisory only with disclaimer. Wrap in try/catch for graceful degradation.
- **VALIDATE**: Add "Ibuprofen" when "Aspirin" exists → see interaction warning.

---

## Acceptance Criteria

- [ ] Archived medications can be unarchived
- [ ] Archived section visible on medications page
- [ ] Overdue medications can be skipped on dashboard
- [ ] Skipped doses appear in history with quantity 0
- [ ] OpenFDA interaction check runs when adding medications
- [ ] Interaction warnings are advisory (non-blocking)
- [ ] No type errors, all tests pass

## Risks

| Risk                                  | Likelihood | Impact | Mitigation                                            |
| ------------------------------------- | ---------- | ------ | ----------------------------------------------------- |
| OpenFDA rate limiting                 | Medium     | Low    | Graceful degradation, no API key needed for basic use |
| OpenFDA text matching false positives | Medium     | Low    | "Advisory only" disclaimer                            |
| Skip abuse (user skips everything)    | Low        | Low    | Skips show in history, affect adherence stats         |
