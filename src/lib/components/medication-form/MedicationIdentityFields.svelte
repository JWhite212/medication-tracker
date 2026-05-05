<script lang="ts">
  import Input from "$lib/components/ui/Input.svelte";
  import InteractionWarningPanel from "./InteractionWarningPanel.svelte";
  import type { FormErrors } from "$lib/medications/medication-form-errors";

  let {
    nameValue,
    errors,
    interactionWarnings,
    onNameBlur,
  }: {
    nameValue: string;
    errors: FormErrors;
    interactionWarnings: string[];
    onNameBlur: (name: string) => void;
  } = $props();
</script>

<Input
  label="Name"
  name="name"
  value={nameValue}
  error={errors["name"]?.[0] ?? ""}
  required
  placeholder="e.g. Aspirin"
  onblur={(e: FocusEvent & { currentTarget: HTMLInputElement }) =>
    onNameBlur(e.currentTarget.value)}
/>

<InteractionWarningPanel warnings={interactionWarnings} />
