/**
 * Just enough of an Eagle .brd reader to rebuild a board's top side.
 *
 * Coordinates stay in Eagle's frame: millimetres, X right, Y up, origin at the
 * board's lower-left corner as Arduino drew it.
 */
import { XMLParser } from "fast-xml-parser";

const LISTS = new Set([
  "library", "package", "element", "wire", "pad", "smd", "text", "circle",
  "rectangle", "polygon", "vertex", "signal", "via", "hole", "attribute", "layer",
]);

export function parseBoard(xml) {
  const doc = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    parseAttributeValue: false,
    isArray: (name, _path, _leaf, isAttribute) => !isAttribute && LISTS.has(name),
  }).parse(xml);
  const board = doc.eagle.drawing.board;
  const packages = new Map();
  for (const lib of board.libraries.library) {
    for (const pkg of lib.packages?.package ?? []) packages.set(`${lib.name}/${pkg.name}`, pkg);
  }
  const elements = board.elements.element.map((el) => ({
    ...el,
    x: Number(el.x), y: Number(el.y),
    pkg: packages.get(`${el.library}/${el.package}`),
    ...parseRot(el.rot),
  }));
  return { plain: board.plain, elements, signals: board.signals?.signal ?? [] };
}

function parseRot(rot = "R0") {
  const m = rot.match(/^(M?)(S?)R(-?[\d.]+)$/);
  return { mirror: Boolean(m?.[1]), angle: Number(m?.[3] ?? 0) };
}

/** Package coordinates to board coordinates for an element. */
export function placer(el) {
  const a = (el.angle * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return (x, y) => {
    const mx = el.mirror ? -x : x;
    return { x: el.x + c * mx - s * y, y: el.y + s * mx + c * y };
  };
}

/** Points along a wire, following its arc when it has one. */
export function wirePoints(w, segments = 12) {
  const x1 = Number(w.x1), y1 = Number(w.y1), x2 = Number(w.x2), y2 = Number(w.y2);
  const curve = Number(w.curve ?? 0);
  if (!curve) return [{ x: x1, y: y1 }, { x: x2, y: y2 }];
  const theta = (curve * Math.PI) / 180;
  const chord = Math.hypot(x2 - x1, y2 - y1);
  const r = chord / (2 * Math.sin(Math.abs(theta) / 2));
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const d = Math.sqrt(Math.max(0, r * r - (chord / 2) ** 2));
  // Positive curve is counter-clockwise, which puts the centre to the left of the chord.
  const ux = -(y2 - y1) / chord, uy = (x2 - x1) / chord;
  const sign = (theta > 0) === (Math.abs(theta) < Math.PI) ? 1 : -1;
  const cx = mx + sign * ux * d, cy = my + sign * uy * d;
  const a0 = Math.atan2(y1 - cy, x1 - cx);
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const a = a0 + (theta * i) / segments;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}

/** The board outline (Dimension layer) as one closed loop. */
export function outline(plain) {
  const wires = plain.wire.filter((w) => w.layer === "20").map((w) => wirePoints(w, 10));
  const same = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < 0.01;
  const loop = [...wires.shift()];
  while (wires.length) {
    const end = loop[loop.length - 1];
    const i = wires.findIndex((w) => same(w[0], end) || same(w[w.length - 1], end));
    if (i < 0) throw new Error("board outline is not closed");
    const w = wires.splice(i, 1)[0];
    loop.push(...(same(w[0], end) ? w : [...w].reverse()).slice(1));
  }
  if (same(loop[0], loop[loop.length - 1])) loop.pop();
  return loop;
}

/** Pads and SMD lands of an element, in board coordinates. */
export function elementPads(el) {
  const place = placer(el);
  const pads = [];
  for (const p of el.pkg?.pad ?? []) {
    pads.push({ ...place(Number(p.x), Number(p.y)), name: p.name, tht: true,
      drill: Number(p.drill), diameter: Number(p.diameter ?? 0), shape: p.shape ?? "round" });
  }
  for (const p of el.pkg?.smd ?? []) {
    pads.push({ ...place(Number(p.x), Number(p.y)), name: p.name, tht: false,
      dx: Number(p.dx), dy: Number(p.dy), angle: el.angle + parseRot(p.rot).angle });
  }
  return pads;
}

/** Pads in the package's own frame, for matching against a KiCad footprint. */
export function packagePads(pkg) {
  return [...(pkg.pad ?? []), ...(pkg.smd ?? [])]
    .map((p) => ({ name: p.name, x: Number(p.x), y: Number(p.y) }));
}
