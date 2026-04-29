<script lang="ts">
  import "../app.css";
  import favicon from "$lib/assets/favicon.svg";

  let { children } = $props();
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
  <meta
    name="description"
    content="Track your medications, log doses with a single tap, see live timers, and monitor adherence — all in one beautiful, secure app."
  />
  <meta name="theme-color" content="#6366f1" />
  <meta property="og:site_name" content="MedTracker" />
  <meta property="og:type" content="website" />
  <meta property="og:image" content="https://medication-tracker-jw.vercel.app/og-image.svg" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="MedTracker — Track your medications effortlessly" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:image" content="https://medication-tracker-jw.vercel.app/og-image.svg" />
  <meta name="twitter:image:alt" content="MedTracker — Track your medications effortlessly" />
</svelte:head>

{@render children()}
