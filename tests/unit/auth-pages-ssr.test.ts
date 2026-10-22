// @vitest-environment node
//
// `node` is load-bearing for the reason tests/unit/form-errors-aria-ssr.test.ts
// gives: under jsdom vite resolves `svelte` to its client entry and `render()`
// from `svelte/server` throws `effect_orphan` before an assertion runs.
//
// The sign-in pages, server-rendered: each submit is one full-width 44px
// primary Button that still carries the accessible name the e2e suite clicks,
// the OAuth warnings are needs-you Alerts that do not interrupt, and a sent
// reset link is announced from a status region that exists before it does.
// The error wiring (ids, aria-describedby, aria-invalid) is pinned in
// form-errors-aria-ssr.test.ts.
import { describe, it, expect, vi } from "vitest";
import { render } from "svelte/server";
import { toneClass } from "../../src/lib/utils/status-tone";
import { alertTitled, expectClasses } from "./helpers/alert-dom";
import { expectAxeClean, ssrDocument } from "./helpers/axe-ssr";
import { accessibleName, textOf } from "./helpers/dom-names";

// 2fa and reset-password read `page.status` from `$app/state`, which a bare
// `render()` does not provide; a plain object stands in, as in
// form-errors-aria-ssr.test.ts.
const pageState = vi.hoisted(() => ({ status: 200 }));
vi.mock("$app/state", () => ({ page: pageState }));

import Login from "../../src/routes/auth/login/+page.svelte";
import Register from "../../src/routes/auth/register/+page.svelte";
import TwoFactor from "../../src/routes/auth/2fa/+page.svelte";
import ResetPassword from "../../src/routes/auth/reset-password/+page.svelte";
import ResetConfirm from "../../src/routes/auth/reset-password/confirm/+page.svelte";
import Verify from "../../src/routes/auth/verify/+page.svelte";

const LOGIN_DATA = { user: null, hasOAuth: false, oauthError: null };

// `label` is what tests/e2e/helpers/auth.ts clicks by name; `pending` is the
// word shown while the request is in flight, with a real ellipsis.
const SUBMITS = [
  {
    page: "/auth/login",
    html: () => render(Login, { props: { data: LOGIN_DATA, form: null } }).body,
    label: "Sign in",
    pending: "Signing in…",
  },
  {
    page: "/auth/register",
    html: () => render(Register, { props: { form: null } }).body,
    label: "Create account",
    pending: "Creating account…",
  },
  {
    page: "/auth/2fa",
    html: () => render(TwoFactor, { props: { form: null } }).body,
    label: "Verify",
    pending: "Verifying…",
  },
  {
    page: "/auth/reset-password",
    html: () => render(ResetPassword, { props: { form: null } }).body,
    label: "Send reset link",
    pending: "Sending…",
  },
  {
    page: "/auth/reset-password/confirm",
    html: () =>
      render(ResetConfirm, { props: { data: { user: null, token: "t" }, form: null } }).body,
    label: "Set new password",
    pending: "Updating…",
  },
];

describe.each(SUBMITS)("$page submit", ({ html, label, pending }) => {
  const submit = () => {
    const buttons =
      ssrDocument(html()).querySelectorAll<HTMLButtonElement>('button[type="submit"]');
    expect(buttons).toHaveLength(1);
    return buttons[0];
  };
  it("is one full-width 44px primary, named exactly what the e2e suite clicks", () => {
    expect(accessibleName(submit())).toBe(label); // tests/e2e/helpers/auth.ts:26,50
    expectClasses(submit(), "w-full h-11 bg-accent text-accent-fg");
  });
  it("carries its pending words with a real ellipsis", () => {
    expect(submit().textContent).toContain(pending);
    expect(submit().textContent).not.toContain("...");
  });
});

