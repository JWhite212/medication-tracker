<svelte:head>
  <title>MedTracker — Personal Medication Tracker</title>
  <meta name="description" content="Log doses with a single tap, see live timers for every medication, track adherence streaks, and export your history. Free, secure, and open source." />
  <meta property="og:title" content="MedTracker — Personal Medication Tracker" />
  <meta property="og:description" content="Log doses with a single tap, see live timers, track adherence streaks. Beautiful, fast, and secure." />
  <meta property="og:url" content="https://medication-tracker-jw.vercel.app" />
  <link rel="canonical" href="https://medication-tracker-jw.vercel.app" />
</svelte:head>

<div class="flex min-h-screen flex-col">
  <header class="flex items-center justify-between border-b border-glass-border px-4 py-4 sm:px-6">
    <div class="flex items-center gap-3">
      <div class="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-sm font-bold text-white">M</div>
      <span class="text-lg font-semibold">MedTracker</span>
    </div>
    <div class="flex items-center gap-3">
      <a href="/auth/login" class="rounded-lg px-4 py-2 text-sm font-medium text-text-secondary hover:text-text-primary">Sign in</a>
      <a href="/auth/register" class="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover">Get Started</a>
    </div>
  </header>

  <main id="main-content" class="flex flex-1 flex-col items-center justify-center px-4 text-center sm:px-6">
    <h1 class="max-w-2xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl lg:text-5xl">
      Track your medications
      <span class="text-accent">effortlessly</span>
    </h1>
    <p class="mt-4 max-w-lg text-lg text-text-secondary">
      Log doses with a single tap. See live timers. Track adherence. Beautiful, fast, and secure.
    </p>
    <div class="mt-8 flex gap-4">
      <a href="/auth/register"
        class="rounded-xl bg-accent px-8 py-3 text-lg font-medium text-white transition-all hover:bg-accent-hover hover:shadow-lg hover:shadow-accent/25">
        Start Tracking
      </a>
    </div>

    <div class="mt-16 grid max-w-3xl grid-cols-1 gap-6 text-center sm:grid-cols-3 sm:gap-8">
      <div>
        <div class="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-accent/15 text-xl">⏱</div>
        <h2 class="font-semibold">Live Timers</h2>
        <p class="mt-1 text-sm text-text-secondary">See exactly when you last took each medication</p>
      </div>
      <div>
        <div class="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-success/15 text-xl">📊</div>
        <h2 class="font-semibold">Analytics</h2>
        <p class="mt-1 text-sm text-text-secondary">Track streaks, adherence, and patterns over time</p>
      </div>
      <div>
        <div class="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-warning/15 text-xl">🔒</div>
        <h2 class="font-semibold">Secure</h2>
        <p class="mt-1 text-sm text-text-secondary">Your data is encrypted and never shared</p>
      </div>
    </div>
  </main>
</div>
