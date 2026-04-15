<script lang="ts">
  import { enhance } from '$app/forms';
  import type { Medication } from '$lib/types';
  import Input from '$lib/components/ui/Input.svelte';

  let {
    medication = undefined,
    errors = {},
    formValues = {}
  }: {
    medication?: Medication;
    errors?: Record<string, string[]>;
    formValues?: Record<string, string>;
  } = $props();

  const presetColours = [
    '#6366f1', '#8b5cf6', '#a855f7', '#ec4899', '#ef4444',
    '#f59e0b', '#10b981', '#06b6d4', '#3b82f6', '#64748b'
  ];

  let selectedColour = $state(
    formValues['colour'] ?? medication?.colour ?? '#6366f1'
  );

  let loading = $state(false);
  let scheduleType = $state(
    formValues['scheduleType'] ?? medication?.scheduleType ?? 'scheduled'
  );

  const formOptions = [
    { value: 'tablet', label: 'Tablet' },
    { value: 'capsule', label: 'Capsule' },
    { value: 'liquid', label: 'Liquid' },
    { value: 'softgel', label: 'Softgel' },
    { value: 'patch', label: 'Patch' },
    { value: 'injection', label: 'Injection' },
    { value: 'inhaler', label: 'Inhaler' },
    { value: 'drops', label: 'Drops' },
    { value: 'cream', label: 'Cream' },
    { value: 'other', label: 'Other' }
  ];

  const categoryOptions = [
    { value: 'prescription', label: 'Prescription' },
    { value: 'otc', label: 'Over the Counter' },
    { value: 'supplement', label: 'Supplement' }
  ];
</script>

<form
  method="POST"
  action={medication ? '?/update' : undefined}
  use:enhance={() => {
    loading = true;
    return async ({ update }) => {
      await update();
      loading = false;
    };
  }}
  class="space-y-5"
>
  <Input
    label="Name"
    name="name"
    value={formValues['name'] ?? medication?.name ?? ''}
    error={errors['name']?.[0] ?? ''}
    required
    placeholder="e.g. Aspirin"
  />

  <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
    <Input
      label="Dosage Amount"
      name="dosageAmount"
      value={formValues['dosageAmount'] ?? medication?.dosageAmount ?? ''}
      error={errors['dosageAmount']?.[0] ?? ''}
      required
      placeholder="e.g. 500"
    />
    <Input
      label="Dosage Unit"
      name="dosageUnit"
      value={formValues['dosageUnit'] ?? medication?.dosageUnit ?? ''}
      error={errors['dosageUnit']?.[0] ?? ''}
      required
      placeholder="e.g. mg"
    />
  </div>

  <div>
    <label for="form" class="mb-1 block text-sm font-medium">Form</label>
    <select
      id="form"
      name="form"
      class="w-full rounded-lg border border-glass-border bg-surface-raised px-4 py-2.5 text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
    >
      {#each formOptions as opt}
        <option
          value={opt.value}
          selected={(formValues['form'] ?? medication?.form) === opt.value}
        >{opt.label}</option>
      {/each}
    </select>
    {#if errors['form']?.[0]}<p class="mt-1 text-sm text-danger">{errors['form'][0]}</p>{/if}
  </div>

  <div>
    <label for="category" class="mb-1 block text-sm font-medium">Category</label>
    <select
      id="category"
      name="category"
      class="w-full rounded-lg border border-glass-border bg-surface-raised px-4 py-2.5 text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
    >
      {#each categoryOptions as opt}
        <option
          value={opt.value}
          selected={(formValues['category'] ?? medication?.category) === opt.value}
        >{opt.label}</option>
      {/each}
    </select>
    {#if errors['category']?.[0]}<p class="mt-1 text-sm text-danger">{errors['category'][0]}</p>{/if}
  </div>

  <div>
    <p class="mb-2 block text-sm font-medium">Colour</p>
    <div class="flex flex-wrap gap-2">
      {#each presetColours as colour}
        <button
          type="button"
          onclick={() => (selectedColour = colour)}
          class="h-8 w-8 rounded-full transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 {selectedColour === colour ? 'ring-2 ring-accent ring-offset-2 scale-110' : ''}"
          style="background-color: {colour}"
          aria-label="Select colour {colour}"
        ></button>
      {/each}
    </div>
    <input type="hidden" name="colour" value={selectedColour} />
    {#if errors['colour']?.[0]}<p class="mt-1 text-sm text-danger">{errors['colour'][0]}</p>{/if}
  </div>

  <div>
    <label class="mb-1 block text-sm font-medium">Schedule Type</label>
    <div class="flex gap-3">
      <button
        type="button"
        onclick={() => (scheduleType = 'scheduled')}
        class="flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors {scheduleType === 'scheduled' ? 'border-accent bg-accent/15 text-accent' : 'border-glass-border text-text-secondary hover:bg-glass-hover'}"
      >
        Scheduled
      </button>
      <button
        type="button"
        onclick={() => (scheduleType = 'as_needed')}
        class="flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors {scheduleType === 'as_needed' ? 'border-accent bg-accent/15 text-accent' : 'border-glass-border text-text-secondary hover:bg-glass-hover'}"
      >
        As Needed (PRN)
      </button>
    </div>
    <input type="hidden" name="scheduleType" value={scheduleType} />
  </div>

  {#if scheduleType === 'scheduled'}
    <Input
      label="Schedule Interval (hours)"
      name="scheduleIntervalHours"
      type="number"
      value={formValues['scheduleIntervalHours'] ?? (medication?.scheduleIntervalHours ?? '')}
      error={errors['scheduleIntervalHours']?.[0] ?? ''}
      placeholder="e.g. 8"
    />
  {/if}

  <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
    <Input
      label="Inventory Count"
      name="inventoryCount"
      type="number"
      value={formValues['inventoryCount'] ?? (medication?.inventoryCount?.toString() ?? '')}
      error={errors['inventoryCount']?.[0] ?? ''}
      placeholder="e.g. 30"
    />
    <Input
      label="Low Stock Alert Threshold"
      name="inventoryAlertThreshold"
      type="number"
      value={formValues['inventoryAlertThreshold'] ?? (medication?.inventoryAlertThreshold?.toString() ?? '')}
      error={errors['inventoryAlertThreshold']?.[0] ?? ''}
      placeholder="e.g. 7"
    />
  </div>

  <div>
    <label for="notes" class="mb-1 block text-sm font-medium">Notes</label>
    <textarea
      id="notes"
      name="notes"
      rows="3"
      placeholder="Optional notes..."
      class="w-full rounded-lg border border-glass-border bg-surface-raised px-4 py-2.5 text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
    >{formValues['notes'] ?? medication?.notes ?? ''}</textarea>
    {#if errors['notes']?.[0]}<p class="mt-1 text-sm text-danger">{errors['notes'][0]}</p>{/if}
  </div>

  <button
    type="submit"
    disabled={loading}
    class="w-full rounded-lg bg-accent px-4 py-2.5 font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
  >
    {loading ? 'Saving...' : medication ? 'Update Medication' : 'Add Medication'}
  </button>
</form>
