<script lang="ts">
	let {
		stats,
		trends = []
	}: {
		stats: {
			medicationId: string;
			medicationName: string;
			colour: string;
			adherence: number;
			doseCount: number;
			expectedTotal: number;
		}[];
		trends?: { medicationId: string; trend: { direction: 'up' | 'down' | 'flat'; percent: number } }[];
	} = $props();

	function getTrend(medicationId: string) {
		return trends.find((t) => t.medicationId === medicationId)?.trend;
	}
</script>

<div class="space-y-3">
	{#each stats as stat}
		{@const trend = getTrend(stat.medicationId)}
		<div class="space-y-1">
			<div class="flex items-center justify-between text-sm">
				<div class="flex items-center gap-2">
					<div
						class="h-2.5 w-2.5 rounded-full"
						style="background-color: {stat.colour}"
					></div>
					<span class="font-medium">{stat.medicationName}</span>
				</div>
				<div class="flex items-center gap-1.5">
					<span class="text-text-secondary">{stat.adherence}%</span>
					{#if trend && trend.direction !== 'flat'}
						<span class="text-xs {trend.direction === 'up' ? 'text-success' : 'text-danger'}">
							{trend.direction === 'up' ? '\u2191' : '\u2193'}{trend.percent}%
						</span>
					{/if}
				</div>
			</div>
			<div class="h-2 overflow-hidden rounded-full bg-glass">
				<div
					class="h-full rounded-full transition-all duration-500"
					style="width: {Math.min(stat.adherence, 100)}%; background-color: {stat.colour}"
				></div>
			</div>
			<p class="text-xs text-text-muted">
				{stat.doseCount} / {stat.expectedTotal} doses
			</p>
		</div>
	{/each}
</div>
