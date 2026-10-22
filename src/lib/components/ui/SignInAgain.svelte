<!--
  "Sign in again to confirm": what an account with no password sees when its
  session is too old for one of the four deletions nothing can undo
  (checkDestructiveGuard). One link per linked provider; each starts the
  provider sign-in and comes back to `returnTo` (server/auth/return-path.ts).

  A needs-you Alert, so it is never role="alert": a caller that shows it
  after something changed (a refusal, a mode switch) renders it inside a
  role="status" wrapper that already exists, which announces it.
-->
<script lang="ts">
  import Alert from "./Alert.svelte";
  import Button from "./Button.svelte";
  import {
    RECENT_SIGN_IN_MESSAGE,
    RECENT_SIGN_IN_WINDOW_MS,
    signInAgainHref,
    type ReturnPath,
    type WebProvider,
  } from "$lib/utils/destructive-confirm";

  let {
    providers,
    returnTo,
    note,
    class: className = "",
  }: {
    providers: WebProvider[];
    returnTo: ReturnPath;
    /** An extra sentence after the explanation, e.g. Import's "choose the file again". */
    note?: string;
    class?: string;
  } = $props();

  const NAMES: Record<WebProvider, string> = { google: "Google", github: "GitHub" };
  const MINUTES = RECENT_SIGN_IN_WINDOW_MS / 60_000;
</script>

{#snippet links()}
  <div class="flex flex-wrap gap-2">
    {#each providers as provider (provider)}
      <Button href={signInAgainHref(provider, returnTo)}
        >Sign in again with {NAMES[provider]}</Button
      >
    {/each}
  </div>
{/snippet}

<Alert
  tone="needs-you"
  title={RECENT_SIGN_IN_MESSAGE}
  class={className}
  action={providers.length > 0 ? links : undefined}
>
  {#if providers.length > 0}
    Deleting needs a sign-in in the last {MINUTES} minutes. You'll come back to this page.
    {#if note}{note}{/if}
  {:else}
    Deleting needs a sign-in in the last {MINUTES} minutes, and this account has no way to sign in again
    here. To delete, set a password with Forgot password on the sign-in page, then come back.
  {/if}
</Alert>
