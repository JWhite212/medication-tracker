<script lang="ts">
  import TimelineEntry from "$components/TimelineEntry.svelte";
  import Modal from "$components/ui/Modal.svelte";
  import DoseEditForm from "$components/DoseEditForm.svelte";
  import EmptyState from "$components/EmptyState.svelte";
  import { onDestroy } from "svelte";
  import type { DoseLogWithMedication } from "$lib/types";
  import emptyDoseHistory from "$lib/assets/1b27c358-1903-4e2a-bf26-8f1085f94ee6.webp";

  let { data } = $props();
  let editingDose = $state<DoseLogWithMedication | null>(null);

  // Mirrors data.filters.q so the input stays responsive while typing
  // (debounced URL update), but resyncs whenever the loaded URL changes
  // — e.g. user clears the input or navigates with browser back.
  // eslint-disable-next-line svelte/prefer-writable-derived
  let searchInput = $state("");
  $effect(() => {
    searchInput = data.filters.q ?? "";
  });
  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  onDestroy(() => {
    if (searchTimer) {
      clearTimeout(searchTimer);
      searchTimer = null;
    }
  });

  // The filters are a plain GET form so they work without JavaScript
  // (SvelteKit's router intercepts GET submissions client-side when JS
  // is available). Changing any control auto-submits; the Apply button
  // is the no-JS path. Submitting a GET form drops the page param, so
  // every filter change naturally resets pagination to page 1.
  function submitOnChange(e: Event) {
    (e.currentTarget as HTMLInputElement | HTMLSelectElement).form?.requestSubmit();
  }

  function handleSearch(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    searchInput = input.value;
    if (searchTimer) {
      clearTimeout(searchTimer);
      searchTimer = null;
    }
    searchTimer = setTimeout(() => input.form?.requestSubmit(), 300);
  }

  // Keep submitted URLs clean when JS is available: temporarily disable
  // empty fields (and the redundant status=any default) so the browser
  // omits them from the query string. No-JS submissions include them —
  // the server load treats empty values as absent, so both work.
  function pruneEmptyFilters(e: SubmitEvent) {
    const form = e.currentTarget as HTMLFormElement;
    const pruned: (HTMLInputElement | HTMLSelectElement)[] = [];
    for (const el of Array.from(form.elements)) {
      if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLSelectElement)) continue;
      if (!el.name || el.disabled) continue;
      if (el instanceof HTMLInputElement && el.type === "checkbox") continue;
      if (el.value === "" || (el.name === "status" && el.value === "any")) {
        el.disabled = true;
        pruned.push(el);
      }
    }
    setTimeout(() => pruned.forEach((el) => (el.disabled = false)), 0);
  }

  const hasActiveFilter = $derived(
    Boolean(
      data.filters.medication ||
      data.filters.from ||
      data.filters.to ||
      data.filters.status !== "any" ||
      data.filters.withSideEffects ||
      data.filters.q,
    ),
  );

  function formatDateKey(date: Date, tz: string): string {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  }

  function formatDateLabel(dateKey: string, todayKey: string, yesterdayKey: string): string {
    if (dateKey === todayKey) return "Today";
    if (dateKey === yesterdayKey) return "Yesterday";

    const [y, m, d] = dateKey.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
    }).format(date);
  }

  const groupedDoses = $derived.by(() => {
    const now = new Date();
    const todayKey = formatDateKey(now, data.timezone);
    const yesterdayKey = formatDateKey(new Date(now.getTime() - 86400000), data.timezone);
    const groups: Array<{ dateKey: string; label: string; doses: typeof data.doses }> = [];
    const map = new Map<string, typeof data.doses>();
    for (const dose of data.doses) {
      const key = formatDateKey(new Date(dose.takenAt), data.timezone);
      const existing = map.get(key);
      if (existing) {
        existing.push(dose);
      } else {
        const arr = [dose];
        map.set(key, arr);
      }
    }
    for (const [dateKey, doses] of map) {
      groups.push({ dateKey, label: formatDateLabel(dateKey, todayKey, yesterdayKey), doses });
    }
    return groups;
  });
</script>

<svelte:head>
  <title>Dose History — MedTracker</title>
</svelte:head>