describe("/auth/login", () => {
  it.each([
    ["/auth/callback/google", "Continue with Google"],
    ["/auth/callback/github", "Continue with GitHub"],
  ])("offers %s as a full-width secondary Button link", (href, name) => {
    const link = ssrDocument(
      render(Login, { props: { data: { ...LOGIN_DATA, hasOAuth: true }, form: null } }).body,
    ).querySelector(`a[href="${href}"]`)!;
    expect(textOf(link)).toBe(name);
    expectClasses(link, "w-full h-11 border-border-strong text-text-primary");
  });

  it.each([
    [
      "oauth_email_conflict",
      "An account with that email already exists.",
      "Please sign in with your password, then link your OAuth provider from settings.",
    ],
    [
      "oauth_email_unverified",
      "Your social-login provider returned an unverified email address.",
      "Verify the email with your provider and try again.",
    ],
  ])("draws %s as a needs-you Alert that does not interrupt", (code, title, body) => {
    const doc = ssrDocument(
      render(Login, { props: { data: { ...LOGIN_DATA, oauthError: code }, form: null } }).body,
    );
    const alert = alertTitled(doc, title)!;
    expect(alert.getAttribute("role")).toBeNull();
    expect(doc.querySelector('[role="alert"]'), "needs-you is never role=alert").toBeNull();
    expectClasses(alert, toneClass("needs-you", "alert"));
    expect(textOf(alert)).toContain(body);
  });
});

describe("/auth/reset-password", () => {
  it("announces the sent link from a status region that exists before it", () => {
    const idle = ssrDocument(render(ResetPassword, { props: { form: null } }).body).querySelector(
      '[role="status"]',
    );
    expect(idle).not.toBeNull();
    expect(textOf(idle!)).toBe("");
    const doc = ssrDocument(render(ResetPassword, { props: { form: { success: true } } }).body);
    const alert = alertTitled(doc, "Check your email for a reset link.")!;
    expect(alert.closest('[role="status"]')).not.toBeNull();
    expect(alert.getAttribute("role")).toBeNull();
    expectClasses(alert, toneClass("happened", "alert"));
    expect(textOf(alert)).toContain(
      "If an account exists for that address, you'll receive instructions shortly.",
    );
    expect(doc.querySelector("form")).toBeNull();
  });
});

describe("axe on the auth pages", () => {
  const RULES = ["button-name", "link-name", "aria-hidden-focus", "aria-allowed-role"];
  it.each([
    [
      "login, failed, with an OAuth warning",
      () =>
        render(Login, {
          props: {
            data: { ...LOGIN_DATA, hasOAuth: true, oauthError: "oauth_email_conflict" },
            form: { errors: { form: ["Invalid email or password"] } },
          },
        }).body,
    ],
    [
      "register, throttled",
      () =>
        render(Register, {
          props: { form: { errors: { form: ["Too many attempts. Try again in 15 minutes."] } } },
        }).body,
    ],
    [
      "2fa, refused",
      () => render(TwoFactor, { props: { form: { error: "Invalid code, try again" } } }).body,
    ],
    [
      "reset-password, refused",
      () => render(ResetPassword, { props: { form: { error: "Email is required." } } }).body,
    ],
    [
      "reset-password/confirm, refused",
      () =>
        render(ResetConfirm, {
          props: { data: { user: null, token: "t" }, form: { error: "Passwords do not match" } },
        }).body,
    ],
  ])("%s passes", async (_label, html) => {
    await expectAxeClean(ssrDocument(html()), RULES);
  });
  it("reset-password, sent, passes", async () => {
    await expectAxeClean(
      ssrDocument(render(ResetPassword, { props: { form: { success: true } } }).body),
      ["link-name", "aria-hidden-focus", "aria-allowed-role"],
    );
  });
});

describe("/auth/verify", () => {
  it.each([
    [{ user: null, verified: true }, "Email Verified", "happened", "✓"],
    [
      { user: null, verified: false, error: "Invalid or expired token" },
      "Verification Failed",
      "wrong",
      "✗",
    ],
  ] as const)(
    "colours the heading from the owner and hides the glyph (%o)",
    (data, heading, tone, glyph) => {
      const doc = ssrDocument(render(Verify, { props: { data } }).body);
      const h1 = doc.querySelector("h1")!;
      expect(textOf(h1)).toBe(heading);
      expectClasses(h1, toneClass(tone, "text"));
      expect(textOf(doc.querySelector('[aria-hidden="true"]')!)).toBe(glyph);
      expectClasses(doc.querySelector('a[href="/dashboard"]')!, "h-11 bg-accent text-accent-fg");
    },
  );
  it("passes axe", async () => {
    await expectAxeClean(
      ssrDocument(
        render(Verify, { props: { data: { user: null, verified: false, error: "Missing token" } } })
          .body,
      ),
      ["link-name", "aria-hidden-focus"],
    );
  });
});
