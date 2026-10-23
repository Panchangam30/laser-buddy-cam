/**
 * SVG to PNG through headless Chromium -- already installed for the tests and
 * the thumbnails, and it has real fonts, which a pure-JS rasteriser does not.
 */
import { chromium } from "playwright";

let browser;

export async function rasterize(svg, width, height, { transparent = false } = {}) {
  browser ??= await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${svg}</body></html>`,
    { waitUntil: "load" },
  );
  const png = await page.screenshot({ clip: { x: 0, y: 0, width, height }, omitBackground: transparent });
  await page.close();
  return png;
}

export async function closeRasterizer() {
  await browser?.close();
  browser = undefined;
}
