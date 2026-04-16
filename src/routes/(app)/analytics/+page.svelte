<script lang="ts">
	import GlassCard from '$components/ui/GlassCard.svelte';
	import Heatmap from '$components/Heatmap.svelte';
	import AdherenceChart from '$components/AdherenceChart.svelte';
	import { goto } from '$app/navigation';

	let { data } = $props();

	const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
	const PERIODS = [
		{ value: 7, label: '7d' },
		{ value: 30, label: '30d' },
		{ value: 90, label: '90d' },
		{ value: 365, label: '1y' }
	] as const;

	function periodLabel(days: number): string {
		return days === 365 ? '1 year' : `${days} days`;
	}

	function setPeriod(value: number) {
		const url = new URL(window.location.href);
		url.searchParams.set('period', String(value));
		goto(url.toString(), { invalidateAll: true });
	}
</script>

<svelte:head>
	<title>Analytics — MedTracker</title>
</svelte:head>

<div class="mx-auto max-w-3xl space-y-6">
	<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
		<h1 class="text-2xl font-bold">Analytics</h1>
		<div class="flex gap-1 rounded-lg border border-glass-border bg-glass p-1 backdrop-blur-xl">
			{#each PERIODS as p}
				<button
					class="rounded-md px-3 py-1.5 text-sm font-medium transition-colors {data.period === p.value ? 'bg-accent text-white' : 'text-text-secondary hover:text-text-primary'}"
					onclick={() => setPeriod(p.value)}
				>
					{p.label}
				</button>
			{/each}
		</div>
	</div>

	<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:gap-4">
		<GlassCard class="text-center animate-fade-in-up" style="animation-delay: 0ms">
			<p class="text-3xl font-bold text-accent">{data.streak}</p>
			<p class="mt-1 text-sm text-text-secondary">Day Streak</p>
		</GlassCard>
		<GlassCard class="text-center animate-fade-in-up" style="animation-delay: 80ms">
			<p class="text-3xl font-bold text-success">
				{data.avgAdherence}%
			</p>
			<div class="mt-1 flex items-center justify-center gap-1.5">
				<span class="text-sm text-text-secondary">Avg Adherence</span>
				{#if data.trends.adherence.direction !== 'flat'}
					<span class="text-xs {data.trends.adherence.direction === 'up' ? 'text-success' : 'text-danger'}">
						{data.trends.adherence.direction === 'up' ? '\u2191' : '\u2193'}{data.trends.adherence.percent}%
					</span>
				{/if}
			</div>
		</GlassCard>
		<GlassCard class="text-center animate-fade-in-up" style="animation-delay: 160ms">
			<p class="text-3xl font-bold text-warning">
				{data.totalDoses}
			</p>
			<div class="mt-1 flex items-center justify-center gap-1.5">
				<span class="text-sm text-text-secondary">Doses ({periodLabel(data.period)})</span>
				{#if data.trends.doses.direction !== 'flat'}
					<span class="text-xs {data.trends.doses.direction === 'up' ? 'text-success' : 'text-danger'}">
						{data.trends.doses.direction === 'up' ? '\u2191' : '\u2193'}{data.trends.doses.percent}%
					</span>
				{/if}
			</div>
		</GlassCard>
	</div>

	<GlassCard>
		<h2 class="mb-4 text-lg font-semibold">Activity (last {periodLabel(data.period)})</h2>
		<Heatmap data={data.dailyCounts} days={data.period} />
	</GlassCard>

	<GlassCard>
		<h2 class="mb-4 text-lg font-semibold">Per-Medication Adherence ({periodLabel(data.period)})</h2>
		{#if data.medStats.length > 0}
			<AdherenceChart stats={data.medStats} trends={data.trends.perMedication} />
		{:else}
			<p class="text-text-secondary">No data yet</p>
		{/if}
	</GlassCard>

	<GlassCard>
		<h2 class="mb-4 text-lg font-semibold">Day of Week Distribution</h2>
		<div class="overflow-x-auto"><div class="flex h-32 items-end gap-2" style="min-width: 20rem">
			{#each Array.from({ length: 7 }, (_, i) => i) as dow}
				{@const count = data.dayOfWeek.find((d: { dayOfWeek: number }) => d.dayOfWeek === dow)?.count ?? 0}
				{@const maxD = Math.max(...data.dayOfWeek.map((d: { count: number }) => d.count), 1)}
				<div class="flex flex-1 flex-col items-center gap-1">
					<div
						class="w-full rounded-t bg-accent/60 transition-all"
						style="height: {(count / maxD) * 100}%"
					></div>
					<span class="text-[10px] text-text-muted">{DAY_LABELS[dow]}</span>
				</div>
			{/each}
		</div></div>
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
