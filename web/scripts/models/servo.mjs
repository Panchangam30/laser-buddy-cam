/**
 * SG90 micro servo.
 *
 * The case and horn are the SG90 models from FreeCAD's parts library (CC-BY
 * 3.0; see public/models/CREDITS.md). They arrive as uncoloured solids, so the
 * colouring is done here: the translucent-blue case, the white output spline
 * and horn, the side label. The lead and its 3-pin plug are not in the CAD at
 * all and are built from the part's dimensions, because the plug is where the
 * jumper wires go and has to be where the app thinks it is.
 */
import * as THREE from "three";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { freecadPart, OUT, WEB } from "./sources.mjs";
import { Builder, linear, readStep } from "./mesh.mjs";
import { rasterize } from "./raster.mjs";

// Measured off the FreeCAD model, in its frame (mm, Z up).
const BODY_MID = 11.25;            // the case runs Y 0..22.5
const SHAFT = { x: 0, y: 16.59 };  // output spline axis
const BOSS_TOP = 26.9;             // shoulder the horn seats on
const HORN_HUB = { x: 26.97, y: 36.34, z: 25.67 };  // hub centre, underside, in the horn file
const HALF_WIDTH = 5.9;
const TAB_BOTTOM = 15.9;

const MAT = {
  case: { name: "servo-case", color: linear("#2b63d9"), roughness: 0.32, metalness: 0 },
  white: { name: "servo-horn", color: linear("#f1f1ec"), roughness: 0.45 },
  plug: { name: "servo-plug", color: linear("#17181b"), roughness: 0.55 },
  socket: { name: "servo-plug-socket", color: linear("#050506"), roughness: 0.9 },
  wire: (name, hex) => ({ name, color: linear(hex), roughness: 0.5 }),
  label: (map) => ({ name: "servo-label", color: [1, 1, 1], roughness: 0.4, map }),
};

/** FreeCAD frame -> scene: length along X with the shaft toward +X, Y up. */
const TO_SCENE = new THREE.Matrix4().set(
  0, 1, 0, -BODY_MID,
  0, 0, 1, 0,
  1, 0, 0, 0,
  0, 0, 0, 1,
);

/** Split triangles of the case solid into spline (near the axis, on top) and case. */
function addCase(builder, parts) {
  const sel = { spline: [], body: [] };
  for (const p of parts) {
    for (let t = 0; t < p.positions.length / 9; t++) {
      let spline = true;
      for (let k = 0; k < 3; k++) {
        const i = t * 9 + k * 3;
        const x = p.positions[i], y = p.positions[i + 1], z = p.positions[i + 2];
        if (Math.hypot(x - SHAFT.x, y - SHAFT.y) > 2.45 || z < BOSS_TOP + 0.05) spline = false;
      }
      (spline ? sel.spline : sel.body).push([p, t]);
    }
  }
  for (const [kind, tris] of Object.entries(sel)) {
    const pos = new Float32Array(tris.length * 9), nrm = new Float32Array(tris.length * 9);
    tris.forEach(([p, t], j) => {
      pos.set(p.positions.subarray(t * 9, t * 9 + 9), j * 9);
      nrm.set(p.normals.subarray(t * 9, t * 9 + 9), j * 9);
    });
    builder.addTriangles(pos, nrm, TO_SCENE, kind === "spline" ? MAT.white : MAT.case);
  }
}

