<script lang="ts">
  let { doseCount, streak = 0, overdueCount = 0 }: { doseCount: number; streak?: number; overdueCount?: number } = $props();
</script>

<div class="flex items-center justify-between rounded-lg border border-glass-border bg-glass px-5 py-3 backdrop-blur-xl">
  <span class="text-sm font-medium text-text-secondary">
    <span class="text-lg font-bold text-text-primary">{doseCount}</span> doses today
  </span>
  <div class="flex items-center gap-2">
    {#if overdueCount > 0}
      <span class="rounded-full bg-warning/15 px-3 py-1 text-xs font-medium text-warning">
        {overdueCount} overdue
      </span>
    {/if}
    {#if streak > 0}
      <span class="rounded-full bg-success/15 px-3 py-1 text-xs font-medium text-success">
        {streak} day streak
      </span>
    {/if}
  </div>
</div>
