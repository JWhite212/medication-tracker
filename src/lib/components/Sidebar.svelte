<script lang="ts">
  import type { SessionUser } from '$lib/types';
  import { page } from '$app/stores';

  let { user }: { user: SessionUser } = $props();

  const navItems = [
    { href: '/dashboard', label: 'Dashboard', icon: '⏱' },
    { href: '/medications', label: 'Medications', icon: '💊' },
    { href: '/log', label: 'History', icon: '📋' },
    { href: '/analytics', label: 'Analytics', icon: '📊' },
    { href: '/settings', label: 'Settings', icon: '⚙' }
  ];
</script>

<aside class="flex h-screen w-64 flex-col border-r border-glass-border bg-surface-raised">
  <div class="flex items-center gap-3 border-b border-glass-border p-5">
    <div class="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-sm font-bold text-white">M</div>
    <span class="text-lg font-semibold">MedTracker</span>
  </div>
  <nav class="flex-1 space-y-1 p-3">
    {#each navItems as item}
      {@const active = $page.url.pathname.startsWith(item.href)}
      <a href={item.href}
        class="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors {active ? 'bg-accent/15 text-accent' : 'text-text-secondary hover:bg-glass-hover hover:text-text-primary'}"
        aria-current={active ? 'page' : undefined}>
        <span class="text-base">{item.icon}</span>
        {item.label}
      </a>
    {/each}
  </nav>
  <div class="border-t border-glass-border p-4">
    <div class="flex items-center gap-3">
      <div class="flex h-8 w-8 items-center justify-center rounded-full bg-accent/20 text-xs font-medium text-accent">{user.name.charAt(0).toUpperCase()}</div>
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-medium">{user.name}</p>
        <p class="truncate text-xs text-text-muted">{user.email}</p>
      </div>
    </div>
  </div>
</aside>
