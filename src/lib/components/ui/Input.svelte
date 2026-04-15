<script lang="ts">
  let { label, name, type = 'text', value = '', error = '', required = false, placeholder = '', ...rest }:
    { label: string; name: string; type?: string; value?: string; error?: string; required?: boolean; placeholder?: string; [key: string]: unknown } = $props();
</script>

<div>
  <label for={name} class="mb-1 block text-sm font-medium">{label}</label>
  <input id={name} {name} {type} {value} {required} {placeholder}
    class="w-full rounded-lg border border-glass-border bg-surface-raised px-4 py-2.5 text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
    {...rest} />
  {#if error}<p class="mt-1 text-sm text-danger">{error}</p>{/if}
</div>
