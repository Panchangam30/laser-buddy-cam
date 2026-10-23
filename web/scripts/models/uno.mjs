/**
 * Arduino Uno R3, rebuilt from Arduino's own board file.
 *
 * Arduino does not publish a 3D model of the Uno, but it does publish the PCB:
 * the outline, every part's position and rotation, every pad, the copper and
 * the silkscreen. That is enough to build an accurate one. The PCB and its
 * printing come straight from the layout; the parts on it are KiCad's library
 * models of the same packages, placed by matching their pads to Arduino's.
 * Two parts KiCad has no model for -- the USB-B socket and the reset switch --
 * are modelled here from their datasheet dimensions.
 */
import * as THREE from "three";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { arduinoUnoBoard, kicadFootprint, kicadModel, OUT, WEB } from "./sources.mjs";
import { elementPads, outline, packagePads, parseBoard, placer, wirePoints } from "./eagle.mjs";
import { alignPads, footprintPads, modelMatrix } from "./kicad.mjs";
import { Builder, linear, readStep, stepBounds } from "./mesh.mjs";
import { rasterize } from "./raster.mjs";

const PCB = 1.6;                    // board thickness, mm
const PX_PER_MM = 30;               // silkscreen texture resolution

const COLORS = {
  mask: "#00838a",
  copper: "#0f979c",
  silk: "#f4f6f1",
  pad: "#cfd2d4",
  drill: "#1b1d1f",
};

/** Eagle package -> KiCad footprint. The model comes from the footprint. */
const PARTS = {
  "DIL28-3": { lib: "Package_DIP", fp: "DIP-28_W7.62mm_Socket" },
  "1X06": { lib: "Connector_PinSocket_2.54mm", fp: "PinSocket_1x06_P2.54mm_Vertical" },
  "1X08": { lib: "Connector_PinSocket_2.54mm", fp: "PinSocket_1x08_P2.54mm_Vertical" },
  "1X10": { lib: "Connector_PinSocket_2.54mm", fp: "PinSocket_1x10_P2.54mm_Vertical" },
  "2X03": { lib: "Connector_PinHeader_2.54mm", fp: "PinHeader_2x03_P2.54mm_Vertical" },
  "C0603-ROUND": { lib: "Capacitor_SMD", fp: "C_0603_1608Metric" },
  "CT/CN0603": { lib: "Capacitor_SMD", fp: "C_0603_1608Metric" },
  "R0603-ROUND": { lib: "Resistor_SMD", fp: "R_0603_1608Metric" },
  "0805": { lib: "Inductor_SMD", fp: "L_0805_2012Metric" },
  "CHIP-LED0805": { lib: "LED_SMD", fp: "LED_0805_2012Metric", alias: { C: "1", A: "2" } },
  "MINIMELF": { lib: "Diode_SMD", fp: "D_MiniMELF", alias: { C: "1", A: "2" } },
  "SMB": { lib: "Diode_SMD", fp: "D_SMB", alias: { C: "1", A: "2" } },
  "PANASONIC_D": { lib: "Capacitor_SMD", fp: "CP_Elec_6.3x5.4", alias: { "+": "1", "-": "2" } },
  "MLF32": { lib: "Package_DFN_QFN", fp: "QFN-32-1EP_5x5mm_P0.5mm_EP3.45x3.45mm" },
  "MSOP08": { lib: "Package_SO", fp: "MSOP-8_3x3mm_P0.65mm" },
  "SOT23-DBV": { lib: "Package_TO_SOT_SMD", fp: "SOT-23-5" },
  "SOT-23": { lib: "Package_TO_SOT_SMD", fp: "SOT-23" },
  "SOT223": { lib: "Package_TO_SOT_SMD", fp: "SOT-223-3_TabPin2" },
  "L1812": { lib: "Resistor_SMD", fp: "R_1812_4532Metric" },
  "CAY16": { lib: "Resistor_SMD", fp: "R_Array_Convex_4x0603" },
  "QS": { lib: "Crystal", fp: "Crystal_SMD_HC49-SD" },
  "RESONATOR": { lib: "Crystal", fp: "Resonator_SMD_Murata_CSTxExxV-3Pin_3.0x1.1mm" },
  "POWERSUPPLY_DC-21MM": { lib: "Connector_BarrelJack", fp: "BarrelJack_Horizontal" },
};

