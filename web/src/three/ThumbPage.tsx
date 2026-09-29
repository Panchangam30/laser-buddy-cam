import { useEffect } from "react";
import { Canvas } from "@react-three/fiber";
import { Environment, OrthographicCamera } from "@react-three/drei";
import { STARTER_KIT_PARTS } from "../components/StarterKit";
import {
  BatteryModel, BreadboardModel, ButtonModel, BuzzerModel, CapacitorModel,
  DisplayModel, IcModel, KnobModel, LedModel, MotorModel, RelayModel,
  RemoteModel, ResistorModel, SensorModel, ServoModel, TransistorModel,
  UnoModel, WireModel,
} from "./kitModels";

/**
 * Renders one kit part on its own, for capturing a thumbnail.
 *
 * Why pre-render rather than put a live canvas on each card: a browser allows
 * something like sixteen WebGL contexts, and the drawer shows twenty-nine parts.
 * Live canvases would silently start dropping the later ones. Images cost
 * nothing to show, and scripts/thumbs.mjs regenerates them whenever a model
 * changes.
 *
 * Reached at /thumb?part=<id>. Not linked from anywhere in the app.
 */

const MODELS: Record<string, typeof LedModel> = {
  board: UnoModel, breadboard: BreadboardModel, led: LedModel,
  resistor: ResistorModel, button: ButtonModel, knob: KnobModel,
  sensor: SensorModel, motor: MotorModel, servo: ServoModel,
  display: DisplayModel, battery: BatteryModel, buzzer: BuzzerModel,
  relay: RelayModel, ic: IcModel, capacitor: CapacitorModel,
  transistor: TransistorModel, remote: RemoteModel, wire: WireModel,
};

/**
 * Roughly how many millimetres across each part is, so the camera can frame
 * them at a consistent apparent size. A 9 V battery beside a 5 mm LED at true
 * scale makes the LED a speck, which is correct and useless as a thumbnail.
 */
const FRAME: Record<string, number> = {
  board: 80, breadboard: 62, remote: 95, display: 90, battery: 62,
  motor: 40, servo: 40, relay: 48, ultrasonic: 52,
  "seven-segment": 26, "lcd-1602": 90,
  ic: 26, knob: 18, button: 14, buzzer: 18, capacitor: 20, wire: 24,
  resistor: 16, led: 15, transistor: 14, sensor: 14,
};

/**
 * Yaw applied before capture, so the feature that identifies a part faces the
 * camera: the stripe on an electrolytic, the flat on an LED, the notch on a
 * chip. A thumbnail that hides the one marking a student looks for is a
 * picture of the wrong thing.
 */
const FACING: Record<string, number> = {
  capacitor: -Math.PI * 0.62,
  led: -Math.PI * 0.25,
  transistor: -Math.PI * 0.3,
  ic: Math.PI * 0.08,
};

export function ThumbPage() {
  // main.tsx imports App statically, which pulls in App.css and its opaque body
  // background even on this route. Playwright's omitBackground can only produce
  // a transparent PNG if nothing behind the canvas is painted, so clear it.
  useEffect(() => {
    const previous = document.body.style.background;
    document.body.style.background = "transparent";
    return () => { document.body.style.background = previous; };
  }, []);

  const id = new URLSearchParams(window.location.search).get("part") ?? "led-red";
  const part = STARTER_KIT_PARTS.find((p) => p.id === id) ?? STARTER_KIT_PARTS[0];
  const Model = MODELS[part.shape] ?? IcModel;
  const size = FRAME[part.id] ?? FRAME[part.shape] ?? 24;

  return (
    <div style={{ width: 320, height: 320, background: "transparent" }}>
      <Canvas shadows gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
              style={{ background: "transparent" }}>
        {/* Orthographic, so every thumbnail has the same projection and the set
            reads as one family rather than as separate photographs. */}
        <OrthographicCamera makeDefault position={[size, size * 0.85, size]} zoom={1}
                            left={-size} right={size} top={size} bottom={-size}
                            near={-500} far={500} onUpdate={(c) => c.lookAt(0, size * 0.12, 0)} />
        <directionalLight position={[-40, 70, 50]} intensity={2.1} castShadow
                          shadow-mapSize={[1024, 1024]} />
        <directionalLight position={[50, 30, -60]} intensity={0.7} color="#9fb6ff" />
        <ambientLight intensity={0.5} />
        <Environment preset="studio" environmentIntensity={0.5} />
        <group rotation={[0, FACING[part.shape] ?? 0, 0]}>
          <Model id={part.id} color={part.color} />
        </group>
      </Canvas>
    </div>
  );
}
