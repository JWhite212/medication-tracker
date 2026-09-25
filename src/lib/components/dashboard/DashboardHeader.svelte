<script lang="ts">
  import type { DashboardStatus } from "$lib/types";
  import { formatUserDate, type DateFormat, type TimeFormat } from "$lib/utils/time";
  import { dashboardHeaderCopy } from "$lib/utils/dashboard-copy";
  import { DASHBOARD_HEADING_ID } from "./dom-ids";

  let {
    status,
    serverNow,
    timezone,
    timeFormat,
    dateFormat,
  }: {
    status: DashboardStatus;
    /** The page's server-relative 60-second tick. */
    serverNow: Date;
    timezone: string;
    timeFormat: TimeFormat;
    dateFormat: DateFormat;
  } = $props();

  const eyebrow = $derived(
    formatUserDate(serverNow, timezone, dateFormat, { weekday: true, year: false }),
  );
  const copy = $derived(dashboardHeaderCopy(status, serverNow, timezone, timeFormat));
</script>

<!-- A <div>, not <header>: inside <main> a header is not the banner landmark
     anyway, and this is not a live region — only the Toast is. -->
<div class="space-y-1">
  <p class="text-text-secondary text-sm">{eyebrow}</p>
  <!-- Stable "Today", and tabindex="-1": the last-resort focus target after a row resolves. -->
  <h1 id={DASHBOARD_HEADING_ID} tabindex="-1" class="text-2xl font-bold">Today</h1>
  <p class="text-lg font-semibold">{copy.sentence}</p>
  {#if copy.supporting}
    <p class="text-text-secondary text-sm">{copy.supporting}</p>
  {/if}
</div>
