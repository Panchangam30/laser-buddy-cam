import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Environment, ContactShadows } from "@react-three/drei";
import { Breadboard } from "./Breadboard";
import { PartMesh } from "./Parts";
import { WorldLayer } from "./World";
import type { Plan } from "../lib/types";
import type { World } from "../lib/world";
import type { Guidance } from "../lib/guidance";

/**
 * What the student is looking at.
 *
 * "plan" is the circuit they are aiming for, "live" is the map of what is
 * actually on their bench, and "compare" draws the plan faintly underneath the
 * live map so the difference is visible rather than described.
 */
export type ViewMode = "plan" | "live" | "compare";

export function Scene({ plan, step, exploded, mode, world, guidance, labels }: {
  plan: Plan;
  step: number;
  exploded: boolean;
  mode: ViewMode;
  world: World;
  guidance: Guidance;
  labels: boolean;
}) {
  const visibleAt = new Map<string, number>();
  plan.steps.forEach((s) => s.adds.forEach((id) => visibleAt.set(id, s.n)));
  const currentIds = new Set(plan.steps.find((s) => s.n === step)?.adds ?? []);

  const showPlan = mode !== "live";
  const showWorld = mode !== "plan";
  // In compare the plan is context, not the subject: drawn back so the live map
  // reads on top of it instead of fighting it.
  const planDimmed = mode === "compare";

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      // Distance chosen to frame the whole 162mm board with margin at this fov.
      camera={{ position: [0, 128, 162], fov: 36 }}
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

        {showPlan && plan.parts.map((p) => {
          const at = visibleAt.get(p.id) ?? 1;
          if (at > step) return null;
          const isCurrent = currentIds.has(p.id);
          return (
            <group key={p.id} position={exploded && isCurrent ? [0, 26, 0] : [0, 0, 0]}>
              <PartMesh part={p} highlighted={isCurrent && !planDimmed}
                        dimmed={planDimmed || (!isCurrent && exploded)} />
            </group>
          );
        })}

        {showWorld && (
          <WorldLayer world={world} guidance={guidance} showLabels={labels} />
        )}
      </group>

      <ContactShadows position={[0, -4.6, 0]} opacity={0.62} scale={280} blur={2.2} far={50} />
      <OrbitControls makeDefault enablePan target={[0, 0, 0]}
        minDistance={55} maxDistance={420} maxPolarAngle={Math.PI / 2.06} />
    </Canvas>
  );
}
