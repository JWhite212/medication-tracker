<script lang="ts">
  import appIcon from "$lib/assets/medtracker-icon-vector.svg";
  import heroImage from "$lib/assets/9910d8b5-01d3-4293-94a7-eca14d4e66f5.png";
  import wordmark from "$lib/assets/medtracker-logo-lockup-vector.svg";
</script>

<svelte:head>
  <title>MedTracker — Personal Medication Tracker</title>
  <meta
    name="description"
    content="Log doses with a single tap, see live timers for every medication, track adherence streaks, and export your history. Free, secure, and open source."
  />
  <meta property="og:title" content="MedTracker — Personal Medication Tracker" />
  <meta
    property="og:description"
    content="Log doses with a single tap, see live timers, track adherence streaks. Beautiful, fast, and secure."
  />
  <meta property="og:url" content="https://medication-tracker-jw.vercel.app" />
  <link rel="canonical" href="https://medication-tracker-jw.vercel.app" />
</svelte:head>

<div class="flex min-h-screen flex-col">
  <header class="border-glass-border flex items-center justify-between border-b px-4 py-4 sm:px-6">
    <div class="flex items-center gap-3">
      <img src={appIcon} alt="" width="36" height="36" class="h-9 w-9 rounded-lg" />
      <span class="text-lg font-semibold">MedTracker</span>
    </div>
    <div class="flex items-center gap-3">
      <a
        href="/auth/login"
        class="text-text-secondary hover:text-text-primary rounded-lg px-4 py-2 text-sm font-medium"
        >Sign in</a
      >
      <a
        href="/auth/register"
        class="bg-accent hover:bg-accent-hover rounded-lg px-4 py-2 text-sm font-medium text-white"
        >Get Started</a
      >
    </div>
  </header>

  <main
    id="main-content"
    class="flex flex-1 flex-col items-center justify-center px-4 text-center sm:px-6"
  >
    <div
      class="grid w-full max-w-5xl grid-cols-1 items-center gap-10 py-12 lg:grid-cols-2 lg:gap-16 lg:text-left"
    >
      <div class="flex flex-col items-center lg:items-start">
        <h1
          class="max-w-2xl text-3xl leading-tight font-bold tracking-tight sm:text-4xl lg:text-5xl"
        >
          Track your medications
          <span class="text-accent">effortlessly</span>
        </h1>
        <p class="text-text-secondary mt-4 max-w-lg text-lg">
          Log doses with a single tap. See live timers. Track adherence. Beautiful, fast, and
          secure.
        </p>
        <div class="mt-8 flex gap-4">
          <a
            href="/auth/register"
            class="bg-accent hover:bg-accent-hover hover:shadow-accent/25 rounded-xl px-8 py-3 text-lg font-medium text-white transition-all hover:shadow-lg"
          >
            Start Tracking
          </a>
        </div>
      </div>
      <div class="flex justify-center lg:justify-end">
        <img
          src={heroImage}
          alt="MedTracker app showing a daily medication schedule with checkmarks for completed doses"
          width="320"
          height="560"
          loading="eager"
          class="shadow-accent/10 w-full max-w-xs rounded-3xl shadow-2xl sm:max-w-sm"
        />
      </div>
    </div>

    <div class="mt-16 grid max-w-3xl grid-cols-1 gap-6 text-center sm:grid-cols-3 sm:gap-8">
      <div>
        <div
          class="bg-accent/15 mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl text-xl"
        >
          ⏱
        </div>
        <h2 class="font-semibold">Live Timers</h2>
        <p class="text-text-secondary mt-1 text-sm">
          See exactly when you last took each medication
        </p>
      </div>
      <div>
        <div
          class="bg-success/15 mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl text-xl"
        >
          📊
        </div>
        <h2 class="font-semibold">Analytics</h2>
        <p class="text-text-secondary mt-1 text-sm">
          Track streaks, adherence, and patterns over time
        </p>
      </div>
      <div>
        <div
          class="bg-warning/15 mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl text-xl"
        >
          🔒
        </div>
        <h2 class="font-semibold">Secure</h2>
        <p class="text-text-secondary mt-1 text-sm">Your data is encrypted and never shared</p>
      </div>
    </div>
  </main>

  <footer class="border-glass-border flex flex-col items-center gap-3 border-t px-4 py-8 sm:px-6">
    <img src={wordmark} alt="MedTracker" width="220" height="55" class="h-12 w-auto" />
    <p class="text-text-muted text-xs">© MedTracker · Personal medication tracker</p>
  </footer>
</div>
