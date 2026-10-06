import * as THREE from "three";
import { useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Environment, ContactShadows } from "@react-three/drei";
import { Breadboard } from "./Breadboard";
import { PartMesh } from "./Parts";
import { WorldLayer } from "./World";
import type { Plan } from "../lib/types";
import type { World } from "../lib/world";
import type { Guidance } from "../lib/guidance";
import { KitPartsLayer, type PlacedKitPart, type SimulationState } from "../components/StarterKit";
import { ExternalDevices, externalAnchorMap } from "./ExternalDevices";

/**
 * What the student is looking at.
 *
 * "plan" is the circuit they are aiming for and "live" is the map of what is
 * actually on their bench.
 */
export type ViewMode = "plan" | "live";

const NO_DEVICES: NonNullable<Plan["devices"]> = [];

export function Scene({ plan, step, exploded, mode, world, guidance, labels,
  kitParts = [], selectedKitPart = null, onSelectKitPart = () => {},
  simulation = { running: false, powered: true, rate: 1, includedIds: [] },
  onMoveKitPart = () => {}, onDeleteKitPart = () => {}, onWireChange = () => {},
}: {
  plan: Plan;
  step: number;
  exploded: boolean;
  mode: ViewMode;
  world: World;
  guidance: Guidance;
  labels: boolean;
  kitParts?: PlacedKitPart[];
  simulation?: SimulationState;
  selectedKitPart?: string | null;
  onSelectKitPart?: (id: string | null) => void;
  onMoveKitPart?: (id: string, position: [number, number, number]) => void;
  onDeleteKitPart?: (id: string) => void;
  onWireChange?: (id: string, end: "start" | "end", position: [number, number, number], target?: string) => void;
}) {
  const [focusedMove, setFocusedMove] = useState(false);
  const visibleAt = new Map<string, number>();
  plan.steps.forEach((s) => [...s.adds, ...(s.renders ?? [])]
    .forEach((id) => visibleAt.set(id, s.n)));
  const current = plan.steps.find((s) => s.n === step);
  const currentIds = new Set([...(current?.adds ?? []), ...(current?.renders ?? [])]);
  const devices = plan.devices ?? NO_DEVICES;
  const externalAnchors = useMemo(() => externalAnchorMap(devices), [devices]);
  const visibleDeviceIds = devices
    .filter((device) => (device.visibleFromStep ?? 1) <= step)
    .map((device) => device.id).join(" ");
  const visiblePartIds = plan.parts
    .filter((part) => (visibleAt.get(part.id) ?? 1) <= step)
    .map((part) => part.id).join(" ");

  const showPlan = mode !== "live";
  const showWorld = mode !== "plan";

  return (
    <Canvas
      data-testid="assembly-scene"
      data-device-ids={visibleDeviceIds}
      data-part-ids={visiblePartIds}
      shadows
      dpr={[1, 2]}
      // Distance chosen to frame the whole 162mm board with margin at this fov.
      camera={{ position: [0, 158, 205], fov: 36 }}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 0.82 }}
      style={{ background: "radial-gradient(120% 90% at 50% 18%, #1c2028 0%, #0b0c0f 70%)" }}
    >
      {/* Key light from the front-left, the angle product photos use. */}
      <directionalLight
        position={[-70, 130, 90]} intensity={1.85} castShadow
        shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004}
        shadow-camera-left={-120} shadow-camera-right={120}
        shadow-camera-top={120} shadow-camera-bottom={-120}
      />
      {/* Cool fill from behind to separate the board from the background. */}
      <directionalLight position={[80, 60, -110]} intensity={0.75} color="#9fb6ff" />
      <ambientLight intensity={0.35} />
      <Environment preset="studio" environmentIntensity={0.45} />

      <group>
        <Breadboard />

        {showPlan && <ExternalDevices devices={devices} step={step} dimmed={exploded} />}

        {showPlan && plan.parts.map((p) => {
          const at = visibleAt.get(p.id) ?? 1;
          if (at > step) return null;
          const isCurrent = currentIds.has(p.id);
          return (
            // The lift goes to PartMesh, not a wrapping group: only the part
            // itself can damp the change, and a group here would teleport it.
            <PartMesh key={p.id} part={p}
                      lift={exploded && isCurrent ? 26 : 0}
                      highlighted={isCurrent}
                      dimmed={!isCurrent && exploded}
                      externalAnchors={externalAnchors} />
          );
        })}

        {showWorld && (
          <WorldLayer world={world} guidance={guidance} showLabels={labels} />
        )}

        {mode === "plan" && (
          <KitPartsLayer parts={kitParts} selectedId={selectedKitPart}
            simulation={simulation}
            onSelect={onSelectKitPart} onMove={onMoveKitPart} onDelete={onDeleteKitPart}
            onWireChange={onWireChange} onInteractionChange={setFocusedMove} />
        )}
      </group>

      <ContactShadows position={[0, -4.6, -18]} opacity={0.62} scale={340} blur={2.2} far={50} />
      <OrbitControls makeDefault enablePan enabled={!focusedMove} target={[0, 0, -18]}
        minDistance={55} maxDistance={420} maxPolarAngle={Math.PI / 2.06} />
    </Canvas>
  );
}
