<script lang="ts">
  import Sidebar from '$components/Sidebar.svelte';
  let { data, children } = $props();
</script>

<div class="flex h-screen overflow-hidden">
  <Sidebar user={data.user} />
  <main class="flex-1 overflow-y-auto p-6 lg:p-8">
    {@render children()}
  </main>
</div>
