import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { usePreferences } from "../lib/preferences";
import { purchaseUrl } from "../lib/purchase";
import { SURFACE_Y, snapToHole } from "../lib/breadboard";
import {
  BatteryModel, BreadboardModel, ButtonModel, BuzzerModel, CapacitorModel,
  DisplayModel, IcModel, KnobModel, LedModel, MotorModel, RelayModel,
  RemoteModel, ResistorModel, SensorModel, ServoModel, TransistorModel,
  UnoModel, WireModel,
} from "../three/kitModels";

export type KitShape =
  | "board" | "breadboard" | "led" | "resistor" | "button" | "knob"
  | "sensor" | "motor" | "servo" | "display" | "battery" | "buzzer"
  | "relay" | "ic" | "capacitor" | "transistor" | "wire" | "remote";

const HOVER_HELP_DELAY_MS = 350;

export type KitPartDefinition = {
  id: string;
  name: string;
  category: string;
  shape: KitShape;
  color: string;
};

export type PlacedKitPart = KitPartDefinition & {
  instanceId: string;
  position: [number, number, number];
  rotation: number;
  wireStart?: [number, number, number];
  wireEnd?: [number, number, number];
  wireStartTarget?: string;
  wireEndTarget?: string;
};

export type SimulationState = { running: boolean; powered: boolean; rate: number; includedIds: string[] };

export const STARTER_KIT_PARTS: KitPartDefinition[] = [
  { id: "uno-r3", name: "Arduino Uno R3", category: "Boards", shape: "board", color: "#087f8c" },
  { id: "breadboard", name: "Breadboard", category: "Boards", shape: "breadboard", color: "#e7e5dc" },
  { id: "led-red", name: "Red LED", category: "Output", shape: "led", color: "#ef4444" },
  { id: "led-green", name: "Green LED", category: "Output", shape: "led", color: "#22c55e" },
  { id: "led-blue", name: "Blue LED", category: "Output", shape: "led", color: "#3b82f6" },
  { id: "rgb-led", name: "RGB LED", category: "Output", shape: "led", color: "#a855f7" },
  { id: "resistor-220", name: "220Ω Resistor", category: "Passive", shape: "resistor", color: "#d6b27a" },
  { id: "resistor-1k", name: "1kΩ Resistor", category: "Passive", shape: "resistor", color: "#caa46b" },
  { id: "resistor-10k", name: "10kΩ Resistor", category: "Passive", shape: "resistor", color: "#bd9863" },
  { id: "pushbutton", name: "Push Button", category: "Input", shape: "button", color: "#334155" },
  { id: "potentiometer", name: "Potentiometer", category: "Input", shape: "knob", color: "#2563eb" },
  { id: "photoresistor", name: "Photoresistor", category: "Sensors", shape: "sensor", color: "#d97706" },
  { id: "thermistor", name: "Thermistor", category: "Sensors", shape: "sensor", color: "#111827" },
  { id: "tilt-switch", name: "Tilt Switch", category: "Sensors", shape: "sensor", color: "#94a3b8" },
  { id: "ultrasonic", name: "Ultrasonic Sensor", category: "Sensors", shape: "sensor", color: "#0f766e" },
  { id: "servo", name: "Micro Servo", category: "Motion", shape: "servo", color: "#2563eb" },
  { id: "dc-motor", name: "DC Motor", category: "Motion", shape: "motor", color: "#94a3b8" },
  { id: "stepper", name: "Stepper Motor", category: "Motion", shape: "motor", color: "#64748b" },
  { id: "lcd-1602", name: "16×2 LCD", category: "Output", shape: "display", color: "#1d4ed8" },
  { id: "seven-segment", name: "7-Segment Display", category: "Output", shape: "display", color: "#7f1d1d" },
  { id: "piezo", name: "Piezo Buzzer", category: "Output", shape: "buzzer", color: "#171717" },
  { id: "relay", name: "5V Relay", category: "Modules", shape: "relay", color: "#2563eb" },
  { id: "motor-driver", name: "L293D Driver", category: "ICs", shape: "ic", color: "#18181b" },
  { id: "shift-register", name: "74HC595", category: "ICs", shape: "ic", color: "#27272a" },
  { id: "capacitor", name: "100µF Capacitor", category: "Passive", shape: "capacitor", color: "#1f2937" },
  { id: "transistor", name: "NPN Transistor", category: "Active", shape: "transistor", color: "#20242b" },
  { id: "jumper-wire", name: "Jumper Wire", category: "Connectors", shape: "wire", color: "#f59e0b" },
  { id: "battery-snap", name: "9V Battery", category: "Power", shape: "battery", color: "#111827" },
  { id: "ir-remote", name: "IR Remote", category: "Input", shape: "remote", color: "#242424" },
  { id: "joystick", name: "Analog Joystick", category: "Input", shape: "knob", color: "#2563eb" },
  { id: "soil-sensor", name: "Soil Moisture Sensor", category: "Sensors", shape: "sensor", color: "#15803d" },
  { id: "neopixel", name: "NeoPixel Ring", category: "Output", shape: "led", color: "#f8fafc" },
];

