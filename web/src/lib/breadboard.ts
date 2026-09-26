/**
 * Geometry of a standard 830-tie-point solderless breadboard.
 *
 * This file is why the 3D view is accurate rather than guessed: a breadboard is
 * a fixed grid, so the vision model only has to name a hole ("E12") and we
 * derive the exact position from it. No invented coordinates.
 *
 * Coordinate system: millimetres, X along the columns, Z across the rows,
 * Y up out of the board. The origin sits at the centre of the board.
 */

export const PITCH = 2.54;          // 0.1 inch, the universal hole spacing
export const COLUMNS = 63;          // full-size board
export const CHANNEL = 7.62;        // 0.3 inch gap between the E and F rows

/** Terminal rows, in the order they sit across the board. */
export const ROWS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"] as const;
export type Row = (typeof ROWS)[number];

/** Power-rail identifiers: T=top, B=bottom, +=positive, -=negative. */
export const RAILS = ["T+", "T-", "B+", "B-"] as const;
export type Rail = (typeof RAILS)[number];

/** Z offset of each terminal row from row A. */
function rowOffset(row: Row): number {
  const i = ROWS.indexOf(row);
  // Rows F-J sit past the centre channel, so they gain the channel width
  // instead of another pitch step.
  return i <= 4 ? i * PITCH : 4 * PITCH + CHANNEL + (i - 5) * PITCH;
}

const LAST_ROW_Z = rowOffset("J");

/** Rails sit outboard of rows A and J, with a wider gap to the terminal strip. */
const RAIL_GAP = PITCH * 2;
const RAIL_Z: Record<Rail, number> = {
  "B-": -RAIL_GAP - PITCH,
  "B+": -RAIL_GAP,
  "T+": LAST_ROW_Z + RAIL_GAP,
  "T-": LAST_ROW_Z + RAIL_GAP + PITCH,
};

/** Plastic body extends past the outermost holes. */
const MARGIN = PITCH;

export const BOARD = {
  width: (COLUMNS - 1) * PITCH + MARGIN * 2,
  depth: RAIL_Z["T-"] - RAIL_Z["B-"] + MARGIN * 2,
  height: 9,                         // typical board thickness in mm
  channelWidth: CHANNEL,
};

/** Centre the grid on the origin. */
const X0 = -((COLUMNS - 1) * PITCH) / 2;
const Z0 = -(RAIL_Z["B-"] + RAIL_Z["T-"]) / 2;

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
  const z = Z0 + (h.kind === "rail" ? RAIL_Z[h.rail!] : rowOffset(h.row!));
  return { x, y: BOARD.height / 2, z };
}

/**
 * Electrical net a hole belongs to. Two holes on the same net are already
 * connected by the board itself -- used to flag a jumper that does nothing.
 */
export function netOf(ref: string): string | null {
  const h = parseHole(ref);
  if (!h) return null;
  if (h.kind === "rail") return `rail:${h.rail}`;     // rails run the full length
  const bank = ROWS.indexOf(h.row!) <= 4 ? "low" : "high";
  return `col:${h.column}:${bank}`;
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
    if (c % 6 !== 0) {
      for (const rail of RAILS) {
        const ref = `${rail}${c}`;
        out.push({ ref, pos: holePosition(ref)! });
      }
    }
  }
  return out;
}

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
