"""Find the things sitting on the board, in board millimetres.

This is the OpenCV half of the map. It works on the rectified top-down view, so
every measurement it reports is already in the board's own frame -- no pixels
escape this file.

What it does NOT do is decide what a part is. It reports shape, size, colour and
which holes a blob covers; naming it a 220 ohm resistor is label.py's job, and
guessing a value from a blob would be exactly the kind of confident mistake the
rest of this project avoids.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from . import board as bd
from . import geometry as g

#: Smaller than this and it is a speck, a shadow or a single hole.
MIN_AREA_MM2 = 3.0
#: Bigger than this fraction of the board and it is the bench, a hand, or glare.
MAX_AREA_FRACTION = 0.42

#: A blob this much longer than it is wide, over this length, behaves like a wire.
#: 12 mm is the line that separates a jumper from an axial resistor body: a
#: resistor body is 6-9 mm long and also elongated, so elongation alone calls
#: every resistor a wire.
WIRE_ELONGATION = 2.6
WIRE_MIN_LENGTH_MM = 12.0
WIRE_MAX_WIDTH_MM = 3.5

_BOARD_AREA_MM2 = g.BOARD_WIDTH * g.BOARD_DEPTH

#: Reference colours for naming what we see. Names, not values -- "the blue wire"
#: is something a student can act on, "#2f7fff" is not.
_NAMED_COLOURS: tuple[tuple[str, tuple[int, int, int]], ...] = (
    ("black", (20, 20, 20)), ("grey", (128, 128, 128)), ("white", (235, 235, 235)),
    ("red", (200, 40, 35)), ("orange", (225, 120, 30)), ("yellow", (225, 205, 55)),
    ("green", (55, 160, 80)), ("blue", (45, 95, 205)), ("purple", (130, 75, 175)),
    ("brown", (110, 70, 45)), ("beige", (205, 185, 150)),
)


@dataclass
class Blob:
    """One connected region on the board, measured in millimetres."""

    centre: tuple[float, float]          # board mm (x, z)
    bbox: tuple[float, float, float, float]   # x0, z0, x1, z1 in board mm
    area_mm2: float
    length_mm: float                     # along the principal axis
    width_mm: float                      # across it
    angle_deg: float                      # principal axis, 0 = along the columns
    elongation: float
    colour_bgr: tuple[int, int, int]
    colour_name: str
    colour_hex: str
    shape: str                           # "wire" | "body"
    holes: tuple[str, ...]
    rows: tuple[str, ...]
    lines: tuple[str, ...]
    columns: tuple[int, int]
    endpoints: tuple[str | None, str | None]  # hole at each end, wires only
    nets: tuple[str, ...]
    crop_rect: tuple[int, int, int, int]      # rectified px, for the labeller
    straddles_channel: bool

    def describe(self) -> str:
        """One line a language model can read without further processing."""
        where = self.footprint_text()
        if self.shape == "wire" and all(self.endpoints):
            where = f"{self.endpoints[0]} to {self.endpoints[1]}"
        return (f"{self.colour_name} {self.shape}, {self.length_mm:.0f}x"
                f"{self.width_mm:.0f} mm, at {where}")

    def footprint_text(self) -> str:
        lo, hi = self.columns
        span = str(lo) if lo == hi else f"{lo}-{hi}"
        return f"{'/'.join(self.lines) or 'channel'}{span}"


def _colour_name(bgr: tuple[int, int, int]) -> str:
    b, g_, r = bgr
    rgb = np.array([r, g_, b], dtype=np.float32)
    # Weighted towards hue: a dim red wire and a bright red wire are both red.
    best, best_d = "grey", 1e9
    for name, ref in _NAMED_COLOURS:
        d = float(np.linalg.norm(rgb - np.array(ref, dtype=np.float32)))
        if d < best_d:
            best, best_d = name, d
    return best


def _stripe_pixels(hsv: np.ndarray) -> np.ndarray:
    """Red and blue pixels lying inside the printed rail bands."""
    h, sat = hsv[:, :, 0], hsv[:, :, 1]
    red = (h <= 12) | (h >= 168)
    blue = (h >= 95) & (h <= 135)
    stripe_coloured = ((red | blue) & (sat > 60)).astype(np.uint8) * 255
    return cv2.bitwise_and(bd.printed_mask(), stripe_coloured)


def _principal_axis(pts: np.ndarray) -> tuple[float, float, float, np.ndarray]:
    """Length, width and angle of a point cloud, plus its unit axis."""
    centred = pts - pts.mean(axis=0)
    if len(pts) < 3:
        return 0.0, 0.0, 0.0, np.array([1.0, 0.0], dtype=np.float32)
    # SVD rather than cv2.PCACompute: it copes with degenerate single-pixel-wide
    # blobs, which thin wires genuinely produce.
    _u, _s, vt = np.linalg.svd(centred, full_matrices=False)
    axis = vt[0] / (np.linalg.norm(vt[0]) or 1.0)
    across = np.array([-axis[1], axis[0]], dtype=np.float32)
    along_proj = centred @ axis
    across_proj = centred @ across
    length = float(along_proj.max() - along_proj.min())
    width = float(across_proj.max() - across_proj.min())
    angle = float(np.degrees(np.arctan2(axis[1], axis[0])))
    return length, width, angle, axis.astype(np.float32)


#: Hue bands, in OpenCV's 0-179 scale. Splitting the mask by colour before
#: labelling is what stops a red LED touching a blue jumper from being read as
#: one 34 mm part: same-coloured parts that touch still merge, but different
#: coloured ones separate for free.
_HUE_BANDS: tuple[tuple[str, int, int], ...] = (
    ("orange", 13, 24), ("yellow", 25, 35), ("green", 36, 85),
    ("cyan", 86, 94), ("blue", 95, 135), ("purple", 136, 167),
)

#: Ignore this much of the rectified border. The board's outermost holes sit
#: 2.54 mm in, so nothing is lost, and it discards the dark rim left when the
#: detected outline sits a pixel or two outside the real edge -- that rim is a
#: closed dark ring and otherwise reads as one board-sized component.
BORDER_INSET_MM = 2.0


def _border_mask() -> np.ndarray:
    m = np.zeros((bd.RECT_H, bd.RECT_W), np.uint8)
    inset = int(round(BORDER_INSET_MM * bd.PX_PER_MM))
    m[inset:bd.RECT_H - inset, inset:bd.RECT_W - inset] = 255
    return m


def _clean(mask: np.ndarray) -> np.ndarray:
    """Knit up speckle without bridging the 1 mm gap between adjacent holes."""
    k = max(3, int(round(0.5 * bd.PX_PER_MM)) | 1)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE,
                            cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    return cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))


def component_masks(rect: np.ndarray) -> list[tuple[str, np.ndarray]]:
    """One mask per colour of thing that is not bare board.

    Components divide cleanly into two kinds, and both are found relative to the
    board's own appearance rather than against fixed thresholds, so the detector
    survives a dim room or a desk lamp without being retuned. Anything with a
    coloured jacket or body -- jumpers, resistors, LEDs, capacitors -- shows as
    saturation against near-neutral plastic. Anything black -- a DIP chip, a black
    jumper -- shows as darkness. Bare plastic is neither.
    """
    hsv = cv2.cvtColor(rect, cv2.COLOR_BGR2HSV)
    hue, sat, val = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]

    holes = bd.hole_grid_mask()
    plastic_v = val[holes == 0]
    board_v = float(np.median(plastic_v)) if plastic_v.size else 160.0
    board_s = float(np.median(sat[holes == 0])) if plastic_v.size else 30.0

    inside = _border_mask()
    saturated = (sat > max(60.0, board_s + 45)) & (val > 45)
    dark = val < max(35.0, board_v * 0.55)

    # The printed rail stripes are saturated colour running the whole length of
    # the board; left in, they bridge every part into one board-wide blob. Only
    # their red and blue pixels are removed, not the whole band: a black jumper
    # crosses those bands, and erasing the band wholesale cuts the wire in two and
    # loses one endpoint. A red wire crossing the red stripe is still cut --
    # unavoidable without knowing which is which, and it survives as two blobs.
    stripes = _stripe_pixels(hsv) > 0

    out: list[tuple[str, np.ndarray]] = []
    red = (hue <= 12) | (hue >= 168)
    for name, band in [("red", red)] + [
            (n, (hue >= lo) & (hue <= hi)) for n, lo, hi in _HUE_BANDS]:
        m = (saturated & band & ~stripes).astype(np.uint8) * 255
        m = cv2.bitwise_and(_clean(m), inside)
        if m.any():
            out.append((name, m))

    m = cv2.bitwise_and(_clean(dark.astype(np.uint8) * 255), inside)
    if m.any():
        out.append(("dark", m))
    return out


def _measure(rect: np.ndarray, blob: np.ndarray, stats_row: np.ndarray,
             centroid: np.ndarray) -> Blob:
    """Turn one boolean pixel mask into a millimetre measurement of a part."""
    ys, xs = np.nonzero(blob)
    pts_px = np.column_stack([xs, ys]).astype(np.float32)
    length_px, width_px, angle_px, axis = _principal_axis(pts_px)

    length_mm = length_px / bd.PX_PER_MM
    width_mm = max(width_px / bd.PX_PER_MM, 0.1)
    elongation = length_mm / width_mm

    x0p = int(stats_row[cv2.CC_STAT_LEFT]);  y0p = int(stats_row[cv2.CC_STAT_TOP])
    wp = int(stats_row[cv2.CC_STAT_WIDTH]);  hp = int(stats_row[cv2.CC_STAT_HEIGHT])

    # Rectified Y runs opposite to board Z, so the bbox corners swap: the
    # top-left pixel is the low-X, high-Z corner of the board rectangle.
    bx0, bz1 = bd.rect_to_board(x0p, y0p)
    bx1, bz0 = bd.rect_to_board(x0p + wp, y0p + hp)

    median_bgr = np.median(rect[blob], axis=0)
    colour_bgr = (int(median_bgr[0]), int(median_bgr[1]), int(median_bgr[2]))

    is_wire = (elongation >= WIRE_ELONGATION and length_mm >= WIRE_MIN_LENGTH_MM
               and width_mm <= WIRE_MAX_WIDTH_MM)

    fp = g.footprint(bx0, bz0, bx1, bz1)

    endpoints: tuple[str | None, str | None] = (None, None)
    if is_wire:
        centre_px = pts_px.mean(axis=0)
        proj = (pts_px - centre_px) @ axis
        a_px = pts_px[int(np.argmin(proj))]
        b_px = pts_px[int(np.argmax(proj))]
        endpoints = (
            g.nearest_hole(*bd.rect_to_board(float(a_px[0]), float(a_px[1])),
                           tolerance=g.PITCH * 1.2),
            g.nearest_hole(*bd.rect_to_board(float(b_px[0]), float(b_px[1])),
                           tolerance=g.PITCH * 1.2),
        )

    # A jumper is defined by its two ends. A resistor or a chip is defined by the
    # holes its body covers, because its leads are thin bare metal the camera
    # frequently cannot see at all.
    holes_used = tuple(h for h in endpoints if h) if is_wire and all(endpoints) else fp.holes
    nets = tuple(dict.fromkeys(n for h in holes_used if (n := g.net_of(h))))

    # A DIP chip is the part that straddles the channel; nothing else should.
    straddles = (bz0 < g.Z0 + g.row_offset("E") + 0.5
                 and bz1 > g.Z0 + g.row_offset("F") - 0.5)

    pad = int(round(1.5 * bd.PX_PER_MM))
    crop = (max(0, x0p - pad), max(0, y0p - pad),
            min(bd.RECT_W, x0p + wp + pad), min(bd.RECT_H, y0p + hp + pad))

    cx, cz = bd.rect_to_board(float(centroid[0]), float(centroid[1]))

    return Blob(
        centre=(round(cx, 2), round(cz, 2)),
        bbox=(round(bx0, 2), round(bz0, 2), round(bx1, 2), round(bz1, 2)),
        area_mm2=round(float(blob.sum()) / (bd.PX_PER_MM ** 2), 1),
        length_mm=round(length_mm, 1),
        width_mm=round(width_mm, 1),
        angle_deg=round(-angle_px, 1),          # negate: pixel Y is flipped vs board Z
        elongation=round(elongation, 2),
        colour_bgr=colour_bgr,
        colour_name=_colour_name(colour_bgr),
        colour_hex="#%02x%02x%02x" % (colour_bgr[2], colour_bgr[1], colour_bgr[0]),
        shape="wire" if is_wire else "body",
        holes=holes_used,
        rows=fp.rows,
        lines=fp.lines,
        columns=fp.columns,
        endpoints=endpoints,
        nets=nets,
        crop_rect=crop,
        straddles_channel=straddles,
    )


def find_blobs(rect: np.ndarray) -> list[Blob]:
    """Every component-sized region on the rectified board."""
    holes = bd.hole_grid_mask()
    sat = cv2.cvtColor(rect, cv2.COLOR_BGR2HSV)[:, :, 1]
    out: list[Blob] = []

    for _bucket, mask in component_masks(rect):
        n, labels, stats, centroids = cv2.connectedComponentsWithStats(mask, connectivity=8)
        for i in range(1, n):
            area_mm2 = int(stats[i, cv2.CC_STAT_AREA]) / (bd.PX_PER_MM ** 2)
            if area_mm2 < MIN_AREA_MM2 or area_mm2 > _BOARD_AREA_MM2 * MAX_AREA_FRACTION:
                continue

            blob = labels == i
            # The board's own grid. Holes are dark, grey, and exactly where we
            # know holes to be; a part sitting on them obscures some, so a real
            # part never lines up this well. The saturation test is what keeps a
            # coloured wire running along a column of holes out of this bin.
            if (holes[blob] > 0).mean() > 0.72 and float(np.median(sat[blob])) < 60:
                continue

            out.append(_measure(rect, blob, stats[i], centroids[i]))

    # Largest first: the parts that matter most to a student are the big ones.
    out.sort(key=lambda b: b.area_mm2, reverse=True)
    return out
