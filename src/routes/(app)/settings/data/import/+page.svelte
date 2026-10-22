<script lang="ts">
  import { tick } from "svelte";
  import type { ActionResult } from "@sveltejs/kit";
  import { enhance } from "$app/forms";
  import GlassCard from "$lib/components/ui/GlassCard.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import Alert from "$lib/components/ui/Alert.svelte";
  import DestructiveConfirm from "$lib/components/ui/DestructiveConfirm.svelte";
  import { createDestructiveDialog } from "$lib/components/ui/destructive-dialog.svelte";
  import { focusIfLost, pageHeading } from "$components/dose-writes/focus-after";
  import { replaceSummary } from "$lib/utils/destructive-confirm";

  let { data, form } = $props();

  let mode = $state<"merge" | "replace">("merge");
  let sectionInventory = $state(true);
  // Preferences and profile default OFF. Both overwrite settings the
  // account already has, which would contradict the promise that merging
  // never overwrites anything — so they are opt-in, not opt-out.
  let sectionPreferences = $state(false);
  let sectionProfile = $state(false);
  let submitting = $state(false);
  let fileName = $state("");
  let fileSize = $state(0);

  // name -> "skip" | "create" | a medication id
  let mapping = $state<Record<string, string>>({});

  const imported = $derived(form?.imported ?? null);

  const mappingJson = $derived(
    JSON.stringify(
      Object.fromEntries(
        Object.entries(mapping).map(([name, choice]) => [
          name.trim().toLowerCase(),
          choice === "skip" || choice === "create"
            ? { action: choice }
            : { action: "map", medicationId: choice },
        ]),
      ),
    ),
  );

  // A preview describes one exact combination of file and options. If any
  // of them changes afterwards the numbers on screen no longer describe
  // what the commit button would do — most dangerously, a merge preview
  // followed by switching to Replace. Drop the stale preview instead.
  //
  // The mapping is deliberately not part of this: changing it is the
  // normal flow, and the server re-plans on commit and refuses while any
  // name is still undecided.
  let previewSignature = $state<string | null>(null);
  const currentSignature = $derived(
    [mode, sectionInventory, sectionPreferences, sectionProfile, fileName, fileSize].join("|"),
  );
  const preview = $derived(
    previewSignature !== null && previewSignature !== currentSignature
      ? null
      : (form?.preview ?? null),
  );

  const needsMapping = $derived((preview?.unmatchedNames ?? []).length > 0);

  // Seed a choice for every unmatched name so the "Skip" shown in the
  // dropdown is actually submitted. Without this the default is only ever
  // visual: `mapping` stays empty, the server keeps reporting the name as
  // undecided, and the commit button can never be enabled.
  $effect(() => {
    const names = preview?.unmatchedNames ?? [];
    if (names.length === 0) return;
    const missing = names.filter((name) => !(name in mapping));
    if (missing.length === 0) return;
    mapping = { ...mapping, ...Object.fromEntries(missing.map((name) => [name, "skip"])) };
  });

  // Both the merge submit and the replace dialog's entry use it: the
  // dialog cannot open without a preview that matches what would be sent.
  const canCommit = $derived(preview !== null && !preview.empty && !needsMapping && !submitting);

  const maxMb = $derived(Math.round(data.maxBytes / 1024 / 1024));

  // Replace mode deletes everything first, so it commits from the one
  // confirmation dialog (DestructiveConfirm), which sits inside this form.
  const replaceDialog = createDestructiveDialog();

  function submitHandler() {
    const signatureAtSubmit = currentSignature;
    // The dialog is modal: while it is open its submit is the only one reachable.
    const fromDialog = replaceDialog.open;
    submitting = true;
    if (fromDialog) replaceDialog.begin();
    return async ({
      result,
      update,
    }: {
      result: ActionResult;
      update: (opts?: { reset?: boolean }) => Promise<void>;
    }) => {
      // A refusal stays in the dialog with the server's words; nothing was written.
      if (fromDialog && replaceDialog.settle(result)) {
        submitting = false;
        return;
      }
      try {
        await update({ reset: false });
      } finally {
        if (fromDialog) replaceDialog.finish();
        previewSignature = signatureAtSubmit;
        submitting = false;
      }
      // A successful commit replaces the form, and the control that had focus with it.
      if (result.type === "success") {
        await tick();
        focusIfLost(pageHeading);
      }
    };
  }
