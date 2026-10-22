<!--
  Every Button, IconButton and Toggle case in one tree, for
  tests/unit/button-ssr.test.ts. A real .svelte caller, so each label is a
  compiled snippet exactly as a page's is, and axe sees every case at once.
  Each control carries data-case, passed through the primitive's rest props.
-->
<script lang="ts">
  import Button from "$lib/components/ui/Button.svelte";
  import IconButton from "$lib/components/ui/IconButton.svelte";
  import Toggle from "$lib/components/ui/Toggle.svelte";

  const VARIANTS = ["primary", "secondary", "ghost", "danger"] as const;
  const SIZES = ["md", "sm"] as const;
</script>

{#snippet cross()}
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
    <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" />
  </svg>
{/snippet}

{#each VARIANTS as variant (variant)}
  {#each SIZES as size (size)}
    <Button {variant} {size} data-case="{variant}-{size}">Save changes</Button>
  {/each}
{/each}
<Button href="/log" data-case="link">Clear filters</Button>
<Button type="submit" data-case="submit">Save</Button>
<Button pending={false} data-case="idle">Save changes</Button>
<Button variant="danger" pending={true} pendingLabel="Deleting…" data-case="pending"
  >Delete permanently</Button
>
<Button disabled data-case="disabled">Unavailable</Button>
<Button variant="danger" ariaDisabled data-case="aria-disabled">Delete</Button>
<Button variant="primary" block data-case="block">Sign in</Button>
<Button shape="pill" size="sm" aria-label="Remove Headache" data-case="pill"
  >Headache <span aria-hidden="true">&times;</span></Button
>
<IconButton label="Close menu" data-case="icon-md">{@render cross()}</IconButton>
<IconButton label="Remove colour" size="sm" variant="secondary" data-case="icon-sm"
  >{@render cross()}</IconButton
>
<IconButton label="Settings" href="/settings" data-case="icon-link">{@render cross()}</IconButton>
<div role="group" aria-label="Schedule">
  <Toggle pressed={true} data-case="toggle-on">Interval</Toggle>
  <Toggle pressed={false} data-case="toggle-off">Fixed time</Toggle>
  <Toggle pressed={false} size="md" shape="pill" data-case="toggle-pill">Headache</Toggle>
</div>