const PART_HELP: Record<string, string> = {
  "uno-r3": "The circuit's controller. Upload code over USB; its digital and analog pins read sensors and drive outputs.",
  breadboard: "Builds circuits without solder. Holes in each five-hole row are electrically connected; the side rails distribute power.",
  "led-red": "Emits red light when current flows from anode to cathode. Always use a current-limiting resistor.",
  "led-green": "Emits green light when forward biased. The longer leg is the positive anode.",
  "led-blue": "Emits blue light from a semiconductor junction. It usually needs a slightly higher forward voltage.",
  "rgb-led": "Three LEDs share one package, letting PWM mix red, green, and blue into many colors.",
  "resistor-220": "Limits current; commonly protects an LED on a 5V Arduino output.",
  "resistor-1k": "Limits current or forms a voltage divider. Color bands encode its 1,000Ω value.",
  "resistor-10k": "Common pull-up or pull-down resistor that keeps an input from floating.",
  pushbutton: "A momentary switch. Pressing it bridges its two sides to create a digital input.",
  potentiometer: "An adjustable voltage divider. Turn the shaft to vary the voltage on its center pin.",
  photoresistor: "Changes resistance with light level, usually read through an analog voltage divider.",
  thermistor: "Changes resistance with temperature, allowing an analog input to estimate heat.",
  "tilt-switch": "A small internal ball closes the contacts when the sensor is tilted.",
  ultrasonic: "Measures distance by timing how long an ultrasonic pulse takes to echo back.",
  servo: "A geared motor with position feedback. A timed control pulse sets its output angle.",
  "dc-motor": "Converts electrical energy into continuous rotation. Use a driver and flyback protection, not an Arduino pin directly.",
  stepper: "Moves in precise angular steps by energizing its coils in sequence through a driver.",
  "lcd-1602": "Displays two rows of 16 characters using parallel signals or an optional I²C adapter.",
  "seven-segment": "Seven LED bars combine to display numbers. Each segment needs current limiting.",
  piezo: "Turns an alternating electrical signal into sound for tones, alerts, and simple melodies.",
  relay: "An electrically controlled switch that lets a low-voltage signal isolate and switch another circuit.",
  "motor-driver": "A dual H-bridge IC that safely controls motor direction and speed from logic signals.",
  "shift-register": "Converts serial data into eight parallel outputs, expanding the Arduino's output count.",
  capacitor: "Stores electrical charge. This polarized electrolytic smooths supply voltage; observe + and −.",
  transistor: "An NPN transistor uses a small base current to switch or amplify a larger collector current.",
  "jumper-wire": "Makes a removable electrical connection between breadboard rows, modules, and Arduino pins.",
  "battery-snap": "Portable 9V supply. Connect through VIN or a regulator and never reverse polarity.",
  "ir-remote": "Sends digitally encoded infrared light; an IR receiver module decodes each button press.",
  joystick: "Two potentiometers report X/Y position while the shaft also acts as a push button.",
  "soil-sensor": "Estimates soil moisture from conductivity. Use short readings to reduce probe corrosion.",
  neopixel: "Individually addressable RGB LEDs share one data wire and can display animated colors.",
};

/**
 * Shapes with leads that go into the board.
 *
 * Everything else -- an Arduino, a 9 V battery, a remote -- sits beside the
 * board rather than in it, and snapping those to the hole grid would be
 * meaningless precision.
 */
const THROUGH_HOLE = new Set<KitShape>([
  "led", "resistor", "capacitor", "transistor", "button", "knob", "ic",
  "sensor", "buzzer", "wire",
]);

export function seatsInHoles(shape: KitShape): boolean {
  return THROUGH_HOLE.has(shape);
}

