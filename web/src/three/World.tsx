import { useMemo } from "react";
import * as THREE from "three";
import { Billboard } from "@react-three/drei";
import { BOARD, holePosition } from "../lib/breadboard";
import { textPlate } from "./labels";
import { PartMesh } from "./Parts";
import type { Entity, World } from "../lib/world";
import type { Guidance, PartStatus } from "../lib/guidance";
import type { Part } from "../lib/types";

/**
 * The live map: what is actually on the board, drawn on the same board as the
 * plan.
 *
 * Two kinds of thing are drawn, and they are drawn differently on purpose.
 * A part the vision model has identified gets its proper 3D shape. A part that
 * has only been located -- measured, but not yet named -- gets a plain block at
 * exactly its measured size, because a block is what we actually know is there.
 * Drawing a guessed resistor for an unidentified blob would look better and say
 * something untrue.
 */

/** Status colours, shared with the side panel. */
export const STATUS_COLOR: Record<PartStatus | "extra" | "unknown", string> = {
  placed: "#3ddc84",
  misplaced: "#ff9f3b",
  missing: "#ff6b5e",
  "not-yet": "#5a5d65",
  extra: "#7fa8ff",
  unknown: "#8e9099",
};

const SURFACE = BOARD.height / 2;

export function WorldLayer({ world, guidance, showLabels }: {
  world: World; guidance: Guidance; showLabels: boolean;
}) {
  // Which observed thing corresponds to which planned part, so the live map can
  // be coloured by whether it is right, not merely by what it is.
  const statusOf = useMemo(() => {
    const m = new Map<string, PartStatus>();
    for (const c of guidance.checks) if (c.entity) m.set(c.entity.id, c.status);
    return m;
  }, [guidance]);

  const missing = guidance.checks.filter((c) => c.status === "missing");

  // Parts on a breadboard sit close together, so labels at one height overlap
  // into an unreadable stack. Ordering by position along the board and stepping
  // the height keeps neighbours apart without moving anything.
  const tier = new Map<string, number>();
  [...world.entities]
    .sort((a, b) => a.centreMm.x - b.centreMm.x)
    .forEach((e, i) => tier.set(e.id, i % 3));

  return (
    <group>
      {world.entities.map((e) => (
        <ObservedEntity key={e.id} entity={e} tier={tier.get(e.id) ?? 0}
          status={statusOf.get(e.id) ?? "extra"} showLabel={showLabels} />
      ))}
      {missing.map((c, i) => (
        <GhostPart key={c.part.id} part={c.part} tier={i % 3} showLabel={showLabels} />
      ))}
    </group>
  );
}

function ObservedEntity({ entity, status, showLabel, tier }: {
  entity: Entity; status: PartStatus | "extra"; showLabel: boolean; tier: number;
}) {
  const colour = STATUS_COLOR[status] ?? STATUS_COLOR.unknown;
  const { x, z } = entity.centreMm;

  // An identified part is drawn as itself. Everything else is drawn as the
  // block we measured, which is the honest shape for "something is here".
  const known = entity.identified && entity.kind
    && entity.pins.length > 0 && entity.pins.every((p) => holePosition(p));

  return (
    <group>
      {known ? (
        <PartMesh part={asPart(entity)} highlighted={status === "misplaced"} />
      ) : (
        <MeasuredBlock entity={entity} />
      )}
      <StatusPad x={x} z={z}
        length={Math.max(entity.sizeMm.length, 3)}
        width={Math.max(entity.sizeMm.width, 3)}
        angle={entity.angleDeg} colour={colour} />
      {showLabel && (
        <Tag x={x} z={z} y={11 + tier * 5.5}
          text={`${entity.label}${entity.value ? ` ${entity.value}` : ""} · ${entity.footprint}`}
          accent={colour}
          dim={entity.confidence === "low"} />
      )}
    </group>
  );
}

