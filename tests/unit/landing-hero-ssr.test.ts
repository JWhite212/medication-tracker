// @vitest-environment node
//
// `node` for the same reason as walkthrough-video-ssr.test.ts: under jsdom,
// `render()` from `svelte/server` throws `effect_orphan`.
//
// The landing hero is the page's LCP element, and the page is prerendered, so
// the markup asserted here is exactly what a first visit receives. The image
// is a render of the walkthrough's phone scene (scripts/render-landing-hero.mjs),
// so it is regenerated whenever the dashboard changes, and a regenerated file
// can come back a different shape or size than the tag that draws it.
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { render } from "svelte/server";
import LandingPage from "../../src/routes/+page.svelte";
import { expectClasses } from "./helpers/alert-dom";
import { expectAxeClean, ssrDocument } from "./helpers/axe-ssr";
import { textOf } from "./helpers/dom-names";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

function heroImage(): HTMLImageElement {
  const doc = ssrDocument(render(LandingPage).body);
  const prioritised = [...doc.querySelectorAll("img")].filter(
    (img) => img.getAttribute("fetchpriority") === "high",
  );
  // One image may ask to jump the queue; two would compete for it.
  expect(prioritised).toHaveLength(1);
  return prioritised[0];
}

/** The asset on disk behind an `<img src>` that vite resolved from `$lib/assets`. */
function assetPath(img: HTMLImageElement): string {
  const src = img.getAttribute("src")!;
  expect(src).toMatch(/^\/src\/lib\/assets\/[^/]+\.webp$/);
  const file = join(repoRoot, src.slice(1));
  expect(existsSync(file)).toBe(true);
  return file;
}

describe("the landing hero", () => {
  it("is fetched eagerly and first, because it is the LCP element", () => {
    expect(heroImage().getAttribute("loading")).toBe("eager");
  });

  it("is drawn at the asset's own proportions, so nothing shifts as it loads", async () => {
    const img = heroImage();
    const { width, height } = await sharp(assetPath(img)).metadata();
    const drawn = Number(img.getAttribute("width")) / Number(img.getAttribute("height"));
    expect(drawn).toBeGreaterThan(0);
    expect(Math.abs(drawn - width! / height!) / (width! / height!)).toBeLessThan(0.01);
  });

  it("carries at least twice the pixels it is drawn at, so it is sharp on a retina screen", async () => {
    const img = heroImage();
    const { width } = await sharp(assetPath(img)).metadata();
    expect(width!).toBeGreaterThanOrEqual(2 * Number(img.getAttribute("width")));
  });

  it("is the phone dashboard render, not the old illustration", () => {
    const img = heroImage();
    expect(img.getAttribute("src")).toBe("/src/lib/assets/landing-hero-phone.webp");
    expect(img.getAttribute("alt")).toMatch(/Log now/);
  });
});

describe("the landing header", () => {
  const header = () => ssrDocument(render(LandingPage).body).querySelector("header")!;
  it("signs in through a ghost Button link and starts through a primary one, both 36px", () => {
    const signIn = header().querySelector('a[href="/auth/login"]')!;
    expect(textOf(signIn)).toBe("Sign in");
    expectClasses(signIn, "h-9 text-text-secondary");
    const start = header().querySelector('a[href="/auth/register"]')!;
    expect(textOf(start)).toBe("Get Started");
    expectClasses(start, "h-9 bg-accent text-accent-fg");
  });
  it("passes axe link-name", async () => {
    await expectAxeClean(ssrDocument(render(LandingPage).body), ["link-name"]);
  });
});