/**
 * Where a dragged part should actually come to rest.
 *
 * Through-hole parts snap to the grid and sit ON the board surface, because
 * their legs are modelled going straight down and only reach a hole if both of
 * those are true. Getting either wrong leaves the part hovering with its legs
 * in the gaps, which is what it looked like before.
 */
export function seatPart(shape: KitShape, x: number, z: number): [number, number, number] {
  if (!seatsInHoles(shape)) return [x, SURFACE_Y + 1.2, z];
  const snapped = snapToHole(x, z);
  return [snapped.x, SURFACE_Y, snapped.z];
}

export function partHelp(part: KitPartDefinition) {
  return PART_HELP[part.id] ?? "An electronic component used to build and test Arduino circuits.";
}

export function ComponentsDrawer({ open, onToggle, count, onAdd }: {
  open: boolean;
  onToggle: () => void;
  count: number;
  onAdd: (partId: string) => void;
}) {
  const { preferences } = usePreferences();
  const [query, setQuery] = useState("");
  const shown = STARTER_KIT_PARTS.filter((part) =>
    `${part.name} ${part.category}`.toLowerCase().includes(query.toLowerCase()));

  return (
    <>
      <button className={`components-trigger ${open ? "on" : ""}`} onClick={onToggle}
              aria-expanded={open} aria-controls="component-library">
        <span className="cube-icon" aria-hidden="true">◇</span>
        Components
        {count > 0 && <span className="component-count">{count}</span>}
      </button>
      {open && (
        <aside className="components-drawer" id="component-library">
          <div className="components-heading">
            <div><strong>Starter kit</strong><span>Swipe to browse · Tap a part to add</span></div>
            <button onClick={onToggle} aria-label="Close component library">×</button>
          </div>
          <input className="component-search" value={query}
                 onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${STARTER_KIT_PARTS.length} components…`} />
          <div className="component-grid" aria-label="Components">
            {shown.map((part) => (
              <div className="component-tile" key={part.id}><button className="component-card" draggable={preferences.dragToPlace}
                aria-label={`Add ${part.name}`}
                onDragStart={(event) => {
                  event.dataTransfer.setData("application/x-starter-part", part.id);
                  event.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => onAdd(part.id)}>
                <PartPreview part={part} />
                <span>{part.name}</span>
                <small>{part.category}</small>
                <span className="component-tooltip" role="tooltip"><strong>{part.name}</strong>{partHelp(part)}</span>
              </button>
              <a className="purchase-link" href={purchaseUrl(part.name)} target="_blank" rel="noopener noreferrer" aria-label={`Shop for ${part.name}`}>Shop ↗</a>
              </div>
            ))}
          </div>
          {shown.length === 0 && <p className="component-empty">No matching parts. Try another name or category.</p>}
        </aside>
      )}
    </>
  );
}

function PartPreview({ part }: { part: KitPartDefinition }) {
  const [failed, setFailed] = useState(false);
  // The CSS shape stays as the fallback: if the thumbnails have not been
  // generated yet, the drawer still shows something part-shaped rather than a
  // row of broken-image icons.
  if (failed) {
    return <span className={`part-preview shape-${part.shape}`}
                 style={{ "--part-color": part.color } as React.CSSProperties} />;
  }
  return (
    <img className="part-thumb" src={`/parts/${part.id}.png`} alt="" loading="lazy"
         width={72} height={72} onError={() => setFailed(true)} />
  );
}

export function KitPartsLayer({ parts, selectedId, onSelect, onMove, onDelete,
  onWireChange = () => {}, onInteractionChange = () => {},
  simulation = { running: false, powered: true, rate: 1, includedIds: [] } }: {
  parts: PlacedKitPart[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMove: (id: string, position: [number, number, number]) => void;
  onDelete: (id: string) => void;
  onWireChange?: (id: string, end: "start" | "end", position: [number, number, number], target?: string) => void;
  onInteractionChange?: (active: boolean) => void;
  simulation?: SimulationState;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [hoverCandidate, setHoverCandidate] = useState<string | null>(null);
  const [wireDrag, setWireDrag] = useState<{ id: string; end: "start" | "end" } | null>(null);

  useEffect(() => {
    if (!hoverCandidate || dragging || wireDrag) { setHovered(null); return; }
    const timer = window.setTimeout(() => setHovered(hoverCandidate), HOVER_HELP_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [hoverCandidate, dragging, wireDrag]);

  useEffect(() => () => onInteractionChange(false), [onInteractionChange]);

  useEffect(() => {
    if (!dragging && !wireDrag) return;
    const releaseFocus = () => {
      setDragging(null);
      setWireDrag(null);
      onInteractionChange(false);
    };
    window.addEventListener("pointerup", releaseFocus);
    window.addEventListener("blur", releaseFocus);
    return () => {
      window.removeEventListener("pointerup", releaseFocus);
      window.removeEventListener("blur", releaseFocus);
    };
  }, [dragging, wireDrag, onInteractionChange]);

  const wireSelected = parts.find((part) => part.instanceId === selectedId)?.shape === "wire";
  const nearestTarget = (point: THREE.Vector3) => {
    let best: PlacedKitPart | undefined;
    let distance = 13;
    for (const part of parts) {
      if (part.shape === "wire") continue;
      const next = Math.hypot(point.x - part.position[0], point.z - part.position[2]);
      if (next < distance) { best = part; distance = next; }
    }
    return best;
  };

  return (
    <group>
      {!simulation.running && <mesh position={[0, 5.6, 0]} rotation={[-Math.PI / 2, 0, 0]}
        onPointerMove={(event) => {
          if (wireDrag) {
            event.stopPropagation();
            onWireChange(wireDrag.id, wireDrag.end, [event.point.x, 7.5, event.point.z]);
            return;
          }
          if (!dragging) return;
          event.stopPropagation();
          const held = parts.find((part) => part.instanceId === dragging);
          onMove(dragging, seatPart(held?.shape ?? "ic",
            Math.max(-78, Math.min(78, event.point.x)),
            Math.max(-48, Math.min(48, event.point.z))));
        }}
        onPointerUp={(event) => {
          if (wireDrag) {
            const target = nearestTarget(event.point);
            if (target) onWireChange(wireDrag.id, wireDrag.end,
              [target.position[0], target.position[1] + 4, target.position[2]], target.instanceId);
            setWireDrag(null);
          }
          setDragging(null);
          onInteractionChange(false);
        }} onPointerMissed={() => { setDragging(null); setWireDrag(null); onInteractionChange(false); }}>
        <planeGeometry args={[190, 120]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>}
      {!simulation.running && wireSelected && parts.filter((part) => part.shape !== "wire").map((part) => (
        <group key={`port-${part.instanceId}`} position={part.position}>
          <mesh position={[0, 5, 0]}>
            <sphereGeometry args={[1.25, 14, 10]} />
            <meshStandardMaterial color="#ffcc00" emissive="#ffcc00" emissiveIntensity={.65} />
          </mesh>
        </group>
      ))}
      {parts.filter((part) => part.shape !== "wire").map((part) => (
        <group key={part.instanceId} position={part.position} rotation={[0, part.rotation, 0]}
          onPointerDown={(event: ThreeEvent<PointerEvent>) => {
            if (simulation.running) return;
            event.stopPropagation(); onSelect(part.instanceId); setDragging(part.instanceId);
            setHovered(null); onInteractionChange(true);
          }}
          onPointerOver={(event: ThreeEvent<PointerEvent>) => { event.stopPropagation(); setHoverCandidate(part.instanceId); }}
          onPointerOut={() => { setHoverCandidate((id) => id === part.instanceId ? null : id); setHovered((id) => id === part.instanceId ? null : id); }}
          onDoubleClick={(event: ThreeEvent<MouseEvent>) => { if (!simulation.running) { event.stopPropagation(); onDelete(part.instanceId); } }}>
          <SimulatedPart part={part} selected={selectedId === part.instanceId} simulation={simulation}
            included={simulation.includedIds.includes(part.instanceId)} />
          {hovered === part.instanceId && !dragging && (
            <Html position={[0, 15, 0]} center zIndexRange={[12, 0]}>
              <div className="canvas-part-label"><strong>{part.name}</strong><span>{partHelp(part)}</span></div>
            </Html>
          )}
        </group>
      ))}
      {parts.filter((part) => part.shape === "wire").map((part) => {
        const startTarget = parts.find((candidate) => candidate.instanceId === part.wireStartTarget);
        const endTarget = parts.find((candidate) => candidate.instanceId === part.wireEndTarget);
        const start = startTarget
          ? [startTarget.position[0], startTarget.position[1] + 4, startTarget.position[2]] as [number, number, number]
          : part.wireStart ?? [part.position[0] - 8, 7.5, part.position[2]];
        const end = endTarget
          ? [endTarget.position[0], endTarget.position[1] + 4, endTarget.position[2]] as [number, number, number]
          : part.wireEnd ?? [part.position[0] + 8, 7.5, part.position[2]];
        return <JumperWire key={part.instanceId} part={part} start={start} end={end}
          simulation={simulation} included={simulation.includedIds.includes(part.instanceId)
            || (!!part.wireStartTarget && simulation.includedIds.includes(part.wireStartTarget))
            || (!!part.wireEndTarget && simulation.includedIds.includes(part.wireEndTarget))}
          selected={!simulation.running && selectedId === part.instanceId} hovered={!simulation.running && hovered === part.instanceId}
          onSelect={() => { if (!simulation.running) onSelect(part.instanceId); }}
          onHover={(value) => {
            setHoverCandidate(value ? part.instanceId : null);
            if (!value) setHovered((id) => id === part.instanceId ? null : id);
          }}
          onDragEnd={(endName) => {
            if (simulation.running) return;
            onSelect(part.instanceId); setWireDrag({ id: part.instanceId, end: endName });
            setHovered(null); onInteractionChange(true);
          }} />;
      })}
    </group>
  );
}

function SimulatedPart({ part, selected, simulation, included }: {
  part: KitPartDefinition; selected: boolean; simulation: SimulationState; included: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!group.current) return;
    const active = simulation.running && simulation.powered && included;
    const phase = clock.elapsedTime * simulation.rate;
    const wave = Math.sin(phase * Math.PI * 2);
    group.current.scale.setScalar(active && (["led", "buzzer", "relay", "capacitor"] as KitShape[]).includes(part.shape)
      ? 1 + Math.max(0, wave) * .1 : 1);
    group.current.position.y = active && (["sensor", "button", "transistor", "ic", "display", "breadboard"] as KitShape[]).includes(part.shape)
      ? Math.max(0, wave) * .35 : 0;
    group.current.rotation.y = active && part.shape === "motor" ? phase * 3
      : active && (part.shape === "knob" || part.shape === "remote") ? Math.sin(phase) * .12 : 0;
    group.current.rotation.z = active && part.shape === "servo" ? Math.sin(phase * 2) * .3
      : active && part.shape === "resistor" ? wave * .025 : 0;
  });

  const active = simulation.running && simulation.powered && included;
  const lit = active && part.shape === "led";
  const boardActive = active && part.shape === "board";
  return <group ref={group}>
    <KitPartModel part={part} selected={selected || lit || boardActive} />
    {lit && <pointLight position={[0, 6, 0]} color={part.color} intensity={2.2} distance={22} />}
    {boardActive && <group position={[8, 3.4, -8]}>
      <pointLight color="#4ade80" intensity={1.8} distance={18} />
      <mesh><sphereGeometry args={[.8, 12, 8]} /><meshBasicMaterial color="#6dff9b" /></mesh>
    </group>}
    {active && !lit && !boardActive && <mesh position={[0, .15, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[5.5, 6, 28]} />
      <meshBasicMaterial color="#4ade80" transparent opacity={.28} depthWrite={false} />
    </mesh>}
  </group>;
}

function JumperWire({ part, start, end, selected, hovered, onSelect, onHover, onDragEnd,
  simulation, included }: {
  part: PlacedKitPart;
  start: [number, number, number];
  end: [number, number, number];
  selected: boolean;
  hovered: boolean;
  onSelect: () => void;
  onHover: (value: boolean) => void;
  onDragEnd: (end: "start" | "end") => void;
  simulation: SimulationState;
  included: boolean;
}) {
  const wire = useMemo(() => {
    const a = new THREE.Vector3(...start);
    const b = new THREE.Vector3(...end);
    const distance = a.distanceTo(b);
    const lift = Math.min(7 + distance * .13, 23);
    const direction = b.clone().sub(a);
    const side = new THREE.Vector3(-direction.z, 0, direction.x).normalize().multiplyScalar(Math.min(distance * .045, 2.2));
    const curve = new THREE.CatmullRomCurve3([
      a, a.clone().lerp(b, .18).add(new THREE.Vector3(0, lift * .72, 0)).add(side),
      a.clone().lerp(b, .5).add(new THREE.Vector3(0, lift, 0)),
      a.clone().lerp(b, .82).add(new THREE.Vector3(0, lift * .72, 0)).sub(side), b,
    ], false, "centripetal", .35);
    return { curve, outer: new THREE.TubeGeometry(curve, 48, .72, 12, false),
      highlight: new THREE.TubeGeometry(curve, 48, .18, 7, false) };
  }, [start, end]);

  return <group onPointerOver={(event) => { event.stopPropagation(); onHover(true); }} onPointerOut={() => onHover(false)}>
    <mesh geometry={wire.outer} castShadow onPointerDown={(event) => { event.stopPropagation(); onSelect(); }}>
      <meshStandardMaterial color={part.color} roughness={.38}
        emissive={selected ? "#ffcc00" : part.color} emissiveIntensity={selected ? .3 : .08} />
    </mesh>
    <mesh geometry={wire.highlight} position={[0, .5, 0]}>
      <meshBasicMaterial color="#fff" transparent opacity={.2} depthWrite={false} />
    </mesh>
    <WireSignal curve={wire.curve} active={simulation.running && simulation.powered && included}
      rate={simulation.rate} color={part.color} />
    {(["start", "end"] as const).map((endName) => {
      const point = endName === "start" ? start : end;
      return <group key={endName} position={point}>
        <mesh onPointerDown={(event) => { event.stopPropagation(); onDragEnd(endName); }}>
          <sphereGeometry args={[selected ? 1.8 : 1.25, 16, 12]} />
          <meshStandardMaterial color={selected ? "#ffcc00" : "#d5d8dc"} metalness={.65} roughness={.25} />
        </mesh>
        <mesh position={[0, -1.25, 0]}><cylinderGeometry args={[1.2, .92, 2.8, 14]} />
          <meshStandardMaterial color={part.color} roughness={.42} /></mesh>
        <mesh position={[0, -.2, 0]}><torusGeometry args={[.91, .16, 7, 14]} />
          <meshStandardMaterial color="#17191d" roughness={.7} /></mesh>
        <mesh position={[0, -2.8, 0]}><cylinderGeometry args={[.58, .58, 1.3, 10]} />
          <meshStandardMaterial color="#d7dadd" metalness={.9} roughness={.18} /></mesh>
      </group>;
    })}
    {hovered && <Html position={[(start[0] + end[0]) / 2, Math.max(start[1], end[1]) + 14, (start[2] + end[2]) / 2]} center>
      <div className="canvas-part-label"><strong>Jumper wire</strong><span>Drag either glowing end onto a yellow component connection point.</span></div>
    </Html>}
  </group>;
}

function WireSignal({ curve, active, rate, color }: {
  curve: THREE.Curve<THREE.Vector3>; active: boolean; rate: number; color: string;
}) {
  const pulse = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!pulse.current) return;
    pulse.current.visible = active;
    if (active) pulse.current.position.copy(curve.getPoint((clock.elapsedTime * rate * .38) % 1));
  });
  return <mesh ref={pulse} visible={false}>
    <sphereGeometry args={[1.05, 12, 9]} />
    <meshBasicMaterial color={color} toneMapped={false} />
  </mesh>;
}

/**
 * Dispatch a kit part to its detailed model.
 *
 * These used to be primitives built inline -- a sphere for every sensor, a
 * rounded box for every module. They are now the same models the board view
 * uses, so a part a student drags in looks like the part they are holding, and
 * there is one place to improve a component rather than two that drift apart.
 */
function KitPartModel({ part, selected }: { part: KitPartDefinition; selected: boolean }) {
  const props = { id: part.id, color: part.color, selected };
  switch (part.shape) {
    case "board":       return <UnoModel {...props} />;
    case "breadboard":  return <BreadboardModel {...props} />;
    case "led":         return <LedModel {...props} />;
    case "resistor":    return <ResistorModel {...props} />;
    case "button":      return <ButtonModel {...props} />;
    case "knob":        return <KnobModel {...props} />;
    case "sensor":      return <SensorModel {...props} />;
    case "motor":       return <MotorModel {...props} />;
    case "servo":       return <ServoModel {...props} />;
    case "display":     return <DisplayModel {...props} />;
    case "battery":     return <BatteryModel {...props} />;
    case "buzzer":      return <BuzzerModel {...props} />;
    case "relay":       return <RelayModel {...props} />;
    case "ic":          return <IcModel {...props} />;
    case "capacitor":   return <CapacitorModel {...props} />;
    case "transistor":  return <TransistorModel {...props} />;
    case "remote":      return <RemoteModel {...props} />;
    // On the canvas a placed wire is drawn by JumperWire, which needs both of
    // its endpoints; this is only reached for a loose one.
    case "wire":        return <WireModel {...props} />;
    default:            return <IcModel {...props} />;
  }
}