/** Header pads, in pad order, by the name printed beside them. */
const HEADERS = {
  IOH: ["D8", "D9", "D10", "D11", "D12", "D13", "GND2", "AREF", "SDA", "SCL"],
  IOL: ["D0", "D1", "D2", "D3", "D4", "D5", "D6", "D7"],
  POWER: ["NC", "IOREF", "RESET", "3V3", "5V", "GND", "GND1", "VIN"],
  AD: ["A0", "A1", "A2", "A3", "A4", "A5"],
};

// ------------------------------------------------------------------ materials

const MAT = {
  pcbTop: (map) => ({ name: "uno-pcb", color: [1, 1, 1], roughness: 0.42, metalness: 0, map }),
  pcbBottom: { name: "uno-pcb-bottom", color: linear(COLORS.mask), roughness: 0.45 },
  pcbEdge: { name: "uno-pcb-edge", color: linear("#8fb3a6"), roughness: 0.8 },
  // Not fully metallic: a pure metal is black wherever the environment map is
  // dark or not yet loaded, and the thumbnails are shot against nothing.
  tin: { name: "tin", color: linear("#d4d7db"), metalness: 0.85, roughness: 0.25 },
  insert: { name: "usb-insert", color: linear("#ecebe6"), roughness: 0.55 },
  cavity: { name: "usb-cavity", color: linear("#16171a"), roughness: 0.7 },
  switchBody: { name: "switch-body", color: linear("#1c1c1f"), roughness: 0.5 },
  marking: (map) => ({ name: "chip-marking", color: [1, 1, 1], roughness: 0.6, map, opacity: 0.999 }),
};

/**
 * KiCad's models use a small fixed palette. Match the metals exactly and treat
 * everything else as moulded plastic or ceramic.
 */
export function kicadMaterial(color) {
  const [r, g, b] = color;
  const hex = new THREE.Color(r, g, b).getHexString();
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const sat = max ? (max - min) / max : 0;
  // metal grey pins / tin: pale, nearly neutral, a touch warm
  if (max > 0.45 && sat < 0.16 && r >= b) {
    return { name: `metal-${hex}`, color, metalness: 0.92, roughness: 0.3 };
  }
  // gold pins
  if (r > 0.5 && g > 0.3 && b < 0.3 && r > g && g > b && sat > 0.45) {
    return { name: `gold-${hex}`, color, metalness: 0.95, roughness: 0.28 };
  }
  return { name: `plastic-${hex}`, color, metalness: 0.02, roughness: max < 0.05 ? 0.48 : 0.55 };
}

// -------------------------------------------------------------- silkscreen

