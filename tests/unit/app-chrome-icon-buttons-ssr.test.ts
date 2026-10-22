// @vitest-environment node
//
// The mobile menu's two icon buttons -- MobileHeader's toggle and the mobile
// Sidebar's close -- are the shared IconButton: 44px (they exist only at touch
// widths, `md:hidden`), a type="button", the focus ring, and an icon hidden
// from AT so the control's name is its aria-label alone.
//
// `@vitest-environment node` is load-bearing for the same reason as
// tests/unit/mobile-nav-link-names-ssr.test.ts: under jsdom, `render()` from
// `svelte/server` throws `effect_orphan` before an assertion runs.
import { describe, it, expect, vi } from "vitest";
import { render } from "svelte/server";
import { readable } from "svelte/store";
import { expectAxeClean, ssrDocument } from "./helpers/axe-ssr";

// Sidebar reads $page for aria-current; outside a SvelteKit app the real
// store has no context to read from.
vi.mock("$app/stores", () => ({
  page: readable({ url: new URL("http://localhost/dashboard") }),
}));

const { default: MobileHeader } = await import("../../src/lib/components/MobileHeader.svelte");
const { default: Sidebar } = await import("../../src/lib/components/Sidebar.svelte");

const user = {
  id: "u1",
  email: "person@example.com",
  name: "Test Person",
  avatarUrl: null,
  timezone: "UTC",
  twoFactorEnabled: false,
  emailVerified: true,
};

const FOCUS_RING = "focus-visible:outline-accent-ink";

function expectIconButton(button: Element | null, size: "size-9" | "size-11") {
  expect(button, "button not rendered").not.toBeNull();
  expect(button!.getAttribute("type")).toBe("button");
  expect([...button!.classList]).toEqual(expect.arrayContaining([size, FOCUS_RING]));
  expect(button!.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
}

describe("the mobile menu's IconButtons", () => {
  const header = ssrDocument(
    render(MobileHeader, {
      props: { user, menuOpen: false, menuId: "mobile-nav", ontoggle: () => {} },
    }).body,
  );
  const mobileSidebar = ssrDocument(
    render(Sidebar, { props: { user, mobile: true, ondismiss: () => {} } }).body,
  );

  it("draws the toggle as a 44px IconButton whose icon is hidden", () => {
    expectIconButton(header.querySelector('button[aria-label="Toggle menu"]'), "size-11");
  });

  it("draws the close button the same way, and only in the mobile sidebar", () => {
    expectIconButton(mobileSidebar.querySelector('button[aria-label="Close menu"]'), "size-11");
    const desktop = ssrDocument(render(Sidebar, { props: { user } }).body);
    expect(desktop.querySelector('button[aria-label="Close menu"]')).toBeNull();
  });

  it("passes axe: button-name", async () => {
    for (const doc of [header, mobileSidebar]) {
      await expectAxeClean(doc, ["button-name"]);
    }
  });
});
