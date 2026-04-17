<script lang="ts">
  import type { SessionUser } from '$lib/types';
  import { page } from '$app/stores';

  let { user, mobile = false, onclose }: { user: SessionUser; mobile?: boolean; onclose?: () => void } = $props();

  const navItems = [
    { href: '/dashboard', label: 'Dashboard', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' },
    { href: '/medications', label: 'Medications', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/></svg>' },
    { href: '/log', label: 'History', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/></svg>' },
    { href: '/analytics', label: 'Analytics', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/></svg>' },
    { href: '/settings', label: 'Settings', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>' }
  ];
</script>

<aside class="flex h-screen w-64 flex-col border-r border-glass-border bg-surface-raised">
  <a href="/dashboard" class="flex items-center gap-3 border-b border-glass-border p-5 transition-colors hover:bg-glass-hover">
    <div class="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-sm font-bold text-accent-fg">M</div>
    <span class="text-lg font-semibold">MedTracker</span>
  </a>
  <nav class="flex-1 space-y-1 p-3">
    {#each navItems as item}
      {@const active = $page.url.pathname.startsWith(item.href)}
      <a href={item.href}
        class="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors {active ? 'bg-accent/15 text-accent' : 'text-text-secondary hover:bg-glass-hover hover:text-text-primary'}"
        aria-current={active ? 'page' : undefined}
        onclick={() => mobile && onclose?.()}>
        <span class="flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden="true">{@html item.icon}</span>
        {item.label}
      </a>
    {/each}
  </nav>
  <div class="border-t border-glass-border p-4">
    <a href="/settings" class="flex items-center gap-3 rounded-lg p-1 transition-colors hover:bg-glass-hover" onclick={() => mobile && onclose?.()}>
      <div class="flex h-8 w-8 items-center justify-center rounded-full bg-accent/20 text-xs font-medium text-accent">{user.name.charAt(0).toUpperCase()}</div>
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-medium">{user.name}</p>
        <p class="truncate text-xs text-text-muted">{user.email}</p>
      </div>
    </a>
  </div>
</aside>