function silkscreenSvg(brd, loop, W, H) {
  const Y = (y) => H - y;
  const out = [];
  const pathOf = (pts) => pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(3)} ${Y(p.y).toFixed(3)}`).join(" ");
  out.push(`<path d="${pathOf(loop)} Z" fill="${COLORS.mask}"/>`);

  // Copper under the mask reads as slightly lighter tracks.
  for (const sig of brd.signals) {
    for (const w of sig.wire ?? []) {
      if (w.layer !== "1") continue;
      out.push(`<path d="${pathOf(wirePoints(w))}" stroke="${COLORS.copper}" stroke-width="${w.width}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`);
    }
    for (const v of sig.via ?? []) {
      const d = Math.max(Number(v.diameter ?? 0), Number(v.drill) + 0.35);
      out.push(`<circle cx="${v.x}" cy="${Y(Number(v.y))}" r="${d / 2}" fill="${COLORS.copper}"/>`);
      out.push(`<circle cx="${v.x}" cy="${Y(Number(v.y))}" r="${Number(v.drill) / 2}" fill="#0b5b60"/>`);
    }
  }

  const silk = (items, place = (x, y) => ({ x, y }), rotOffset = 0, layers = ["21", "25"]) => {
    for (const w of items.wire ?? []) {
      if (!layers.includes(w.layer)) continue;
      const pts = wirePoints(w).map((p) => place(p.x, p.y));
      out.push(`<path d="${pathOf(pts)}" stroke="${COLORS.silk}" stroke-width="${Math.max(0.15, Number(w.width))}" fill="none" stroke-linecap="round"/>`);
    }
    for (const c of items.circle ?? []) {
      if (c.layer !== "21") continue;
      const p = place(Number(c.x), Number(c.y));
      const width = Number(c.width);
      out.push(width
        ? `<circle cx="${p.x}" cy="${Y(p.y)}" r="${c.radius}" stroke="${COLORS.silk}" stroke-width="${width}" fill="none"/>`
        : `<circle cx="${p.x}" cy="${Y(p.y)}" r="${c.radius}" fill="${COLORS.silk}"/>`);
    }
    for (const r of items.rectangle ?? []) {
      if (r.layer !== "21") continue;
      const corners = [[r.x1, r.y1], [r.x2, r.y1], [r.x2, r.y2], [r.x1, r.y2]]
        .map(([x, y]) => place(Number(x), Number(y)));
      out.push(`<path d="${pathOf(corners)} Z" fill="${COLORS.silk}"/>`);
    }
    for (const t of items.text ?? []) {
      if (!layers.includes(t.layer)) continue;
      const label = String(t["#text"] ?? "");
      // ">NAME" and ">VALUE" are Eagle placeholders, not printed text.
      if (!label || label.startsWith(">")) continue;
      const p = place(Number(t.x), Number(t.y));
      const { angle, mirror } = rotOf(t.rot);
      if (mirror) continue;
      const size = Number(t.size);
      const anchor = (t.align ?? "bottom-left").includes("center") ? "middle"
        : (t.align ?? "").includes("right") ? "end" : "start";
      const base = (t.align ?? "").startsWith("top") ? "hanging"
        : (t.align ?? "") === "center" || (t.align ?? "").startsWith("center") ? "central" : "alphabetic";
      const weight = Number(t.ratio ?? 8) >= 13 ? 700 : 600;
      const escaped = String(label).replace(/&/g, "&amp;").replace(/</g, "&lt;");
      // Eagle's vector font is narrower than any system face; condense to match.
      out.push(`<text transform="translate(${p.x.toFixed(3)} ${Y(p.y).toFixed(3)}) rotate(${-(angle + rotOffset)}) scale(0.84 1)" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-weight="${weight}" font-size="${(size * 1.32).toFixed(3)}" fill="${COLORS.silk}" text-anchor="${anchor}" dominant-baseline="${base}">${escaped}</text>`);
    }
  };

  silk(brd.plain);
  for (const el of brd.elements) {
    if (el.mirror || !el.pkg) continue;
    silk(el.pkg, placer(el), el.angle, ["21"]);
  }

  // Exposed pads last, so silkscreen never paints over solder.
  for (const el of brd.elements) {
    // Test points are probe lands on the underside; nothing is visible on top.
    if (el.mirror || el.package === "TP-SP") continue;
    for (const p of elementPads(el)) {
      if (p.tht) {
        const d = Math.max(p.diameter, p.drill * 1.6, p.drill + 0.5);
        if (p.shape === "square") {
          out.push(`<rect x="${p.x - d / 2}" y="${Y(p.y) - d / 2}" width="${d}" height="${d}" fill="${COLORS.pad}"/>`);
        } else {
          out.push(`<circle cx="${p.x}" cy="${Y(p.y)}" r="${d / 2}" fill="${COLORS.pad}"/>`);
        }
        out.push(`<circle cx="${p.x}" cy="${Y(p.y)}" r="${p.drill / 2}" fill="${COLORS.drill}"/>`);
      } else {
        out.push(`<rect x="${-p.dx / 2}" y="${-p.dy / 2}" width="${p.dx}" height="${p.dy}" fill="${COLORS.pad}" transform="translate(${p.x} ${Y(p.y)}) rotate(${-p.angle})"/>`);
      }
    }
  }
  for (const h of brd.plain.hole ?? []) {
    out.push(`<circle cx="${h.x}" cy="${Y(Number(h.y))}" r="${Number(h.drill) / 2 + 0.9}" fill="${COLORS.pad}"/>`);
  }

  const w = Math.round(W * PX_PER_MM), h = Math.round(H * PX_PER_MM);
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${COLORS.mask}"/>${out.join("")}</svg>`,
    w, h,
  };
}

