// The (app) layout scrolls one element, <main>, inside a one-screen shell. An
// absolutely positioned descendant takes its nearest POSITIONED ancestor as its
// containing block, and an overflow clip only holds descendants whose
// containing block is inside the clipping element. With <main> left `static`,
// every `sr-only` inside it (the dashboard's hidden "Log" chip labels, Done
// rows and "Due" heading) used the page itself, escaped main's overflow, and
// stretched the document past the window: measured on the live dashboard, a
// 729px window had a 1262px document, ending exactly at the last hidden label.
// Scrolling main to its end then scrolled the document on, lifting the whole
// shell and showing blank page beneath it, on desktop and mobile alike.
//
// jsdom has no layout, so this pins the cause rather than measuring the
// symptom: <main> must be positioned while it is the scroll container.
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
// registry. Nothing here submits or reloads.
vi.mock("$app/forms", () => ({
  deserialize: (text: string) => JSON.parse(text),
  enhance: () => ({ destroy() {} }),
}));
vi.mock("$app/state", () => ({
  navigating: { to: null, willUnload: null, complete: null },
  updated: { current: false },
  page: { url: new URL("http://localhost/dashboard"), data: {} },
}));

const { default: Layout } = await import("../../src/routes/(app)/+layout.svelte");

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

let app: ReturnType<typeof mount> | undefined;

afterEach(() => {
  if (app) unmount(app);
  app = undefined;
  document.body.replaceChildren();
});

function mountLayout(): HTMLElement {
  const target = document.createElement("div");
  document.body.appendChild(target);
  const children = createRawSnippet(() => ({
    render: () => `<p><span class="sr-only">Log</span></p>`,
  }));
  app = mount(Layout, { target, props: { data: { user, preferences }, children } });
  flushSync();
  const main = target.querySelector<HTMLElement>("main#main-content");
  if (!main) throw new Error("main#main-content not rendered");
  return main;
}

describe("the (app) shell's scroll container", () => {
  it("is the page's only scroller: <main> scrolls inside a one-screen, clipped shell", () => {
    const main = mountLayout();

    expect(main.classList).toContain("overflow-y-auto");
    expect(main.parentElement?.classList).toEqual(
      expect.objectContaining({
        value: expect.stringMatching(/\bh-screen\b.*\boverflow-hidden\b/),
      }),
    );
  });

  it("is positioned, so a hidden label inside it cannot stretch the document", () => {
    const main = mountLayout();

    expect(main.classList).toContain("relative");
  });
});
