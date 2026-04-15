<script lang="ts">
	import GlassCard from '$components/ui/GlassCard.svelte';
	import Heatmap from '$components/Heatmap.svelte';
	import AdherenceChart from '$components/AdherenceChart.svelte';

	let { data } = $props();
</script>

<svelte:head>
	<title>Analytics — MedTracker</title>
</svelte:head>

<div class="mx-auto max-w-3xl space-y-6">
	<h1 class="text-2xl font-bold">Analytics</h1>

	<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:gap-4">
		<GlassCard class="text-center">
			<p class="text-3xl font-bold text-accent">{data.streak}</p>
			<p class="mt-1 text-sm text-text-secondary">Day Streak</p>
		</GlassCard>
		<GlassCard class="text-center">
			<p class="text-3xl font-bold text-success">
				{data.medStats.length > 0
					? Math.round(
							data.medStats.reduce(
								(a: number, s: { adherence: number }) => a + s.adherence,
								0
							) / data.medStats.length
						)
					: 0}%
			</p>
			<p class="mt-1 text-sm text-text-secondary">Avg Adherence</p>
		</GlassCard>
		<GlassCard class="text-center">
			<p class="text-3xl font-bold text-warning">
				{data.dailyCounts.reduce((a: number, d: { count: number }) => a + d.count, 0)}
			</p>
			<p class="mt-1 text-sm text-text-secondary">Doses (90 days)</p>
		</GlassCard>
	</div>

	<GlassCard>
		<h2 class="mb-4 text-lg font-semibold">Activity (last 90 days)</h2>
		<Heatmap data={data.dailyCounts} />
	</GlassCard>

	<GlassCard>
		<h2 class="mb-4 text-lg font-semibold">Per-Medication Adherence (30 days)</h2>
		{#if data.medStats.length > 0}
			<AdherenceChart stats={data.medStats} />
		{:else}
			<p class="text-text-secondary">No data yet</p>
		{/if}
	</GlassCard>

	<GlassCard>
		<h2 class="mb-4 text-lg font-semibold">Time of Day Distribution</h2>
		<div class="overflow-x-auto"><div class="flex h-32 items-end gap-1" style="min-width: 28rem">
			{#each Array.from({ length: 24 }, (_, i) => i) as hour}
				{@const count = data.hourly.find((h: { hour: number }) => h.hour === hour)?.count ?? 0}
				{@const maxH = Math.max(...data.hourly.map((h: { count: number }) => h.count), 1)}
				<div class="flex flex-1 flex-col items-center gap-1">
					<div
						class="w-full rounded-t bg-accent/60 transition-all"
						style="height: {(count / maxH) * 100}%"
					></div>
					{#if hour % 6 === 0}
						<span class="text-[10px] text-text-muted">{hour}</span>
					{/if}
				</div>
			{/each}
		</div></div>
	</GlassCard>
</div>
