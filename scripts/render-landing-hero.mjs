// Renders the landing page's hero image from the walkthrough's phone scene, so
// the hero shows the dashboard as it ships rather than an illustration of an
// app that never existed. The phone scene is held to the real dashboard
// composer by tests/unit/walkthrough-dashboard-fidelity.test.ts; this script
// only photographs it.
//
// It drives the real landing page: Playwright's fake clock is installed before
// load, the walkthrough is scrolled into view, and the clock is stepped until
// the stage cuts to the phone. The first frame after the cut is the one
// wanted: the overdue Due card with Log now, Done and Later, before the push
// banner drops in or the fingertip appears. Finding the cut, rather than
// naming a time, keeps the script correct when the storyboard is retimed.
//
// Usage, with the dev server running (npm run dev):
//   npm run render:hero
// BASE_URL overrides http://localhost:5173. Run it on macOS: the phone scene
// asks for SF Pro, and another platform substitutes a different font.
// Re-run whenever the dashboard or the phone scene changes; commit the .webp.
import { chromium } from "playwright";
import sharp from "sharp";
import { stat } from "node:fs/promises";
import path from "node:path";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5173";
const OUTPUT = path.resolve("src/lib/assets/landing-hero-phone.webp");

// The phone scene's own frame, from PhoneScene.svelte, and the factor the
// asset is stored at. +page.svelte draws it at 320px wide, so 804px is 2.5x.
const PHONE_W = 402;
const PHONE_H = 874;
const OUTPUT_SCALE = 2;

const STEP_MS = 100;
// Comfortably more than one loop of the walkthrough.
const GIVE_UP_MS = 120_000;

const browser = await chromium.launch();
try {
  // The stage is drawn at roughly half size inside the landing page's column,
  // so it is captured at 4x and scaled down, never up.
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 4,
    reducedMotion: "no-preference",
  });
  const page = await context.newPage();
  await page.clock.install();
  await page.goto(BASE_URL, { waitUntil: "networkidle" });

  // The stage mounts its phone layer, and starts playing, once in view.
  const surface = page.locator('[data-stage-surface="phone"]');
  await page.locator("#walkthrough-heading").scrollIntoViewIfNeeded();
  await surface.waitFor({ state: "attached" });

  let elapsed = 0;
  while ((await surface.evaluate((el) => getComputedStyle(el).visibility)) !== "visible") {
    if (elapsed >= GIVE_UP_MS) {
      throw new Error(`The walkthrough never cut to the phone within ${GIVE_UP_MS / 1000}s.`);
    }
    await page.clock.runFor(STEP_MS);
    elapsed += STEP_MS;
  }

  // The scaled 402x874 wrapper that holds PhoneScene's device frame.
  const phone = surface.locator(":scope > div").first();
  const box = await phone.evaluate((el) => [el.offsetWidth, el.offsetHeight]);
  if (box[0] !== PHONE_W || box[1] !== PHONE_H) {
    throw new Error(`Expected the phone at ${PHONE_W}x${PHONE_H}, found ${box[0]}x${box[1]}.`);
  }

  // Everything behind the phone is see-through, so the device frame's rounded
  // corners come out transparent rather than filled with the stage's dark.
  await phone.evaluate((el) => {
    for (let node = el.parentElement; node; node = node.parentElement) {
      node.style.setProperty("background", "transparent", "important");
      node.style.setProperty("box-shadow", "none", "important");
      node.style.setProperty("border-color", "transparent", "important");
    }
  });

  // A page screenshot clipped to the phone, not an element screenshot: the
  // latter waits for the element to be stable across animation frames, and
  // under the fake clock no frame ever comes. The clip is in viewport
  // coordinates, so the phone is centred in the viewport first.
  await phone.evaluate((el) => el.scrollIntoView({ block: "center", inline: "center" }));
  const clip = await phone.boundingBox();
  if (!clip) throw new Error("The phone has no layout box to capture.");
  const png = await page.screenshot({ clip, omitBackground: true, animations: "disabled" });
  await sharp(png)
    .resize(PHONE_W * OUTPUT_SCALE, PHONE_H * OUTPUT_SCALE, { fit: "fill" })
    .webp({ quality: 82, alphaQuality: 100, effort: 6 })
    .toFile(OUTPUT);

  const { size } = await stat(OUTPUT);
  console.log(
    `${path.relative(process.cwd(), OUTPUT)}: ${PHONE_W * OUTPUT_SCALE}x${PHONE_H * OUTPUT_SCALE}, ` +
      `${(size / 1024).toFixed(0)}KB, phone shot found at ${(elapsed / 1000).toFixed(1)}s`,
  );
} finally {
  await browser.close();
}