async function label() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="480" viewBox="0 0 800 480">
    <rect width="800" height="480" rx="18" fill="#1f4fb8"/>
    <rect x="18" y="18" width="764" height="444" rx="10" fill="none" stroke="#e8eefc" stroke-width="6"/>
    <g font-family="Helvetica Neue, Helvetica, Arial, sans-serif" fill="#f4f7ff" text-anchor="middle">
      <text x="400" y="190" font-size="150" font-weight="800" letter-spacing="6">SG90</text>
      <text x="400" y="290" font-size="62" font-weight="600" letter-spacing="4">MICRO SERVO</text>
      <text x="400" y="390" font-size="58" font-weight="500" letter-spacing="10">9g</text>
    </g></svg>`;
  return rasterize(svg, 800, 480);
}

/** A sticker on each long side of the case, below the mounting tabs. */
function addLabels(builder, map) {
  const quad = () => {
    const g = new THREE.PlaneGeometry(19, 11.4);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));   // glTF V runs down
    return g;
  };
  const ex = new THREE.Vector3(1, 0, 0), ey = new THREE.Vector3(0, 1, 0), ez = new THREE.Vector3(0, 0, 1);
  for (const side of [1, -1]) {
    // Text reads along +Y seen from +X, along -Y seen from -X.
    const basis = new THREE.Matrix4()
      .makeBasis(ey.clone().multiplyScalar(side), ez, ex.clone().multiplyScalar(side))
      .setPosition(side * (HALF_WIDTH + 0.03), BODY_MID, 8.2);
    builder.addGeometry(quad(), TO_SCENE.clone().multiply(basis), MAT.label(map));
  }
}

/** The horn, turned arm-up and pressed onto the spline, arm over the case. */
function hornMatrix() {
  return TO_SCENE.clone()
    .multiply(new THREE.Matrix4().makeTranslation(SHAFT.x, SHAFT.y, BOSS_TOP + 5))
    .multiply(new THREE.Matrix4().makeRotationZ(-Math.PI / 2))
    .multiply(new THREE.Matrix4().makeRotationX(Math.PI))
    .multiply(new THREE.Matrix4().makeTranslation(-HORN_HUB.x, -HORN_HUB.y, -HORN_HUB.z));
}

/**
 * The flat three-core lead (brown GND, red +5 V, orange signal) and its
 * 2.54 mm female plug, built in scene coordinates. Returns the plug's sockets.
 */
function addLead(builder) {
  const exitX = -BODY_MID - 0.2, exitY = 4.2;
  const plug = { x0: -35, x1: -21, h: 2.6, w: 7.8 };
  const wires = [
    ["signal", "#ef8a2b", -1.0],
    ["5V", "#cf2f27", 0],
    ["GND", "#5b3a26", 1.0],
  ];
  for (const [name, hex, z] of wires) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(exitX + 0.6, exitY, z),
      new THREE.Vector3(exitX - 2.5, exitY - 0.2, z),
      new THREE.Vector3(exitX - 6, 2.0, z),
      new THREE.Vector3(plug.x1 - 0.5, plug.h / 2, z),
      new THREE.Vector3(plug.x1 + 0.6, plug.h / 2, z),
    ]);
    builder.addGeometry(new THREE.TubeGeometry(curve, 40, 0.5, 10, false), new THREE.Matrix4(),
      MAT.wire(`servo-wire-${name}`, hex));
  }
  builder.addGeometry(new THREE.BoxGeometry(plug.x1 - plug.x0, plug.h, plug.w)
    .translate((plug.x0 + plug.x1) / 2, plug.h / 2, 0), new THREE.Matrix4(), MAT.plug);
  const sockets = {};
  wires.forEach(([name], i) => {
    const z = (i - 1) * 2.54;
    builder.addGeometry(new THREE.BoxGeometry(0.1, 1.1, 1.1).translate(plug.x0 - 0.04, plug.h / 2, z),
      new THREE.Matrix4(), MAT.socket);
    sockets[name] = { x: plug.x0, y: +(plug.h / 2).toFixed(3), z: +z.toFixed(3) };
  });
  return sockets;
}

export async function buildServo() {
  const b = new Builder();
  addCase(b, await readStep(await freecadPart("Electrical Parts/Servos/SG-90/Servo-sg90.step"), 0.02));
  const horn = await readStep(await freecadPart("Electrical Parts/Servos/SG-90/SG90-1-arm-horn.step"), 0.02);
  b.addStep(horn, hornMatrix(), () => MAT.white);
  addLabels(b, await label());
  const ports = addLead(b);
  const size = b.bounds().getSize(new THREE.Vector3());
  await b.writeGlb(join(OUT, "micro-servo.glb"), "micro-servo");
  await writeFile(join(WEB, "src/three/micro-servo.ports.json"), JSON.stringify({
    note: "Plug sockets, mm, in /models/micro-servo.glb's frame. Generated by `npm run models`; do not edit.",
    ports,
  }, null, 2) + "\n");
  return `micro-servo      ${String(b.triangleCount()).padStart(6)} tris  ${size.x.toFixed(1)} x ${size.y.toFixed(1)} x ${size.z.toFixed(1)} mm`;
}
