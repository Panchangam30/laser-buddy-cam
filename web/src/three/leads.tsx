import { useMemo } from "react";
import * as THREE from "three";
import { LEAD, PIN } from "./materials";

/**
 * Component legs.
 *
 * Real leads are not vertical sticks. They leave the body, bend, and drop into
 * the hole, and that bend is most of what makes a part look seated rather than
 * hovering. The curve here goes: straight down into the hole for a few
 * millimetres, then a radius, then straight to the body.
 */

export interface LeadProps {
  /** Hole end, on the board surface. */
  from: THREE.Vector3;
  /** Body end. */
  to: THREE.Vector3;
  radius?: number;
  /** How far it runs vertically out of the hole before bending. */
  rise?: number;
  material?: typeof LEAD | typeof PIN;
}

export function Lead({ from, to, radius = 0.26, rise = 1.8, material = LEAD }: LeadProps) {
  const geometry = useMemo(() => {
    const up = new THREE.Vector3(0, 1, 0);
    // A short vertical run out of the hole, so the lead enters straight down
    // the way a real one does, then a smooth bend towards the body.
    const straight = from.clone().addScaledVector(up, Math.min(rise, to.y - from.y));
    const approach = to.clone().addScaledVector(up, -Math.min(rise * 0.6, 1.2));

    const points = [
      from.clone().addScaledVector(up, -1.2),   // buried in the hole
      from,
      straight,
      approach,
      to,
    ];
    const curve = new THREE.CatmullRomCurve3(points, false, "catmullrom", 0.35);
    return new THREE.TubeGeometry(curve, 20, radius, 8, false);
  }, [from, to, radius, rise]);

  return (
    <mesh geometry={geometry} castShadow>
      <meshStandardMaterial {...material} />
    </mesh>
  );
}

/**
 * A chip or header pin: straight, tapered, and square in section.
 *
 * Distinct from Lead because DIP pins do not bend on their way to the board --
 * they are stamped flat and go straight in, and drawing them as round wire is
 * the difference between a chip and a spider.
 */
export function Pin({ at, height = 3.2, width = 0.42 }: {
  at: THREE.Vector3; height?: number; width?: number;
}) {
  return (
    <group position={[at.x, at.y, at.z]}>
      <mesh position={[0, -0.6, 0]} castShadow>
        <boxGeometry args={[width, 2.0, width * 0.62]} />
        <meshStandardMaterial {...PIN} />
      </mesh>
      <mesh position={[0, height / 2, 0]} castShadow>
        <boxGeometry args={[width * 1.25, height, width * 0.72]} />
        <meshStandardMaterial {...PIN} />
      </mesh>
    </group>
  );
}

/** Bare tinned wire at the end of a jumper, where the insulation stops. */
export function WireTip({ at, height = 3.4 }: { at: THREE.Vector3; height?: number }) {
  return (
    <mesh position={[at.x, at.y + height / 2 - 1.0, at.z]} castShadow>
      <cylinderGeometry args={[0.32, 0.28, height, 8]} />
      <meshStandardMaterial {...LEAD} />
    </mesh>
  );
}
