<script lang="ts">
  import { formatTimeSince } from "$lib/utils/time";
  let { date }: { date: Date } = $props();
  let display = $state(formatTimeSince(date));

  $effect(() => {
    display = formatTimeSince(date);
    const interval = setInterval(() => {
      display = formatTimeSince(date);
    }, 60_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") display = formatTimeSince(date);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  });
</script>

<time datetime={date.toISOString()} class="tabular-nums">{display}</time>
