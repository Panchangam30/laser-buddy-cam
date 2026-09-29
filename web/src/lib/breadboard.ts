/** Geometry adapter for the canonical breadboard workspace definition. */

import definition from "../workspaces/breadboard-830.v1.json";

export const WORKSPACE_PROFILE_ID = definition.id;
export const WORKSPACE_PROFILE_VERSION = definition.version;
export const PITCH = definition.columns.pitch;
export const COLUMNS = definition.columns.count;
export const CHANNEL = Math.abs(
  definition.lines.find((line) => line.id === "F")!.z
  - definition.lines.find((line) => line.id === "E")!.z,
);

/** Terminal rows, in the order they sit across the board. */
export type Row = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J";
export const ROWS = definition.lines
  .filter((line) => line.kind === "terminal")
  .map((line) => line.id as Row);

/** Power-rail identifiers: T=top, B=bottom, +=positive, -=negative. */
export type Rail = "T+" | "T-" | "B+" | "B-";
export const RAILS = definition.lines
  .filter((line) => line.kind === "rail")
  .map((line) => line.id as Rail);

const lineById = new Map(definition.lines.map((line) => [line.id, line]));

/** Centred Z coordinate of a terminal row. */
function rowZ(row: Row): number {
  return lineById.get(row)!.z;
}

const RAIL_Z: Record<Rail, number> = Object.fromEntries(
  RAILS.map((rail) => [rail, lineById.get(rail)!.z]),
) as Record<Rail, number>;

export const BOARD = {
  width: definition.dimensions.width,
  depth: definition.dimensions.depth,
  height: definition.dimensions.height,
  channelWidth: CHANNEL,
};

const X0 = definition.columns.firstX;

export interface Vec3 { x: number; y: number; z: number }

export interface HoleRef {
  kind: "terminal" | "rail";
  row?: Row;
  rail?: Rail;
  column: number;                    // 1-based
}

/**
 * Parse a hole reference.
 *   "E12"   -> terminal row E, column 12
 *   "T+5"   -> top positive rail, column 5
 * Returns null rather than throwing: the model does occasionally emit nonsense,
 * and one bad pin should drop a part, not crash the render.
 */
export function parseHole(ref: string): HoleRef | null {
  const s = ref.trim().toUpperCase();

  const rail = s.match(/^([TB])\s*([+-])\s*(\d{1,2})$/);
  if (rail) {
    const id = `${rail[1]}${rail[2]}` as Rail;
    const column = Number(rail[3]);
    if (!RAILS.includes(id) || !inRange(column)) return null;
    return { kind: "rail", rail: id, column };
  }

  const term = s.match(/^([A-J])\s*(\d{1,2})$/);
  if (term) {
    const row = term[1] as Row;
    const column = Number(term[2]);
    if (!inRange(column)) return null;
    return { kind: "terminal", row, column };
  }

  return null;
}

function inRange(column: number): boolean {
  return Number.isInteger(column) && column >= 1 && column <= COLUMNS;
}

/** World position of the top surface of a hole. */
export function holePosition(ref: string): Vec3 | null {
  const h = parseHole(ref);
  if (!h) return null;
  const x = X0 + (h.column - 1) * PITCH;
  const z = h.kind === "rail" ? RAIL_Z[h.rail!] : rowZ(h.row!);
  return { x, y: BOARD.height / 2, z };
}

/**
 * Electrical net a hole belongs to. Two holes on the same net are already
 * connected by the board itself -- used to flag a jumper that does nothing.
 */
export function netOf(ref: string): string | null {
  const h = parseHole(ref);
  if (!h) return null;
  const line = lineById.get(h.kind === "rail" ? h.rail! : h.row!);
  if (!line) return null;
  return line.kind === "rail" ? line.nodeGroup : `col:${h.column}:${line.nodeGroup}`;
}

/** Every hole on the board, for rendering the grid. */
export function allHoles(): { ref: string; pos: Vec3 }[] {
  const out: { ref: string; pos: Vec3 }[] = [];
  for (let c = 1; c <= COLUMNS; c++) {
    for (const r of ROWS) {
      const ref = `${r}${c}`;
      out.push({ ref, pos: holePosition(ref)! });
    }
    // Real boards break the rails into groups of five; skipping the
    // sixth hole of each group reproduces that without faking it.
    if (c % definition.railAppearance.missingEvery !== 0) {
      for (const rail of RAILS) {
        const ref = `${rail}${c}`;
        out.push({ ref, pos: holePosition(ref)! });
      }
    }
  }
  return out;
}

/**
 * The hole nearest a point on the board surface, or null if it is too far from
 * any row or rail to be meaningful.
 *
 * The inverse of holePosition, and the thing that makes a dragged part land in
 * a hole rather than between two. Mirrors nearest_hole() in vision/geometry.py.
 */
export function nearestHole(x: number, z: number, tolerance = PITCH): string | null {
  const column = Math.max(1, Math.min(COLUMNS, Math.round((x - X0) / PITCH) + 1));

  let best: string | null = null;
  let bestDistance = Infinity;
  for (const row of ROWS) {
    const d = Math.abs(z - rowZ(row));
    if (d < bestDistance) { best = row; bestDistance = d; }
  }
  for (const rail of RAILS) {
    const d = Math.abs(z - RAIL_Z[rail]);
    if (d < bestDistance) { best = rail; bestDistance = d; }
  }
  // A point out in the centre channel belongs to no hole, and naming one for it
  // would be an invention.
  if (best === null || bestDistance > tolerance) return null;
  return `${best}${column}`;
}

/**
 * Snap a point to the nearest hole. Returns the point unchanged when it is off
 * the grid, so dragging a part past the edge of the board still works.
 */
export function snapToHole(x: number, z: number): { x: number; z: number; ref: string | null } {
  const ref = nearestHole(x, z);
  const at = ref ? holePosition(ref) : null;
  return at ? { x: at.x, z: at.z, ref } : { x, z, ref: null };
}

/** Top surface of the board, where a through-hole part's body sits. */
export const SURFACE_Y = BOARD.height / 2;

/**
 * Off-board endpoints (an Arduino pin, a battery terminal) have no hole. They
 * are written "EXT:<label>" and anchored just off the front edge of the board,
 * lined up with whatever hole they connect to, so the wire visibly leaves the
 * board instead of silently disappearing.
 */
export const EXT_PREFIX = "EXT:";

export function isExternal(ref: string): boolean {
  return ref.trim().toUpperCase().startsWith(EXT_PREFIX);
}

export function externalLabel(ref: string): string {
  return ref.trim().slice(EXT_PREFIX.length).trim() || "external";
}

/** Anchor for an off-board endpoint, aligned with its on-board partner. */
export function externalPosition(alignWith: Vec3 | null): Vec3 {
  return {
    x: alignWith?.x ?? 0,
    y: BOARD.height / 2,
    z: -(BOARD.depth / 2) - 16,
  };
}
