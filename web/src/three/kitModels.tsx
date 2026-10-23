import { useMemo } from "react";
import * as THREE from "three";
import { RoundedBox, Text } from "@react-three/drei";
import { ALUMINIUM, MOULDED, PCB_GREEN, bevel, dShape } from "./materials";
import { resistorBands } from "./labels";
import { Lead } from "./leads";
import { PITCH } from "../lib/breadboard";
import { GlbModel, preloadModel } from "./GlbModel";
import unoPins from "./uno-r3.pins.json";
import servoPorts from "./micro-servo.ports.json";

/**
 * Detailed, free-standing models of the 29 starter-kit parts.
 *
 * Separate from bodies.tsx because the two are driven differently. Those models
 * are built from breadboard hole positions -- a resistor spans E22 to E26 and
 * its length follows from that. These sit wherever the student drops them, so
 * they are centred on the origin at their real size and carry their own legs.
 *
 * Everything is in millimetres at true scale, so a part looks right next to the
 * board without a fudge factor. What is modelled on each one is whatever you
 * would actually look for: the flat on an LED, the stripe on an electrolytic,
 * the notch on a chip, the bands on a resistor.
 */

export interface ModelProps {
  /** Kit part id, for the variations that depend on it. */
  id: string;
  color: string;
  /** Yellow rim while the part is selected on the canvas. */
  selected?: boolean;
}

function useSelectionGlow(selected?: boolean) {
  return selected
    ? { emissive: "#ffcc00", emissiveIntensity: 0.32 }
    : { emissive: "#000000", emissiveIntensity: 0 };
}

/** A round through-hole lead. */
function Leg({ x = 0, z = 0, length = 5, radius = 0.3 }) {
  return (
    <mesh position={[x, -length / 2, z]} castShadow>
      <cylinderGeometry args={[radius, radius * 0.85, length, 8]} />
      <meshStandardMaterial color="#c6cad2" metalness={0.9} roughness={0.28} />
    </mesh>
  );
}

/** A stamped, flat pin: chips, headers, modules. */
function FlatPin({ x = 0, z = 0, length = 4.5, width = 0.5 }) {
  return (
    <mesh position={[x, -length / 2, z]} castShadow>
      <boxGeometry args={[width, length, width * 0.62]} />
      <meshStandardMaterial color="#b8bcc4" metalness={0.85} roughness={0.36} />
    </mesh>
  );
}

/** Black header shroud with gold pins, the thing on every breakout board. */
function Header({ count, spacing = 2.54, z = 0, rows = 1 }: {
  count: number; spacing?: number; z?: number; rows?: number;
}) {
  const w = count * spacing;
  return (
    <group position={[0, 0, z]}>
      <mesh position={[0, 1.2, 0]} castShadow>
        <boxGeometry args={[w, 2.4, rows * spacing]} />
        <meshStandardMaterial {...MOULDED} />
      </mesh>
      {Array.from({ length: count }, (_, i) =>
        Array.from({ length: rows }, (_, r) => (
          <mesh key={`${i}-${r}`} castShadow
                position={[-w / 2 + spacing / 2 + i * spacing, 3.6,
                           (r - (rows - 1) / 2) * spacing]}>
            <boxGeometry args={[0.64, 6, 0.64]} />
            <meshStandardMaterial color="#d8b25a" metalness={0.85} roughness={0.3} />
          </mesh>
        )))}
    </group>
  );
}

// ------------------------------------------------------------------- boards

export const UNO_URL = "/models/uno-r3.glb";
preloadModel(UNO_URL);

/**
 * Where the CAD Uno is drawn relative to its origin: its lowest point (the pin
 * tails underneath) sits where the old primitive's underside did.
 */
const UNO_OFFSET: [number, number, number] = [0, -0.9, 0];

/** A header socket opening on the Uno, by the name printed beside it. */
export function unoPin(name: string): { x: number; y: number; z: number } | undefined {
  const pin = (unoPins.pins as Record<string, { x: number; y: number; z: number }>)[name];
  return pin && { x: pin.x + UNO_OFFSET[0], y: pin.y + UNO_OFFSET[1], z: pin.z + UNO_OFFSET[2] };
}

/**
 * Arduino Uno R3, built from Arduino's released board file with KiCad's models
 * of the parts on it (scripts/models/uno.mjs).
 */
export function UnoModel({ selected, ...props }: ModelProps) {
  return <GlbModel url={UNO_URL} selected={selected} glow={["uno-pcb", "uno-pcb-edge"]}
                   position={UNO_OFFSET} fallback={<UnoPrimitive selected={selected} {...props} />} />;
}

