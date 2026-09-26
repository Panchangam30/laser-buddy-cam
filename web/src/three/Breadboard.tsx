import { useMemo } from "react";
import * as THREE from "three";
import { RoundedBox } from "@react-three/drei";
import { allHoles, BOARD, COLUMNS, PITCH, ROWS, RAILS, holePosition } from "../lib/breadboard";
import { labelTexture } from "./labels";

// Real slots are ~1.5mm on a 2.54mm pitch, but rendered pure-dark at that size
// they visually dominate and the board reads as a grid instead of a board.
const HOLE = 1.15;
const SURFACE = BOARD.height / 2;

export function Breadboard() {
  return (
    <group>
      <Body />
      <Channel />
      <Holes />
      <RailStripes />
      <RowLabels />
      <ColumnLabels />
    </group>
  );
}

/** Slightly warm off-white plastic with a softened edge. */
function Body() {
  return (
    <RoundedBox args={[BOARD.width, BOARD.height, BOARD.depth]} radius={0.9} smoothness={4}
                castShadow receiveShadow>
      <meshStandardMaterial color="#e4e1d8" roughness={0.68} metalness={0.02} />
    </RoundedBox>
  );
}

/** The recessed centre gutter, with visible side walls and a darker floor. */
function Channel() {
  const w = BOARD.channelWidth - PITCH * 0.8;
  const depth = 2.2;
  return (
    <group>
      <mesh position={[0, SURFACE - depth / 2, 0]} receiveShadow>
        <boxGeometry args={[BOARD.width - 2, depth, w]} />
        <meshStandardMaterial color="#c6c2b8" roughness={0.85} />
      </mesh>
      <mesh position={[0, SURFACE - depth + 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[BOARD.width - 2, w]} />
        <meshStandardMaterial color="#b0aca2" roughness={0.98} />
      </mesh>
    </group>
  );
}

/**
 * 842 square slots in one instanced mesh. Recessed below the surface so they
 * read as holes rather than printed dots.
 */
function Holes() {
  const mesh = useMemo(() => {
    const holes = allHoles();
    const geo = new THREE.BoxGeometry(HOLE, 1.2, HOLE);
    const mat = new THREE.MeshStandardMaterial({
      color: "#4a4a52", roughness: 0.9, metalness: 0.25,
    });
    const im = new THREE.InstancedMesh(geo, mat, holes.length);
    const o = new THREE.Object3D();
    holes.forEach((h, i) => {
      o.position.set(h.pos.x, SURFACE - 0.55, h.pos.z);
      o.updateMatrix();
      im.setMatrixAt(i, o.matrix);
    });
    im.instanceMatrix.needsUpdate = true;
    im.receiveShadow = true;
    return im;
  }, []);
  return <primitive object={mesh} />;
}

/** Red and blue rail lines, drawn just inboard of each rail. */
function RailStripes() {
  const y = SURFACE + 0.02;
  const cfg: [string, string, number][] = [
    ["T+", "#d4453b", +1], ["T-", "#3b6fd4", -1],
    ["B+", "#d4453b", -1], ["B-", "#3b6fd4", +1],
  ];
  return (
    <>
      {cfg.map(([rail, color, side]) => {
        const p = holePosition(`${rail}1`);
        if (!p) return null;
        return (
          <mesh key={rail} rotation={[-Math.PI / 2, 0, 0]}
                position={[0, y, p.z + side * PITCH * 0.78]}>
            <planeGeometry args={[BOARD.width * 0.93, 0.3]} />
            <meshBasicMaterial color={color} toneMapped={false} />
          </mesh>
        );
      })}
    </>
  );
}

function Flat({ text, x, z, size = 2.2, color }: {
  text: string; x: number; z: number; size?: number; color?: string;
}) {
  const tex = useMemo(() => labelTexture(text, color), [text, color]);
  return (
    <mesh position={[x, SURFACE + 0.03, z]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[size, size]} />
      <meshBasicMaterial map={tex} transparent depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

/** Row letters at both ends of the terminal strip. */
function RowLabels() {
  const ends = [-1, 1];
  return (
    <>
      {ROWS.map((r) =>
        ends.map((e) => {
          const p = holePosition(`${r}${e < 0 ? 1 : COLUMNS}`);
          if (!p) return null;
          return <Flat key={`${r}${e}`} text={r} x={p.x + e * PITCH * 1.5} z={p.z} size={2} />;
        })
      )}
    </>
  );
}

/** Column numbers every five, above and below the terminal rows. */
function ColumnLabels() {
  const out = [];
  for (let c = 1; c <= COLUMNS; c += c === 1 ? 4 : 5) {
    const a = holePosition(`A${c}`);
    const j = holePosition(`J${c}`);
    if (a) out.push(<Flat key={`a${c}`} text={String(c)} x={a.x} z={a.z - PITCH * 1.35} size={2.1} />);
    if (j) out.push(<Flat key={`j${c}`} text={String(c)} x={j.x} z={j.z + PITCH * 1.35} size={2.1} />);
  }
  // + and - beside each rail
  for (const rail of RAILS) {
    const p = holePosition(`${rail}1`);
    if (p) out.push(
      <Flat key={rail} text={rail[1]} x={-BOARD.width / 2 + 2.6} z={p.z}
            size={2.4} color={rail[1] === "+" ? "#d4453b" : "#3b6fd4"} />
    );
  }
  return <>{out}</>;
}
