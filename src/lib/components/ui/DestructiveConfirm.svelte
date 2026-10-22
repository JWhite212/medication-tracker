<!--
  The one confirmation for the four deletions nothing can undo: Privacy's
  two wipes, Data's account deletion and Import's replace mode. It says what
  will go (with the server's counts), that it can't be undone, and asks for
  a typed word, plus the password where the account has one.

  - Render it INSIDE the <form> it submits. Its fields (`confirmWord`,
    `password`) and its danger button belong to that form.
  - That form must not sit inside a GlassCard. `backdrop-blur-xl` makes the
    card the containing block for Modal's `fixed inset-0` scrim, which would
    then be clipped to the card and stack under later page content.
  - The server's `checkDestructiveGuard` is the real gate; this dialog is the
    explanation. Readiness here mirrors the server's check (the word trimmed
    and case-sensitive, a password where there is one) so the button says
    when a submit would be refused, but a direct POST still meets the guard.
-->
<script lang="ts">
  import Modal from "./Modal.svelte";
  import Alert from "./Alert.svelte";
  import Button from "./Button.svelte";
  import type { DestructiveWord } from "$lib/utils/destructive-confirm";

  type Props = {
    open: boolean;
    onclose: () => void;
    /** "Delete dose history?" — the dialog's name and its heading. */
    title: string;
    /** What goes, from the server's counts: "This deletes 1,204 doses for 6 medications." */
    summary: string;
    word: DestructiveWord;
    hasPassword: boolean;
    /** The danger button's label. */
    confirmLabel: string;
    pending?: boolean;
    /** Shown as a wrong-tone Alert inside the dialog. */
    error?: string | null;
    returnFocus?: () => HTMLElement | null;
    /** Passed to the danger button: Import's form has no action, so it needs "?/commit". */
    formaction?: string;
  };

  let {
    open,
    onclose,
    title,
    summary,
    word,
    hasPassword,
    confirmLabel,
    pending = false,
    error = null,
    returnFocus,
    formaction,
  }: Props = $props();

  const uid = $props.id();

  let typed = $state("");
  let password = $state("");

  const ready = $derived(typed.trim() === word && (!hasPassword || password.length > 0));

  // Escape (through Modal) and Cancel both come here: a deletion in flight
  // cannot be dismissed out from under its own result.
  function requestClose() {
    if (!pending) onclose();
  }

  // aria-disabled, not disabled, keeps the button in the Tab order and the
  // trap's list, so it has to refuse the click itself. Implicit submission
  // (Enter in a field) clicks the form's default button, which this is while
  // it is the form's first submit button, so this one guard covers Enter too.
  function guard(e: MouseEvent) {
    if (!ready || pending) e.preventDefault();
  }

  // Neither effect reads what it writes.
  $effect(() => {
    if (!open) {
      typed = "";
      password = "";
    }
  });
  $effect(() => {
    if (error) password = "";
  });

  const INPUT =
    "border-border-strong bg-surface-raised text-text-primary focus:border-accent-ink focus:ring-accent-ink h-11 w-full rounded-lg border px-3 text-sm focus:ring-1 focus:outline-none";
</script>

<Modal {open} {title} onclose={requestClose} {returnFocus}>
  <h2 class="mb-2 text-lg font-semibold">{title}</h2>
  <p class="text-text-secondary text-sm">{summary}</p>
  <p class="text-text-secondary mt-1 text-sm">This can't be undone.</p>
  {#if error}
    <Alert class="mt-4" tone="wrong" title={error} />
  {/if}
  <div class="mt-4 space-y-3">
    <div>
      <label for="{uid}-word" class="mb-1 block text-sm font-medium"
        >Type <strong>{word}</strong> to confirm</label
      >
      <input
        id="{uid}-word"
        name="confirmWord"
        type="text"
        autocomplete="off"
        autocapitalize="characters"
        spellcheck="false"
        required
        bind:value={typed}
        class={INPUT}
      />
    </div>
    {#if hasPassword}
      <div>
        <label for="{uid}-password" class="mb-1 block text-sm font-medium">Your password</label>
        <input
          id="{uid}-password"
          name="password"
          type="password"
          autocomplete="current-password"
          required
          bind:value={password}
          class={INPUT}
        />
      </div>
    {/if}
  </div>
  <div class="mt-6 flex justify-end gap-3">
    <Button variant="ghost" ariaDisabled={pending} onclick={requestClose}>Cancel</Button>
    <Button
      variant="danger"
      type="submit"
      {formaction}
      ariaDisabled={!ready}
      {pending}
      pendingLabel={word === "REPLACE" ? "Replacing…" : "Deleting…"}
      onclick={guard}>{confirmLabel}</Button
    >
  </div>
</Modal>
