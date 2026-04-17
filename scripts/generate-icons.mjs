import sharp from "sharp";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const svgInput = resolve(root, "src/lib/assets/favicon.svg");
const outDir = resolve(root, "static/icons");

const svg = readFileSync(svgInput);

const sizes = [
  { name: "icon-192.png", size: 192 },
  { name: "icon-512.png", size: 512 },
  { name: "apple-touch-icon.png", size: 180 },
];

for (const { name, size } of sizes) {
  await sharp(svg).resize(size, size).png().toFile(resolve(outDir, name));
  console.log(`Generated ${name} (${size}x${size})`);
}

// Maskable icon: 512x512 with 10% safe-zone padding (rendered at 410 centered on 512 canvas)
const innerSize = Math.round(512 * 0.8);
const padding = Math.round((512 - innerSize) / 2);
const inner = await sharp(svg).resize(innerSize, innerSize).png().toBuffer();
await sharp({
  create: {
    width: 512,
    height: 512,
    channels: 4,
    background: { r: 99, g: 102, b: 241, alpha: 1 },
  },
})
  .composite([{ input: inner, left: padding, top: padding }])
  .png()
  .toFile(resolve(outDir, "icon-maskable-512.png"));
console.log("Generated icon-maskable-512.png (512x512 maskable)");
