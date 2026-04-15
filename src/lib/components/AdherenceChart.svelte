<script lang="ts">
	let {
		stats
	}: {
		stats: {
			medicationName: string;
			colour: string;
			adherence: number;
			doseCount: number;
			expectedTotal: number;
		}[];
	} = $props();
</script>

<div class="space-y-3">
	{#each stats as stat}
		<div class="space-y-1">
			<div class="flex items-center justify-between text-sm">
				<div class="flex items-center gap-2">
					<div
						class="h-2.5 w-2.5 rounded-full"
						style="background-color: {stat.colour}"
					></div>
					<span class="font-medium">{stat.medicationName}</span>
				</div>
				<span class="text-text-secondary">{stat.adherence}%</span>
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