/** The hand-built Uno, shown while the CAD model loads. */
function UnoPrimitive({ selected }: ModelProps) {
  const glow = useSelectionGlow(selected);
  return (
    <group>
      <RoundedBox args={[68.6, 1.8, 53.3]} radius={1.6} smoothness={3} castShadow receiveShadow>
        <meshStandardMaterial color="#0d7d8c" roughness={0.55} metalness={0.08} {...glow} />
      </RoundedBox>
      {/* USB-B jack: the big silver box everyone recognises. */}
      <mesh position={[-28, 4.2, 14]} castShadow>
        <boxGeometry args={[16, 11, 12]} />
        <meshStandardMaterial {...ALUMINIUM} />
      </mesh>
      {/* Barrel jack. */}
      <mesh position={[-28, 3.4, -14]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[4.6, 4.6, 13, 20]} />
        <meshStandardMaterial color="#0e0f12" roughness={0.5} />
      </mesh>
      {/* The ATmega328P in its socket, and the crystal beside it. */}
      <mesh position={[6, 2.6, -6]} castShadow>
        <boxGeometry args={[35, 3.4, 8]} />
        <meshStandardMaterial {...MOULDED} />
      </mesh>
      <mesh position={[-6, 2.2, 4]} castShadow>
        <boxGeometry args={[5, 2.6, 9]} />
        <meshStandardMaterial {...ALUMINIUM} />
      </mesh>
      {/* Reset button. */}
      <mesh position={[-24, 2.6, 21]} castShadow>
        <boxGeometry args={[5, 3, 5]} />
        <meshStandardMaterial color="#b02a2a" roughness={0.45} />
      </mesh>
      <group position={[-14, 0, 0]}><Header count={10} z={24} /><Header count={8} z={-24} /></group>
      <group position={[14, 0, 0]}><Header count={8} z={24} /><Header count={6} z={-24} /></group>
      <Text position={[12, 0.95, 20]} rotation={[-Math.PI / 2, 0, 0]}
            fontSize={4.5} color="#dff6f8" anchorX="center">UNO</Text>
    </group>
  );
}

