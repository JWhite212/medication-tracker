// The (app) layout sets the accent and the tokens derived from it inline on
// its wrapper, from the stored hex. theme-tokens.test.ts measures every preset
// as "the stored hex plus what the layout derives", so this is what makes
// that assumption true: without --color-accent-hover here, a signed-in user's
// hover falls back to the logged-out #4338ca whatever their accent-fg: for
// the seven presets that take the dark label, #111111 on #4338ca, 2.39:1.
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRawSnippet, flushSync, mount, unmount } from "svelte";
import { readable } from "svelte/store";
import { entryFor } from "$lib/appearance/registry";
import { readableForeground, readableHover } from "$lib/utils/contrast";
import { preferencesFixture } from "./helpers/preferences-fixture";

// The same seams app-shell-scroll.test.ts mounts the layout through.
vi.mock("$app/navigation", () => ({ afterNavigate: () => {} }));
vi.mock("$app/stores", () => ({
  page: readable({ url: new URL("http://localhost/dashboard") }),
}));
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

function preferences(accentColor: string) {
  return {
    ...preferencesFixture,
    accentColor,
    theme: "system",
    timeFormat: "24h",
    updatedAt: new Date("2026-08-01T00:00:00Z"),
  } as const;
}

let app: ReturnType<typeof mount> | undefined;

afterEach(() => {
  if (app) unmount(app);
  app = undefined;
  document.body.replaceChildren();
});

/** The element carrying the inline accent: the layout's wrapper. */
function mountWrapper(accentColor: string): HTMLElement {
  const target = document.createElement("div");
  document.body.appendChild(target);
  const children = createRawSnippet(() => ({ render: () => "<p></p>" }));
  app = mount(Layout, {
    target,
    props: { data: { user, preferences: preferences(accentColor) }, children },
  });
  flushSync();
  const themed = [...target.querySelectorAll<HTMLElement>("[style]")].filter(
    (el) => el.style.getPropertyValue("--color-accent") !== "",
  );
  expect(themed).toHaveLength(1);
  return themed[0];
}

describe("the (app) layout's inline accent", () => {
  // Not #4f46e5: the logged-out fallbacks already hold that hex's values,
  // so a missing inline token would still read correctly there.
  const accent = "#f59e0b";

  it("is the stored hex", () => {
    expect(mountWrapper(accent).style.getPropertyValue("--color-accent")).toBe(accent);
  });

  it("carries every scheme-independent token the registry says it derives", () => {
    const dom = entryFor("accentColor").dom;
    if (dom.kind !== "css-var") throw new Error("accentColor is no longer a css-var");
    const derive: Record<string, (hex: string) => string> = {
      "--color-accent-fg": (hex) => readableForeground(hex).color,
      "--color-accent-hover": readableHover,
    };
    // accent-ink is per scheme, so the theme block emits it (theme-css.test.ts).
    expect(dom.derived.filter((t) => t !== "--color-accent-ink").sort()).toEqual(
      Object.keys(derive).sort(),
    );
    const wrapper = mountWrapper(accent);
    for (const [token, from] of Object.entries(derive)) {
      expect(wrapper.style.getPropertyValue(token), token).toBe(from(accent));
    }
  });
});
