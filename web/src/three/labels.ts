import * as THREE from "three";

/**
 * Text drawn to a canvas and used as a texture.
 *
 * drei's <Text> pulls a font over the network, which fails offline and in
 * headless rendering. Canvas glyphs always work and these labels are tiny.
 */
const cache = new Map<string, THREE.CanvasTexture>();

export function labelTexture(text: string, color = "#6b6d73"): THREE.CanvasTexture {
  const key = `${text}|${color}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const S = 128;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, S, S);
  g.fillStyle = color;
  g.font = "600 74px ui-sans-serif, -apple-system, system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, S / 2, S / 2 + 4);

  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}

/** Digit -> band colour, the standard resistor code. */
const BAND = ["#1a1a1a", "#7a4a20", "#d0342c", "#e08a2e", "#e8c93a",
              "#3f9e4d", "#2f6fd0", "#8b5cc7", "#9a9a9a", "#f0f0f0"];

/**
 * Colour bands for a resistance value, e.g. "220 ohm" -> red red brown gold.
 * Returns null when the value was never read, so the renderer can show
 * neutral bands instead of inventing a plausible-looking wrong value.
 */
export function resistorBands(value?: string): string[] | null {
  if (!value) return null;
  const m = value.replace(/\s/g, "").toLowerCase()
    .match(/^(\d+(?:\.\d+)?)(k|m)?/);
  if (!m) return null;

  let ohms = parseFloat(m[1]);
  if (m[2] === "k") ohms *= 1e3;
  if (m[2] === "m") ohms *= 1e6;
  if (!isFinite(ohms) || ohms < 1) return null;

  const digits = Math.round(ohms).toString();
  const d1 = Number(digits[0]);
  const d2 = Number(digits[1] ?? "0");
  const mult = digits.length - 2;
  if (mult < 0 || mult > 9) return null;

  return [BAND[d1], BAND[d2], BAND[mult], "#c9a227"]; // last band = gold, 5%
}

const plates = new Map<string, { tex: THREE.CanvasTexture; aspect: number }>();

/**
 * A pill of text for floating labels over the live map.
 *
 * labelTexture draws one glyph in a square, which squashes anything longer than
 * a couple of characters. This measures the text and sizes the canvas to it, and
 * returns the aspect so the caller can shape the plane to match.
 */
export function textPlate(
  text: string,
  { color = "#f2f2f4", bg = "rgba(12,13,16,0.82)", accent = "" } = {},
): { tex: THREE.CanvasTexture; aspect: number } {
  const key = `${text}|${color}|${bg}|${accent}`;
  const hit = plates.get(key);
  if (hit) return hit;

  const FONT = "600 44px ui-sans-serif, -apple-system, system-ui, sans-serif";
  const pad = 22;
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = FONT;
  const w = Math.ceil(measure.measureText(text).width) + pad * 2;
  const h = 78;

  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.fillStyle = bg;
  g.beginPath();
  g.roundRect(0, 0, w, h, 16);
  g.fill();
  if (accent) {
    g.fillStyle = accent;
    g.beginPath();
    g.roundRect(0, 0, 7, h, 16);
    g.fill();
  }
  g.fillStyle = color;
  g.font = FONT;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, w / 2 + (accent ? 4 : 0), h / 2 + 2);

  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  const out = { tex, aspect: w / h };
  plates.set(key, out);
  return out;
}