<div class="mx-auto w-full max-w-2xl space-y-6">
  <h1 class="text-2xl font-bold">Dose History</h1>

  <form
    method="GET"
    data-sveltekit-keepfocus
    data-sveltekit-noscroll
    onsubmit={pruneEmptyFilters}
    class="border-glass-border bg-glass flex flex-col gap-2 rounded-xl border p-4 backdrop-blur-xl sm:flex-row sm:flex-wrap sm:gap-3"
  >
    <select
      name="medication"
      aria-label="Filter by medication"
      class="border-glass-border bg-surface-raised text-text-primary w-full rounded-lg border px-3 py-2 text-sm sm:w-auto"
      onchange={submitOnChange}
    >
      <option value="">All medications</option>
      {#each data.medications as med}
        <option value={med.id} selected={med.id === data.filters.medication}>{med.name}</option>
      {/each}
    </select>
    <select
      name="status"
      aria-label="Filter by status"
      class="border-glass-border bg-surface-raised text-text-primary w-full rounded-lg border px-3 py-2 text-sm sm:w-auto"
      onchange={submitOnChange}
    >
      <option value="any" selected={data.filters.status === "any"}>Any status</option>
      <option value="taken" selected={data.filters.status === "taken"}>Taken</option>
      <option value="skipped" selected={data.filters.status === "skipped"}>Skipped</option>
      <option value="missed" selected={data.filters.status === "missed"}>Missed</option>
    </select>
    <input
      type="date"
      name="from"
      aria-label="From date"
      class="border-glass-border bg-surface-raised text-text-primary w-full rounded-lg border px-3 py-2 text-sm sm:w-auto"
      value={data.filters.from ?? ""}
      onchange={submitOnChange}
    />
    <span class="text-text-muted self-center">to</span>
    <input
      type="date"
      name="to"
      aria-label="To date"
      class="border-glass-border bg-surface-raised text-text-primary w-full rounded-lg border px-3 py-2 text-sm sm:w-auto"
      value={data.filters.to ?? ""}
      onchange={submitOnChange}
    />
    <input
      type="search"
      name="q"
      aria-label="Search notes"
      placeholder="Search notes…"
      class="border-glass-border bg-surface-raised text-text-primary w-full rounded-lg border px-3 py-2 text-sm sm:w-48"
      value={searchInput}
      oninput={handleSearch}
    />
    <label class="text-text-secondary flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        name="withSideEffects"
        value="1"
        class="border-glass-border bg-surface-raised h-4 w-4 rounded"
        checked={data.filters.withSideEffects}
        onchange={submitOnChange}
      />
      With side effects
    </label>
    <button
      type="submit"
      class="border-glass-border bg-surface-raised text-text-secondary hover:text-text-primary rounded-lg border px-3 py-2 text-sm"
    >
      Apply
    </button>
  </form>

  {#if data.doses.length === 0}
    {#if hasActiveFilter}
      <EmptyState
        title="No doses match these filters"
        body="Try clearing one or more filters above to see more results."
      />
    {:else}
      <EmptyState
        illustration={emptyDoseHistory}
        illustrationAlt="No dose history yet — your logged doses will appear here once you start tracking"
        title="No dose history yet"
        body="Your logged doses will appear here once you start tracking."
        action={{ href: "/dashboard", label: "Log a dose" }}
      />
    {/if}
  {:else}
    <div role="list">
      {#each groupedDoses as group (group.dateKey)}
        <div class="bg-surface/80 sticky top-0 z-10 -mx-1 px-1 py-2 backdrop-blur-sm">
          <h3 class="text-text-secondary text-sm font-medium">{group.label}</h3>
        </div>
        <div class="space-y-2 pb-4">
          {#each group.doses as dose (dose.id)}
            <TimelineEntry
              {dose}
              timezone={data.timezone}
              timeFormat={data.preferences.timeFormat as "12h" | "24h"}
              onedit={(d) => (editingDose = d)}
            />
          {/each}
        </div>
      {/each}
    </div>
  {/if}

  <nav aria-label="Dose history pagination" class="flex items-center justify-between">
    {#if data.page > 1}
      <a
        href="?page={data.page - 1}"
        rel="prev"
        aria-label="Go to previous page"
        class="border-glass-border hover:bg-glass-hover rounded-lg border px-4 py-2 text-sm"
        >Previous</a
      >
    {:else}<div></div>{/if}
    <span class="text-text-secondary text-sm" aria-current="page">Page {data.page}</span>
    {#if data.hasMore}
      <a
        href="?page={data.page + 1}"
        rel="next"
        aria-label="Go to next page"
        class="border-glass-border hover:bg-glass-hover rounded-lg border px-4 py-2 text-sm">Next</a
      >
    {:else}<div></div>{/if}
  </nav>
</div>

<Modal open={editingDose !== null} onclose={() => (editingDose = null)}>
  {#if editingDose}
    <DoseEditForm dose={editingDose} onclose={() => (editingDose = null)} />
  {/if}
</Modal>
