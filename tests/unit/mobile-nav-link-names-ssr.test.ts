// @vitest-environment node
//
// Covers: the accessible names of the links that used to be named by a glyph
// alone -- the avatar link in MobileHeader (a single initial), its desktop
// twin in Sidebar, and the "&larr;" back links on five settings sub-pages.
// A screen reader announced those as "J, link" and "left arrow, link", which
// says nothing about where either goes (WCAG 2.4.4).
//
// The name is computed from the SSR'd markup rather than matched as a string,
// because the fix for the avatar links is to HIDE the visible content from AT
// and name the destination instead. A substring check would pass whether or
// not the initial was still being read out.
//
// `@vitest-environment node` is load-bearing for the same reason as
// tests/unit/appearance-page-ssr.test.ts: under jsdom, `render()` from
// `svelte/server` throws `effect_orphan` before an assertion runs.
import { describe, it, expect, vi } from "vitest";
import type { Component } from "svelte";
import { render } from "svelte/server";
import { readable } from "svelte/store";
import { JSDOM } from "jsdom";

// Sidebar reads $page for aria-current; outside a SvelteKit app the real
// store has no context to read from.
vi.mock("$app/stores", () => ({
  page: readable({ url: new URL("http://localhost/dashboard") }),
}));

const { default: MobileHeader } = await import("../../src/lib/components/MobileHeader.svelte");
const { default: Sidebar } = await import("../../src/lib/components/Sidebar.svelte");
const { default: AppearancePage } =
  await import("../../src/routes/(app)/settings/appearance/+page.svelte");
const { default: NotificationsPage } =
  await import("../../src/routes/(app)/settings/notifications/+page.svelte");
const { default: DataPage } = await import("../../src/routes/(app)/settings/data/+page.svelte");
const { default: PrivacyPage } =
  await import("../../src/routes/(app)/settings/privacy/+page.svelte");
const { default: ImportPage } =
  await import("../../src/routes/(app)/settings/data/import/+page.svelte");

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
};

function parse(html: string): Document {
  return new JSDOM(html).window.document;
}

/**
 * The accessible name of a link, per the parts of the accname algorithm these
 * links exercise: aria-label wins outright, otherwise the text content with
 * every aria-hidden subtree removed. sr-only text is deliberately KEPT, since
 * it is visually hidden only and is exactly what a screen reader reads.
 */
function accessibleName(el: Element): string {
  const label = el.getAttribute("aria-label");
  if (label) return label.trim();
  const parts: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === node.TEXT_NODE) {
      parts.push(node.textContent ?? "");
    } else if (node.nodeType === node.ELEMENT_NODE) {
      if ((node as Element).getAttribute("aria-hidden") === "true") return;
      parts.push(" ");
      node.childNodes.forEach(walk);
      parts.push(" ");
    }
  };
  el.childNodes.forEach(walk);
  return parts.join("").replace(/\s+/g, " ").trim();
}

function link(doc: Document, selector: string): Element {
  const el = doc.querySelector(selector);
  if (!el) throw new Error(`no element matches ${selector}`);
  return el;
}

describe("the account link", () => {
  it("is named for its destination in the mobile header, not by the user's initial", () => {
    const { body } = render(MobileHeader, {
      props: { user, menuOpen: false, menuId: "mobile-nav", ontoggle: () => {} },
    });
    const account = link(parse(body), 'header a[href="/settings"]');

    expect(accessibleName(account)).toBe("Account settings");
    // Still visible: the initial is decoration now, not removed.
    expect(account.textContent).toContain("T");
  });

  it("keeps the visible name and email first in the sidebar and adds the destination", () => {
    const { body } = render(Sidebar, { props: { user } });
    const doc = parse(body);
    // The footer link, not the "Settings" item in the nav list.
    const account = link(doc, 'aside > div a[href="/settings"]');

    // Starting with the visible text is what lets a speech-input user say
    // what they see (WCAG 2.5.3); the stray initial must not lead it.
    expect(accessibleName(account)).toBe("Test Person person@example.com Account settings");
  });
});

// The name the security page already uses, and each page's real parent. The
// import page's parent is Data Management, not the settings index.
type PageCase = [label: string, Page: unknown, data: unknown, href: string, name: string];

const pages: PageCase[] = [
  ["appearance", AppearancePage, { user, preferences }, "/settings", "← Settings"],
  [
    "notifications",
    NotificationsPage,
    {
      user,
      preferences,
      vapidPublicKey: "",
      emailVerified: true,
      emailConfigured: true,
      pushHealth: {
        deviceCount: 0,
        lastReminderAt: null,
        oldestRegisteredAt: null,
        vapidConfigured: false,
      },
      mutedMedications: [],
    },
    "/settings",
    "← Settings",
  ],
  ["data", DataPage, { user, preferences }, "/settings", "← Settings"],
  [
    "privacy",
    PrivacyPage,
    {
      user,
      preferences,
      counts: {
        doseLogs: 0,
        activeMedications: 0,
        archivedMedications: 0,
        sessions: 1,
        auditLogs: 0,
      },
    },
    "/settings",
    "← Settings",
  ],
  [
    "import",
    ImportPage,
    { user, preferences, medications: [], hasPassword: true, maxBytes: 5_000_000, timezone: "UTC" },
    "/settings/data",
    "← Data Management",
  ],
];

describe.each(pages)("the %s page's back link", (_label, Page, data, href, name) => {
  // The page components each type `data` from their own generated PageData;
  // these fixtures only carry what the markup under test reads.
  const { body } = render(Page as Component<{ data: unknown; form: unknown }>, {
    props: { data, form: null },
  });
  const doc = parse(body);

  it(`is named "${name}", matching the security page`, () => {
    // The first link to the parent is the back link: it precedes the h1.
    expect(accessibleName(link(doc, `a[href="${href}"]`))).toBe(name);
  });

  it("sits before the page heading", () => {
    const back = link(doc, `a[href="${href}"]`);
    const h1 = link(doc, "h1");
    expect(back.compareDocumentPosition(h1) & back.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
