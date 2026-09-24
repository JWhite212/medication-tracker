<script lang="ts">
  // ui/Input.svelte drawn as a static box, so the typing animation can place a
  // caret and focus ring without a real (focusable) input on the landing page.
  import { useMark } from "../marks";

  let {
    label,
    required = false,
    value = "",
    placeholder = "",
    focused = false,
    caret = false,
    width,
    markKey,
  }: {
    label: string;
    required?: boolean;
    value?: string;
    placeholder?: string;
    focused?: boolean;
    caret?: boolean;
    width?: number;
    markKey?: string;
  } = $props();

  const mark = useMark();
</script>

<div class={width ? "shrink-0" : undefined} style:width={width ? `${width}px` : undefined}>
  <p class="mb-1 block text-sm font-medium">
    {label}{#if required}&nbsp;<span class="text-danger-ink">*</span>{/if}
  </p>
  <div
    use:mark={markKey}
    class="bg-surface-raised flex h-[46px] items-center overflow-hidden rounded-lg border px-4 text-base whitespace-nowrap {focused
      ? 'border-accent-ink ring-accent-ink ring-1'
      : 'border-border-strong'}"
  >
    {#if value}
      <span class="text-text-primary">{value}</span>
      {#if focused && caret}<span class="bg-text-primary mx-px inline-block h-5 w-0.5 shrink-0"
        ></span>{/if}
    {:else}
      {#if focused && caret}<span class="bg-text-primary mx-px inline-block h-5 w-0.5 shrink-0"
        ></span>{/if}
      <span class="text-text-muted">{placeholder}</span>
    {/if}
  </div>
</div>
