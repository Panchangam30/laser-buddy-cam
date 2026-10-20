/**
 * The live map of what is actually on the bench.
 *
 * Mirrors the schema built in vision/world.py. Everything in it is either
 * measured from the board's grid -- positions, sizes, which holes, which
 * electrical nets -- or identified by the vision model, and each field says
 * which. `Plan` in types.ts is the opposite thing: what the board SHOULD look
 * like. Reconciling the two is guidance.ts.
 */

import type { PartKind } from "./types";
import type { WorkspaceDescriptor, WorkspaceLocation } from "./workspace";

/** One physical thing seen on the board. */
export interface Entity {
  id: string;
  /** False when it has been located but not yet identified -- not the same as unknown. */
  identified: boolean;
  kind: PartKind | null;
  label: string;
  /** "220 ohm", or "" when the markings could not be read. */
  value: string;
  unreadable: boolean;
  polarised: boolean;
  /** Weakest link of board pose, identification and how long it has been seen. */
  confidence: "high" | "medium" | "low";
  shape: "wire" | "body";
  /** Holes the renderer draws it between. */
  pins: string[];
  /** Scoped locations corresponding to pins; pins remains for v1 compatibility. */
  locations?: WorkspaceLocation[];
  /** Bodies whose bare leads are not visible do not have measured terminals. */
  terminalEvidence?: "measured" | "inferred" | "unknown";
  /** Every hole its body covers. */
  holes: string[];
  /** "E20 to E22" for a jumper, "E/F40-47" for a body. */
  footprint: string;
  footprintBox: string;
  nets: string[];
  straddlesChannel: boolean;
  /** At the very ends of the board, where hole references are least reliable. */
  atEdge: boolean;
  colorHex: string;
  colorName: string;
  sizeMm: { length: number; width: number; area: number };
  centreMm: { x: number; z: number };
  angleDeg: number;
  present: boolean;
  seenFrames: number;
  ageS: number;
  note: string;
  describe: string;
}

/** A fault that follows from the wiring alone, provable from the nets. */
export interface Issue {
  severity: "error" | "warn" | "info";
  message: string;
  entities: string[];
}

export interface BoardPose {
  found: boolean;
  corners?: [number, number][];
  flipped?: boolean;
  aspect?: number;
  coverage?: number;
  confidence?: "high" | "medium" | "low";
  note?: string;
  widthMm?: number;
  depthMm?: number;
  registrationMethod?: string;
  registrationValidation?: string;
  /** Set only when found is false. */
  reason?: string;
  hint?: string;
}

export interface World {
  at: number;
  frame: number;
  board: BoardPose;
  workspace?: WorkspaceDescriptor & {
    registration?: {
      found: boolean;
      confidence?: "high" | "medium" | "low";
      method?: string;
      validation?: string;
      note?: string;
    };
  };
  entities: Entity[];
  /** net id -> entity ids sharing it. Two parts on one net are already joined. */
  nets: Record<string, string[]>;
  issues: Issue[];
  errors: string[];
  /** Prose the voice model can read without any preprocessing. */
  summary: string;
  orientation?: { flipped: boolean; source: string };
}

export const EMPTY_WORLD: World = {
  at: 0,
  frame: 0,
  board: { found: false },
  entities: [],
  nets: {},
  issues: [],
  errors: [],
  summary: "The board has not been looked at yet.",
};

/** Send a frame to the vision service and get the updated map back. */
/** With no image, the service analyses its own camera's newest frame. */
export async function analyseFrame(imageDataUrl: string | null, signal?: AbortSignal): Promise<World> {
  const r = await fetch("/api/vision/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(imageDataUrl ? { image: imageDataUrl } : {}),
    signal,
  });
  const body = await r.json();
  if (!r.ok) throw new Error(body.detail || body.error || `HTTP ${r.status}`);
  return body as World;
}

export async function getWorld(): Promise<World> {
  const r = await fetch("/api/vision/world");
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as World;
}

/** Tell the service which end of the board holds column 1. Resets the map. */
export async function setOrientation(flipped: boolean): Promise<void> {
  await fetch("/api/vision/orientation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ flipped }),
  });
}

export async function resetWorld(): Promise<void> {
  await fetch("/api/vision/reset", { method: "POST" });
}

export function visionDebugUrl(view: "rect" | "frame" = "rect"): string {
  return `/api/vision/debug.jpg?view=${view}&t=${Date.now()}`;
}
