<script lang="ts">
  import { enhance } from "$app/forms";
  import { onDestroy } from "svelte";
  import GlassCard from "$lib/components/ui/GlassCard.svelte";
  import Tooltip from "$lib/components/ui/Tooltip.svelte";
  import { showToast } from "$lib/components/ui/Toast.svelte";
  import { APPEARANCE_ENTRIES, actionFor, entryFor } from "$lib/appearance/registry";
  import type { AppearanceKey } from "$lib/appearance/registry";
  import type { SubmitFunction } from "@sveltejs/kit";

  let { data } = $props();

  const presetColours = entryFor("accentColor").presets;

  /**
   * One settled control produces one POST. Long enough to swallow the
   * per-option `change` events a closed <select> fires under arrow keys
   * (arrowing three options down is three change events in Chrome), short
   * enough that the blur flush is the rare path rather than the normal one.
   */
  const SAVE_DEBOUNCE_MS = 400;

  // Local two-way state seeded from the server payload. `value={...}` is
  // one-way in Svelte 5 -- settings/notifications:56-62 documents the same
  // trap -- and this is also the revert target, because on a failure
  // `data` never changes and nothing else puts the control back.
  let values = $state({
    accentColor: data.preferences.accentColor,
    dateFormat: data.preferences.dateFormat,
    timeFormat: data.preferences.timeFormat,
    uiDensity: data.preferences.uiDensity,
    reducedMotion: data.preferences.reducedMotion,
  });

  // Deliberately NOT $state: timers and in-flight bookkeeping are never
  // rendered, and making them reactive would re-run the re-seed effect on
  // every save. `acked` is the last value the SERVER confirmed.
  const timers = new Map<AppearanceKey, ReturnType<typeof setTimeout>>();
  const inFlight = new Set<AppearanceKey>();
  const queued = new Set<AppearanceKey>();
  // Populated declaratively via bind:this on each <form> (below), so a
  // form is registered the moment it mounts -- not only after its first
  // change event. A submit that never goes through queueSave (implicit
  // submission, or a Save-button click in the window between use:enhance
  // attaching and `hydrated` flipping) still finds its form here.
  const formEls: Partial<Record<AppearanceKey, HTMLFormElement>> = {};
  let acked: Record<string, unknown> = { ...data.preferences };

  let status = $state<Record<string, "saving" | "saved" | "error" | undefined>>({});
  let announcement = $state("");
  // Alternates on every successful save so the announcement string is
  // never identical twice in a row. Svelte's $state equality check means
  // re-assigning the SAME string does not re-fire the source -- so a
  // repeated save of the same key (toggle reduce-motion off, then back
  // on) would leave the polite region silently unchanged on the second
  // save. The status text next to each control is aria-hidden, so there
  // is no fallback channel; this is the only thing a screen reader hears.
  let announceParity = false;
  // Set once, after hydration -- there is no onMount in this codebase, so
  // an effect is the idiom (log/+page.svelte:16 has the same disable for
  // the same reason: this can't be a $derived because it doesn't derive
  // from anything, it just flips once when the client takes over).
  // eslint-disable-next-line svelte/prefer-writable-derived
  let hydrated = $state(false);
  $effect(() => {
    hydrated = true;
  });

  // Re-seed from the server whenever a load re-runs. A successful save
  // calls invalidateAll, which re-runs the (app) layout load and returns
  // EVERY preference -- so without the guard, saving the accent would
  // stamp the server's stale density over a change made 200ms ago.
  $effect(() => {
    const prefs = data.preferences;
    for (const entry of APPEARANCE_ENTRIES) {
      acked[entry.key] = prefs[entry.key];
      if (timers.has(entry.key) || inFlight.has(entry.key) || queued.has(entry.key)) continue;
      values[entry.key] = prefs[entry.key] as never;
    }
  });

  onDestroy(() => {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  });

  function labelOf(key: AppearanceKey) {
    return entryFor(key).label;
  }

  // `APPEARANCE_ENTRIES` is `as const satisfies`, so each element keeps its
  // own literal type rather than widening to `AppearanceEntry` -- an entry
  // whose source object omits `description` (dateFormat, timeFormat) has no
  // such key at all, not even as `undefined`, so `entry.description` fails
  // to compile inside the {#each} below. The `in` check narrows the union
  // to the members that actually declare the key.
  function descriptionOf(entry: (typeof APPEARANCE_ENTRIES)[number]): string | undefined {
    return "description" in entry ? entry.description : undefined;
  }

  function queueSave(key: AppearanceKey) {
    clearTimeout(timers.get(key));
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        submitField(key);
      }, SAVE_DEBOUNCE_MS),
    );
  }

  /** Tabbing away commits immediately rather than waiting out the debounce. */
  function flushSave(key: AppearanceKey) {
    const timer = timers.get(key);
    if (timer === undefined) return;
    clearTimeout(timer);
    timers.delete(key);
    submitField(key);
  }

  /**
   * Flushes the accent save when focus actually leaves the swatch group --
   * guarded on `relatedTarget`, because focusout also fires between two
   * radios in the SAME group (the old one blurs before the new one
   * focuses). An unguarded focusout would flush on every arrow step and
   * defeat the debounce entirely.
   */
  function handleAccentGroupFocusOut(event: FocusEvent) {
    const group = event.currentTarget as HTMLFieldSetElement;
    if (!group.contains(event.relatedTarget as Node)) {
      flushSave("accentColor");
    }
  }

  function submitField(key: AppearanceKey) {
    const form = formEls[key];
    if (!form) return;
    // Arrowing away and back lands on the value already stored: no POST,
    // so a keyboard user cannot burn a rate-limit token standing still.
    if (values[key] === acked[key]) return;
    form.requestSubmit();
  }

  function save(key: AppearanceKey): SubmitFunction {
    return ({ cancel }) => {
      // Single-flight per key. Cancelling the NEWCOMER and queueing it is
      // what actually serialises the two writes: controller.abort() stops
      // us waiting for the response, it does not stop the server writing,
      // so an aborted A -> B can still land after B -> A. Abort also skips
      // this callback entirely, which would strand `inFlight`.
      // The guard lives here rather than in submitField so it also covers
      // Enter on a control and the pre-hydration Save button.
      if (inFlight.has(key)) {
        queued.add(key);
        cancel();
        return;
      }

      const previous = acked[key];
      const attempted = values[key];
      inFlight.add(key);
      status[key] = "saving";

      return async ({ result, update }) => {
        inFlight.delete(key);
        let rateLimited = false;

        if (result.type === "success") {
          acked[key] = attempted;
          status[key] = "saved";
          announceParity = !announceParity;
          // Trailing zero-width space forces a distinct string on every
          // save (see the announceParity declaration above) without
          // changing what a screen reader actually reads aloud.
          announcement = `${labelOf(key)} saved${announceParity ? "​" : ""}`;
        } else {
          // `data` is unchanged on a failure, so the re-seed effect above
          // does NOT run: this assignment is the only thing that puts the
          // control back. Skip it if the user already chose something newer.
          if (!queued.has(key)) values[key] = previous as never;
          status[key] = "error";
          rateLimited = result.type === "failure" && result.status === 429;
          showToast(
            result.type === "failure" && typeof result.data?.saveError === "string"
              ? result.data.saveError
              : `Could not save ${labelOf(key).toLowerCase()}.`,
            "error",
          );
        }

        try {
          // reset:false is not optional: hydration strips the checked/value
          // ATTRIBUTES while keeping the properties, so form.reset() blanks
          // the control that was just saved.
          await update({ reset: false });
        } finally {
          // `finally` (not a bare await) so a queued change is still
          // replayed -- or, on a 429, still cleared -- even if update()
          // itself rejects (a transient load failure on the (app) layout).
          // Without this, `key` stays in `queued` for the rest of the
          // session: permanently skipped by the re-seed guard and by the
          // failure-revert above.
          const hadQueued = queued.delete(key);
          if (hadQueued) {
            if (rateLimited) {
              // The server just asked us to slow down; replaying the
              // instant update() resolves would produce a second
              // rejected POST -- and a second error toast -- for the one
              // user intent that queued behind this save. Re-arm the
              // normal debounce timer instead of retrying immediately.
              timers.set(
                key,
                setTimeout(() => {
                  timers.delete(key);
                  submitField(key);
                }, SAVE_DEBOUNCE_MS),
              );
            } else {
              submitField(key);
            }
          }
        }
      };
    };
  }

  function statusText(key: AppearanceKey) {
    if (status[key] === "saving") return "Saving…";
    if (status[key] === "saved") return "Saved";
    if (status[key] === "error") return "Not saved";
    return "";
  }