/** An entity in the shape the 3D parts already know how to draw. */
function asPart(entity: Entity): Part {
  return {
    id: entity.id,
    kind: entity.kind!,
    label: entity.label,
    pins: entity.pins,
    color: entity.colorHex,
    value: entity.value,
    polarised: entity.polarised,
  };
}

/** A block at the measured size, angle and colour. Nothing inferred. */
function MeasuredBlock({ entity }: { entity: Entity }) {
  const { x, z } = entity.centreMm;
  const h = entity.shape === "wire" ? 1.6 : 3.4;
  return (
    <mesh
      position={[x, SURFACE + h / 2, z]}
      rotation={[0, THREE.MathUtils.degToRad(-entity.angleDeg), 0]}
      castShadow
    >
      <boxGeometry args={[Math.max(entity.sizeMm.length, 1.5), h,
                          Math.max(entity.sizeMm.width, 1.5)]} />
      <meshStandardMaterial
        color={entity.colorHex} roughness={0.6}
        transparent opacity={0.78}
        // An unidentified thing glows faintly so it reads as "not resolved yet"
        // rather than as a part that happens to be a grey box.
        emissive="#ffffff" emissiveIntensity={0.06}
      />
    </mesh>
  );
}

/** A flat status marker on the board under a part. */
function StatusPad({ x, z, length, width, angle, colour }: {
  x: number; z: number; length: number; width: number; angle: number; colour: string;
}) {
  return (
    <mesh position={[x, SURFACE + 0.06, z]}
          rotation={[-Math.PI / 2, 0, THREE.MathUtils.degToRad(angle)]}>
      <planeGeometry args={[length + 2.2, width + 2.2]} />
      <meshBasicMaterial color={colour} transparent opacity={0.22}
                         toneMapped={false} depthWrite={false} />
    </mesh>
  );
}

/**
 * A planned part that is not on the board: drawn as a wireframe where it should
 * go, so "what is missing" is a place on the board rather than a line of text.
 */
function GhostPart({ part, showLabel, tier }: {
  part: Part; showLabel: boolean; tier: number;
}) {
  const pts = part.pins.map((p) => holePosition(p)).filter((p) => p !== null);
  if (!pts.length) return null;

  const xs = pts.map((p) => p!.x);
  const zs = pts.map((p) => p!.z);
  const x = (Math.min(...xs) + Math.max(...xs)) / 2;
  const z = (Math.min(...zs) + Math.max(...zs)) / 2;
  const w = Math.max(Math.max(...xs) - Math.min(...xs), 4) + 3;
  const d = Math.max(Math.max(...zs) - Math.min(...zs), 4) + 3;

  return (
    <group>
      <mesh position={[x, SURFACE + 2.6, z]}>
        <boxGeometry args={[w, 5, d]} />
        <meshBasicMaterial color={STATUS_COLOR.missing} wireframe
                           transparent opacity={0.55} toneMapped={false} />
      </mesh>
      <StatusPad x={x} z={z} length={w} width={d} angle={0}
                 colour={STATUS_COLOR.missing} />
      {showLabel && (
        <Tag x={x} z={z} y={12 + tier * 5.5} text={`missing · ${part.label}`}
             accent={STATUS_COLOR.missing} />
      )}
    </group>
  );
}

/** A label that always faces the camera. */
function Tag({ x, y, z, text, accent, dim }: {
  x: number; y: number; z: number; text: string; accent: string; dim?: boolean;
}) {
  const { tex, aspect } = useMemo(
    () => textPlate(dim ? `${text} (uncertain)` : text, { accent }),
    [text, accent, dim]);
  const h = 3.6;
  return (
    <Billboard position={[x, y, z]}>
      <mesh>
        <planeGeometry args={[h * aspect, h]} />
        <meshBasicMaterial map={tex} transparent depthWrite={false}
                           opacity={dim ? 0.72 : 1} toneMapped={false} />
      </mesh>
    </Billboard>
  );
}
