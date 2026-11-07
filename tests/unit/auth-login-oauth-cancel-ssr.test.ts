// @vitest-environment node
//
// `node` for the reason tests/unit/auth-pages-ssr.test.ts gives: under jsdom
// `render()` from `svelte/server` throws before an assertion runs.
//
// The OAuth callback sends a cancelled or failed provider sign-in to
// /auth/login?error=oauth_cancelled (or oauth_failed). The page must say so,
// the same way it says the other OAuth outcomes: a needs-you Alert that does
// not interrupt, because nothing went wrong that the user has to fix.
import { describe, it, expect, vi } from "vitest";
import { render } from "svelte/server";
import { toneClass } from "../../src/lib/utils/status-tone";
import { alertTitled, expectClasses } from "./helpers/alert-dom";
import { ssrDocument } from "./helpers/axe-ssr";
import { textOf } from "./helpers/dom-names";

vi.mock("$app/state", () => ({ page: { status: 200 } }));

import Login from "../../src/routes/auth/login/+page.svelte";

const LOGIN_DATA = { user: null, hasOAuth: true, oauthError: null };

describe("/auth/login after the provider sign-in did not complete", () => {
  it.each([
    [
      "oauth_cancelled",
      "Sign-in was cancelled.",
      "Nothing was changed. Choose a way to sign in when you're ready.",
    ],
    [
      "oauth_failed",
      "Your social-login provider didn't finish signing you in.",
      "Nothing was changed. Try again, or sign in another way.",
    ],
  ])("draws %s as a needs-you Alert that does not interrupt", (code, title, body) => {
    const doc = ssrDocument(
      render(Login, { props: { data: { ...LOGIN_DATA, oauthError: code }, form: null } }).body,
    );
    const alert = alertTitled(doc, title);
    expect(alert, `no Alert titled "${title}"`).not.toBeNull();
    expect(alert!.getAttribute("role")).toBeNull();
    expect(doc.querySelector('[role="alert"]'), "needs-you is never role=alert").toBeNull();
    expectClasses(alert!, toneClass("needs-you", "alert"));
    expect(textOf(alert!)).toContain(body);
  });
});
