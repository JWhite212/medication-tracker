<!--
  Every Alert tone, title-only and with a body and an action, for
  tests/unit/alert-ssr.test.ts: a real .svelte caller, so the body and the
  action are compiled snippets as a page's are, and axe sees all eight.
-->
<script lang="ts">
  import Alert from "$lib/components/ui/Alert.svelte";
  import type { Tone } from "$lib/utils/status-tone";

  const TONES: Tone[] = ["happened", "wrong", "needs-you", "neutral"];
</script>

{#each TONES as tone (tone)}
  <Alert {tone} title="Settings saved." />
  <Alert {tone} title="Verify your email to get reminders by email.">
    We sent a link to your address.
    {#snippet action()}
      <button type="submit">Resend</button>
    {/snippet}
  </Alert>
{/each}
