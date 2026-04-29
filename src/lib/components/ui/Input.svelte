<script lang="ts">
  let {
    label,
    name,
    type = "text",
    value = "",
    error = "",
    required = false,
    placeholder = "",
    ...rest
  }: {
    label: string;
    name: string;
    type?: string;
    value?: string;
    error?: string;
    required?: boolean;
    placeholder?: string;
    [key: string]: unknown;
  } = $props();
</script>

<div>
  <label for={name} class="mb-1 block text-sm font-medium">
    {label}
    {#if required}<span class="text-danger" aria-hidden="true">*</span>{/if}
  </label>
  <input
    id={name}
    {name}
    {type}
    {value}
    {required}
    {placeholder}
    aria-invalid={error ? "true" : undefined}
    aria-describedby={error ? `${name}-error` : undefined}
    aria-required={required ? "true" : undefined}
    class="bg-surface-raised text-text-primary placeholder:text-text-muted focus:border-accent focus:ring-accent w-full rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none {error
      ? 'border-danger'
      : 'border-glass-border'}"
    {...rest}
  />
  {#if error}<p id={`${name}-error`} class="text-danger mt-1 text-sm" role="alert">{error}</p>{/if}
</div>
