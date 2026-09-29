import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import { Lead, Pin, WireTip } from "./leads";
import { ALUMINIUM, EPOXY, MOULDED, PCB_GREEN, bevel, dShape } from "./materials";
import { resistorBands, textPlate } from "./labels";
import type { Part } from "../lib/types";

/**
 * The component bodies, modelled from the real packages.
 *
 * Each one is built around whatever feature a student actually needs to see: a
 * resistor is its colour bands, an LED is its flat and its short leg, an
 * electrolytic is its stripe, a DIP is its notch. Those are the things that
 * tell you which way round a part goes, so they are modelled rather than
 * suggested, and everything else is kept simple enough to stay cheap.
 */

export interface BodyProps {
  part: Part;
  pins: THREE.Vector3[];
  dimmed?: boolean;
  highlighted?: boolean;
}

/** Common material props so dimming works the same way on every part. */
function look(dimmed?: boolean) {
  return dimmed
    ? { transparent: true, opacity: 0.22 }
    : { transparent: false, opacity: 1 };
}

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Midpoint and axis of a two-lead part. */
function span(pins: THREE.Vector3[]) {
  const a = pins[0];
  const b = pins[pins.length - 1];
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const axis = len > 1e-6 ? dir.clone().normalize() : new THREE.Vector3(1, 0, 0);
  const quat = new THREE.Quaternion().setFromUnitVectors(v3(0, 1, 0), axis);
  return { a, b, mid, axis, len, quat };
}

// ---------------------------------------------------------------- resistor

/** Axial carbon-film resistor: turned body, four bands, bent leads. */
export function Resistor({ part, pins, dimmed }: BodyProps) {
  const { a, b, mid, axis, len, quat } = span(pins);
  const rise = 5.6;
  const bodyLen = Math.max(len * 0.46, 5.4);
  const top = (p: THREE.Vector3) => v3(p.x, p.y + rise, p.z);

  // The pinched ends and slight barrel of a moulded film resistor. A plain
  // cylinder reads as a fuse.
  const profile = useMemo(() => {
    const r = 1.22;
    const h = bodyLen / 2;
    return [
      new THREE.Vector2(0.30, -h),
      new THREE.Vector2(0.34, -h + 0.18),
      new THREE.Vector2(r * 0.70, -h + 0.55),
      new THREE.Vector2(r * 0.97, -h + 1.05),
      new THREE.Vector2(r, -h + 1.9),
      new THREE.Vector2(r, h - 1.9),
      new THREE.Vector2(r * 0.97, h - 1.05),
      new THREE.Vector2(r * 0.70, h - 0.55),
      new THREE.Vector2(0.34, h - 0.18),
      new THREE.Vector2(0.30, h),
    ];
  }, [bodyLen]);

  // Real bands when the value was read, neutral grey when it was not -- an
  // unreadable resistor must never show a confident-looking wrong value.
  const bands = resistorBands(part.value) ?? ["#8d8d93", "#8d8d93", "#8d8d93"];
  const m = look(dimmed);

  return (
    <group>
      <Lead from={a} to={top(a)} rise={2.4} />
      <Lead from={b} to={top(b)} rise={2.4} />
      <mesh position={mid.clone().setY(mid.y + rise)} quaternion={quat} castShadow>
        <latheGeometry args={[profile, 28]} />
        <meshStandardMaterial color={part.color ?? "#d8c49a"} roughness={0.42}
                              metalness={0.03} {...m} />
      </mesh>
      {bands.map((c, i) => {
        // Three value bands grouped at one end, tolerance set apart -- the
        // spacing is how you know which end to read from.
        const isTolerance = i === bands.length - 1 && bands.length === 4;
        const t = isTolerance
          ? bodyLen * 0.30
          : (i - 1) * 0.92 - bodyLen * 0.14;
        return (
          <mesh key={i} quaternion={quat}
                position={mid.clone().setY(mid.y + rise).addScaledVector(axis, t)}>
            <cylinderGeometry args={[1.26, 1.26, isTolerance ? 0.5 : 0.62, 28]} />
            <meshStandardMaterial color={c} roughness={isTolerance ? 0.3 : 0.5}
                                  metalness={isTolerance ? 0.55 : 0.05} {...m} />
          </mesh>
        );
      })}
    </group>
  );
}

// --------------------------------------------------------------------- LED

