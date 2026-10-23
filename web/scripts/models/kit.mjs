/**
 * Starter-kit parts, from KiCad's 3D library.
 *
 * Each comes out centred on the origin at true size, with Y = 0 on the board
 * surface and the leads below it -- the convention kitModels.tsx already uses,
 * so a CAD model drops in where its primitive stood. Materials whose colour
 * changes with the part (an LED's lens, a capacitor's sleeve) get a role name
 * the app recolours by.
 */
import * as THREE from "three";
import { join } from "node:path";
import { kicadModel, OUT } from "./sources.mjs";
import { Builder, linear, readStep } from "./mesh.mjs";
import { kicadMaterial } from "./uno.mjs";

/** KiCad (X right, Y back, Z up) to three.js (X right, Y up, Z toward the viewer). */
const KICAD_TO_SCENE = new THREE.Matrix4().set(
  1, 0, 0, 0,
  0, 0, 1, 0,
  0, -1, 0, 0,
  0, 0, 0, 1,
);

const yaw = (deg) => new THREE.Matrix4().makeRotationY((deg * Math.PI) / 180);
const at = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);

/**
 * out: file name. parts: KiCad models with a placement in KiCad's frame.
 * roles: KiCad colour (hex) -> material name the app looks for.
 * turn: yaw in degrees applied after conversion, to match the primitive's layout.
 */
const PARTS = [
  { out: "led-5mm", parts: [["LED_THT", "LED_D5.0mm"]],
    roles: { b31a0d: { name: "led-lens", roughness: 0.18, opacity: 0.88 } } },
  { out: "led-5mm-rgb", parts: [["LED_THT", "LED_D5.0mm-4_RGB"]],
    roles: { e4e3cf: { name: "led-lens", roughness: 0.25, opacity: 0.9 } } },
  { out: "resistor-axial", parts: [["Resistor_THT", "R_Axial_DIN0207_L6.3mm_D2.5mm_P10.16mm_Horizontal"]],
    roles: { e1b57d: { name: "resistor-body", roughness: 0.45 } } },
  { out: "pushbutton-6mm", parts: [["Button_Switch_THT", "SW_PUSH_6mm_H5mm"]] },
  { out: "trimpot", parts: [["Potentiometer_THT", "Potentiometer_Bourns_3296W_Vertical"]] },
  { out: "photoresistor", parts: [["OptoDevice", "R_LDR_5.1x4.3mm_P3.4mm_Vertical"]] },
  { out: "lcd-1602", parts: [["Display", "WC1602A"]],
    roles: { e4e3cf: { name: "lcd-glass", roughness: 0.3 } } },
  { out: "seven-segment", parts: [["Display_7Segment", "7SegmentLED_LTS6760_LTS6780"]], turn: 90 },
  { out: "piezo-buzzer", parts: [["Buzzer_Beeper", "Buzzer_12x9.5RM7.6"]] },
  { out: "dip-16", parts: [["Package_DIP", "DIP-16_W7.62mm"]], turn: 90,
    roles: { "262525": { name: "ic-body", roughness: 0.55 } } },
  { out: "electrolytic", parts: [["Capacitor_THT", "CP_Radial_D6.3mm_P2.50mm"]],
    roles: { "2367b9": { name: "cap-sleeve", roughness: 0.4 } } },
  { out: "to-92", parts: [["Package_TO_SOT_THT", "TO-92_Inline"]] },
  // A relay module as sold for Arduino: the Songle-style relay, a 3-way screw
  // terminal on the switched side, and the 3-pin control header.
  { out: "relay-module", turn: 0, board: { x0: -19, x1: 33, y0: -13, y1: 13, color: "#1d4f9c" }, parts: [
    ["Relay_THT", "Relay_SPDT_SANYOU_SRD_Series_Form_C"],
    ["TerminalBlock_Phoenix", "TerminalBlock_Phoenix_MKDS-1,5-3-5.08_1x03_P5.08mm_Horizontal", at(-9.5, 5.08, 0).multiply(new THREE.Matrix4().makeRotationZ(-Math.PI / 2))],
    ["Connector_PinHeader_2.54mm", "PinHeader_1x03_P2.54mm_Vertical", at(29, 2.54, 0)],
  ] },
];

const PCB = 1.6;

export async function buildKit() {
  const lines = [];
  for (const spec of PARTS) {
    const b = new Builder();
    const toScene = yaw(spec.turn ?? 0).multiply(KICAD_TO_SCENE);
    const materialFor = (color) => {
      const base = kicadMaterial(color);
      const hex = new THREE.Color(...color).getHexString();
      const role = spec.roles?.[hex];
      return role ? { ...base, ...role } : base;
    };
    for (const [lib, name, place] of spec.parts) {
      const model = await readStep(await kicadModel(lib, name), 0.02);
      b.addStep(model, toScene.clone().multiply(place ?? new THREE.Matrix4()), materialFor);
    }
    if (spec.board) {
      const { x0, x1, y0, y1, color } = spec.board;
      const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, PCB)
        .translate((x0 + x1) / 2, (y0 + y1) / 2, -PCB / 2);
      b.addGeometry(g, toScene, { name: "module-pcb", color: linear(color), roughness: 0.5 });
    }
    // Centre on the footprint; the board surface stays at y = 0.
    const box = b.bounds();
    const c = box.getCenter(new THREE.Vector3());
    b.translate(-c.x, 0, -c.z);
    const size = b.bounds().getSize(new THREE.Vector3());
    await b.writeGlb(join(OUT, `${spec.out}.glb`), spec.out);
    lines.push(`${spec.out.padEnd(16)} ${String(b.triangleCount()).padStart(6)} tris  ${size.x.toFixed(1)} x ${size.y.toFixed(1)} x ${size.z.toFixed(1)} mm  top ${b.bounds().max.y.toFixed(2)}`);
  }
  return lines;
}
