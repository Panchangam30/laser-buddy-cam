import { Component, Suspense, useEffect, useMemo, type ReactNode } from "react";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";

/**
 * A part model built from CAD by scripts/models (see public/models/CREDITS.md).
 *
 * The loaded scene is shared, so each use takes its own clone, and its own
 * copies of whichever materials it changes -- otherwise selecting one LED
 * would light every LED on the bench. The procedural model it replaces is the
 * fallback while the file loads, so nothing pops out of existence.
 */
export function GlbModel({ url, fallback, selected, glow, recolor, position, children }: {
  url: string;
  /** Extra detail drawn with the model, in its frame (a resistor's bands). */
  children?: ReactNode;
  fallback: ReactNode;
  selected?: boolean;
  /** Materials that take the blue selection rim. Omit for every non-metal. */
  glow?: string[];
  /** Material name -> colour, for parts whose colour varies (an LED's lens). */
  recolor?: Record<string, string>;
  position?: [number, number, number];
}) {
  return (
    <MissingModel fallback={fallback}>
      <Suspense fallback={fallback}>
        <Loaded url={url} selected={selected} glow={glow} recolor={recolor} position={position} />
        {children}
      </Suspense>
    </MissingModel>
  );
}

/**
 * If a model file fails to load (not deployed, offline), keep showing the
 * hand-built part instead of letting the error take down the whole canvas.
 */
class MissingModel extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.warn("3D model failed to load; using the simple model.", error); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function Loaded({ url, selected, glow, recolor, position }: {
  url: string; selected?: boolean; glow?: string[];
  recolor?: Record<string, string>; position?: [number, number, number];
}) {
  const { scene } = useGLTF(url, false, true);
  const recolorKey = JSON.stringify(recolor ?? {});
  const glowKey = glow?.join("\n");
  const object = useMemo(() => {
    const clone = scene.clone(true);
    const colours = JSON.parse(recolorKey) as Record<string, string>;
    clone.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      const colour = colours[mat.name];
      const lit = selected && (glowKey !== undefined ? glowKey.split("\n").includes(mat.name) : mat.metalness < 0.5);
      if (!colour && !lit) return;
      const own = mat.clone();
      own.userData.owned = true;
      if (colour) own.color.set(colour);
      if (lit) { own.emissive.set("#2f6bd8"); own.emissiveIntensity = 0.32; }
      mesh.material = own;
    });
    return clone;
  }, [scene, selected, glowKey, recolorKey]);

  // Cloned materials are this instance's to free.
  useEffect(() => () => {
    object.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && (mesh.material as THREE.Material).userData.owned) {
        (mesh.material as THREE.Material).dispose();
      }
    });
  }, [object]);

  return <primitive object={object} position={position} />;
}

/** Start fetching a model before anything asks for it. */
export function preloadModel(url: string) {
  useGLTF.preload(url, false, true);
}

/**
 * Suspends until a model is loaded, then reports it. ThumbPage uses this so a
 * thumbnail is never captured from the placeholder.
 */
export function ModelReady({ url, onReady }: { url: string; onReady: () => void }) {
  useGLTF(url, false, true);
  useEffect(onReady, [onReady]);
  return null;
}