</script>

<svelte:head>
  <title>Import Data — MedTracker</title>
</svelte:head>

<div class="mx-auto w-full max-w-2xl space-y-6">
  <div class="flex items-center gap-3">
    <a href="/settings/data" class="text-text-muted hover:text-text-primary text-sm"
      >← Data Management</a
    >
    <span class="text-text-muted">/</span>
    <h1 tabindex="-1" class="text-2xl font-bold">Import Data</h1>
  </div>

  <!-- PERSISTENT, and outside the form: a successful commit replaces the
       form with the outcome, and a live region inserted with its content is
       not reliably announced. Only what happened goes in it. -->
  <div id="import-outcome" role="status">
    {#if imported}
      <Alert tone="happened" title="Import complete">
        <ul class="space-y-1">
          <li>{imported.medicationsCreated} medications added</li>
          {#if imported.medicationsReused > 0}
            <li>{imported.medicationsReused} already existed and were left untouched</li>
          {/if}
          <li>{imported.dosesCreated} dose entries added</li>
          {#if imported.dosesSkipped > 0}
            <li>{imported.dosesSkipped} dose entries skipped as duplicates</li>
          {/if}
          {#if imported.inventoryEventsCreated > 0}
            <li>{imported.inventoryEventsCreated} inventory events restored</li>
          {/if}
          {#if imported.medicationsDeleted > 0}
            <!-- Neutral: it reports what already happened, inside a happened Alert. -->
            <li>
              {imported.medicationsDeleted} medications and {imported.dosesDeleted} dose entries were
              replaced
            </li>
          {/if}
        </ul>
      </Alert>
    {/if}
  </div>

  {#if imported}
    <div class="flex gap-3">
      <Button variant="primary" href="/medications">View medications</Button>
      <Button variant="ghost" href="/settings/data">Back to Data</Button>
    </div>
  {:else}
    <form method="POST" enctype="multipart/form-data" use:enhance={submitHandler} class="space-y-6">
      <input type="hidden" name="mapping" value={mappingJson} />

      <!-- Here, before the first GlassCard, on purpose. Outside every card,
           because backdrop-blur-xl would make a card the containing block for
           Modal's fixed scrim. And first in the form, so while it is open its
           danger button is the form's default button: Enter in the word field
           submits the dialog (guarded), not "Preview again". The `contents`
           wrapper keeps the scrim from being a direct child of this
           space-y-6 form, whose margin-block-end would otherwise shorten the
           fixed inset-0 scrim and leave a clickable strip of page beneath it;
           it draws no box, so it adds no gap while the dialog is closed. -->
      <div class="contents">
        <DestructiveConfirm
          open={replaceDialog.open}
          onclose={replaceDialog.close}
          title="Replace all your data?"
          summary={replaceSummary({
            medications: preview?.summary.medicationsDeleted ?? 0,
            doses: preview?.summary.dosesDeleted ?? 0,
          })}
          word="REPLACE"
          hasPassword={data.hasPassword}
          confirmLabel="Replace all data"
          formaction="?/commit"
          pending={replaceDialog.pending}
          error={replaceDialog.error}
        />
      </div>

      <GlassCard>
        <h2 class="mb-1 text-lg font-semibold">Choose a file</h2>
        <p class="text-text-secondary mb-4 text-sm">
          A MedTracker JSON backup (full restore) or a dose-history CSV. Maximum {maxMb} MB.
        </p>

        <input
          type="file"
          name="file"
          aria-label="Choose a file to import"
          accept=".json,.csv,application/json,text/csv"
          required
          onchange={(event) => {
            const chosen = event.currentTarget.files?.[0];
            fileName = chosen?.name ?? "";
            fileSize = chosen?.size ?? 0;
          }}
          class="border-border-strong bg-surface-raised text-text-primary file:bg-accent file:text-accent-fg w-full rounded-lg border px-4 py-2.5 text-sm file:mr-4 file:rounded-md file:border-0 file:px-3 file:py-1.5 file:text-sm file:font-medium"
        />

        <p class="text-text-muted mt-3 text-xs">
          PDF reports can't be imported — they're formatted documents, not data. Audit-log exports
          are read-only history and can't be imported either.
        </p>
        <p class="text-text-muted mt-2 text-xs">
          CSV times have no timezone, so they'll be read as local time in <strong
            >{data.timezone}</strong
          >.
        </p>
      </GlassCard>

      <GlassCard>
        <h2 class="mb-4 text-lg font-semibold">How to import</h2>

        <div class="space-y-3">
          <label class="border-glass-border flex gap-3 rounded-lg border p-3">
            <input type="radio" name="mode" value="merge" bind:group={mode} class="mt-1" />
            <span>
              <span class="block text-sm font-medium">Merge (recommended)</span>
              <span class="text-text-muted block text-sm">
                Adds what's missing and skips duplicates. Nothing existing is changed or deleted.
              </span>
            </span>
          </label>

          <!-- Neutral, like Merge: choosing it is reversible. The step that can't
               be undone is the confirmation dialog's danger button. -->
          <label class="border-glass-border flex gap-3 rounded-lg border p-3">
            <input type="radio" name="mode" value="replace" bind:group={mode} class="mt-1" />
            <span>
              <span class="block text-sm font-medium">Replace everything</span>
              <span class="text-text-muted block text-sm">
                Deletes all current medications, schedules, doses and inventory history, then
                restores the file. Cannot be undone.
              </span>
            </span>
          </label>
        </div>

        <div class="border-glass-border mt-4 space-y-2 border-t pt-4">
          <p class="text-sm font-medium">Also restore from a JSON backup</p>
          <p class="text-text-muted text-xs">
            These overwrite settings you already have, so they're off by default.
          </p>
          <label class="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="sectionInventory"
              checked={sectionInventory}
              onchange={(event) => (sectionInventory = event.currentTarget.checked)}
            />
            Inventory counts and event history
          </label>
          <label class="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="sectionPreferences"
              checked={sectionPreferences}
              onchange={(event) => (sectionPreferences = event.currentTarget.checked)}
            />
            Appearance and notification preferences
          </label>
          <label class="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="sectionProfile"
              checked={sectionProfile}
              onchange={(event) => (sectionProfile = event.currentTarget.checked)}
            />
            Display name and timezone
          </label>
          <p class="text-text-muted text-xs">
            Your email, password and two-factor settings are never imported.
          </p>
        </div>
      </GlassCard>

      <!-- The outcome of the page's primary action. use:enhance means no
           navigation, so without a persistent live region the arrival of the
           preview below was not announced at all. A failure is an Alert with
           role="alert", which announces itself, so it is a sibling: nested in
           this polite region it could be read twice. -->
      <div role="status">
        {#if preview && !form?.error}
          <p class="sr-only">Import preview ready. Review the summary below before importing.</p>
        {/if}
      </div>
      {#if form?.error}
        <Alert tone="wrong" title={form.error} />
      {/if}

      {#if preview}
        <GlassCard>
          <h2 class="mb-3 text-lg font-semibold">Preview</h2>
          <p class="text-text-muted mb-3 text-sm">
            Nothing has been written yet. This is what importing
            {fileName ? `"${fileName}"` : "this file"} would do.
          </p>

          <dl class="grid grid-cols-2 gap-3 text-sm">
            <div class="bg-surface-raised rounded-lg p-3">
              <dt class="text-text-muted text-xs">Medications added</dt>
              <dd class="text-lg font-semibold">{preview.summary.medicationsCreated}</dd>
            </div>
            <div class="bg-surface-raised rounded-lg p-3">
              <dt class="text-text-muted text-xs">Dose entries added</dt>
              <dd class="text-lg font-semibold">{preview.summary.dosesCreated}</dd>
            </div>
            <div class="bg-surface-raised rounded-lg p-3">
              <dt class="text-text-muted text-xs">Already present (kept)</dt>
              <dd class="text-lg font-semibold">{preview.summary.medicationsReused}</dd>
            </div>
            <div class="bg-surface-raised rounded-lg p-3">
              <dt class="text-text-muted text-xs">Duplicates skipped</dt>
              <dd class="text-lg font-semibold">{preview.summary.dosesSkipped}</dd>
            </div>
          </dl>

          {#if preview.summary.medicationsDeleted > 0 || preview.summary.dosesDeleted > 0}
            <Alert
              class="mt-3"
              tone="needs-you"
              title={`Replace mode will first delete ${preview.summary.medicationsDeleted} medications and ${preview.summary.dosesDeleted} dose entries.`}
            />
          {/if}

          {#if preview.createdNames.length > 0}
            <p class="text-text-secondary mt-3 text-sm">
              <span class="font-medium">New:</span>
              {preview.createdNames.join(", ")}
            </p>
          {/if}
          {#if preview.reusedNames.length > 0}
            <p class="text-text-secondary mt-2 text-sm">
              <span class="font-medium">Matched existing:</span>
              {preview.reusedNames.join(", ")}
            </p>
          {/if}

          {#if preview.warnings.length > 0}
            <Alert class="mt-3" tone="needs-you" title="Check before importing">
              <!-- Unkeyed on purpose: two identical warnings would make a keyed each throw. -->
              <ul class="list-disc space-y-1 pl-4">
                {#each preview.warnings as warning}
                  <li>{warning}</li>
                {/each}
              </ul>
            </Alert>
          {/if}

          {#if preview.empty}
            <p class="text-text-muted mt-3 text-sm">
              Nothing new to import — everything in this file is already in your account.
            </p>
          {/if}
        </GlassCard>
      {/if}

      {#if needsMapping && preview}
        <GlassCard>
          <h2 class="mb-1 text-lg font-semibold">Unrecognised medications</h2>
          <p class="text-text-secondary mb-4 text-sm">
            These names aren't in your account. Choose what to do with each, then preview again.
          </p>

          <div class="space-y-3">
            {#each preview.unmatchedNames as name}
              <div class="border-glass-border flex items-center gap-3 rounded-lg border p-3">
                <span class="flex-1 text-sm font-medium">{name}</span>
                <!-- The name sits in a sibling <span>, which associates with
                     nothing — one select per unmatched name, all unnamed. -->
                <select
                  aria-label="What to do with {name}"
                  value={mapping[name] ?? "skip"}
                  onchange={(event) =>
                    (mapping = { ...mapping, [name]: event.currentTarget.value })}
                  class="border-border-strong bg-surface-raised text-text-primary focus:border-accent-ink focus:ring-accent-ink rounded-lg border px-3 py-2 text-sm focus:ring-1 focus:outline-none"
                >
                  <option value="skip">Skip</option>
                  <option value="create">Create as new</option>
                  {#each data.medications as med}
                    <option value={med.id}>
                      Map to {med.name}{med.isArchived ? " (archived)" : ""}
                    </option>
                  {/each}
                </select>
              </div>
            {/each}
          </div>
        </GlassCard>
      {/if}

      <div class="flex flex-wrap gap-3">
        <Button variant="secondary" type="submit" formaction="?/preview" disabled={submitting}>
          {preview ? "Preview again" : "Preview import"}
        </Button>

        {#if mode === "replace"}
          <!-- Opens the confirmation; the dialog's own danger button commits. -->
          <Button variant="secondary" disabled={!canCommit} onclick={replaceDialog.show}
            >Replace all data</Button
          >
        {:else}
          <Button variant="primary" type="submit" formaction="?/commit" disabled={!canCommit}
            >Import</Button
          >
        {/if}
      </div>

      {#if preview && needsMapping}
        <p class="text-text-muted text-sm">
          Decide what to do with the unrecognised medications above, then preview again to enable
          the import.
        </p>
      {/if}
    </form>
  {/if}
</div>
