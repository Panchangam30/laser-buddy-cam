"""Breadboard grid geometry, in millimetres.

This is a deliberate port of web/src/lib/breadboard.ts. The two files MUST agree:
the Python side decides which hole a detected blob sits in, the TypeScript side
decides where to draw it, and a disagreement between them shows up as parts
floating one row off in the 3D view. If you change a constant here, change it
there too.

Coordinate frame: millimetres. X runs along the columns, Z across the rows, Y up
out of the board. The origin is the centre of the board's plastic outline.
"""

from __future__ import annotations

from dataclasses import dataclass

PITCH = 2.54          # 0.1 inch, the universal hole spacing
COLUMNS = 63          # full-size 830-tie-point board
CHANNEL = 7.62        # 0.3 inch gutter between the E and F rows

ROWS = ("A", "B", "C", "D", "E", "F", "G", "H", "I", "J")
RAILS = ("T+", "T-", "B+", "B-")


def row_offset(row: str) -> float:
    """Z offset of a terminal row from row A."""
    i = ROWS.index(row)
    # Rows F-J sit past the centre channel, so they gain the channel width
    # instead of another pitch step.
    return i * PITCH if i <= 4 else 4 * PITCH + CHANNEL + (i - 5) * PITCH


LAST_ROW_Z = row_offset("J")
RAIL_GAP = PITCH * 2

RAIL_Z = {
    "B-": -RAIL_GAP - PITCH,
    "B+": -RAIL_GAP,
    "T+": LAST_ROW_Z + RAIL_GAP,
    "T-": LAST_ROW_Z + RAIL_GAP + PITCH,
}

MARGIN = PITCH        # plastic extends this far past the outermost holes

BOARD_WIDTH = (COLUMNS - 1) * PITCH + MARGIN * 2          # 162.56 mm
BOARD_DEPTH = RAIL_Z["T-"] - RAIL_Z["B-"] + MARGIN * 2    # 48.26 mm
BOARD_ASPECT = BOARD_WIDTH / BOARD_DEPTH                  # ~3.37

# Centre the grid on the origin, exactly as breadboard.ts does.
X0 = -((COLUMNS - 1) * PITCH) / 2
Z0 = -(RAIL_Z["B-"] + RAIL_Z["T-"]) / 2

#: Every addressable Z line, paired with its identifier, nearest-first lookups.
_Z_LINES: list[tuple[str, float]] = (
    [(r, Z0 + row_offset(r)) for r in ROWS]
    + [(r, Z0 + RAIL_Z[r]) for r in RAILS]
)


def hole_xz(ref: str) -> tuple[float, float] | None:
    """Board-frame (x, z) of a hole, or None if the reference is not a hole."""
    parsed = parse_hole(ref)
    if parsed is None:
        return None
    line, column = parsed
    z = Z0 + (RAIL_Z[line] if line in RAIL_Z else row_offset(line))
    return X0 + (column - 1) * PITCH, z


def parse_hole(ref: str) -> tuple[str, int] | None:
    """'E12' -> ('E', 12);  'T+5' -> ('T+', 5);  anything else -> None."""
    s = ref.strip().upper().replace(" ", "")
    if len(s) >= 3 and s[:2] in RAIL_Z and s[2:].isdigit():
        column = int(s[2:])
        return (s[:2], column) if 1 <= column <= COLUMNS else None
    if len(s) >= 2 and s[0] in ROWS and s[1:].isdigit():
        column = int(s[1:])
        return (s[0], column) if 1 <= column <= COLUMNS else None
    return None


def column_at(x: float) -> int:
    """Nearest column to an X coordinate, clamped into the board."""
    c = round((x - X0) / PITCH) + 1
    return max(1, min(COLUMNS, c))


def line_at(z: float) -> tuple[str, float]:
    """Nearest row or rail to a Z coordinate, with the distance to it in mm."""
    return min(((n, abs(z - zl)) for n, zl in _Z_LINES), key=lambda t: t[1])


def nearest_hole(x: float, z: float, tolerance: float = PITCH) -> str | None:
    """Hole reference nearest to a board-frame point.

    Returns None when the point is further than `tolerance` from any row or rail
    line -- a blob sitting in the centre channel belongs to no hole, and naming
    one for it would be an invention.
    """
    line, dz = line_at(z)
    if dz > tolerance:
        return None
    return f"{line}{column_at(x)}"


def net_of(ref: str) -> str | None:
    """Electrical net a hole belongs to.

    Two holes on the same net are already joined by the board's own springs, so
    this is what tells us a jumper does nothing or a component is shorted out.
    """
    parsed = parse_hole(ref)
    if parsed is None:
        return None
    line, column = parsed
    if line in RAIL_Z:
        return f"rail:{line}"          # rails run the full length of the board
    bank = "low" if ROWS.index(line) <= 4 else "high"
    return f"col:{column}:{bank}"


def all_holes() -> list[tuple[str, float, float]]:
    """(ref, x, z) for every hole, including the gaps real rails have."""
    out: list[tuple[str, float, float]] = []
    for c in range(1, COLUMNS + 1):
        for r in ROWS:
            x, z = hole_xz(f"{r}{c}")  # type: ignore[misc]
            out.append((f"{r}{c}", x, z))
        # Real boards break the rails into groups of five; skipping the sixth
        # hole of each group reproduces that without faking it.
        if c % 6 != 0:
            for rail in RAILS:
                x, z = hole_xz(f"{rail}{c}")  # type: ignore[misc]
                out.append((f"{rail}{c}", x, z))
    return out


@dataclass(frozen=True)
class Footprint:
    """The holes a detected blob covers, and the span it covers them over."""
    holes: tuple[str, ...]
    rows: tuple[str, ...]      # terminal rows only, A-J
    lines: tuple[str, ...]     # every row AND rail the blob reaches
    columns: tuple[int, int]

    def describe(self) -> str:
        lo, hi = self.columns
        span = f"{lo}" if lo == hi else f"{lo}-{hi}"
        # Rails have to appear: a jumper from A26 down to B-26 spans one terminal
        # row and two rails, and describing it as "A26" hides where it goes.
        head = "/".join(self.lines) or "channel"
        return f"{head}{span}"


def footprint(x0: float, z0: float, x1: float, z1: float) -> Footprint:
    """Every hole inside a board-frame rectangle."""
    c_lo, c_hi = sorted((column_at(x0), column_at(x1)))
    lines = [n for n, zl in _Z_LINES if min(z0, z1) - PITCH * 0.4 <= zl <= max(z0, z1) + PITCH * 0.4]
    holes = tuple(f"{n}{c}" for n in lines for c in range(c_lo, c_hi + 1))
    rows = tuple(n for n in lines if n in ROWS)
    return Footprint(holes=holes, rows=rows, lines=tuple(lines), columns=(c_lo, c_hi))
