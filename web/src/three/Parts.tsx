import { useMemo } from "react";
import * as THREE from "three";
import { holePosition, externalPosition, type Vec3 } from "../lib/breadboard";
import { resistorBands } from "./labels";
import type { Part } from "../lib/types";

const LEAD_COLOR = "#b9bcc2";
const LEAD_R = 0.28;

const v = (p: Vec3) => new THREE.Vector3(p.x, p.y, p.z);

/** A straight lead from a hole up to the body. */
function Lead({ from, to }: { from: THREE.Vector3; to: THREE.Vector3 }) {
  const { pos, quat, len } = useMemo(() => {
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    const quat = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    return { pos: new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5), quat, len };
  }, [from, to]);

  return (
    <mesh position={pos} quaternion={quat} castShadow>
      <cylinderGeometry args={[LEAD_R, LEAD_R, len, 6]} />
      <meshStandardMaterial color={LEAD_COLOR} metalness={0.8} roughness={0.35} />
    </mesh>
  );
}

/**
 * Resolve a part's pins to positions.
 *
 * Anything that isn't a valid hole is treated as an off-board endpoint (an
 * Arduino pin, a battery lead) and anchored off the front edge, aligned with
 * the nearest pin that did resolve. Dropping those parts instead would make
 * wires to the Arduino silently vanish from the board.
 */
function pinPositions(part: Part): THREE.Vector3[] | null {
  const resolved = part.pins.map((ref) => holePosition(ref));
  const onBoard = resolved.find((p): p is Vec3 => p !== null) ?? null;

  const out = resolved.map((p, i) => {
    if (p) return v(p);
    // Align the anchor with a sibling pin so the wire runs sensibly.
    const sibling = resolved[i === 0 ? resolved.length - 1 : 0] ?? onBoard;
    return v(externalPosition(sibling ?? onBoard));
  });

  // A part with no on-board pin at all has nothing to attach to.
  return onBoard && out.length ? out : null;
}

export function PartMesh({ part, dimmed, highlighted }: {
  part: Part; dimmed?: boolean; highlighted?: boolean;
}) {
  const pins = pinPositions(part);
  if (!pins) return null;

  // Posts mark where a wire leaves the board, so an off-board connection
  // reads as deliberate rather than a wire trailing into nothing.
  const anchors = part.pins
    .map((ref, i) => (holePosition(ref) === null ? pins[i] : null))
    .filter((p): p is THREE.Vector3 => p !== null);

  const opacity = dimmed ? 0.25 : 1;
  const emissive = highlighted ? "#ffcc00" : "#000000";
  const common = {
    opacity,
    transparent: !!dimmed,
    emissive,
    emissiveIntensity: highlighted ? 0.45 : 0,
  };

  const body = (() => {
  switch (part.kind) {
    case "wire":      return <Wire part={part} pins={pins} {...common} />;
    case "led":       return <Led part={part} pins={pins} {...common} />;
    case "resistor":  return <Resistor part={part} pins={pins} {...common} />;
    case "capacitor": return <Capacitor part={part} pins={pins} {...common} />;
    case "ic":        return <Dip part={part} pins={pins} {...common} />;
    default:          return <GenericBody part={part} pins={pins} {...common} />;
  }
  })();

  return (
    <group>
      {body}
      {anchors.map((a, i) => (
        <mesh key={`anchor-${i}`} position={[a.x, a.y + 1.5, a.z]} castShadow>
          <cylinderGeometry args={[1.5, 1.9, 3, 10]} />
          <meshStandardMaterial color="#5c6069" roughness={0.6} metalness={0.4} />
        </mesh>
      ))}
    </group>
  );
}

type BodyProps = {
  part: Part; pins: THREE.Vector3[];
  opacity: number; transparent: boolean; emissive: string; emissiveIntensity: number;
};

