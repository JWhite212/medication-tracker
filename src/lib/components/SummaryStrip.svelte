<script lang="ts">
  let {
    doseCount,
    streak = 0,
    overdueCount = 0,
  }: { doseCount: number; streak?: number; overdueCount?: number } = $props();
</script>

<div
  class="border-glass-border bg-glass flex items-center justify-between rounded-lg border px-5 py-3 backdrop-blur-xl"
>
  <span class="text-text-secondary text-sm font-medium">
    <span class="text-text-primary text-lg font-bold">{doseCount}</span> doses today
  </span>
  <div class="flex items-center gap-2">
    {#if overdueCount > 0}
      <span class="bg-warning/15 text-warning rounded-full px-3 py-1 text-xs font-medium">
        {overdueCount} overdue
      </span>
    {/if}
    {#if streak > 0}
      <span class="bg-success/15 text-success rounded-full px-3 py-1 text-xs font-medium">
        {streak} day streak
      </span>
    {/if}
  </div>
</div>
