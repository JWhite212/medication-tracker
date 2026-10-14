<script lang="ts">
  // DashboardHeader.svelte as a picture: the date eyebrow, "Today", the
  // status sentence and its supporting line, with the real component's
  // classes. "Today" is a <p>, never a heading: the stage adds no headings.
  // The status crossfades from `before` to `after` as `logged` goes 0 → 1.
  // Both layers share one grid cell, so nothing below the header moves.
  import type { DashboardStatus } from "$lib/types";
  import type { DateFormat, TimeFormat } from "$lib/utils/time";
  import { dashboardHeaderCopy, headerEyebrow } from "$lib/utils/dashboard-copy";
  import { useMark } from "../../marks";
  import { WALKTHROUGH_DATE_FORMAT } from "../../stage-dashboard";

  let {
    before,
    after,
    logged,
    now,
    tz,
    timeFormat,
    dateFormat = WALKTHROUGH_DATE_FORMAT,
    mark,
  }: {
    before: DashboardStatus;
    after: DashboardStatus;
    logged: number;
    /** The moment's `now`; a beat's before and after share it. */
    now: Date;
    tz: string;
    timeFormat: TimeFormat;
    dateFormat?: DateFormat;
    mark?: string;
  } = $props();

  const register = useMark();

  const eyebrow = $derived(headerEyebrow(now, tz, dateFormat));
  // The copy reads the payload only, and `logged` moves every frame, so the
  // layers never read it: each one's opacity does, in the template.
  const layers = $derived([
    { key: "before", copy: dashboardHeaderCopy(before, now, tz, timeFormat), after: false },
    { key: "after", copy: dashboardHeaderCopy(after, now, tz, timeFormat), after: true },
  ]);
</script>

<div use:register={mark} data-stage-section="header" class="space-y-1">
  <p class="text-text-secondary text-sm">{eyebrow}</p>
  <p class="text-2xl font-bold">Today</p>
  <div class="grid">
    {#each layers as layer (layer.key)}
      <div
        class="col-start-1 row-start-1 space-y-1"
        style:opacity={layer.after ? logged : 1 - logged}
      >
        <p class="text-lg font-semibold">{layer.copy.sentence}</p>
        {#if layer.copy.supporting}
          <p class="text-text-secondary text-sm">{layer.copy.supporting}</p>
        {/if}
      </div>
    {/each}
  </div>
</div>
