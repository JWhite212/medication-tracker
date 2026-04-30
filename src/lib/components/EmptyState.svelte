<script lang="ts">
  type Props = {
    illustration?: string;
    illustrationAlt?: string;
    title: string;
    body?: string;
    action?: { href?: string; label: string; onclick?: () => void };
  };

  let { illustration, illustrationAlt = "", title, body, action }: Props = $props();
</script>

<div
  class="border-glass-border bg-glass flex flex-col items-center rounded-xl border p-8 text-center backdrop-blur-xl sm:p-12"
>
  {#if illustration}
    <img
      src={illustration}
      alt={illustrationAlt}
      width="320"
      height="240"
      class="mb-4 w-full max-w-xs"
    />
  {/if}
  <h3 class="text-text-primary text-base font-semibold">{title}</h3>
  {#if body}
    <p class="text-text-secondary mt-2 max-w-sm text-sm">{body}</p>
  {/if}
  {#if action}
    {#if action.href}
      <a
        href={action.href}
        class="bg-accent text-accent-fg mt-4 rounded-lg px-5 py-2.5 text-sm font-medium transition-opacity hover:opacity-90"
      >
        {action.label}
      </a>
    {:else}
      <button
        type="button"
        onclick={action.onclick}
        class="bg-accent text-accent-fg mt-4 rounded-lg px-5 py-2.5 text-sm font-medium transition-opacity hover:opacity-90"
      >
        {action.label}
      </button>
    {/if}
  {/if}
</div>
