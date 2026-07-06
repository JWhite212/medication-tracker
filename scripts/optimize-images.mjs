// One-shot optimizer for the raster illustrations that ship in the
// client bundle. The AI-generated source PNGs are 0.8-1.2MB each; at
// the sizes they render (max-w-xs/sm, so <=384 CSS px), a WebP capped
// at 2x display width is visually identical and ~95% smaller — the
// landing hero is the LCP element, so this directly moves LCP.
//
// Usage: node scripts/optimize-images.mjs
// Re-run only when a source illustration changes; commit the .webp.
import sharp from "sharp";
import { stat } from "node:fs/promises";
import path from "node:path";

const ASSETS = path.resolve("src/lib/assets");

// targetWidth = 2x the largest CSS width the image renders at.
const IMAGES = [
  { file: "9910d8b5-01d3-4293-94a7-eca14d4e66f5.png", targetWidth: 768 }, // landing hero (max-w-sm)
  { file: "8ccec61e-617c-4da0-8596-c6aa9970893e.png", targetWidth: 768 }, // register splash
  { file: "1b27c358-1903-4e2a-bf26-8f1085f94ee6.png", targetWidth: 640 }, // log empty state (max-w-xs)
  { file: "397d3a76-85b0-43ee-a0c2-981053e4040c.png", targetWidth: 640 }, // medications empty state (max-w-xs)
];

for (const { file, targetWidth } of IMAGES) {
  const input = path.join(ASSETS, file);
  const output = input.replace(/\.png$/, ".webp");
  const image = sharp(input);
  const { width } = await image.metadata();
  await image
    .resize({ width: Math.min(targetWidth, width ?? targetWidth), withoutEnlargement: true })
    .webp({ quality: 80 })
    .toFile(output);
  const before = (await stat(input)).size;
  const after = (await stat(output)).size;
  console.log(
    `${file}: ${(before / 1024).toFixed(0)}KB -> ${(after / 1024).toFixed(0)}KB (${path.basename(output)})`,
  );
}