/** Jumper wire: an arc between two holes, height scaled to the span. */
function Wire({ part, pins, opacity, transparent, emissive, emissiveIntensity }: BodyProps) {
  const geo = useMemo(() => {
    const [a, b] = [pins[0], pins[pins.length - 1]];
    const span = a.distanceTo(b);
    const direction = b.clone().sub(a);
    const side = new THREE.Vector3(-direction.z, 0, direction.x).normalize().multiplyScalar(Math.min(span * .04, 1.4));
    const lift = Math.min(4 + span * .18, 16);
    const curve = new THREE.CatmullRomCurve3([
      a, a.clone().lerp(b, .2).add(new THREE.Vector3(0, lift * .7, 0)).add(side),
      a.clone().lerp(b, .5).add(new THREE.Vector3(0, lift, 0)),
      a.clone().lerp(b, .8).add(new THREE.Vector3(0, lift * .7, 0)).sub(side), b,
    ], false, "centripetal", .35);
    return new THREE.TubeGeometry(curve, 40, 0.48, 10, false);
  }, [pins]);

  return (
    <group>
    <mesh geometry={geo} castShadow>
      <meshStandardMaterial color={part.color ?? "#2f7fff"} roughness={0.45}
        opacity={opacity} transparent={transparent}
        emissive={emissive} emissiveIntensity={emissiveIntensity} />
    </mesh>
    {[pins[0], pins[pins.length - 1]].map((point, index) => (
      <group key={index} position={[point.x, point.y + .9, point.z]}>
        <mesh><cylinderGeometry args={[.72, .62, 1.8, 10]} />
          <meshStandardMaterial color={part.color ?? "#2f7fff"} roughness={.42} /></mesh>
        <mesh position={[0, -1.05, 0]}><cylinderGeometry args={[.3, .3, .75, 8]} />
          <meshStandardMaterial color="#cfd3d8" metalness={.86} roughness={.2} /></mesh>
      </group>
    ))}
    </group>
  );
}

/** Axial resistor: a turned body with correctly coded colour bands. */
function Resistor({ part, pins, opacity, transparent, emissive, emissiveIntensity }: BodyProps) {
  const [a, b] = [pins[0], pins[pins.length - 1]];
  const h = 5.2;
  const top = (p: THREE.Vector3) => new THREE.Vector3(p.x, p.y + h, p.z);
  const [ta, tb] = [top(a), top(b)];
  const mid = new THREE.Vector3().addVectors(ta, tb).multiplyScalar(0.5);
  const dir = new THREE.Vector3().subVectors(tb, ta);
  const quat = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  const bodyLen = Math.max(dir.length() * 0.52, 4.2);

  // Real bands when the value was read; neutral grey when it was not, so an
  // unreadable resistor never displays a confident-looking wrong value.
  const bands = resistorBands(part.value) ?? ["#8a8a8a", "#8a8a8a", "#8a8a8a"];

  // A lathe profile gives the pinched ends of a real axial resistor.
  const profile = useMemo(() => {
    const r = 1.15;
    return [
      new THREE.Vector2(0.34, -bodyLen / 2),
      new THREE.Vector2(r * 0.72, -bodyLen / 2 + 0.35),
      new THREE.Vector2(r, -bodyLen / 2 + 1.0),
      new THREE.Vector2(r, bodyLen / 2 - 1.0),
      new THREE.Vector2(r * 0.72, bodyLen / 2 - 0.35),
      new THREE.Vector2(0.34, bodyLen / 2),
    ];
  }, [bodyLen]);

  return (
    <group>
      <Lead from={a} to={ta} /><Lead from={b} to={tb} />
      <mesh position={mid} quaternion={quat} castShadow>
        <latheGeometry args={[profile, 20]} />
        <meshStandardMaterial color={part.color ?? "#cdb387"} roughness={0.45}
          opacity={opacity} transparent={transparent}
          emissive={emissive} emissiveIntensity={emissiveIntensity} />
      </mesh>
      {bands.map((c, i) => {
        const t = (i - (bands.length - 1) / 2) * 0.9;
        return (
          <mesh key={i} position={mid.clone().addScaledVector(
                  dir.clone().normalize(), t)} quaternion={quat}>
            <cylinderGeometry args={[1.2, 1.2, 0.62, 20]} />
            <meshStandardMaterial color={c} roughness={0.5}
              opacity={opacity} transparent={transparent} />
          </mesh>
        );
      })}
    </group>
  );
}

