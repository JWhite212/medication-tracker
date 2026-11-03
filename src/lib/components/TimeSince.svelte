<script lang="ts">
  import { formatTimeSince, TIME_SINCE_DAYS_FROM_HOURS } from "$lib/utils/time";
  let { date }: { date: Date } = $props();
  let display = $state(formatTimeSince(date, new Date(), TIME_SINCE_DAYS_FROM_HOURS));

  $effect(() => {
    display = formatTimeSince(date, new Date(), TIME_SINCE_DAYS_FROM_HOURS);
    const interval = setInterval(() => {
      display = formatTimeSince(date, new Date(), TIME_SINCE_DAYS_FROM_HOURS);
    }, 60_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible")
        display = formatTimeSince(date, new Date(), TIME_SINCE_DAYS_FROM_HOURS);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  });
</script>

<time datetime={date.toISOString()} class="tabular-nums">{display}</time>
