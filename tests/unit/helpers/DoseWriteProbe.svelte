<!--
  A bare control over createDoseWrite, for tests/unit/dose-write.svelte.test.ts.
  DoseActionForm always passes the dashboard clock as its stale guard; the
  /log and /medications controls pass none, and this is how the suite drives
  the primitive the way they do: with only the lock in context.
-->
<script lang="ts">
  import { enhance } from "$app/forms";
  import {
    createDoseWrite,
    type DoseWriteOptions,
  } from "$lib/components/dose-writes/dose-write.svelte";

  let {
    action = "?/logDose",
    fields = { medicationId: "m1", quantity: "1" },
    options = {},
  }: {
    action?: string;
    fields?: Record<string, string>;
    options?: DoseWriteOptions;
  } = $props();

  const write = createDoseWrite(() => options);
</script>

<form method="POST" {action} use:enhance={write.submit}>
  {#each Object.entries(fields) as [name, value] (name)}
    <input type="hidden" {name} {value} />
  {/each}
  <button type="submit" aria-disabled={write.busy ? "true" : undefined} onkeydown={write.onkeydown}
    >Write</button
  >
</form>
