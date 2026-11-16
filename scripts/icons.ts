/**
 * Draws the PNG icons an installed app needs from public/icon.svg: Android
 * asks for 192 and 512 px, a maskable one whose symbol stays inside the safe
 * circle, and iOS for a 180 px square it rounds itself. Run it after changing
 * the icon:
 *   bun scripts/icons.ts
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const PUBLIC = join(import.meta.dir, "..", "public");
const svg = await readFile(join(PUBLIC, "icon.svg"), "utf8");
// The symbol alone: the rounded square comes off, each icon draws its own ground.
const symbol = svg.replace(/<rect[^>]*\/>/, "").replace(/<title>.*?<\/title>/, "");
const BLUE = "#1a66d9";

function page(size: number, opts: { round: boolean; scale: number }): string {
  const radius = opts.round ? Math.round(size * (14 / 64)) : 0;
  const inner = Math.round(size * opts.scale);
  return `<!doctype html><html><body style="margin:0;background:transparent">
<div style="width:${size}px;height:${size}px;border-radius:${radius}px;background:${BLUE};display:grid;place-items:center">
${symbol.replace("<svg ", `<svg width="${inner}" height="${inner}" `)}
</div></body></html>`;
}

const browser = await chromium.launch();
const tab = await browser.newPage();
const icons = [
  // Like the SVG: the symbol fills its rounded square.
  { file: "icon-192.png", size: 192, round: true, scale: 1 },
  { file: "icon-512.png", size: 512, round: true, scale: 1 },
  // Maskable: full bleed, the symbol within the middle 80 %.
  { file: "icon-maskable-512.png", size: 512, round: false, scale: 0.72 },
  // iOS rounds the corners itself.
  { file: "apple-touch-icon.png", size: 180, round: false, scale: 0.86 },
];
for (const icon of icons) {
  await tab.setViewportSize({ width: icon.size, height: icon.size });
  await tab.setContent(page(icon.size, icon));
  await tab.screenshot({ path: join(PUBLIC, icon.file), omitBackground: true });
  console.log(icon.file);
}
await browser.close();
