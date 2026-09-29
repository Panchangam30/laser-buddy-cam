import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { holePosition, externalPosition, type Vec3 } from "../lib/breadboard";
import {
  Button, Capacitor, Dip, GenericBody, Led, Module, Potentiometer, Resistor,
  Transistor, Wire,
} from "./bodies";
import type { Part } from "../lib/types";

const v = (p: Vec3) => new THREE.Vector3(p.x, p.y, p.z);

/**
 * Resolve a part's pins to positions.
 *
 * Anything that is not a valid hole is treated as an off-board endpoint (an
 * Arduino pin, a battery lead) and anchored off the front edge, aligned with
 * the nearest pin that did resolve. Dropping those parts instead would make
 * wires to the Arduino silently vanish from the board.
 */
const externalKey = (value: string) => value.trim().replace(/\s+/g, " ").toUpperCase();

function pinPositions(part: Part, externalAnchors: Map<string, Vec3>): THREE.Vector3[] | null {
  const resolved = part.pins.map((ref) => holePosition(ref) ?? externalAnchors.get(externalKey(ref)) ?? null);
  const boardResolved = part.pins.map((ref) => holePosition(ref));
  const onBoard = boardResolved.find((p): p is Vec3 => p !== null) ?? null;
  const realEndpoint = resolved.find((p): p is Vec3 => p !== null) ?? null;

  const out = resolved.map((p, i) => {
    if (p) return v(p);
    const sibling = resolved[i === 0 ? resolved.length - 1 : 0] ?? onBoard;
    return v(externalPosition(sibling ?? onBoard));
  });

  return realEndpoint && out.length ? out : null;
}

/**
 * Animation wrapper for a part.
 *
 * Every state change used to be a jump cut: a part appeared at full size, and
 * the exploded view teleported it 26 mm into the air. Damping each change
 * instead is what makes the view readable -- when a part slides up out of the
 * board you can see WHICH part moved, where a jump only tells you that
 * something is different now.
 *
 * Framerate-independent damping rather than a fixed step per frame, so the
 * motion is the same on a 60 Hz laptop and a 120 Hz display.
 */
function Animated({ lift, active, phase, children }: {
  lift: number; active: boolean; phase: number; children: React.ReactNode;
}) {
  const group = useRef<THREE.Group>(null);
  const state = useRef({ y: lift, scale: 0 });

  useFrame(({ clock }, dt) => {
    const g = group.current;
    if (!g) return;
    const s = state.current;
    // Clamp dt: a backgrounded tab resumes with a huge delta, which would snap
    // everything to its target and undo the point of damping.
    const step = Math.min(dt, 0.05);

    s.y = THREE.MathUtils.damp(s.y, lift, 6, step);
    s.scale = THREE.MathUtils.damp(s.scale, 1, 9, step);

    // A highlighted part breathes very slightly, enough to draw the eye
    // without looking like it is coming loose.
    const bob = active ? Math.sin(clock.elapsedTime * 2.0 + phase) * 0.28 : 0;
    g.position.y = s.y + bob;
    g.scale.setScalar(s.scale);
  });

  // Starts at zero scale so a newly placed part grows into position rather
  // than popping into existence.
  return <group ref={group} scale={0}>{children}</group>;
}

export function PartMesh({ part, dimmed, highlighted, lift = 0, externalAnchors = new Map() }: {
  part: Part;
  dimmed?: boolean;
  highlighted?: boolean;
  /** Height to float at, used by the exploded view. */
  lift?: number;
  /** Named sockets on equipment rendered beside the board. */
  externalAnchors?: Map<string, Vec3>;
}) {
  const pins = useMemo(() => pinPositions(part, externalAnchors), [part, externalAnchors]);
  // Offset each part's idle motion so a row of them does not pulse in unison,
  // which reads as a glitch rather than as life. Derived from the id rather
  // than randomised, so it stays put across re-renders.
  const phase = useMemo(
    () => [...part.id].reduce((h, c) => h + c.charCodeAt(0), 0) % 628 / 100,
    [part.id]);

  if (!pins) return null;

  // Posts mark where a wire leaves the board, so an off-board connection reads
  // as deliberate rather than a wire trailing into nothing.
  const anchors = part.pins
    .map((ref, i) => (holePosition(ref) === null && !externalAnchors.has(externalKey(ref)) ? pins[i] : null))
    .filter((p): p is THREE.Vector3 => p !== null);

  const props = { part, pins, dimmed, highlighted };
  const body = (() => {
    switch (part.kind) {
      case "wire":          return <Wire {...props} />;
      case "led":           return <Led {...props} />;
      case "resistor":      return <Resistor {...props} />;
      case "capacitor":     return <Capacitor {...props} />;
      case "ic":            return <Dip {...props} />;
      case "transistor":    return <Transistor {...props} />;
      case "button":        return <Button {...props} />;
      case "potentiometer": return <Potentiometer {...props} />;
      case "module":        return <Module {...props} />;
      default:              return <GenericBody {...props} />;
    }
  })();

  return (
    <group name={`part:${part.id}`}>
      <Animated lift={lift} active={!!highlighted && !dimmed} phase={phase}>
        {body}
        {anchors.map((a, i) => (
          <group key={`anchor-${i}`} position={[a.x, a.y, a.z]}>
            <mesh position={[0, 1.6, 0]} castShadow>
              <cylinderGeometry args={[1.5, 1.9, 3.2, 12]} />
              <meshStandardMaterial color="#5c6069" roughness={0.55} metalness={0.45}
                                    transparent={!!dimmed} opacity={dimmed ? 0.25 : 1} />
            </mesh>
            <mesh position={[0, 3.4, 0]} castShadow>
              <sphereGeometry args={[1.5, 14, 10]} />
              <meshStandardMaterial color="#70747e" roughness={0.45} metalness={0.5}
                                    transparent={!!dimmed} opacity={dimmed ? 0.25 : 1} />
            </mesh>
          </group>
        ))}
      </Animated>
    </group>
  );
}