function rotOf(rot = "R0") {
  const m = String(rot).match(/^(M?)(S?)R(-?[\d.]+)$/);
  return { mirror: Boolean(m?.[1]), angle: Number(m?.[3] ?? 0) };
}

// ------------------------------------------------------------------- PCB

function pcbGeometry(builder, loop, holes, W, H, toScene, map) {
  const shape = new THREE.Shape(loop.map((p) => new THREE.Vector2(p.x, p.y)));
  for (const h of holes) {
    const path = new THREE.Path();
    path.absarc(Number(h.x), Number(h.y), Number(h.drill) / 2, 0, Math.PI * 2, true);
    shape.holes.push(path);
  }
  // Sides and underside from an extrusion; the top is its own textured face.
  const body = new THREE.ExtrudeGeometry(shape, { depth: PCB, bevelEnabled: false, curveSegments: 32 }).toNonIndexed();
  const pos = body.attributes.position.array;
  const keep = { bottom: [], side: [] };
  for (const g of body.groups) {
    for (let t = g.start; t < g.start + g.count; t += 3) {
      const z = (pos[t * 3 + 2] + pos[t * 3 + 5] + pos[t * 3 + 8]) / 3;
      if (g.materialIndex === 1) keep.side.push(t);
      else if (z < PCB / 2) keep.bottom.push(t);
    }
  }
  for (const [kind, tris] of Object.entries(keep)) {
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(tris.length * 9);
    tris.forEach((t, i) => p.set(pos.subarray(t * 3, t * 3 + 9), i * 9));
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    g.computeVertexNormals();
    builder.addGeometry(g, toScene, kind === "side" ? MAT.pcbEdge : MAT.pcbBottom);
  }

  const top = new THREE.ShapeGeometry(shape, 32);
  top.translate(0, 0, PCB);
  const uv = top.attributes.uv;
  const p = top.attributes.position;
  const clamp = (v) => Math.min(1, Math.max(0, v));
  for (let i = 0; i < uv.count; i++) uv.setXY(i, clamp(p.getX(i) / W), clamp(1 - p.getY(i) / H));
  builder.addGeometry(top, toScene, MAT.pcbTop(map));
}

// --------------------------------------------------------- hand-built parts

const box = (sx, sy, sz, x, y, z) => new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z);

/**
 * USB-B receptacle (through-hole, right angle). Shell 12.0 x 10.9 mm, 16.3 mm
 * deep, overhanging the board edge as the Uno's does.
 */
function usbB(builder, toScene) {
  const x0 = -6.3, x1 = 10.0, y0 = 32.1, y1 = 44.1, z0 = PCB, z1 = PCB + 10.9, t = 0.3;
  const yc = (y0 + y1) / 2, zc = z0 + 5.6;
  const shell = [
    box(x1 - x0, y1 - y0, t, (x0 + x1) / 2, yc, z1 - t / 2),          // top
    box(x1 - x0, t, z1 - z0, (x0 + x1) / 2, y0 + t / 2, (z0 + z1) / 2), // sides
    box(x1 - x0, t, z1 - z0, (x0 + x1) / 2, y1 - t / 2, (z0 + z1) / 2),
    box(t, y1 - y0, z1 - z0, x1 - t / 2, yc, (z0 + z1) / 2),          // back
    box(x1 - x0, y1 - y0, t, (x0 + x1) / 2, yc, z0 + t / 2),          // bottom
  ];
  for (const g of shell) builder.addGeometry(g, toScene, MAT.tin);

  // Front face, with the B-type opening: 8.45 x 7.78, top corners chamfered.
  const ow = 8.45 / 2, oh = 7.78 / 2, ch = 1.2;
  const face = new THREE.Shape([[y0, z0], [y1, z0], [y1, z1], [y0, z1]].map(([a, b]) => new THREE.Vector2(a, b)));
  face.holes.push(new THREE.Path([
    [yc - ow, zc - oh], [yc + ow, zc - oh], [yc + ow, zc + oh - ch],
    [yc + ow - ch, zc + oh], [yc - ow + ch, zc + oh], [yc - ow, zc + oh - ch],
  ].map(([a, b]) => new THREE.Vector2(a, b))));
  const plate = new THREE.ExtrudeGeometry(face, { depth: t, bevelEnabled: false });
  // shape (u, v, w) -> board (w, u, v): the plate's normal points out along X
  const basis = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0)).setPosition(x0, 0, 0);
  builder.addGeometry(plate, toScene.clone().multiply(basis), MAT.tin);

  // Plastic insert filling the back of the socket, and the contact tongue.
  builder.addGeometry(box(x1 - x0 - 9.5, ow * 2, oh * 2, x1 - (x1 - x0 - 9.5) / 2 - t, yc, zc), toScene, MAT.insert);
  builder.addGeometry(box(8.8, 5.2, 3.1, x0 + 1.3 + 4.4, yc, zc - 0.2), toScene, MAT.insert);
  builder.addGeometry(box(9.4, ow * 2 - 0.1, 0.15, x0 + 1.0 + 4.7, yc, zc - oh + 0.08), toScene, MAT.cavity);
}

