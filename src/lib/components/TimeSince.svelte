<script lang="ts">
  import { formatTimeSince } from "$lib/utils/time";
  let { date, daysFromHours }: { date: Date; daysFromHours: number } = $props();

  // One spelling of "how long ago, now", so the three refresh paths below
  // cannot drift apart. `new Date()` is explicit: the device clock is the
  // point of a live counter.
  const render = () => formatTimeSince(date, new Date(), daysFromHours);
  let display = $state(render());

  $effect(() => {
    display = render();
    const interval = setInterval(() => {
      display = render();
    }, 60_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") display = render();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  });
</script>

<time datetime={date.toISOString()} class="tabular-nums">{display}</time>
