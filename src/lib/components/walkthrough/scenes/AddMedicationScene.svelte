<script lang="ts">
  // routes/(app)/medications/new: the top of MedicationForm.svelte, with the
  // name and dosage being typed in. The form stops at Category; the bottom
  // padding stands in for the rest of it so the card runs off the window.
  import type { Frame } from "../timeline";
  import { useMark } from "../marks";
  import FieldBox from "../parts/FieldBox.svelte";
  import SelectBox from "../parts/SelectBox.svelte";

  let { state }: { state: Frame["addForm"] } = $props();

  const mark = useMark();
</script>

<div class="mx-auto flex max-w-2xl flex-col gap-6">
  <p use:mark={"a.h1"} class="text-2xl font-bold">Add Medication</p>
  <div class="border-glass-border bg-glass rounded-xl border p-6 pb-[600px]">
    <div class="flex flex-col gap-5">
      <FieldBox
        label="Name"
        required
        value={state.name}
        placeholder="e.g. Aspirin"
        focused={state.focus === "name"}
        caret={state.caret}
        markKey="a.name"
      />
      <div use:mark={"a.dose"} class="grid grid-cols-2 gap-4">
        <FieldBox
          label="Dosage Amount"
          required
          value={state.amount}
          placeholder="e.g. 500"
          focused={state.focus === "amount"}
          caret={state.caret}
          markKey="a.amount"
        />
        <FieldBox
          label="Dosage Unit"
          required
          value={state.unit}
          placeholder="e.g. mg"
          focused={state.focus === "unit"}
          caret={state.caret}
          markKey="a.unit"
        />
      </div>
      <SelectBox label="Form" value="Tablet" />
      <div use:mark={"a.category"}><SelectBox label="Category" value="Prescription" /></div>
    </div>
  </div>
</div>
