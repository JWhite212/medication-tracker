<script lang="ts">
  import { tick } from "svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import { focusIfLost, isFocusLost, pageHeading } from "$lib/components/dose-writes/focus-after";

  let step = $state(0);
  const totalSteps = 3;

  // Each step's title is the page's h1 (tabindex="-1"): this component is the
  // whole dashboard for an account with no medications, so without one the
  // page had no h1 and pageHeading(), the last resort for focus, found
  // nothing. Exactly one step renders, so there is exactly one h1.
  //
  // Learn more first, Next and Back live inside the step they replace, so
  // pressing one removes the focused button and dropped focus to <body>.
  // Focus moves only if it was lost, and only if there was a focused control
  // to lose (Safari focuses no button it taps): the step dots persist and
  // keep it, and so does a tap that took nothing away.
  async function goTo(next: number) {
    const hadFocus = !isFocusLost();
    step = next;
    await tick();
    if (hadFocus) focusIfLost(pageHeading);
  }
</script>

<div class="mx-auto flex max-w-lg flex-col items-center gap-6 py-8">
  {#if step === 0}
    <div
      class="border-glass-border bg-glass w-full rounded-xl border p-8 text-center backdrop-blur-xl"
    >
      <div class="mb-4 text-4xl" aria-hidden="true">&#x1F48A;</div>
      <h1 tabindex="-1" class="mb-2 text-2xl font-bold">Welcome to MedTracker</h1>
      <p class="text-text-secondary mb-6">
        Track your medications, log doses, and stay on top of your health — all in one place.
      </p>
      <div class="flex flex-col items-center gap-3">
        <Button variant="primary" href="/medications/new">Add your first medication</Button>
        <Button variant="ghost" onclick={() => goTo(1)}>Learn more first</Button>
      </div>
    </div>
  {:else if step === 1}
    <div class="border-glass-border bg-glass w-full rounded-xl border p-8 backdrop-blur-xl">
      <h1 tabindex="-1" class="mb-4 text-xl font-bold">Two ways to track</h1>
      <div class="space-y-4">
        <div class="border-glass-border bg-surface-raised rounded-lg border p-4">
          <p class="text-accent-ink mb-1 font-medium">Scheduled</p>
          <p class="text-text-secondary text-sm">
            For medications you take on a regular schedule. MedTracker will show adherence stats and
            help you stay consistent.
          </p>
        </div>
        <div class="border-glass-border bg-surface-raised rounded-lg border p-4">
          <p class="text-accent-ink mb-1 font-medium">As-needed (PRN)</p>
          <p class="text-text-secondary text-sm">
            For medications you take only when needed. Track usage frequency without the pressure of
            a schedule.
          </p>
        </div>
      </div>
      <div class="mt-6 flex items-center justify-between">
        <Button variant="ghost" onclick={() => goTo(0)}>Back</Button>
        <Button variant="primary" onclick={() => goTo(2)}>Next</Button>
      </div>
    </div>
  {:else if step === 2}
    <div class="border-glass-border bg-glass w-full rounded-xl border p-8 backdrop-blur-xl">
      <h1 tabindex="-1" class="mb-4 text-xl font-bold">Your dashboard at a glance</h1>
      <p class="text-text-secondary mb-4 text-sm">
        Once you add medications, your dashboard will show:
      </p>
      <div class="space-y-3 text-sm">
        <div class="flex items-start gap-3">
          <span
            class="bg-accent/15 text-accent-ink mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs"
            >1</span
          >
          <p class="text-text-secondary">
            <span class="text-text-primary font-medium">Due</span> — one tap to log what's due
          </p>
        </div>
        <div class="flex items-start gap-3">
          <span
            class="bg-accent/15 text-accent-ink mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs"
            >2</span
          >
          <p class="text-text-secondary">
            <span class="text-text-primary font-medium">Done today</span> — everything you've logged
          </p>
        </div>
        <div class="flex items-start gap-3">
          <span
            class="bg-accent/15 text-accent-ink mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs"
            >3</span
          >
          <p class="text-text-secondary">
            <span class="text-text-primary font-medium">Refills</span> — know when to reorder
          </p>
        </div>
      </div>
      <div class="mt-6 flex items-center justify-between">
        <Button variant="ghost" onclick={() => goTo(1)}>Back</Button>
        <Button variant="primary" href="/medications/new">Get started</Button>
      </div>
    </div>
  {/if}

  <!-- Step indicators -->
  <div class="flex gap-2">
    {#each Array(totalSteps) as _, i}
      <!-- The dot stays 8px tall; the BUTTON is 24x24 so it meets the minimum
           target size (WCAG 2.5.8). aria-current carries the active step, which
           was previously conveyed only by width and colour. -->
      <button
        type="button"
        class="flex h-6 min-w-6 items-center justify-center"
        aria-label="Go to step {i + 1}"
        aria-current={i === step ? "step" : undefined}
        onclick={() => goTo(i)}
      >
        <span
          class="h-2 rounded-full transition-all {i === step
            ? 'bg-accent w-6'
            : 'bg-glass-border w-2'}"
        ></span>
      </button>
    {/each}
  </div>
</div>
