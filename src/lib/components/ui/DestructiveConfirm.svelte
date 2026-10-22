<!--
  The one confirmation for the four deletions nothing can undo: Privacy's
  two wipes, Data's account deletion and Import's replace mode. It says what
  will go (with the server's counts), that it can't be undone, and asks for
  a typed word, plus the password where the account has one. An account with
  no password must instead have signed in within the last 10 minutes; when
  it has not, or the server refuses because that moment has passed, the
  dialog offers "Sign in again" links (SignInAgain) and is not ready.

  - Render it INSIDE the <form> it submits. Its fields (`confirmWord`,
    `password`) and its danger button belong to that form.
  - That form must not sit inside a GlassCard. `backdrop-blur-xl` makes the
    card the containing block for Modal's `fixed inset-0` scrim, which would
    then be clipped to the card and stack under later page content.
  - The server's `checkDestructiveGuard` is the real gate; this dialog is the
    explanation. Readiness here mirrors the server's check (the word trimmed
    and case-sensitive, a password where there is one, a recent sign-in
    where there is not) so the button says when a submit would be refused,
    but a direct POST still meets the guard.
-->
<script lang="ts">
  import Modal from "./Modal.svelte";
  import Alert from "./Alert.svelte";
  import Button from "./Button.svelte";
  import SignInAgain from "./SignInAgain.svelte";
  import {
    RECENT_SIGN_IN_MESSAGE,
    type DestructiveConfirmation,
    type DestructiveWord,
    type ReturnPath,
  } from "$lib/utils/destructive-confirm";

  type Props = {
    open: boolean;
    onclose: () => void;
    /** "Delete dose history?" — the dialog's name and its heading. */
    title: string;
    /** What goes, from the server's counts: "This deletes 1,204 doses for 6 medications." */
    summary: string;
    word: DestructiveWord;
    /** What the guard will ask, from the page load's `destructiveConfirmation`. */
    confirmation: DestructiveConfirmation;
    /** This page, for "Sign in again" to come back to. */
    returnTo: ReturnPath;
    /** Added to the sign-in prompt: Import's "You'll need to choose the file again." */
    signInNote?: string;
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
    confirmation,
    returnTo,
    signInNote,
    confirmLabel,
    pending = false,
    error = null,
    returnFocus,
    formaction,
  }: Props = $props();

  const uid = $props.id();

  let typed = $state("");
  let password = $state("");

  const hasPassword = $derived(confirmation.kind === "password");
  // Set once the guard refuses for an old sign-in, recognised by its exact
  // words so the failure keeps the plain shape actionErrorMessage reads. It
  // outlives the error, which show() clears on reopen: the sign-in is no
  // younger after a Cancel, and Import would re-upload the file only to be
  // refused again. A sign-in round trip reloads the page, which resets it.
  let refusedForSignIn = $state(false);
  // Stale at load, or refused since.
  const needsSignIn = $derived(
    confirmation.kind === "recentSignIn" && (!confirmation.recent || refusedForSignIn),
  );

  const ready = $derived(
    !needsSignIn && typed.trim() === word && (!hasPassword || password.length > 0),
  );

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

  // None of these effects reads what it writes.
  $effect(() => {
    if (!open) {
      typed = "";
      password = "";
    }
  });
  $effect(() => {
    if (error) password = "";
  });
  $effect(() => {
    if (error === RECENT_SIGN_IN_MESSAGE) refusedForSignIn = true;
  });

  const INPUT =
    "border-border-strong bg-surface-raised text-text-primary focus:border-accent-ink focus:ring-accent-ink h-11 w-full rounded-lg border px-3 text-sm focus:ring-1 focus:outline-none";
</script>

<Modal {open} {title} onclose={requestClose} {returnFocus}>
  <h2 class="mb-2 text-lg font-semibold">{title}</h2>
  <p class="text-text-secondary text-sm">{summary}</p>
  <p class="text-text-secondary mt-1 text-sm">This can't be undone.</p>
  <!-- The sign-in refusal is shown once, as the prompt below, never also as a red Alert. -->
  {#if error && error !== RECENT_SIGN_IN_MESSAGE}
    <Alert class="mt-4" tone="wrong" title={error} />
  {/if}
  <!-- Always present, so a refusal that swaps the prompt in is announced. -->
  <div role="status">
    {#if needsSignIn && confirmation.kind === "recentSignIn"}
      <SignInAgain class="mt-4" providers={confirmation.providers} {returnTo} note={signInNote} />
    {/if}
  </div>
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
