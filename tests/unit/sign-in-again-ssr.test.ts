// @vitest-environment node
//
// SignInAgain: the "Sign in again to confirm" prompt for an account with no
// password. No page server-renders it (it appears in a dialog, or after
// choosing Replace), so its markup is checked here on its own: a needs-you
// Alert that never claims role="alert", one 44px link per provider back to
// the page, and the copy for an account with no way to sign in again.
import { describe, it, expect } from "vitest";
import { render } from "svelte/server";
import SignInAgain from "$lib/components/ui/SignInAgain.svelte";
import { RECENT_SIGN_IN_MESSAGE } from "$lib/utils/destructive-confirm";
import { evaluatedRules, runAxe, ssrDocument } from "./helpers/axe-ssr";

function renderPrompt(props: Parameters<typeof render<typeof SignInAgain>>[1]["props"]) {
  // Read .body: Svelte's server render is lazy, and an unread render renders nothing.
  return ssrDocument(render(SignInAgain, { props }).body);
}

describe("SignInAgain", () => {
  it("is a needs-you prompt, never role=alert, titled with the guard's own words", () => {
    const doc = renderPrompt({ providers: ["google"], returnTo: "/settings/data" });
    const box = doc.querySelector("main > div")!;
    expect(box.getAttribute("role")).toBeNull();
    expect(box.textContent).toContain(RECENT_SIGN_IN_MESSAGE);
    expect(box.textContent!.replace(/\s+/g, " ")).toContain(
      "Deleting needs a sign-in in the last 10 minutes.",
    );
  });

  it("links each provider back to the page, at least 44px tall", () => {
    const doc = renderPrompt({
      providers: ["google", "github"],
      returnTo: "/settings/data/import",
    });
    const links = [...doc.querySelectorAll("a")];
    expect(links.map((a) => [a.textContent!.trim(), a.getAttribute("href")])).toEqual([
      ["Sign in again with Google", "/auth/callback/google?returnTo=%2Fsettings%2Fdata%2Fimport"],
      ["Sign in again with GitHub", "/auth/callback/github?returnTo=%2Fsettings%2Fdata%2Fimport"],
    ]);
    for (const a of links) expect(a.className.split(/\s+/)).toContain("h-11");
  });

  it("adds a note after the explanation", () => {
    const doc = renderPrompt({
      providers: ["github"],
      returnTo: "/settings/data/import",
      note: "You'll need to choose the file again.",
    });
    expect(doc.body.textContent!.replace(/\s+/g, " ")).toContain(
      "You'll come back to this page. You'll need to choose the file again.",
    );
  });

  it("with no provider, explains Forgot password and offers no link", () => {
    const doc = renderPrompt({ providers: [], returnTo: "/settings/privacy" });
    expect(doc.querySelectorAll("a")).toHaveLength(0);
    const text = doc.body.textContent!.replace(/\s+/g, " ");
    expect(text).toContain("this account has no way to sign in again here");
    expect(text).toContain("set a password with Forgot password on the sign-in page");
  });

  it("passes axe's link-name and structure rules", async () => {
    const doc = renderPrompt({ providers: ["google", "github"], returnTo: "/settings/privacy" });
    const rules = ["link-name", "aria-allowed-role", "nested-interactive"];
    const results = await runAxe(doc, rules);
    expect(results.violations).toEqual([]);
    expect(evaluatedRules(results).has("link-name")).toBe(true);
  });
});
