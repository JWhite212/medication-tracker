<script lang="ts">
  let { label, name, type = 'text', value = '', error = '', required = false, placeholder = '', ...rest }:
    { label: string; name: string; type?: string; value?: string; error?: string; required?: boolean; placeholder?: string; [key: string]: unknown } = $props();
</script>

<div>
  <label for={name} class="mb-1 block text-sm font-medium">
    {label}
    {#if required}<span class="text-danger" aria-hidden="true">*</span>{/if}
  </label>
  <input id={name} {name} {type} {value} {required} {placeholder}
    aria-invalid={error ? 'true' : undefined}
    aria-describedby={error ? `${name}-error` : undefined}
    aria-required={required ? 'true' : undefined}
    class="w-full rounded-lg border bg-surface-raised px-4 py-2.5 text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent {error ? 'border-danger' : 'border-glass-border'}"
    {...rest} />
  {#if error}<p id={`${name}-error`} class="mt-1 text-sm text-danger" role="alert">{error}</p>{/if}
</div>
