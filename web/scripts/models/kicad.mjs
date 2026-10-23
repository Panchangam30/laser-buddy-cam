/**
 * KiCad footprints, read only for their pad positions.
 *
 * A KiCad model and an Eagle package agree on what the part is but not on where
 * its origin sits: KiCad puts a through-hole part's origin on pin 1, Eagle on
 * the package centre, and the two libraries also disagree on which way round a
 * part is drawn. Rather than keep a hand-tuned offset per part, which would be
 * wrong in ways nobody notices until a header sits half a pitch off its holes,
 * the model is placed by matching its footprint's pads to the Eagle pads.
 */
import * as THREE from "three";

/** Pads of a .kicad_mod, in the 3D model's frame (Y up, so footprint Y is negated). */
export function footprintPads(src) {
  const pads = [];
  for (const m of src.matchAll(/\(pad\s+"([^"]*)"\s+\S+\s+\S+\s+\(at\s+(-?[\d.]+)\s+(-?[\d.]+)/g)) {
    pads.push({ name: m[1], x: Number(m[2]), y: -Number(m[3]) });
  }
  const model = src.match(/\(model\s[\s\S]*?\(offset\s+\(xyz\s+(\S+)\s+(\S+)\s+([^\s)]+)\s*\)\s*\)[\s\S]*?\(rotate\s+\(xyz\s+(\S+)\s+(\S+)\s+([^\s)]+)\s*\)/);
  const offset = model ? [Number(model[1]), Number(model[2]), Number(model[3])] : [0, 0, 0];
  const rotate = model ? [Number(model[4]), Number(model[5]), Number(model[6])] : [0, 0, 0];
  return { pads, offset, rotate };
}

/** The footprint's model placement: KiCad rotates by -angle about each axis, then offsets. */
export function modelMatrix({ offset, rotate }) {
  const r = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(
    -THREE.MathUtils.degToRad(rotate[0]),
    -THREE.MathUtils.degToRad(rotate[1]),
    -THREE.MathUtils.degToRad(rotate[2]), "ZYX"));
  return new THREE.Matrix4().makeTranslation(...offset).multiply(r);
}

const centroid = (pts) => pts.reduce((a, p) => ({ x: a.x + p.x / pts.length, y: a.y + p.y / pts.length }), { x: 0, y: 0 });

/**
 * The rigid 2D transform (rotation in quarter turns, then translation) that
 * puts KiCad pads `k` on Eagle pads `e`. Shape decides first; pad names only
 * break ties, which is what keeps a polarised part's stripe on the right end.
 * Eagle names diodes and capacitors by function, so `alias` maps them.
 */
export function alignPads(e, k, alias = {}) {
  const ce = centroid(e);
  const ck = centroid(k);
  let best = null;
  for (const quarter of [0, 1, 2, 3]) {
    const a = (quarter * Math.PI) / 2;
    const c = Math.cos(a), s = Math.sin(a);
    const rot = (p) => ({ x: c * (p.x - ck.x) - s * (p.y - ck.y) + ce.x, y: s * (p.x - ck.x) + c * (p.y - ck.y) + ce.y, name: p.name });
    const kk = k.map(rot);
    const near = (p, set) => Math.min(...set.map((q) => Math.hypot(p.x - q.x, p.y - q.y)));
    let cost = e.reduce((sum, p) => sum + near(p, kk), 0) / e.length
      + kk.reduce((sum, p) => sum + near(p, e), 0) / kk.length;
    let named = 0, n = 0;
    for (const p of e) {
      const q = kk.find((x) => x.name === (alias[p.name] ?? p.name));
      if (q) { named += Math.hypot(p.x - q.x, p.y - q.y); n++; }
    }
    if (n) cost += (0.1 * named) / n;
    if (!best || cost < best.cost) best = { cost, a, rot };
  }
  // Translation after rotating about the KiCad origin.
  const origin = best.rot({ x: 0, y: 0 });
  return {
    angle: best.a,
    matrix: new THREE.Matrix4().makeTranslation(origin.x, origin.y, 0)
      .multiply(new THREE.Matrix4().makeRotationZ(best.a)),
    residual: best.cost,
  };
}