/** 5 mm through-hole LED: domed lens, flat on the cathode, visible internals. */
export function Led({ part, pins, dimmed, highlighted }: BodyProps) {
  const { a, b, mid } = span(pins);
  const glow = useRef<THREE.MeshStandardMaterial>(null);
  const colour = part.color ?? "#ff3b30";

  // The flange is a circle with one side flattened; that flat is the only
  // marking on the package, and it is how you find the cathode.
  const flange = useMemo(
    () => new THREE.ExtrudeGeometry(dShape(2.85, 2.35), bevel(0.75, 0.1)), []);

  useFrame(({ clock }) => {
    if (!glow.current) return;
    // A lit LED does not sit at a constant brightness on screen; a slow breathe
    // reads as "powered" without being a distraction.
    const base = highlighted ? 1.5 : 0.5;
    glow.current.emissiveIntensity =
      base + (highlighted ? Math.sin(clock.elapsedTime * 3.1) * 0.35 : 0);
  });

  const base = mid.y + 0.4;
  return (
    <group>
      {/* Anode leg is the long one. Drawing them equal loses the other cue. */}
      <Lead from={a} to={v3(mid.x, base + 4.4, mid.z)} rise={2.6} />
      <Lead from={b} to={v3(mid.x, base + 3.0, mid.z)} rise={1.7} />

      <mesh geometry={flange} position={[mid.x, base + 0.5, mid.z]}
            rotation={[-Math.PI / 2, 0, 0]} castShadow>
        <meshStandardMaterial color={colour} {...EPOXY} transparent
                              opacity={(dimmed ? 0.22 : 0.9)} />
      </mesh>

      {/* Internals, seen through the epoxy: the cup, the post and the bond wire. */}
      <mesh position={[mid.x - 0.85, base + 4.0, mid.z]}>
        <cylinderGeometry args={[0.72, 0.5, 1.5, 12]} />
        <meshStandardMaterial color="#6d7078" metalness={0.8} roughness={0.35} />
      </mesh>
      <mesh position={[mid.x + 0.85, base + 3.6, mid.z]}>
        <boxGeometry args={[0.5, 2.4, 0.5]} />
        <meshStandardMaterial color="#6d7078" metalness={0.8} roughness={0.35} />
      </mesh>

      <mesh position={[mid.x, base + 3.3, mid.z]} castShadow>
        <cylinderGeometry args={[2.5, 2.5, 5.2, 28]} />
        <meshStandardMaterial ref={glow} color={colour} emissive={colour}
                              emissiveIntensity={0.5} {...EPOXY}
                              transparent opacity={dimmed ? 0.24 : 0.72} />
      </mesh>
      <mesh position={[mid.x, base + 5.9, mid.z]} castShadow>
        <sphereGeometry args={[2.5, 28, 18, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={colour} emissive={colour}
                              emissiveIntensity={highlighted ? 1.1 : 0.35}
                              roughness={0.16} metalness={0.02}
                              transparent opacity={dimmed ? 0.24 : 0.68} />
      </mesh>
      {highlighted && !dimmed && (
        <pointLight position={[mid.x, base + 6.4, mid.z]} color={colour}
                    intensity={26} distance={40} decay={2} />
      )}
    </group>
  );
}

// --------------------------------------------------------------- capacitor

/** Ceramic disc, or an electrolytic can when the part is marked polarised. */
export function Capacitor(props: BodyProps) {
  return props.part.polarised ? <Electrolytic {...props} /> : <Ceramic {...props} />;
}

function Ceramic({ part, pins, dimmed }: BodyProps) {
  const { a, b, mid } = span(pins);
  const m = look(dimmed);
  const rise = 5.4;

  // The dipped blob of a ceramic disc: fat in the middle, thin at the rim.
  const profile = useMemo(() => {
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      pts.push(new THREE.Vector2(
        0.15 + Math.sin(t * Math.PI) * 2.85,
        -1.9 + t * 3.8));
    }
    return pts;
  }, []);

  const label = useMemo(() => textPlate(part.value || "?", { bg: "rgba(0,0,0,0)", color: "#3a2a12" }),
                        [part.value]);

  return (
    <group>
      <Lead from={a} to={v3(mid.x - 1.1, mid.y + rise, mid.z)} rise={2.2} />
      <Lead from={b} to={v3(mid.x + 1.1, mid.y + rise, mid.z)} rise={2.2} />
      <mesh position={[mid.x, mid.y + rise + 1.4, mid.z]} castShadow>
        <latheGeometry args={[profile, 8]} />
        <meshStandardMaterial color={part.color ?? "#d08a2a"} roughness={0.62}
                              metalness={0.02} {...m} />
      </mesh>
      {part.value && !dimmed && (
        <mesh position={[mid.x, mid.y + rise + 1.5, mid.z + 0.75]}>
          <planeGeometry args={[2.6 * label.aspect * 0.5, 1.3]} />
          <meshBasicMaterial map={label.tex} transparent depthWrite={false} toneMapped={false} />
        </mesh>
      )}
    </group>
  );
}

function Electrolytic({ part, pins, dimmed }: BodyProps) {
  const { a, b, mid } = span(pins);
  const m = look(dimmed);
  const h = 9.5;
  const r = 3.1;
  const base = mid.y + 1.4;

  return (
    <group>
      <Lead from={a} to={v3(mid.x - 1.1, base, mid.z)} rise={2.0} />
      <Lead from={b} to={v3(mid.x + 1.1, base, mid.z)} rise={2.0} />
      <mesh position={[mid.x, base + h / 2, mid.z]} castShadow>
        <cylinderGeometry args={[r, r, h, 28]} />
        <meshStandardMaterial color={part.color ?? "#2a3550"} roughness={0.38}
                              metalness={0.24} {...m} />
      </mesh>
      {/* Crimp below the top, and the scored cross that lets it vent. */}
      <mesh position={[mid.x, base + h - 0.9, mid.z]}>
        <torusGeometry args={[r * 0.96, 0.28, 8, 28]} />
        <meshStandardMaterial {...ALUMINIUM} {...m} />
      </mesh>
      <mesh position={[mid.x, base + h + 0.02, mid.z]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[r * 0.93, 28]} />
        <meshStandardMaterial {...ALUMINIUM} {...m} />
      </mesh>
      {[0, Math.PI / 2].map((rot) => (
        <mesh key={rot} position={[mid.x, base + h + 0.06, mid.z]}
              rotation={[-Math.PI / 2, 0, rot]}>
          <planeGeometry args={[r * 1.7, 0.34]} />
          <meshBasicMaterial color="#6f747c" toneMapped={false} />
        </mesh>
      ))}
      {/* The negative stripe. The single most important marking on the part. */}
      <mesh position={[mid.x - r * 0.99, base + h / 2, mid.z]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[1.9, h * 0.86]} />
        <meshBasicMaterial color="#c8ccd4" toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

// --------------------------------------------------------------------- DIP

/** DIP chip: notched body, pin-1 dot, stamped pins straddling the channel. */
export function Dip({ part, pins, dimmed }: BodyProps) {
  const box = new THREE.Box3().setFromPoints(pins);
  const size = box.getSize(new THREE.Vector3());
  const mid = box.getCenter(new THREE.Vector3());
  const w = Math.max(size.x, 7);
  const d = Math.max(size.z * 0.66, 6.2);
  const m = look(dimmed);
  const bodyY = mid.y + 3.6;

  const label = useMemo(
    () => textPlate(part.value || part.label.slice(0, 12), { bg: "rgba(0,0,0,0)", color: "#9aa0ab" }),
    [part.value, part.label]);

  return (
    <group>
      {pins.map((p, i) => <Pin key={i} at={p} height={3.0} />)}
      <RoundedBox args={[w, 2.5, d]} radius={0.28} smoothness={3}
                  position={[mid.x, bodyY, mid.z]} castShadow receiveShadow>
        <meshStandardMaterial color={part.color ?? MOULDED.color}
                              roughness={MOULDED.roughness}
                              metalness={MOULDED.metalness} {...m} />
      </RoundedBox>
      {/* The half-moon notch marking the pin-1 end. */}
      <mesh position={[mid.x - w / 2 + 0.05, bodyY + 0.6, mid.z]}
            rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[1.15, 1.15, 0.7, 18, 1, false, 0, Math.PI]} />
        <meshStandardMaterial color="#141417" roughness={0.8} {...m} />
      </mesh>
      <mesh position={[mid.x - w / 2 + 2.0, bodyY + 1.27, mid.z - d / 2 + 1.4]}
            rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.52, 14]} />
        <meshStandardMaterial color="#0d0d10" roughness={0.9} />
      </mesh>
      {!dimmed && (
        <mesh position={[mid.x, bodyY + 1.27, mid.z + 0.4]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[Math.min(w * 0.7, 3.2 * label.aspect), 3.2]} />
          <meshBasicMaterial map={label.tex} transparent depthWrite={false} toneMapped={false} />
        </mesh>
      )}
    </group>
  );
}