/** LED: domed body on the anode side, flat-cut cathode. */
function Led({ part, pins, opacity, emissive, emissiveIntensity }: BodyProps) {
  const [a, b] = [pins[0], pins[pins.length - 1]];
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  const h = 7;
  return (
    <group>
      <Lead from={a} to={new THREE.Vector3(mid.x, a.y + h * 0.7, mid.z)} />
      <Lead from={b} to={new THREE.Vector3(mid.x, b.y + h * 0.45, mid.z)} />
      <mesh position={[mid.x, mid.y + h, mid.z]} castShadow>
        <sphereGeometry args={[2.1, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={part.color ?? "#ff3b30"} roughness={0.25}
          transparent opacity={opacity * 0.85}
          emissive={part.color ?? "#ff3b30"} emissiveIntensity={emissiveIntensity + 0.25} />
      </mesh>
      <mesh position={[mid.x, mid.y + h - 1.4, mid.z]} castShadow>
        <cylinderGeometry args={[2.1, 2.1, 2.8, 24]} />
        <meshStandardMaterial color={part.color ?? "#ff3b30"} roughness={0.22}
          transparent opacity={opacity * 0.82}
          emissive={emissive} emissiveIntensity={emissiveIntensity} />
      </mesh>
      {/* Base flange -- the flat rim every 5mm LED has, and the cathode marker. */}
      <mesh position={[mid.x, mid.y + h - 2.9, mid.z]} castShadow>
        <cylinderGeometry args={[2.45, 2.45, 0.6, 24]} />
        <meshStandardMaterial color={part.color ?? "#ff3b30"} roughness={0.35}
          transparent opacity={opacity * 0.9} />
      </mesh>
    </group>
  );
}

/** Ceramic capacitor: the classic orange-brown disc. */
function Capacitor({ part, pins, opacity, transparent, emissive, emissiveIntensity }: BodyProps) {
  const [a, b] = [pins[0], pins[pins.length - 1]];
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  const h = 6;
  return (
    <group>
      <Lead from={a} to={new THREE.Vector3(mid.x, a.y + h * 0.6, mid.z)} />
      <Lead from={b} to={new THREE.Vector3(mid.x, b.y + h * 0.6, mid.z)} />
      <mesh position={[mid.x, mid.y + h, mid.z]} castShadow>
        <cylinderGeometry args={[2.6, 2.6, 1.1, 18]} />
        <meshStandardMaterial color={part.color ?? "#c8791f"} roughness={0.7}
          opacity={opacity} transparent={transparent}
          emissive={emissive} emissiveIntensity={emissiveIntensity} />
      </mesh>
    </group>
  );
}

/** DIP chip: black body straddling the centre channel, pin 1 marked. */
function Dip({ part, pins, opacity, transparent, emissive, emissiveIntensity }: BodyProps) {
  const box = new THREE.Box3().setFromPoints(pins);
  const size = box.getSize(new THREE.Vector3());
  const mid = box.getCenter(new THREE.Vector3());
  const w = Math.max(size.x, 6), d = Math.max(size.z, 6);
  return (
    <group>
      {pins.map((p, i) => (
        <Lead key={i} from={p} to={new THREE.Vector3(p.x, p.y + 2.6, p.z)} />
      ))}
      <mesh position={[mid.x, mid.y + 3.6, mid.z]} castShadow>
        <boxGeometry args={[w, 2.2, d * 0.72]} />
        <meshStandardMaterial color={part.color ?? "#232326"} roughness={0.55}
          opacity={opacity} transparent={transparent}
          emissive={emissive} emissiveIntensity={emissiveIntensity} />
      </mesh>
      <mesh position={[mid.x - w / 2 + 1.2, mid.y + 4.75, mid.z]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.6, 12]} />
        <meshBasicMaterial color="#8e8e93" />
      </mesh>
    </group>
  );
}

/** Anything we don't model specifically: a labelled box over its pins. */
function GenericBody({ part, pins, opacity, transparent, emissive, emissiveIntensity }: BodyProps) {
  const box = new THREE.Box3().setFromPoints(pins);
  const size = box.getSize(new THREE.Vector3());
  const mid = box.getCenter(new THREE.Vector3());
  return (
    <group>
      {pins.map((p, i) => (
        <Lead key={i} from={p} to={new THREE.Vector3(p.x, p.y + 3, p.z)} />
      ))}
      <mesh position={[mid.x, mid.y + 4.5, mid.z]} castShadow>
        <boxGeometry args={[Math.max(size.x, 5), 3, Math.max(size.z, 5)]} />
        <meshStandardMaterial color={part.color ?? "#3a7d5a"} roughness={0.6}
          opacity={opacity} transparent={transparent}
          emissive={emissive} emissiveIntensity={emissiveIntensity} />
      </mesh>
    </group>
  );
}
