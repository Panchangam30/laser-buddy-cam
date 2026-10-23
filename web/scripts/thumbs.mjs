/**
 * Render a PNG thumbnail of every starter-kit part.
 *
 *   npm run thumbs            (the dev server must already be running)
 *
 * Writes public/parts/<id>.png. Re-run after changing anything in
 * src/three/kitModels.tsx -- the images are generated, not drawn by hand, so
 * they only go stale if you forget this.
 */
import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, "../public/parts");
const BASE = process.env.THUMB_BASE ?? "http://localhost:5173";

// Read the ids straight from the source, so adding a part to the kit is enough
// and this script never needs a second list to keep in step.
const source = await readFile(resolve(here, "../src/components/StarterKit.tsx"), "utf8");
const ids = [...source.matchAll(/\{\s*id:\s*"([^"]+)",\s*name:/g)].map((m) => m[1]);
if (!ids.length) {
  console.error("found no part ids in StarterKit.tsx");
  process.exit(1);
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({
  args: ["--use-gl=angle", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({
  viewport: { width: 320, height: 320 },
  deviceScaleFactor: 2,              // retina-sharp at the 54 px they display at
});

let done = 0;
for (const id of ids) {
  // "load", not "networkidle": the dev server holds an HMR websocket open, so
  // the network is never idle and every navigation would time out.
  await page.goto(`${BASE}/thumb?part=${encodeURIComponent(id)}`, { waitUntil: "load" });
  // CAD models (public/models) load after the page; ThumbPage flags when they have.
  await page.waitForSelector("body[data-models-ready]", { state: "attached", timeout: 30000 });
  // The studio environment map loads asynchronously; capturing before it lands
  // gives a flat, unlit part.
  await page.waitForTimeout(1600);
  const shot = await page.screenshot({ omitBackground: true });
  await writeFile(resolve(OUT, `${id}.png`), shot);
  done++;
  process.stdout.write(`  ${String(done).padStart(2)}/${ids.length}  ${id}\n`);
}

await browser.close();
console.log(`\nwrote ${done} thumbnails to public/parts/`);
