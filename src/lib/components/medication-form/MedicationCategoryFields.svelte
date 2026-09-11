<script lang="ts">
  import { FORM_OPTIONS, CATEGORY_OPTIONS } from "$lib/medications/medication-style-options";
  import type { FormErrors } from "$lib/medications/medication-form-errors";

  let {
    formValue,
    categoryValue,
    errors,
  }: {
    formValue: string;
    categoryValue: string;
    errors: FormErrors;
  } = $props();
</script>

<div>
  <label for="form" class="mb-1 block text-sm font-medium">Form</label>
  <select
    id="form"
    name="form"
    aria-invalid={errors["form"]?.[0] ? "true" : undefined}
    aria-describedby={errors["form"]?.[0] ? "form-error" : undefined}
    class="border-border-strong bg-surface-raised text-text-primary focus:border-accent-ink focus:ring-accent-ink w-full rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none"
  >
    {#each FORM_OPTIONS as opt}
      <option value={opt.value} selected={formValue === opt.value}>{opt.label}</option>
    {/each}
  </select>
  {#if errors["form"]?.[0]}<p id="form-error" class="text-danger-ink mt-1 text-sm" role="alert">
      {errors["form"][0]}
    </p>{/if}
</div>

<div>
  <label for="category" class="mb-1 block text-sm font-medium">Category</label>
  <select
    id="category"
    name="category"
    aria-invalid={errors["category"]?.[0] ? "true" : undefined}
    aria-describedby={errors["category"]?.[0] ? "category-error" : undefined}
    class="border-border-strong bg-surface-raised text-text-primary focus:border-accent-ink focus:ring-accent-ink w-full rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none"
  >
    {#each CATEGORY_OPTIONS as opt}
      <option value={opt.value} selected={categoryValue === opt.value}>{opt.label}</option>
    {/each}
  </select>
  {#if errors["category"]?.[0]}<p
      id="category-error"
      class="text-danger-ink mt-1 text-sm"
      role="alert"
    >
      {errors["category"][0]}
    </p>{/if}
</div>
