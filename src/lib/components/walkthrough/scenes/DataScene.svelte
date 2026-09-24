<script lang="ts">
  // routes/(app)/settings/data/+page.svelte: export and import. `hover` lights
  // the Download Export button as the cursor lands on it.
  import { DISCLAIMER_TEXT } from "$components/MedicalDisclaimer.svelte";
  import { useMark } from "../marks";
  import SelectBox from "../parts/SelectBox.svelte";

  let { hover }: { hover: boolean } = $props();

  const mark = useMark();
  const card = "border-glass-border bg-glass rounded-xl border p-6";
  const outline =
    "border-glass-border inline-flex rounded-lg border px-4 py-2.5 text-sm font-medium whitespace-nowrap";
</script>

<div class="mx-auto flex max-w-2xl flex-col gap-6">
  <div class="flex items-center gap-3">
    <span class="text-text-muted">←</span>
    <p class="text-2xl font-bold">Data Management</p>
  </div>
  <!-- An empty slot in the real page's layout keeps the same vertical rhythm -->
  <div></div>

  <div use:mark={"x.export"} class={card}>
    <p class="mb-4 text-lg font-semibold">Export</p>
    <p class="text-text-muted mb-4 text-xs">{DISCLAIMER_TEXT}</p>
    <div class="flex flex-col gap-4">
      <SelectBox label="Default Export Format" value="PDF" />
      <span
        class="bg-accent text-accent-fg self-start rounded-lg px-5 py-2.5 text-sm font-medium whitespace-nowrap"
        >Save Format</span
      >
    </div>
    <div class="border-glass-border mt-4 flex flex-wrap gap-3 border-t pt-4">
      <span use:mark={"x.download"} class="{outline} {hover ? 'bg-surface-overlay' : ''}"
        >Download Export</span
      >
      <span class={outline}>Download Full Backup (JSON)</span>
    </div>
    <p class="text-text-muted mt-3 text-xs">
      PDF and CSV exports are reports — useful to read or share, but they don't carry everything.
      The full JSON backup is the only format that can be imported back in.
    </p>
  </div>

  <div class={card}>
    <p class="mb-2 text-lg font-semibold">Import</p>
    <p class="text-text-secondary mb-4 text-sm">
      Restore from a backup, or bring data across from another account. Imports preview what will
      change before anything is written, and merging never overwrites what's already here.
    </p>
    <span class={outline}>Import Data</span>
  </div>
</div>