/** 6 x 3.5 mm SMD tactile switch (Arduino's TS42) with its stamped steel cover. */
function resetSwitch(builder, toScene, el) {
  const m = toScene.clone()
    .multiply(new THREE.Matrix4().makeTranslation(el.x, el.y, PCB))
    .multiply(new THREE.Matrix4().makeRotationZ((el.angle * Math.PI) / 180));
  builder.addGeometry(box(6.0, 3.5, 1.4, 0, 0, 0.7), m, MAT.switchBody);
  builder.addGeometry(box(6.1, 3.6, 0.2, 0, 0, 1.5), m, MAT.tin);
  builder.addGeometry(new THREE.CylinderGeometry(0.85, 0.85, 1.2, 24).rotateX(Math.PI / 2).translate(0, 0, 2.2), m, MAT.switchBody);
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    builder.addGeometry(box(1.6, 0.7, 0.18, sx * 3.6, sy * 1.25, 0.09), m, MAT.tin);
  }
}

async function chipMarking() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="240" viewBox="0 0 1200 240">
    <g font-family="Helvetica Neue, Helvetica, Arial, sans-serif" fill="#a9abae" font-weight="500">
      <text x="600" y="78" font-size="58" text-anchor="middle" letter-spacing="6">ATMEL</text>
      <text x="600" y="148" font-size="56" text-anchor="middle" letter-spacing="3">ATMEGA328P</text>
      <text x="600" y="212" font-size="44" text-anchor="middle" letter-spacing="3">20AU 1832</text>
    </g></svg>`;
  return rasterize(svg, 1200, 240, { transparent: true });
}

// ------------------------------------------------------------------ build

export async function buildUno() {
  const brd = parseBoard(await arduinoUnoBoard());
  const loop = outline(brd.plain);
  const W = Math.max(...loop.map((p) => p.x)), H = Math.max(...loop.map((p) => p.y));

  // Eagle (x, y, z-up) -> scene (x, y-up, z), turned half a turn so the
  // digital header faces +Z, toward the breadboard, as students set it down.
  const toScene = new THREE.Matrix4().set(
    -1, 0, 0, W / 2,
    0, 0, 1, 0,
    0, 1, 0, -H / 2,
    0, 0, 0, 1,
  );

  const b = new Builder();
  const { svg, w, h } = silkscreenSvg(brd, loop, W, H);
  const map = await rasterize(svg, w, h);
  pcbGeometry(b, loop, brd.plain.hole ?? [], W, H, toScene, map);

  const stepCache = new Map();
  const loadStep = async (lib, name) => {
    const key = `${lib}/${name}`;
    if (!stepCache.has(key)) stepCache.set(key, readStep(await kicadModel(lib, name)));
    return stepCache.get(key);
  };
  const report = [];
  let chipTop = null, chip = null;

  for (const el of brd.elements) {
    if (el.mirror) continue;
    if (el.package === "PN61729") { usbB(b, toScene); continue; }
    if (el.package === "TS42") { resetSwitch(b, toScene, el); continue; }
    const part = PARTS[el.package];
    if (!part) continue;
    const fpSrc = await kicadFootprint(part.lib, part.fp);
    const fp = footprintPads(fpSrc);
    const ref = fpSrc.match(/\(model\s+"[^"]*\/([^/"]+)\.3dshapes\/([^/"]+)\.(?:wrl|step|stp)"/);
    const model = await loadStep(ref?.[1] ?? part.lib, ref?.[2] ?? part.fp);
    const align = alignPads(packagePads(el.pkg), fp.pads, part.alias);
    report.push(`${el.name.padEnd(8)} ${el.package.padEnd(20)} ${ref?.[2] ?? part.fp}  rot ${Math.round((align.angle * 180) / Math.PI)}  fit ${align.residual.toFixed(2)}mm`);
    const m = toScene.clone()
      .multiply(new THREE.Matrix4().makeTranslation(el.x, el.y, PCB))
      .multiply(new THREE.Matrix4().makeRotationZ((el.angle * Math.PI) / 180))
      .multiply(align.matrix)
      .multiply(modelMatrix(fp));
    b.addStep(model, m, kicadMaterial);
    if (el.package === "DIL28-3") {
      // KiCad's socket model is the empty socket; seat the ATmega328P in it.
      // The chip's footprint is the socket's, so the same placement holds.
      const ic = await loadStep("Package_DIP", "DIP-28_W7.62mm");
      const seat = stepBounds(model).max.z - 0.45;
      b.addStep(ic, m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, seat)), kicadMaterial);
      chip = { el };
      chipTop = seat + stepBounds(ic).max.z;
    }
  }

  // Part marking on the ATmega328P.
  if (chip) {
    const quad = new THREE.PlaneGeometry(30, 6);
    // glTF samples with V running down the image; PlaneGeometry assumes up.
    const uv = quad.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    const place = toScene.clone()
      .multiply(new THREE.Matrix4().makeTranslation(chip.el.x, chip.el.y, PCB + chipTop + 0.02));
    b.addGeometry(quad, place, MAT.marking(await chipMarking()));
  }

  // Rest the board's lowest point (the pin tails underneath) on y = 0.
  const bounds = b.bounds();
  b.translate(0, -bounds.min.y, 0);

  // Header sockets: where a jumper wire actually goes in.
  const pins = {};
  const socketTop = (PCB + 8.5) - bounds.min.y;
  for (const el of brd.elements) {
    const names = HEADERS[el.name];
    if (!names) continue;
    const pads = elementPads(el).sort((p, q) => Number(p.name) - Number(q.name));
    pads.forEach((p, i) => {
      const v = new THREE.Vector3(p.x, p.y, 0).applyMatrix4(toScene);
      pins[names[i]] = { x: +v.x.toFixed(3), y: +socketTop.toFixed(3), z: +v.z.toFixed(3) };
    });
  }
  // Cross-check against Arduino's own labelled test points.
  for (const el of brd.elements) {
    const tp = el.name.match(/^TP_(\d+|A\d|5V|3V3|VIN|RESET|AREF)$/);
    if (!tp) continue;
    const name = /^\d+$/.test(tp[1]) ? `D${tp[1]}` : tp[1];
    const v = new THREE.Vector3(el.x, el.y, 0).applyMatrix4(toScene);
    const pin = pins[name];
    if (!pin || Math.hypot(pin.x - v.x, pin.z - v.z) > 0.05) {
      throw new Error(`header pin ${name} does not sit on Arduino's test point ${el.name}`);
    }
  }

  const size = b.bounds().getSize(new THREE.Vector3());
  await b.writeGlb(join(OUT, "uno-r3.glb"), "uno-r3");
  await writeFile(join(WEB, "src/three/uno-r3.pins.json"), JSON.stringify({
    note: "Header socket openings, mm, in /models/uno-r3.glb's frame. Generated by `npm run models`; do not edit.",
    pcbTop: +(PCB - bounds.min.y).toFixed(3),
    size: { x: +size.x.toFixed(2), y: +size.y.toFixed(2), z: +size.z.toFixed(2) },
    pins,
  }, null, 2) + "\n");
  return { report, triangles: b.triangleCount(), materials: [...b.buckets.keys()] };
}