/** A miniature breadboard, matching the real one's proportions. */
export function BreadboardModel({ selected }: ModelProps) {
  const glow = useSelectionGlow(selected);
  const holes = useMemo(() => {
    const out: [number, number][] = [];
    for (let c = 0; c < 20; c++) {
      for (const z of [-7.6, -5.1, -2.5, 2.5, 5.1, 7.6]) out.push([-24 + c * 2.54, z]);
    }
    return out;
  }, []);
  return (
    <group>
      <RoundedBox args={[54, 3, 22]} radius={1.2} smoothness={3} castShadow receiveShadow>
        <meshStandardMaterial color="#e6e3da" roughness={0.68} {...glow} />
      </RoundedBox>
      {/* Centre channel. */}
      <mesh position={[0, 1.2, 0]}>
        <boxGeometry args={[52, 1.2, 2.6]} />
        <meshStandardMaterial color="#c4c0b6" roughness={0.85} />
      </mesh>
      {holes.map(([x, z], i) => (
        <mesh key={i} position={[x, 1.2, z]}>
          <boxGeometry args={[0.9, 0.8, 0.9]} />
          <meshStandardMaterial color="#4a4a52" roughness={0.9} metalness={0.2} />
        </mesh>
      ))}
      {[[-9.9, "#d4453b"], [9.9, "#3b6fd4"]].map(([z, c]) => (
        <mesh key={String(z)} position={[0, 1.55, z as number]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[50, 0.5]} />
          <meshBasicMaterial color={c as string} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

// ------------------------------------------------------------------ outputs

/** 5 mm LED. The flat on the flange is the cathode marker. */
function LedPrimitive({ id, color, selected }: ModelProps) {
  const glow = useSelectionGlow(selected);
  const flange = useMemo(() => new THREE.ExtrudeGeometry(dShape(2.9, 2.4), bevel(0.8, 0.1)), []);
  const rgb = id === "rgb-led";
  return (
    <group>
      {/* RGB packages have four legs; the long one is the common pin. */}
      {(rgb ? [-1.9, -0.6, 0.6, 1.9] : [-1.2, 1.2]).map((x, i) => (
        <Leg key={x} x={x} length={i === 0 ? 7 : 5.5} />
      ))}
      <mesh geometry={flange} position={[0, 0.5, 0]} rotation={[-Math.PI / 2, 0, 0]} castShadow>
        <meshStandardMaterial color={color} roughness={0.3} transparent opacity={0.9} {...glow} />
      </mesh>
      <mesh position={[0, 3.3, 0]} castShadow>
        <cylinderGeometry args={[2.5, 2.5, 5.2, 28]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.45}
                              roughness={0.3} transparent opacity={0.74} />
      </mesh>
      <mesh position={[0, 5.9, 0]} castShadow>
        <sphereGeometry args={[2.5, 28, 18, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.4}
                              roughness={0.16} transparent opacity={0.7} />
      </mesh>
      {/* The cup and post inside, visible through the epoxy. */}
      <mesh position={[-0.85, 4.0, 0]}>
        <cylinderGeometry args={[0.72, 0.5, 1.5, 12]} />
        <meshStandardMaterial color="#6d7078" metalness={0.8} roughness={0.35} />
      </mesh>
      <mesh position={[0.85, 3.6, 0]}>
        <boxGeometry args={[0.5, 2.4, 0.5]} />
        <meshStandardMaterial color="#6d7078" metalness={0.8} roughness={0.35} />
      </mesh>
    </group>
  );
}

/** 16x2 character LCD, or a 7-segment digit. */
function DisplayPrimitive({ id, color, selected }: ModelProps) {
  const glow = useSelectionGlow(selected);
  if (id === "seven-segment") {
    // Seven bars and a point, laid out as the real digit.
    const bars: [number, number, number, number][] = [
      [0, 7.5, 5, 1.2], [0, -7.5, 5, 1.2], [0, 0, 5, 1.2],
      [-3.4, 3.8, 1.2, 6], [3.4, 3.8, 1.2, 6],
      [-3.4, -3.8, 1.2, 6], [3.4, -3.8, 1.2, 6],
    ];
    return (
      <group>
        <RoundedBox args={[13, 4, 19]} radius={0.5} smoothness={3} castShadow>
          <meshStandardMaterial color="#1a1a1e" roughness={0.6} {...glow} />
        </RoundedBox>
        {bars.map(([x, z, w, d], i) => (
          <mesh key={i} position={[x, 2.05, -z]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[w, d]} />
            <meshBasicMaterial color="#e8362c" toneMapped={false} />
          </mesh>
        ))}
        <mesh position={[5.2, 2.05, 7.5]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.8, 12]} />
          <meshBasicMaterial color="#e8362c" toneMapped={false} />
        </mesh>
        {[-1, 1].flatMap((s) => Array.from({ length: 5 }, (_, i) =>
          <FlatPin key={`${s}-${i}`} x={-5 + i * 2.54} z={s * 9} />))}
      </group>
    );
  }
  return (
    <group>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[80, 1.6, 36]} />
        <meshStandardMaterial {...PCB_GREEN} {...glow} />
      </mesh>
      {/* Bezel and the lit glass inside it. */}
      <mesh position={[0, 3.4, -1]} castShadow>
        <boxGeometry args={[71, 5, 25]} />
        <meshStandardMaterial {...ALUMINIUM} />
      </mesh>
      <mesh position={[0, 6.0, -1]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[64, 17]} />
        <meshStandardMaterial color={color} emissive="#1d6b4a" emissiveIntensity={0.6}
                              roughness={0.35} />
      </mesh>
      <Text position={[0, 6.1, -3]} rotation={[-Math.PI / 2, 0, 0]}
            fontSize={2.6} color="#c9f7a8" anchorX="center">HELLO, ARDUINO</Text>
      <Header count={16} z={16} />
    </group>
  );
}

/** Piezo buzzer: a sealed can with the sound hole in the top. */
function BuzzerPrimitive({ color, selected }: ModelProps) {
  const glow = useSelectionGlow(selected);
  return (
    <group>
      <Leg x={-2.5} /><Leg x={2.5} />
      <mesh position={[0, 4.5, 0]} castShadow>
        <cylinderGeometry args={[6, 6, 9, 32]} />
        <meshStandardMaterial color={color} roughness={0.55} {...glow} />
      </mesh>
      <mesh position={[0, 9.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[5.9, 32]} />
        <meshStandardMaterial color="#141416" roughness={0.7} />
      </mesh>
      <mesh position={[0, 9.06, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1.1, 20]} />
        <meshBasicMaterial color="#000000" toneMapped={false} />
      </mesh>
    </group>
  );
}

// ------------------------------------------------------------------ passive

/**
 * Axial resistor, seated the way one actually sits on a breadboard.
 *
 * The body lies flat and the leads bend ninety degrees down into the holes two
 * pitches either side of centre. Rotating the whole part to lay the body down
 * -- the obvious way to build it -- takes the legs with it, so they end up
 * pointing sideways into the air and the part never meets the board.
 */
function ResistorPrimitive({ id, color, selected }: ModelProps) {
  const glow = useSelectionGlow(selected);
  const value = id === "resistor-220" ? "220 ohm" : id === "resistor-1k" ? "1k" : "10k";
  const bands = resistorBands(value) ?? ["#8d8d93", "#8d8d93", "#8d8d93"];

  const SPAN = PITCH * 2;              // legs land four columns apart
  const RIDE = 3.2;                    // how high the body sits above the board
  const HALF = 3.1;                    // half the body length

  const profile = useMemo(() => {
    const r = 1.25;
    return [
      new THREE.Vector2(0.3, -HALF), new THREE.Vector2(r * 0.7, -HALF + 0.5),
      new THREE.Vector2(r, -HALF + 1.1), new THREE.Vector2(r, HALF - 1.1),
      new THREE.Vector2(r * 0.7, HALF - 0.5), new THREE.Vector2(0.3, HALF),
    ];
  }, []);

  return (
    <group>
      {[-1, 1].map((side) => (
        <Lead key={side} rise={1.6}
              from={new THREE.Vector3(side * SPAN, -5, 0)}
              to={new THREE.Vector3(side * HALF, RIDE, 0)} />
      ))}
      <group position={[0, RIDE, 0]} rotation={[0, 0, Math.PI / 2]}>
        <mesh castShadow>
          <latheGeometry args={[profile, 26]} />
          <meshStandardMaterial color={color} roughness={0.42} {...glow} />
        </mesh>
        {bands.map((c, i) => {
          const tolerance = i === bands.length - 1 && bands.length === 4;
          return (
            <mesh key={i} position={[0, tolerance ? 1.9 : (i - 1) * 0.95 - 0.6, 0]}>
              <cylinderGeometry args={[1.3, 1.3, tolerance ? 0.5 : 0.62, 26]} />
              <meshStandardMaterial color={c} roughness={tolerance ? 0.3 : 0.5}
                                    metalness={tolerance ? 0.55 : 0.05} />
            </mesh>
          );
        })}
      </group>
    </group>
  );
}

/** Radial electrolytic: can, crimp, vent score and the negative stripe. */
function CapacitorPrimitive({ color, selected }: ModelProps) {
  const glow = useSelectionGlow(selected);
  const h = 11, r = 3.2;
  return (
    <group>
      <Leg x={-1.2} /><Leg x={1.2} />
      <mesh position={[0, h / 2, 0]} castShadow>
        <cylinderGeometry args={[r, r, h, 28]} />
        <meshStandardMaterial color={color} roughness={0.38} metalness={0.25} {...glow} />
      </mesh>
      <mesh position={[0, h - 0.9, 0]}>
        <torusGeometry args={[r * 0.96, 0.28, 8, 28]} />
        <meshStandardMaterial {...ALUMINIUM} />
      </mesh>
      <mesh position={[0, h + 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[r * 0.93, 28]} />
        <meshStandardMaterial {...ALUMINIUM} />
      </mesh>
      {[0, Math.PI / 2].map((rot) => (
        <mesh key={rot} position={[0, h + 0.06, 0]} rotation={[-Math.PI / 2, 0, rot]}>
          <planeGeometry args={[r * 1.7, 0.34]} />
          <meshBasicMaterial color="#6f747c" toneMapped={false} />
        </mesh>
      ))}
      <mesh position={[-r * 0.99, h / 2, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[2.0, h * 0.85]} />
        <meshBasicMaterial color="#cfd3da" toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

// ------------------------------------------------------------------- inputs

/** Tactile switch: housing, actuator, four bent legs. */
function ButtonPrimitive({ color, selected }: ModelProps) {
  const glow = useSelectionGlow(selected);
  return (
    <group>
      {[[-2.5, -3.2], [2.5, -3.2], [-2.5, 3.2], [2.5, 3.2]].map(([x, z]) => (
        <FlatPin key={`${x}-${z}`} x={x} z={z} length={3.4} />
      ))}
      <RoundedBox args={[6, 3.4, 6]} radius={0.25} smoothness={3} position={[0, 1.7, 0]} castShadow>
        <meshStandardMaterial color={color} roughness={0.5} {...glow} />
      </RoundedBox>
      <mesh position={[0, 3.9, 0]} castShadow>
        <cylinderGeometry args={[1.75, 1.85, 1.6, 22]} />
        <meshStandardMaterial color="#141418" roughness={0.42} />
      </mesh>
      <mesh position={[0, 4.7, 0]}>
        <sphereGeometry args={[1.75, 22, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#1d1d21" roughness={0.36} />
      </mesh>
    </group>
  );
}

/** Potentiometer with a slotted shaft, so its setting reads at a glance. */
function KnobPrimitive({ color, selected }: ModelProps) {
  const glow = useSelectionGlow(selected);
  return (
    <group>
      {[-2.54, 0, 2.54].map((x) => <FlatPin key={x} x={x} z={-3.5} length={4} />)}
      <RoundedBox args={[9.5, 4.2, 6.5]} radius={0.3} smoothness={3} position={[0, 2.1, 0]} castShadow>
        <meshStandardMaterial color={color} roughness={0.5} {...glow} />
      </RoundedBox>
      <mesh position={[0, 5.0, 0]} castShadow>
        <cylinderGeometry args={[3.4, 3.4, 1.8, 24]} />
        <meshStandardMaterial {...ALUMINIUM} />
      </mesh>
      <mesh position={[0, 7.4, 0]} castShadow>
        <cylinderGeometry args={[1.5, 1.7, 3.2, 22]} />
        <meshStandardMaterial color="#d8dade" roughness={0.42} />
      </mesh>
      <mesh position={[0, 9.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[2.5, 0.5]} />
        <meshBasicMaterial color="#3a3a40" toneMapped={false} />
      </mesh>
    </group>
  );
}

/** IR remote: a moulded slab of buttons. */
export function RemoteModel({ color, selected }: ModelProps) {
  const glow = useSelectionGlow(selected);
  return (
    <group>
      <RoundedBox args={[38, 6, 86]} radius={3} smoothness={4} castShadow receiveShadow>
        <meshStandardMaterial color={color} roughness={0.45} {...glow} />
      </RoundedBox>
      {/* IR window at the top. */}
      <mesh position={[0, 3.1, -38]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[14, 6]} />
        <meshStandardMaterial color="#1a0d0d" roughness={0.25} metalness={0.2} />
      </mesh>
      {Array.from({ length: 21 }, (_, i) => {
        const col = i % 3, row = Math.floor(i / 3);
        const power = i === 0;
        return (
          <mesh key={i} castShadow
                position={[-9 + col * 9, 3.4, -24 + row * 9.5]}>
            <cylinderGeometry args={[3.2, 3.4, 1.4, 20]} />
            <meshStandardMaterial color={power ? "#c23a32" : "#8d939c"} roughness={0.42} />
          </mesh>
        );
      })}
    </group>
  );
}

// ------------------------------------------------------------------ sensors

function SensorPrimitive({ id, color, selected }: ModelProps) {
  const glow = useSelectionGlow(selected);

  if (id === "ultrasonic") {
    return (
      <group>
        <mesh position={[0, 1, 0]} castShadow receiveShadow>
          <boxGeometry args={[45, 1.6, 20]} />
          <meshStandardMaterial color="#1d4f8c" roughness={0.6} {...glow} />
        </mesh>
        {/* The two transducer cans are the whole silhouette of this part. */}
        {[-12, 12].map((x) => (
          <group key={x} position={[x, 9.5, 0]}>
            <mesh castShadow>
              <cylinderGeometry args={[8, 8, 12, 28]} />
              <meshStandardMaterial {...ALUMINIUM} />
            </mesh>
            <mesh position={[0, 6.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[7.6, 28]} />
              <meshStandardMaterial color="#8e949c" roughness={0.5} metalness={0.5} />
            </mesh>
          </group>
        ))}
        <mesh position={[0, 4, 0]} castShadow>
          <boxGeometry args={[9, 4.5, 5]} />
          <meshStandardMaterial {...ALUMINIUM} />
        </mesh>
        <Header count={4} z={8} />
      </group>
    );
  }

  if (id === "tilt-switch") {
    return (
      <group>
        <Leg x={-1.2} /><Leg x={1.2} />
        <mesh position={[0, 5, 0]} castShadow>
          <cylinderGeometry args={[2.3, 2.3, 9, 22]} />
          <meshStandardMaterial {...ALUMINIUM} {...glow} />
        </mesh>
        <mesh position={[0, 9.6, 0]}>
          <sphereGeometry args={[2.3, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial {...ALUMINIUM} />
        </mesh>
      </group>
    );
  }

  if (id === "photoresistor") {
    return (
      <group>
        <Leg x={-1.6} /><Leg x={1.6} />
        <mesh position={[0, 2.4, 0]} castShadow>
          <cylinderGeometry args={[2.6, 2.6, 1.6, 26]} />
          <meshStandardMaterial color="#e2e4e8" roughness={0.5} {...glow} />
        </mesh>
        {/* The serpentine CdS track: the reason this part is recognisable. */}
        <mesh position={[0, 3.22, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[2.5, 26]} />
          <meshStandardMaterial color="#e9c25a" roughness={0.45} />
        </mesh>
        {[-1.4, -0.7, 0, 0.7, 1.4].map((z) => (
          <mesh key={z} position={[0, 3.26, z]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[4.2, 0.28]} />
            <meshBasicMaterial color="#3d3226" toneMapped={false} />
          </mesh>
        ))}
      </group>
    );
  }

  // Thermistor: a small epoxy bead on two legs.
  return (
    <group>
      <Leg x={-1.1} /><Leg x={1.1} />
      <mesh position={[0, 2.6, 0]} castShadow scale={[1, 1.15, 0.6]}>
        <sphereGeometry args={[2.3, 20, 14]} />
        <meshStandardMaterial color={color} roughness={0.42} {...glow} />
      </mesh>
    </group>
  );
}

// ------------------------------------------------------------------- motion

/** Micro servo, hand-built: shown while the CAD model loads. */
function ServoPrimitive({ color, selected }: ModelProps) {
  const glow = useSelectionGlow(selected);
  const cable = useMemo(() => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-11, 6, 0), new THREE.Vector3(-18, 5, 3),
      new THREE.Vector3(-25, 3, -2), new THREE.Vector3(-32, 2, 2),
    ]);
    return new THREE.TubeGeometry(curve, 24, 0.9, 8, false);
  }, []);
  return (
    <group>
      <RoundedBox args={[22.8, 16, 11.8]} radius={0.8} smoothness={3} position={[0, 8, 0]} castShadow>
        <meshStandardMaterial color={color} roughness={0.45} {...glow} />
      </RoundedBox>
      {/* Mounting flanges. */}
      <mesh position={[0, 13, 0]} castShadow>
        <boxGeometry args={[32, 2.5, 11.8]} />
        <meshStandardMaterial color={color} roughness={0.45} />
      </mesh>
      {/* Gear boss and output horn. */}
      <mesh position={[5.8, 17.5, 0]} castShadow>
        <cylinderGeometry args={[5.8, 5.8, 3, 24]} />
        <meshStandardMaterial color="#f2f4f6" roughness={0.4} />
      </mesh>
      <mesh position={[5.8, 19.6, 0]} castShadow>
        <cylinderGeometry args={[2.2, 2.2, 2.4, 20]} />
        <meshStandardMaterial color="#e8eaee" roughness={0.38} />
      </mesh>
      <mesh position={[5.8, 20.8, 0]} castShadow>
        <boxGeometry args={[26, 1.6, 3.2]} />
        <meshStandardMaterial color="#f4f5f7" roughness={0.4} />
      </mesh>
      <mesh geometry={cable} castShadow>
        <meshStandardMaterial color="#b4642d" roughness={0.5} />
      </mesh>
    </group>
  );
}

/** DC can motor, or a stepper's stacked stack-and-flange. */
export function MotorModel({ id, color, selected }: ModelProps) {
  const glow = useSelectionGlow(selected);
  if (id === "stepper") {
    return (
      <group>
        <mesh position={[0, 9, 0]} castShadow>
          <cylinderGeometry args={[14, 14, 18, 32]} />
          <meshStandardMaterial color={color} roughness={0.42} metalness={0.35} {...glow} />
        </mesh>
        {/* The laminated stack reads as horizontal banding. */}
        {[4, 8, 12, 16].map((y) => (
          <mesh key={y} position={[0, y, 0]}>
            <torusGeometry args={[14.05, 0.35, 6, 32]} />
            <meshStandardMaterial color="#6f757d" metalness={0.5} roughness={0.5} />
          </mesh>
        ))}
        <mesh position={[0, 19.5, 0]} castShadow>
          <cylinderGeometry args={[9, 9, 3, 28]} />
          <meshStandardMaterial {...ALUMINIUM} />
        </mesh>
        <mesh position={[0, 24, 0]} castShadow>
          <cylinderGeometry args={[2.5, 2.5, 6, 20]} />
          <meshStandardMaterial color="#d3d6da" metalness={0.85} roughness={0.25} />
        </mesh>
        <mesh position={[0, 4, 15]} castShadow>
          <boxGeometry args={[14, 6, 5]} />
          <meshStandardMaterial color="#e9eaec" roughness={0.5} />
        </mesh>
      </group>
    );
  }
  return (
    <group rotation={[0, 0, Math.PI / 2]}>
      <mesh castShadow>
        <cylinderGeometry args={[12, 12, 25, 30]} />
        <meshStandardMaterial color={color} roughness={0.34} metalness={0.5} {...glow} />
      </mesh>
      <mesh position={[0, 12.8, 0]} castShadow>
        <cylinderGeometry args={[10, 10, 1.6, 30]} />
        <meshStandardMaterial color="#3d4249" roughness={0.6} />
      </mesh>
      <mesh position={[0, 17, 0]} castShadow>
        <cylinderGeometry args={[1.6, 1.6, 10, 16]} />
        <meshStandardMaterial color="#d6d9dd" metalness={0.9} roughness={0.22} />
      </mesh>
      {[-4, 4].map((z) => (
        <mesh key={z} position={[0, -13.6, z]} castShadow>
          <boxGeometry args={[1.2, 3, 4]} />
          <meshStandardMaterial color="#c58a39" metalness={0.7} roughness={0.35} />
        </mesh>
      ))}
    </group>
  );
}

// ------------------------------------------------------------- ics, modules

/** DIP chip with the right pin count for the part, notch and pin-1 dot. */
function IcPrimitive({ id, color, selected }: ModelProps) {
  const glow = useSelectionGlow(selected);
  const perSide = 8;                     // both L293D and 74HC595 are 16-pin
  const w = perSide * 2.54;
  return (
    <group>
      {[-1, 1].flatMap((side) => Array.from({ length: perSide }, (_, i) => (
        <FlatPin key={`${side}-${i}`} x={-w / 2 + 1.27 + i * 2.54} z={side * 3.8} length={4} />
      )))}
      <RoundedBox args={[w, 3.4, 7]} radius={0.28} smoothness={3} position={[0, 1.7, 0]} castShadow>
        <meshStandardMaterial color={color} roughness={0.52} {...glow} />
      </RoundedBox>
      <mesh position={[-w / 2 + 0.05, 2.3, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[1.3, 1.3, 0.8, 18, 1, false, 0, Math.PI]} />
        <meshStandardMaterial color="#111114" roughness={0.8} />
      </mesh>
      <mesh position={[-w / 2 + 2.4, 3.42, -2.1]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.55, 14]} />
        <meshStandardMaterial color="#0c0c0f" roughness={0.9} />
      </mesh>
      <Text position={[0.6, 3.43, 0.6]} rotation={[-Math.PI / 2, 0, 0]}
            fontSize={2} color="#a9adb5" anchorX="center">
        {id === "motor-driver" ? "L293D" : "74HC595"}
      </Text>
    </group>
  );
}

/** Relay module: the sealed cube plus its carrier board. */
function RelayPrimitive({ color, selected }: ModelProps) {
  const glow = useSelectionGlow(selected);
  return (
    <group>
      <mesh position={[0, 0.8, 0]} castShadow receiveShadow>
        <boxGeometry args={[40, 1.6, 26]} />
        <meshStandardMaterial {...PCB_GREEN} {...glow} />
      </mesh>
      <RoundedBox args={[19, 15, 15.5]} radius={0.4} smoothness={3} position={[5, 9, 0]} castShadow>
        <meshStandardMaterial color={color} roughness={0.4} />
      </RoundedBox>
      <Text position={[5, 16.6, 0]} rotation={[-Math.PI / 2, 0, 0]}
            fontSize={2.6} color="#eaf3ff" anchorX="center">5V</Text>
      {/* Screw terminal on the switched side. */}
      <mesh position={[-14, 5, 0]} castShadow>
        <boxGeometry args={[10, 8, 16]} />
        <meshStandardMaterial color="#1f6ba8" roughness={0.5} />
      </mesh>
      {[-5, 0, 5].map((z) => (
        <mesh key={z} position={[-14, 9.2, z]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[1.6, 14]} />
          <meshStandardMaterial {...ALUMINIUM} />
        </mesh>
      ))}
      <Header count={3} z={10} />
    </group>
  );
}

/** 9 V battery: the block and its two snap terminals. */
export function BatteryModel({ color, selected }: ModelProps) {
  const glow = useSelectionGlow(selected);
  return (
    <group>
      <RoundedBox args={[26.5, 48.5, 17.5]} radius={1.6} smoothness={3}
                  position={[0, 24, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={color} roughness={0.5} {...glow} />
      </RoundedBox>
      {/* Snap terminals: one male stud, one female cup. */}
      <mesh position={[-6, 50, 0]} castShadow>
        <cylinderGeometry args={[3.2, 3.2, 3.4, 20]} />
        <meshStandardMaterial {...ALUMINIUM} />
      </mesh>
      <mesh position={[6, 50, 0]} castShadow>
        <cylinderGeometry args={[4.2, 4.2, 3.4, 20]} />
        <meshStandardMaterial {...ALUMINIUM} />
      </mesh>
      <mesh position={[6, 51.8, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[2.4, 18]} />
        <meshStandardMaterial color="#2a2d33" roughness={0.7} />
      </mesh>
      <Text position={[0, 24, 8.9]} fontSize={7} color="#f2f4f7" anchorX="center">9V</Text>
    </group>
  );
}

/** TO-92 transistor: the flat face fixes the pinout. */
function TransistorPrimitive({ color, selected }: ModelProps) {
  const glow = useSelectionGlow(selected);
  const body = useMemo(() => new THREE.ExtrudeGeometry(dShape(2.55, 1.85), bevel(4.6, 0.22)), []);
  return (
    <group>
      {[-1.27, 0, 1.27].map((x) => <Leg key={x} x={x} length={5.5} />)}
      <mesh geometry={body} position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} castShadow>
        <meshStandardMaterial color={color} roughness={0.56} {...glow} />
      </mesh>
      <mesh position={[0, 4.6, 0]} castShadow>
        <sphereGeometry args={[2.5, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={color} roughness={0.56} />
      </mesh>
    </group>
  );
}


/** A loose jumper lead, for the library thumbnail. */
export function WireModel({ color, selected }: ModelProps) {
  const glow = useSelectionGlow(selected);
  const geometry = useMemo(() => {
    const a = new THREE.Vector3(-16, 0, 0);
    const b = new THREE.Vector3(16, 0, 0);
    const curve = new THREE.CubicBezierCurve3(
      a, new THREE.Vector3(-8, 11, 0), new THREE.Vector3(8, 11, 0), b);
    return new THREE.TubeGeometry(curve, 40, 1.0, 12, false);
  }, []);
  return (
    <group>
      <mesh geometry={geometry} castShadow>
        <meshStandardMaterial color={color} roughness={0.38} {...glow} />
      </mesh>
      {/* Bare tinned ends, where the insulation stops. */}
      {[-16, 16].map((x) => (
        <mesh key={x} position={[x, -2.6, 0]} castShadow>
          <cylinderGeometry args={[0.5, 0.42, 6, 10]} />
          <meshStandardMaterial color="#c6cad2" metalness={0.9} roughness={0.28} />
        </mesh>
      ))}
    </group>
  );
}

// ------------------------------------------------------------ CAD models
//
// Parts KiCad has a model for use it (scripts/models/kit.mjs); the primitives
// above remain as what shows while a model loads, and as the only model for
// parts with no CAD source (servo, motors, battery, remote, wire, ultrasonic,
// tilt switch, thermistor, joystick, soil sensor).

const model = (name: string) => `/models/${name}.glb`;
export const KIT_MODELS = [
  "led-5mm", "led-5mm-rgb", "resistor-axial", "pushbutton-6mm", "trimpot", "photoresistor",
  "lcd-1602", "seven-segment", "piezo-buzzer", "dip-16", "electrolytic", "to-92", "relay-module",
];
KIT_MODELS.forEach((name) => preloadModel(model(name)));
/** Every CAD model the kit uses, the Uno included. */
export const KIT_MODEL_URLS = [UNO_URL, "/models/micro-servo.glb", ...KIT_MODELS.map(model)];

export function LedModel(props: ModelProps) {
  const fallback = <LedPrimitive {...props} />;
  // The RGB package and a NeoPixel are diffused white; the rest are tinted.
  if (props.id === "rgb-led") {
    return <GlbModel url={model("led-5mm-rgb")} selected={props.selected} fallback={fallback} />;
  }
  return <GlbModel url={model("led-5mm")} selected={props.selected} fallback={fallback}
                   recolor={{ "led-lens": props.color }} />;
}

/** The CAD body, with the colour bands for this part's value drawn round it. */
export function ResistorModel(props: ModelProps) {
  const value = props.id === "resistor-220" ? "220 ohm" : props.id === "resistor-1k" ? "1k" : "10k";
  const bands = resistorBands(value) ?? ["#8d8d93", "#8d8d93", "#8d8d93"];
  return (
    <GlbModel url={model("resistor-axial")} selected={props.selected}
              recolor={{ "resistor-body": props.color }}
              fallback={<ResistorPrimitive {...props} />}>
      <group position={[0, 1.25, 0]} rotation={[0, 0, Math.PI / 2]}>
        {bands.map((c, i) => {
          const tolerance = i === bands.length - 1 && bands.length === 4;
          return (
            <mesh key={i} position={[0, tolerance ? 1.9 : (i - 1) * 0.95 - 0.6, 0]}>
              <cylinderGeometry args={[1.3, 1.3, tolerance ? 0.5 : 0.62, 26]} />
              <meshStandardMaterial color={c} roughness={tolerance ? 0.3 : 0.5}
                                    metalness={tolerance ? 0.55 : 0.05} />
            </mesh>
          );
        })}
      </group>
    </GlbModel>
  );
}

export function CapacitorModel(props: ModelProps) {
  return <GlbModel url={model("electrolytic")} selected={props.selected}
                   recolor={{ "cap-sleeve": props.color }} fallback={<CapacitorPrimitive {...props} />} />;
}

export function ButtonModel(props: ModelProps) {
  return <GlbModel url={model("pushbutton-6mm")} selected={props.selected} fallback={<ButtonPrimitive {...props} />} />;
}

export function KnobModel(props: ModelProps) {
  if (props.id !== "potentiometer") return <KnobPrimitive {...props} />;
  return <GlbModel url={model("trimpot")} selected={props.selected} fallback={<KnobPrimitive {...props} />} />;
}

export function SensorModel(props: ModelProps) {
  if (props.id !== "photoresistor") return <SensorPrimitive {...props} />;
  return <GlbModel url={model("photoresistor")} selected={props.selected} fallback={<SensorPrimitive {...props} />} />;
}

export function DisplayModel(props: ModelProps) {
  const fallback = <DisplayPrimitive {...props} />;
  if (props.id === "seven-segment") {
    return <GlbModel url={model("seven-segment")} selected={props.selected} fallback={fallback} />;
  }
  return <GlbModel url={model("lcd-1602")} selected={props.selected} fallback={fallback}
                   recolor={{ "lcd-glass": props.color }} />;
}

export function BuzzerModel(props: ModelProps) {
  return <GlbModel url={model("piezo-buzzer")} selected={props.selected} fallback={<BuzzerPrimitive {...props} />} />;
}

export function RelayModel(props: ModelProps) {
  return <GlbModel url={model("relay-module")} selected={props.selected} fallback={<RelayPrimitive {...props} />} />;
}

export function TransistorModel(props: ModelProps) {
  return <GlbModel url={model("to-92")} selected={props.selected} fallback={<TransistorPrimitive {...props} />} />;
}

/** DIP-16 package, with the part number printed on top. */
export function IcModel(props: ModelProps) {
  return (
    <GlbModel url={model("dip-16")} selected={props.selected}
              recolor={{ "ic-body": props.color }} fallback={<IcPrimitive {...props} />}>
      <Text position={[0.6, 3.7, 0.6]} rotation={[-Math.PI / 2, 0, 0]}
            fontSize={2} color="#a9adb5" anchorX="center">
        {props.id === "motor-driver" ? "L293D" : "74HC595"}
      </Text>
    </GlbModel>
  );
}

export const SERVO_URL = "/models/micro-servo.glb";
preloadModel(SERVO_URL);

/**
 * SG90 micro servo: FreeCAD's model of the case and horn, with its lead and
 * 3-pin plug (scripts/models/servo.mjs).
 */
export function ServoModel(props: ModelProps) {
  return <GlbModel url={SERVO_URL} selected={props.selected} glow={["servo-case"]}
                   recolor={{ "servo-case": props.color }} fallback={<ServoPrimitive {...props} />} />;
}

/** A socket on the servo's plug: "signal", "5V" or "GND". */
export function servoPort(name: string): { x: number; y: number; z: number } | undefined {
  const ports = servoPorts.ports as Record<string, { x: number; y: number; z: number }>;
  const key = Object.keys(ports).find((k) => k.toUpperCase() === name.toUpperCase());
  return key ? { ...ports[key] } : undefined;
}
