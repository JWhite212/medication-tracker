<script lang="ts">
  import { enhance } from "$app/forms";
  import GlassCard from "$lib/components/ui/GlassCard.svelte";

  let { data, form } = $props();

  let mode = $state<"merge" | "replace">("merge");
  let sectionInventory = $state(true);
  let sectionPreferences = $state(true);
  let sectionProfile = $state(false);
  let password = $state("");
  let confirmPhrase = $state("");
  let submitting = $state(false);
  let fileName = $state("");

  // name -> "skip" | "create" | a medication id
  let mapping = $state<Record<string, string>>({});

  const preview = $derived(form?.preview ?? null);
  const imported = $derived(form?.imported ?? null);

  // The preview is advisory; commit re-parses the same upload. Both
  // buttons submit the one form, so the chosen file survives between
  // them without the user re-picking it.
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

  const needsMapping = $derived((preview?.unmatchedNames ?? []).length > 0);
  const replaceConfirmed = $derived(
    mode !== "replace" || (data.hasPassword ? password.length > 0 : confirmPhrase === "REPLACE"),
  );
  const canCommit = $derived(
    preview !== null && !preview.empty && !needsMapping && replaceConfirmed && !submitting,
  );

  const maxMb = $derived(Math.round(data.maxBytes / 1024 / 1024));

  function submitHandler() {
    submitting = true;
    return async ({ update }: { update: (opts?: { reset?: boolean }) => Promise<void> }) => {
      await update({ reset: false });
      submitting = false;
    };
  }
</script>

<svelte:head>
  <title>Import Data — MedTracker</title>
</svelte:head>

<div class="mx-auto w-full max-w-2xl space-y-6">
  <div class="flex items-center gap-3">
    <a href="/settings/data" class="text-text-muted hover:text-text-primary transition-colors"
      >&larr;</a
    >
    <h1 class="text-2xl font-bold">Import Data</h1>
  </div>

  {#if imported}
    <GlassCard>
      <h2 class="text-success mb-2 text-lg font-semibold">Import complete</h2>
      <ul class="text-text-secondary space-y-1 text-sm">
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
          <li class="text-danger">
            {imported.medicationsDeleted} medications and {imported.dosesDeleted} dose entries were replaced
          </li>
        {/if}
      </ul>
      <div class="mt-4 flex gap-3">
        <a
          href="/medications"
          class="bg-accent text-accent-fg rounded-lg px-4 py-2.5 text-sm font-medium transition-opacity hover:opacity-90"
        >
          View medications
        </a>
        <a
          href="/settings/data"
          class="border-glass-border hover:bg-glass-hover rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors"
        >
          Back to Data
        </a>
      </div>
    </GlassCard>
  {:else}
    <form method="POST" enctype="multipart/form-data" use:enhance={submitHandler} class="space-y-6">
      <input type="hidden" name="mapping" value={mappingJson} />

      <GlassCard>
        <h2 class="mb-1 text-lg font-semibold">Choose a file</h2>
        <p class="text-text-secondary mb-4 text-sm">
          A MedTracker JSON backup (full restore) or a dose-history CSV. Maximum {maxMb} MB.
        </p>

        <input
          type="file"
          name="file"
          accept=".json,.csv,application/json,text/csv"
          required
          onchange={(event) => {
            fileName = event.currentTarget.files?.[0]?.name ?? "";
          }}
          class="border-glass-border bg-surface-raised text-text-primary file:bg-accent file:text-accent-fg w-full rounded-lg border px-4 py-2.5 text-sm file:mr-4 file:rounded-md file:border-0 file:px-3 file:py-1.5 file:text-sm file:font-medium"
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

          <label class="border-danger/40 flex gap-3 rounded-lg border p-3">
            <input type="radio" name="mode" value="replace" bind:group={mode} class="mt-1" />
            <span>
              <span class="text-danger block text-sm font-medium">Replace everything</span>
              <span class="text-text-muted block text-sm">
                Deletes all current medications, schedules, doses and inventory history, then
                restores the file. Cannot be undone.
              </span>
            </span>
          </label>
        </div>

        {#if mode === "replace"}
          <div class="border-danger/40 bg-danger/5 mt-4 rounded-lg border p-3">
            {#if data.hasPassword}
              <label for="password" class="mb-1 block text-sm font-medium"
                >Confirm your password</label
              >
              <input
                id="password"
                type="password"
                name="password"
                bind:value={password}
                autocomplete="current-password"
                class="border-glass-border bg-surface-raised text-text-primary focus:border-danger focus:ring-danger w-full rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none"
              />
            {:else}
              <label for="confirmPhrase" class="mb-1 block text-sm font-medium">
                Type <strong>REPLACE</strong> to confirm
              </label>
              <input
                id="confirmPhrase"
                type="text"
                name="confirmPhrase"
                bind:value={confirmPhrase}
                autocomplete="off"
                class="border-glass-border bg-surface-raised text-text-primary focus:border-danger focus:ring-danger w-full rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none"
              />
            {/if}
          </div>
        {/if}

        <div class="border-glass-border mt-4 space-y-2 border-t pt-4">
          <p class="text-sm font-medium">Also restore from a JSON backup</p>
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

      {#if form?.importError}
        <p class="bg-danger/10 text-danger rounded-lg px-4 py-3 text-sm">{form.importError}</p>
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
            <p class="bg-danger/10 text-danger mt-3 rounded-lg px-4 py-3 text-sm">
              Replace mode will first delete {preview.summary.medicationsDeleted} medications and
              {preview.summary.dosesDeleted} dose entries.
            </p>
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
            <ul class="text-warning mt-3 space-y-1 text-sm">
              {#each preview.warnings as warning}
                <li>• {warning}</li>
              {/each}
            </ul>
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
                <select
                  value={mapping[name] ?? "skip"}
                  onchange={(event) =>
                    (mapping = { ...mapping, [name]: event.currentTarget.value })}
                  class="border-glass-border bg-surface-raised text-text-primary focus:border-accent focus:ring-accent rounded-lg border px-3 py-2 text-sm focus:ring-1 focus:outline-none"
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
        <button
          type="submit"
          formaction="?/preview"
          disabled={submitting}
          class="border-glass-border hover:bg-glass-hover rounded-lg border px-5 py-2.5 text-sm font-medium transition-colors disabled:opacity-50"
        >
          {preview ? "Preview again" : "Preview import"}
        </button>

        <button
          type="submit"
          formaction="?/commit"
          disabled={!canCommit}
          class="rounded-lg px-5 py-2.5 text-sm font-medium transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 {mode ===
          'replace'
            ? 'bg-danger text-white'
            : 'bg-accent text-accent-fg'}"
        >
          {mode === "replace" ? "Replace all data" : "Import"}
        </button>
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
