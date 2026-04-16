<script lang="ts">
  let step = $state(0);
  const totalSteps = 3;
</script>

<div class="mx-auto flex max-w-lg flex-col items-center gap-6 py-8">
  {#if step === 0}
    <div class="w-full rounded-xl border border-glass-border bg-glass p-8 text-center backdrop-blur-xl">
      <div class="mb-4 text-4xl" aria-hidden="true">&#x1F48A;</div>
      <h2 class="mb-2 text-2xl font-bold">Welcome to MedTracker</h2>
      <p class="mb-6 text-text-secondary">
        Track your medications, log doses, and stay on top of your health — all in one place.
      </p>
      <div class="flex flex-col items-center gap-3">
        <a
          href="/medications/new"
          class="inline-block rounded-lg bg-accent px-6 py-3 text-sm font-medium text-accent-fg transition-opacity hover:opacity-90"
        >
          Add your first medication
        </a>
        <button
          type="button"
          class="text-sm text-text-secondary transition-colors hover:text-text-primary"
          onclick={() => (step = 1)}
        >
          Learn more first
        </button>
      </div>
    </div>

  {:else if step === 1}
    <div class="w-full rounded-xl border border-glass-border bg-glass p-8 backdrop-blur-xl">
      <h2 class="mb-4 text-xl font-bold">Two ways to track</h2>
      <div class="space-y-4">
        <div class="rounded-lg border border-glass-border bg-surface-raised p-4">
          <p class="mb-1 font-medium text-accent">Scheduled</p>
          <p class="text-sm text-text-secondary">
            For medications you take on a regular schedule. MedTracker will show adherence stats
            and help you stay consistent.
          </p>
        </div>
        <div class="rounded-lg border border-glass-border bg-surface-raised p-4">
          <p class="mb-1 font-medium text-accent">As-needed (PRN)</p>
          <p class="text-sm text-text-secondary">
            For medications you take only when needed. Track usage frequency
            without the pressure of a schedule.
          </p>
        </div>
      </div>
      <div class="mt-6 flex items-center justify-between">
        <button
          type="button"
          class="text-sm text-text-secondary transition-colors hover:text-text-primary"
          onclick={() => (step = 0)}
        >
          Back
        </button>
        <button
          type="button"
          class="text-sm font-medium text-accent transition-colors hover:text-accent-hover"
          onclick={() => (step = 2)}
        >
          Next
        </button>
      </div>
    </div>

  {:else if step === 2}
    <div class="w-full rounded-xl border border-glass-border bg-glass p-8 backdrop-blur-xl">
      <h2 class="mb-4 text-xl font-bold">Your dashboard at a glance</h2>
      <p class="mb-4 text-sm text-text-secondary">
        Once you add medications, your dashboard will show:
      </p>
      <div class="space-y-3 text-sm">
        <div class="flex items-start gap-3">
          <span class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/20 text-xs text-accent">1</span>
          <p class="text-text-secondary"><span class="font-medium text-text-primary">Quick Log</span> — one-tap dose logging for each medication</p>
        </div>
        <div class="flex items-start gap-3">
          <span class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/20 text-xs text-accent">2</span>
          <p class="text-text-secondary"><span class="font-medium text-text-primary">Today's Timeline</span> — a live view of everything you've taken</p>
        </div>
        <div class="flex items-start gap-3">
          <span class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/20 text-xs text-accent">3</span>
          <p class="text-text-secondary"><span class="font-medium text-text-primary">Inventory Tracking</span> — know when it's time to refill</p>
        </div>
      </div>
      <div class="mt-6 flex items-center justify-between">
        <button
          type="button"
          class="text-sm text-text-secondary transition-colors hover:text-text-primary"
          onclick={() => (step = 1)}
        >
          Back
        </button>
        <a
          href="/medications/new"
          class="rounded-lg bg-accent px-6 py-3 text-sm font-medium text-accent-fg transition-opacity hover:opacity-90"
        >
          Get started
        </a>
      </div>
    </div>
  {/if}

  <!-- Step indicators -->
  <div class="flex gap-2">
    {#each Array(totalSteps) as _, i}
      <button
        type="button"
        class="h-2 rounded-full transition-all {i === step ? 'w-6 bg-accent' : 'w-2 bg-glass-border'}"
        aria-label="Go to step {i + 1}"
        onclick={() => (step = i)}
      ></button>
    {/each}
  </div>
</div>
