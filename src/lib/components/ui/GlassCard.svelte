<script lang="ts">
  import type { Snippet } from 'svelte';
  let { children, class: className = '', style = '' }: { children: Snippet; class?: string; style?: string } = $props();
</script>

<div class="rounded-xl border border-glass-border bg-glass p-6 backdrop-blur-xl {className}" {style}>
  {@render children()}
</div>
