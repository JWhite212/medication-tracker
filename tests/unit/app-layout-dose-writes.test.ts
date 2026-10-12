// The (app) layout owns the one dose-write lock every page under it reads
// (spec D10). A write or an Undo can outlive the page that started it, so the
// lock cannot belong to a page: the page navigated to must read the same one.
// It is also per layout instance, never module state, which during SSR is
// shared by every request the process serves.
//
// The page is a raw snippet that looks the lock up exactly as a dose control's
// initialisation does. Svelte runs a snippet inside the component context of
// the component that renders it, which here is the layout.
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRawSnippet, flushSync, mount, unmount } from "svelte";
import { readable } from "svelte/store";

// Sidebar reads $page for aria-current, and the layout registers an
// afterNavigate callback; both need a running SvelteKit client otherwise.
vi.mock("$app/navigation", () => ({ afterNavigate: () => {} }));
vi.mock("$app/stores", () => ({
  page: readable({ url: new URL("http://localhost/dashboard") }),
}));
// The layout's Toast reaches `$app/forms` and `$app/state` through the Undo
// registry (dose-writes/undo-registry.svelte.ts). Nothing here submits or
// reloads, so inert stand-ins keep SvelteKit's client runtime out of it.
vi.mock("$app/forms", () => ({
  deserialize: (text: string) => JSON.parse(text),
  enhance: () => ({ destroy() {} }),
}));
vi.mock("$app/state", () => ({
  navigating: { to: null, willUnload: null, complete: null },
  updated: { current: false },
  page: { url: new URL("http://localhost/dashboard"), data: {} },
}));

import Layout from "../../src/routes/(app)/+layout.svelte";
import {
  getDoseWriteLock,
  type DoseWriteLock,
} from "$lib/components/dose-writes/dose-write-lock.svelte";

const user = {
  id: "u1",
  email: "person@example.com",
  name: "Test Person",
  avatarUrl: null,
  timezone: "UTC",
  twoFactorEnabled: false,
  emailVerified: true,
};

const preferences = {
  userId: "u1",
  accentColor: "#4f46e5",
  theme: "system",
  dateFormat: "DD/MM/YYYY",
  timeFormat: "24h",
  uiDensity: "comfortable",
  reducedMotion: false,
  overdueEmailReminders: true,
  overduePushReminders: true,
  lowInventoryEmailAlerts: true,
  lowInventoryPushAlerts: false,
  doseLogPageSize: 20,
  heatmapPeriod: 90,
  exportFormat: "pdf",
  updatedAt: new Date("2026-08-01T00:00:00Z"),
} as const;

const mounted: Array<{ app: ReturnType<typeof mount>; target: HTMLElement }> = [];

afterEach(() => {
  for (const { app, target } of mounted.splice(0)) {
    unmount(app);
    target.remove();
  }
});

/** Mounts the layout around a page, and returns the lock that page found in context. */
function mountLayout(): DoseWriteLock | null {
  let seen: DoseWriteLock | null = null;
  const children = createRawSnippet(() => {
    seen = getDoseWriteLock();
    return { render: () => "<p>page</p>" };
  });
  const target = document.body.appendChild(document.createElement("div"));
  const app = mount(Layout, { target, props: { data: { user, preferences }, children } });
  flushSync();
  mounted.push({ app, target });
  return seen;
}

describe("the (app) layout's dose-write lock", () => {
  it("puts a lock in context for the page it renders", () => {
    const lock = mountLayout();
    expect(lock).not.toBeNull();
    expect(lock!.busy).toBe(false);
    expect(lock!.acquire()).toBe(true);
  });

  it("gives every layout instance its own lock, never one shared through module state", () => {
    const first = mountLayout();
    const second = mountLayout();
    expect(first).not.toBe(second);
    first!.acquire();
    expect(second!.busy).toBe(false);
  });
});
