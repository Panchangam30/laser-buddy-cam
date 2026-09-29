import * as THREE from "three";

/**
 * Shared surface definitions.
 *
 * Kept in one place because the parts have to look like they came out of the
 * same drawer. Tinned copper on a resistor and tinned copper on a chip are the
 * same metal, and small inconsistencies in roughness across parts read as
 * sloppiness long before anyone can say why.
 */

export const LEAD = {
  color: "#c6cad2",
  metalness: 0.92,
  roughness: 0.27,
} as const;

/** Duller than a fresh lead: chip pins are matte from the plating bath. */
export const PIN = {
  color: "#b6bac2",
  metalness: 0.85,
  roughness: 0.38,
} as const;

export const EPOXY = {
  roughness: 0.34,
  metalness: 0.02,
} as const;

/** Moulded black plastic: chip bodies, switch housings. */
export const MOULDED = {
  color: "#26262b",
  roughness: 0.52,
  metalness: 0.04,
} as const;

export const PCB_GREEN = {
  color: "#1f6b46",
  roughness: 0.62,
  metalness: 0.06,
} as const;

/** Bare aluminium: electrolytic cans. */
export const ALUMINIUM = {
  color: "#c9ccd1",
  metalness: 0.78,
  roughness: 0.3,
} as const;

/**
 * A D-shaped cross-section: a circle with one side flattened.
 *
 * Used for the two packages that are defined by their flat -- a 5 mm LED's
 * flange, which is how you tell the cathode, and a TO-92 transistor, whose flat
 * face carries the part number and fixes the pinout. Faking either with a plain
 * cylinder loses the one feature a student needs to orient the part.
 */
export function dShape(radius: number, flat: number): THREE.Shape {
  const a = Math.acos(Math.min(0.99, flat / radius));
  const shape = new THREE.Shape();
  shape.absarc(0, 0, radius, a, Math.PI * 2 - a, false);
  shape.closePath();
  return shape;
}

/** Extrude settings that give a part a softened, moulded edge. */
export function bevel(depth: number, size = 0.12) {
  return {
    depth,
    bevelEnabled: true,
    bevelThickness: size,
    bevelSize: size,
    bevelSegments: 2,
    curveSegments: 24,
  };
}
