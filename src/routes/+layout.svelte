<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta name="description" content="Track your medications, log doses with a single tap, see live timers, and monitor adherence — all in one beautiful, secure app." />
	<meta name="theme-color" content="#6366f1" />
	<meta property="og:site_name" content="MedTracker" />
	<meta property="og:type" content="website" />
	<meta name="twitter:card" content="summary" />
</svelte:head>

{@render children()}
