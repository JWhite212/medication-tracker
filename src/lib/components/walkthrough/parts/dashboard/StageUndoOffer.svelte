<script lang="ts">
  // The one Undo offer from ui/Toast.svelte as a picture: the message, an
  // underlined "Undo" and "×", with the offer's classes. Undo and × are spans
  // shaped like the 44px buttons they stand for. The caller positions it,
  // as Toast's stack positions the real one. Its entrance is `opacity`, a
  // Frame value, never a CSS transition, and it has no five-second timer,
  // because the app's offer has none.
  import { useMark } from "../../marks";

  let { message, opacity, mark }: { message: string; opacity: number; mark?: string } = $props();

  const register = useMark();
</script>

<div
  use:register={mark}
  data-stage-section="offer"
  class="border-success/30 bg-success/10 text-success flex max-w-sm flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-4 py-3 shadow-lg backdrop-blur-xl"
  style:opacity
  style:transform="translateY({(1 - opacity) * 8}px)"
>
  <span class="min-w-0 flex-1 text-sm">{message}</span>
  <span class="inline-flex min-h-11 items-center px-3 text-sm font-medium underline">Undo</span>
  <span class="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-base"
    >×</span
  >
</div>