// -------------------------------------------------------------- transistor

/** TO-92: the flat face carries the part number and fixes the pinout. */
export function Transistor({ part, pins, dimmed }: BodyProps) {
  const mid = new THREE.Box3().setFromPoints(pins).getCenter(new THREE.Vector3());
  const m = look(dimmed);
  const body = useMemo(
    () => new THREE.ExtrudeGeometry(dShape(2.55, 1.85), bevel(4.6, 0.22)), []);
  const base = mid.y + 3.4;

  return (
    <group>
      {pins.map((p, i) => (
        <Lead key={i} from={p} to={v3(mid.x + (i - 1) * 1.1, base, mid.z)} rise={2.0} />
      ))}
      <mesh geometry={body} position={[mid.x, base, mid.z]}
            rotation={[-Math.PI / 2, 0, 0]} castShadow>
        <meshStandardMaterial color={part.color ?? "#1c1c20"}
                              roughness={0.56} metalness={0.03} {...m} />
      </mesh>
      {/* Domed crown, as moulded. */}
      <mesh position={[mid.x, base + 4.6, mid.z]} castShadow>
        <sphereGeometry args={[2.5, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={part.color ?? "#1c1c20"} roughness={0.56} {...m} />
      </mesh>
    </group>
  );
}

// ------------------------------------------------------------------ button

/** Tactile switch: four legs, moulded housing, round actuator. */
export function Button({ part, pins, dimmed }: BodyProps) {
  const box = new THREE.Box3().setFromPoints(pins);
  const mid = box.getCenter(new THREE.Vector3());
  const m = look(dimmed);
  const s = 6.0;
  const base = mid.y + 1.0;

  return (
    <group>
      {pins.map((p, i) => <Pin key={i} at={p} height={1.6} width={0.5} />)}
      <RoundedBox args={[s, 3.4, s]} radius={0.22} smoothness={3}
                  position={[mid.x, base + 1.7, mid.z]} castShadow>
        <meshStandardMaterial color={part.color ?? "#2b2b30"}
                              roughness={0.55} {...m} />
      </RoundedBox>
      <mesh position={[mid.x, base + 3.9, mid.z]} castShadow>
        <cylinderGeometry args={[1.75, 1.85, 1.6, 20]} />
        <meshStandardMaterial color="#1a1a1e" roughness={0.42} {...m} />
      </mesh>
      <mesh position={[mid.x, base + 4.7, mid.z]}>
        <sphereGeometry args={[1.75, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#232327" roughness={0.36} {...m} />
      </mesh>
    </group>
  );
}

// ------------------------------------------------------------ potentiometer

export function Potentiometer({ part, pins, dimmed }: BodyProps) {
  const mid = new THREE.Box3().setFromPoints(pins).getCenter(new THREE.Vector3());
  const m = look(dimmed);
  const base = mid.y + 1.0;

  return (
    <group>
      {pins.map((p, i) => <Pin key={i} at={p} height={2.0} width={0.5} />)}
      <RoundedBox args={[9.5, 4.2, 6.5]} radius={0.3} smoothness={3}
                  position={[mid.x, base + 2.1, mid.z]} castShadow>
        <meshStandardMaterial color={part.color ?? "#2f4fa8"} roughness={0.5} {...m} />
      </RoundedBox>
      <mesh position={[mid.x, base + 5.0, mid.z]} castShadow>
        <cylinderGeometry args={[2.0, 2.0, 2.0, 22]} />
        <meshStandardMaterial {...ALUMINIUM} {...m} />
      </mesh>
      <mesh position={[mid.x, base + 6.6, mid.z]} castShadow>
        <cylinderGeometry args={[1.5, 1.7, 3.2, 22]} />
        <meshStandardMaterial color="#d8dade" roughness={0.42} {...m} />
      </mesh>
      {/* Slot in the shaft, so its setting is visible at a glance. */}
      <mesh position={[mid.x, base + 8.21, mid.z]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[2.5, 0.5]} />
        <meshBasicMaterial color="#3a3a40" toneMapped={false} />
      </mesh>
    </group>
  );
}

// ------------------------------------------------------------------ module

/** Anything on a small carrier board: a sensor, a driver, a breakout. */
export function Module({ part, pins, dimmed }: BodyProps) {
  const box = new THREE.Box3().setFromPoints(pins);
  const size = box.getSize(new THREE.Vector3());
  const mid = box.getCenter(new THREE.Vector3());
  const w = Math.max(size.x, 12);
  const d = Math.max(size.z, 9);
  const m = look(dimmed);
  const base = mid.y + 3.2;

  const label = useMemo(
    () => textPlate(part.label.slice(0, 16), { bg: "rgba(0,0,0,0)", color: "#dfe3ea" }),
    [part.label]);

  return (
    <group>
      {pins.map((p, i) => <Pin key={i} at={p} height={3.0} width={0.5} />)}
      <mesh position={[mid.x, base, mid.z]} castShadow receiveShadow>
        <boxGeometry args={[w, 1.5, d]} />
        <meshStandardMaterial color={part.color ?? PCB_GREEN.color}
                              roughness={PCB_GREEN.roughness}
                              metalness={PCB_GREEN.metalness} {...m} />
      </mesh>
      {/* Header strip along the pin row. */}
      <mesh position={[mid.x, base + 1.4, mid.z - d / 2 + 1.3]} castShadow>
        <boxGeometry args={[w * 0.9, 1.4, 2.4]} />
        <meshStandardMaterial {...MOULDED} {...m} />
      </mesh>
      {/* A couple of parts on top, so it does not read as a blank tile. */}
      <mesh position={[mid.x - w * 0.18, base + 1.2, mid.z + d * 0.12]} castShadow>
        <boxGeometry args={[w * 0.28, 1.0, d * 0.3]} />
        <meshStandardMaterial color="#1b1b1f" roughness={0.5} {...m} />
      </mesh>
      <mesh position={[mid.x + w * 0.22, base + 1.05, mid.z + d * 0.16]} castShadow>
        <cylinderGeometry args={[1.0, 1.0, 0.7, 16]} />
        <meshStandardMaterial color="#9aa0ab" metalness={0.6} roughness={0.35} {...m} />
      </mesh>
      {!dimmed && (
        <mesh position={[mid.x, base + 0.78, mid.z + d * 0.3]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[Math.min(w * 0.72, 2.6 * label.aspect), 2.6]} />
          <meshBasicMaterial map={label.tex} transparent depthWrite={false} toneMapped={false} />
        </mesh>
      )}
    </group>
  );
}

// -------------------------------------------------------------------- wire

/** Jumper: insulated arc with bare tinned ends going into the holes. */
export function Wire({ part, pins, dimmed, highlighted }: BodyProps) {
  const { a, b, len } = span(pins);

  const geometry = useMemo(() => {
    // Two control points rather than one, so the run leaves each hole vertically
    // and flattens across the middle -- the shape a stripped jumper actually
    // takes. A single midpoint gives a circus tent.
    const lift = Math.min(3.4 + len * 0.26, 19);
    const up = new THREE.Vector3(0, 1, 0);
    const p0 = a.clone().addScaledVector(up, 2.4);
    const p3 = b.clone().addScaledVector(up, 2.4);
    const p1 = p0.clone().lerp(p3, 0.28).addScaledVector(up, lift);
    const p2 = p0.clone().lerp(p3, 0.72).addScaledVector(up, lift);
    const curve = new THREE.CubicBezierCurve3(p0, p1, p2, p3);
    return new THREE.TubeGeometry(curve, 42, 0.52, 10, false);
  }, [a, b, len]);

  const colour = part.color ?? "#2f7fff";
  return (
    <group>
      <WireTip at={a} />
      <WireTip at={b} />
      <mesh geometry={geometry} castShadow>
        <meshStandardMaterial color={colour} roughness={0.38} metalness={0.04}
                              emissive={highlighted ? colour : "#000000"}
                              emissiveIntensity={highlighted ? 0.4 : 0}
                              {...look(dimmed)} />
      </mesh>
    </group>
  );
}

/** Fallback: a labelled block sized to whatever holes it covers. */
export function GenericBody({ part, pins, dimmed }: BodyProps) {
  const box = new THREE.Box3().setFromPoints(pins);
  const size = box.getSize(new THREE.Vector3());
  const mid = box.getCenter(new THREE.Vector3());
  const m = look(dimmed);

  return (
    <group>
      {pins.map((p, i) => (
        <Lead key={i} from={p} to={v3(p.x, p.y + 3.4, p.z)} rise={2.2} />
      ))}
      <RoundedBox args={[Math.max(size.x, 5.5), 3.4, Math.max(size.z, 5.5)]}
                  radius={0.25} smoothness={3}
                  position={[mid.x, mid.y + 5.0, mid.z]} castShadow>
        <meshStandardMaterial color={part.color ?? "#3f8a63"} roughness={0.55} {...m} />
      </RoundedBox>
    </group>
  );
}