</script>

<svelte:head>
  <title>Appearance — MedTracker</title>
</svelte:head>

<div class="mx-auto w-full max-w-2xl space-y-6">
  <div class="flex items-center gap-3">
    <a href="/settings" class="text-text-muted hover:text-text-primary transition-colors">&larr;</a>
    <h1 class="text-2xl font-bold">Appearance</h1>
  </div>

  <!-- Single polite region for every outcome, outside every form so a
       control is not re-announced when its own result changes. Mirrors
       settings/notifications:406-408. The Toast is NOT a polite channel
       despite its container -- each item carries role="alert" -- so it
       carries failures only. -->
  <p role="status" class="sr-only">{announcement}</p>

  <GlassCard>
    <div class="space-y-6">
      <form
        method="POST"
        action={actionFor("accentColor")}
        use:enhance={save("accentColor")}
        bind:this={formEls.accentColor}
      >
        <fieldset class="m-0 border-0 p-0" onfocusout={handleAccentGroupFocusOut}>
          <legend class="mb-2 block text-sm font-medium">{entryFor("accentColor").label}</legend>
          <div class="flex flex-wrap gap-2">
            {#each presetColours as colour (colour)}
              <label class="cursor-pointer">
                <input
                  type="radio"
                  name="accentColor"
                  value={colour}
                  bind:group={values.accentColor}
                  onchange={() => queueSave("accentColor")}
                  class="peer sr-only"
                />
                <span
                  class="border-text-primary peer-focus-visible:ring-accent-ink block h-8 w-8 rounded-full border-2 border-transparent transition-transform peer-checked:scale-110 peer-checked:border-2 peer-focus-visible:ring-2 hover:scale-110"
                  style="background-color: {colour}"
                ></span>
                <span class="sr-only"
                  >{entryFor("accentColor").optionLabelTemplate.replace("{value}", colour)}</span
                >
              </label>
            {/each}
          </div>
        </fieldset>
        {#if !hydrated}
          <button
            type="submit"
            class="bg-accent text-accent-fg mt-2 rounded-lg px-4 py-2 text-sm font-medium"
          >
            Save accent colour
          </button>
        {/if}
        <p class="text-text-muted mt-1 h-4 text-xs" aria-hidden="true">
          {statusText("accentColor")}
        </p>
      </form>

      {#each APPEARANCE_ENTRIES.filter((e) => e.control === "select") as entry (entry.key)}
        {@const desc = descriptionOf(entry)}
        <form
          method="POST"
          action={actionFor(entry.key)}
          use:enhance={save(entry.key)}
          bind:this={formEls[entry.key]}
        >
          <label for={entry.key} class="mb-1 block text-sm font-medium">
            {entry.label}
            {#if desc}
              <Tooltip text={desc} />
            {/if}
          </label>
          <select
            id={entry.key}
            name={entry.key}
            bind:value={values[entry.key]}
            onchange={() => queueSave(entry.key)}
            onblur={() => flushSave(entry.key)}
            class="border-border-strong bg-surface-raised text-text-primary focus:border-accent-ink focus:ring-accent-ink w-full rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none"
          >
            {#each entry.options as option (option.value)}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
          {#if !hydrated}
            <button
              type="submit"
              class="bg-accent text-accent-fg mt-2 rounded-lg px-4 py-2 text-sm font-medium"
            >
              Save {entry.label.toLowerCase()}
            </button>
          {/if}
          <p class="text-text-muted mt-1 h-4 text-xs" aria-hidden="true">
            {statusText(entry.key)}
          </p>
        </form>
      {/each}

      <form
        method="POST"
        action={actionFor("reducedMotion")}
        use:enhance={save("reducedMotion")}
        bind:this={formEls.reducedMotion}
      >
        <div class="flex items-center gap-3">
          <!-- The hidden "off" precedes the checkbox so the key is ALWAYS
               present: an unchecked box submits nothing, and a required
               arity cannot tell that apart from a mistyped field name.
               Object.fromEntries keeps the last duplicate, so "on" wins
               whenever the box is checked. Same pattern as
               MedicationNotificationFields.svelte:44-59. -->
          <input type="hidden" name="reducedMotion" value="off" />
          <input
            type="checkbox"
            id="reducedMotion"
            name="reducedMotion"
            value="on"
            bind:checked={values.reducedMotion}
            onchange={() => queueSave("reducedMotion")}
            onblur={() => flushSave("reducedMotion")}
            class="border-border-strong bg-surface-raised text-accent-ink focus:ring-accent-ink h-4 w-4 rounded-xs"
          />
          <label for="reducedMotion" class="text-sm font-medium">
            {entryFor("reducedMotion").label}
            <Tooltip text={entryFor("reducedMotion").description} />
          </label>
        </div>
        {#if !hydrated}
          <button
            type="submit"
            class="bg-accent text-accent-fg mt-2 rounded-lg px-4 py-2 text-sm font-medium"
          >
            Save motion setting
          </button>
        {/if}
        <p class="text-text-muted mt-1 h-4 text-xs" aria-hidden="true">
          {statusText("reducedMotion")}
        </p>
      </form>
    </div>
  </GlassCard>
</div>
