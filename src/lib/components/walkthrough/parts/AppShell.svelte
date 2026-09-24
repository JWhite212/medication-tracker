<script lang="ts">
  // The desktop (app) layout at 1440x900: Sidebar.svelte on the left and the
  // page area on the right, signed in as the demo user. Plain divs rather than
  // aside/nav/main: this sits inside the landing page's own <main>, and the
  // whole stage is decorative (aria-hidden), so it must not add landmarks.
  import type { Snippet } from "svelte";
  import appIcon from "$lib/assets/medtracker-icon-vector.svg";
  import type { NavKey } from "../demo-data";
  import { SHELL_ROOT, useMark } from "../marks";

  let { active, overlay, children }: { active: NavKey; overlay?: Snippet; children: Snippet } =
    $props();

  const mark = useMark();

  const NAV: ReadonlyArray<{ key: NavKey; label: string }> = [
    { key: "dash", label: "Dashboard" },
    { key: "meds", label: "Medications" },
    { key: "log", label: "History" },
    { key: "ana", label: "Analytics" },
    { key: "set", label: "Settings" },
  ];
</script>

<div
  use:mark={SHELL_ROOT}
  class="bg-surface text-text-primary relative flex h-[900px] w-[1440px] overflow-hidden text-left text-base antialiased"
>
  <div class="bg-surface-raised border-glass-border flex h-full w-64 shrink-0 flex-col border-r">
    <div class="border-glass-border flex items-center gap-3 border-b p-5">
      <img src={appIcon} alt="" width="36" height="36" class="h-9 w-9 shrink-0 rounded-lg" />
      <span class="text-lg font-semibold">MedTracker</span>
    </div>
    <div class="flex flex-1 flex-col gap-1 p-3">
      {#each NAV as item (item.key)}
        <div
          class="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium {item.key ===
          active
            ? 'bg-accent/15 text-accent-ink'
            : 'text-text-secondary'}"
        >
          <span class="flex h-5 w-5 shrink-0 items-center justify-center">
            <!-- Lucide paths, as in Sidebar.svelte -->
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              {#if item.key === "dash"}
                <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
              {:else if item.key === "meds"}
                <path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z" />
                <path d="m8.5 8.5 7 7" />
              {:else if item.key === "log"}
                <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
                <path
                  d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"
                />
                <path d="M12 11h4" /><path d="M12 16h4" /><path d="M8 11h.01" /><path
                  d="M8 16h.01"
                />
              {:else if item.key === "ana"}
                <line x1="18" x2="18" y1="20" y2="10" />
                <line x1="12" x2="12" y1="20" y2="4" />
                <line x1="6" x2="6" y1="20" y2="14" />
              {:else}
                <path
                  d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
                />
                <circle cx="12" cy="12" r="3" />
              {/if}
            </svg>
          </span>
          {item.label}
        </div>
      {/each}
    </div>
    <div class="border-glass-border border-t p-4">
      <div class="flex items-center gap-3 rounded-lg p-1">
        <div
          class="bg-accent/15 text-accent-ink flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-medium"
        >
          D
        </div>
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium">Demo User</p>
          <p class="text-text-muted text-xs">demo@medtracker.app</p>
        </div>
      </div>
    </div>
  </div>
  <div class="relative flex-1 overflow-hidden">
    {@render children()}
  </div>
  {@render overlay?.()}
</div>
