<script lang="ts">
  let {
    label,
    name,
    // The DOM id defaults to `name`, which is correct for the common case of one
    // field per name per page. It must be overridable: two forms on the same page
    // can legitimately post the same field name (settings/security mounts two
    // `currentPassword` inputs), and without this the second one's `<label for>`
    // resolves to the first input, leaving the second with no accessible name.
    id = name,
    type = "text",
    value = "",
    error = "",
    required = false,
    placeholder = "",
    ...rest
  }: {
    label: string;
    name: string;
    id?: string;
    type?: string;
    value?: string;
    error?: string;
    required?: boolean;
    placeholder?: string;
    [key: string]: unknown;
  } = $props();
</script>

<div>
  <label for={id} class="mb-1 block text-sm font-medium">
    {label}
    {#if required}<span class="text-danger-ink" aria-hidden="true">*</span>{/if}
  </label>
  <input
    {id}
    {name}
    {type}
    {value}
    {required}
    {placeholder}
    aria-invalid={error ? "true" : undefined}
    aria-describedby={error ? `${id}-error` : undefined}
    aria-required={required ? "true" : undefined}
    class="bg-surface-raised text-text-primary placeholder:text-text-muted focus:border-accent-ink focus:ring-accent-ink w-full rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none {error
      ? 'border-danger-ink'
      : 'border-border-strong'}"
    {...rest}
  />
  {#if error}<p id={`${id}-error`} class="text-danger-ink mt-1 text-sm" role="alert">
      {error}
    </p>{/if}
</div>
