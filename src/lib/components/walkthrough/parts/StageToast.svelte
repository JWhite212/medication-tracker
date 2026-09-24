<script lang="ts">
  // ui/Toast.svelte's success toast, with its entrance driven by `progress`
  // (0 hidden, 1 fully in) rather than a CSS transition.
  import { useMark } from "../marks";

  let {
    text,
    progress,
    bottom = 16,
    markKey,
  }: { text: string; progress: number; bottom?: number; markKey?: string } = $props();

  const mark = useMark();
</script>

<div
  class="absolute right-4 z-50 flex flex-col gap-2"
  style:bottom="{bottom}px"
  style:opacity={progress}
  style:transform="translateY({(1 - progress) * 8}px)"
>
  <div
    use:mark={markKey}
    class="border-success/30 bg-success/10 text-success flex items-center gap-3 rounded-lg border px-4 py-3 shadow-lg"
  >
    <span class="text-sm whitespace-nowrap">{text}</span>
  </div>
</div>
