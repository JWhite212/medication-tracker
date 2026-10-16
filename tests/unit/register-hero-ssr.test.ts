// @vitest-environment node
//
// `node` for the same reason as landing-hero-ssr.test.ts: under jsdom,
// `render()` from `svelte/server` throws `effect_orphan`.
//
// The sign-up page shows the landing hero beside its form, on wide screens
// only. It is the same file, so a visitor from the landing page already has it
// cached, and the same render (scripts/render-landing-hero.mjs) can come back
// a different shape or size than this tag draws it at.
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { render } from "svelte/server";
import LandingPage from "../../src/routes/+page.svelte";
import RegisterPage from "../../src/routes/auth/register/+page.svelte";
import { ssrDocument } from "./helpers/axe-ssr";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

function imagesOf(html: string): HTMLImageElement[] {
  return [...ssrDocument(html).querySelectorAll("img")];
}

function registerHero(): HTMLImageElement {
  // Every other image on the page is the decorative app icon, alt="".
  const described = imagesOf(render(RegisterPage, { props: { form: null } }).body).filter(
    (img) => img.getAttribute("alt") !== "",
  );
  expect(described).toHaveLength(1);
  return described[0];
}

function landingHero(): HTMLImageElement {
  const hero = imagesOf(render(LandingPage).body).find(
    (img) => img.getAttribute("fetchpriority") === "high",
  );
  expect(hero).toBeDefined();
  return hero!;
}

/** The asset on disk behind an `<img src>` that vite resolved from `$lib/assets`. */
function assetPath(img: HTMLImageElement): string {
  const src = img.getAttribute("src")!;
  expect(src).toMatch(/^\/src\/lib\/assets\/[^/]+\.webp$/);
  const file = join(repoRoot, src.slice(1));
  expect(existsSync(file)).toBe(true);
  return file;
}

describe("the sign-up page's hero", () => {
  it("is the landing hero's file, so a visitor from the landing page has it cached", () => {
    expect(registerHero().getAttribute("src")).toBe(landingHero().getAttribute("src"));
  });

  it("describes the screen it shows, not the old illustration's slogan", () => {
    const alt = registerHero().getAttribute("alt")!;
    expect(alt).toMatch(/Log now/);
    expect(alt).not.toMatch(/confidence/);
  });

  it("is lazy, because it is hidden below lg and a phone should not fetch it", () => {
    expect(registerHero().getAttribute("loading")).toBe("lazy");
  });

  it("is drawn at the asset's own proportions, so nothing shifts as it loads", async () => {
    const img = registerHero();
    const { width, height } = await sharp(assetPath(img)).metadata();
    const drawn = Number(img.getAttribute("width")) / Number(img.getAttribute("height"));
    expect(drawn).toBeGreaterThan(0);
    expect(Math.abs(drawn - width! / height!) / (width! / height!)).toBeLessThan(0.01);
  });

  it("carries at least twice the pixels it is drawn at, so it is sharp on a retina screen", async () => {
    const img = registerHero();
    const { width } = await sharp(assetPath(img)).metadata();
    expect(width!).toBeGreaterThanOrEqual(2 * Number(img.getAttribute("width")));
  });
});
