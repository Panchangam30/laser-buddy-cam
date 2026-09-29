"""Find the breadboard in a frame and solve for its pose.

Everything downstream depends on this. Once we know where the board's four
corners are in the image, a homography turns any pixel into a millimetre
coordinate in the board's own frame, and geometry.py turns that into a hole
reference. That is the whole reason the map is trustworthy: we never ask a model
where a part is, we ask it only what a part is.

One ambiguity cannot be solved geometrically. A rectangle photographed from
above looks identical rotated 180 degrees, so the board's pose is only
determined up to which end holds column 1. That is carried as `flipped` and
resolved elsewhere (by reading the printed numbers, or by the user saying so),
never guessed silently here.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np

from . import geometry as g

#: Resolution of the rectified top-down view. 6 px/mm puts ~15 px between holes,
#: enough to resolve a lead but small enough to process every frame.
PX_PER_MM = 6.0

RECT_W = int(round(g.BOARD_WIDTH * PX_PER_MM))
RECT_H = int(round(g.BOARD_DEPTH * PX_PER_MM))

#: A board seen at an angle foreshortens, so accept a wide aspect window.
ASPECT_TOLERANCE = tuple(float(x) for x in g.PROFILE["registration"]["aspectTolerance"])

#: Below this the "board" is more likely a bright patch of bench.
MIN_AREA_FRACTION = float(g.PROFILE["registration"]["minimumAreaFraction"])


@dataclass
class BoardPose:
    """Where the board is, and how to move between the image and the board."""

    corners: np.ndarray                 # 4x2 float32, image pixels, ordered
    H_img_to_board: np.ndarray          # 3x3, image px -> board mm
    H_board_to_img: np.ndarray          # 3x3, board mm -> image px
    H_img_to_rect: np.ndarray           # 3x3, image px -> rectified px
    flipped: bool                       # True when column 1 is on the image right
    aspect: float
    area_fraction: float
    confidence: str = "medium"
    note: str = ""
    method: str = "outline-homography"
    registration_validation: str = "outline-only"

    def to_board(self, pts: np.ndarray) -> np.ndarray:
        """Image pixels -> board millimetres. Accepts (N,2), returns (N,2)."""
        return _apply(self.H_img_to_board, pts)

    def to_image(self, pts: np.ndarray) -> np.ndarray:
        """Board millimetres -> image pixels."""
        return _apply(self.H_board_to_img, pts)

    def rectify(self, frame: np.ndarray) -> np.ndarray:
        """Warp the frame to a straight-on view of the board."""
        return cv2.warpPerspective(frame, self.H_img_to_rect, (RECT_W, RECT_H),
                                   flags=cv2.INTER_LINEAR)

    def serialise(self) -> dict:
        return {
            "found": True,
            "corners": [[round(float(x), 1), round(float(y), 1)] for x, y in self.corners],
            "flipped": self.flipped,
            "aspect": round(self.aspect, 2),
            "coverage": round(self.area_fraction, 3),
            "confidence": self.confidence,
            "note": self.note,
            "registrationMethod": self.method,
            "registrationValidation": self.registration_validation,
            "widthMm": round(g.BOARD_WIDTH, 2),
            "depthMm": round(g.BOARD_DEPTH, 2),
        }


@dataclass
class NoBoard:
    """Returned instead of a pose when no board could be located."""

    reason: str
    hint: str = ""
    found: bool = field(default=False, init=False)

    def serialise(self) -> dict:
        return {"found": False, "reason": self.reason, "hint": self.hint}


def _apply(H: np.ndarray, pts: np.ndarray) -> np.ndarray:
    p = np.asarray(pts, dtype=np.float32).reshape(-1, 1, 2)
    return cv2.perspectiveTransform(p, H).reshape(-1, 2)


def _order_corners(quad: np.ndarray) -> np.ndarray:
    """Order four points as (near-left, near-right, far-right, far-left).

    "Near" is the long edge closest to the camera -- lowest on screen. Naming the
    corners explicitly rather than relying on winding order matters: get it wrong
    and the whole map is mirrored, which looks plausible and is completely wrong.

    This fixes the pose only up to which end of the board holds column 1. A
    rectangle photographed from above is identical rotated 180 degrees, and no
    amount of geometry settles it, so it is carried as `flipped` instead.
    """
    pts = np.asarray(quad, dtype=np.float32).reshape(4, 2)

    # Sort by angle about the centroid, giving a simple non-crossing polygon.
    centre = pts.mean(axis=0)
    angles = np.arctan2(pts[:, 1] - centre[1], pts[:, 0] - centre[0])
    pts = pts[np.argsort(angles)]

    # The two long edges run along the columns. Pick the one nearer the camera.
    edges = [(i, np.linalg.norm(pts[(i + 1) % 4] - pts[i])) for i in range(4)]
    long_start = max(edges, key=lambda e: e[1])[0]
    other_start = (long_start + 2) % 4

    def edge(i: int) -> tuple[np.ndarray, np.ndarray]:
        return pts[i], pts[(i + 1) % 4]

    a0, a1 = edge(long_start)
    b0, b1 = edge(other_start)
    a_mid, b_mid = (a0 + a1) / 2, (b0 + b1) / 2
    if abs(a_mid[1] - b_mid[1]) > 4:
        near, far = ((a0, a1), (b0, b1)) if a_mid[1] > b_mid[1] else ((b0, b1), (a0, a1))
    else:
        # Board appears end-on or vertical: fall back to left-most as "near" so
        # the choice is at least stable frame to frame.
        near, far = ((a0, a1), (b0, b1)) if a_mid[0] < b_mid[0] else ((b0, b1), (a0, a1))

    near_l, near_r = sorted(near, key=lambda p: p[0])
    far_l, far_r = sorted(far, key=lambda p: p[0])
    return np.array([near_l, near_r, far_r, far_l], dtype=np.float32)


def _board_corners(flipped: bool) -> np.ndarray:
    """The board's own four corners in millimetres, matching _order_corners.

    Near edge is -Z (the bottom rail side), far edge +Z, so the image's "near
    left" corner is (-W/2, -D/2) when not flipped.
    """
    w, d = g.BOARD_WIDTH / 2, g.BOARD_DEPTH / 2
    quad = np.array([[-w, -d], [+w, -d], [+w, +d], [-w, +d]], dtype=np.float32)
    if flipped:
        quad = quad * np.array([-1.0, -1.0], dtype=np.float32)   # 180 deg about Y
    return quad


def _rect_corners() -> np.ndarray:
    """Board corners in rectified-image pixels, in the same order."""
    return np.array([[0, RECT_H], [RECT_W, RECT_H], [RECT_W, 0], [0, 0]], dtype=np.float32)


def _candidate_quads(frame: np.ndarray) -> list[tuple[np.ndarray, float, float, str]]:
    """Plausible board outlines, as (quad, quad_area, fill_ratio, how-found).

    `fill_ratio` is how much of the candidate the detected region actually
    occupies. It is what separates a true four-cornered fit from a bounding
    rectangle thrown around a board seen at an angle: the rectangle is larger, so
    area alone picks it, and it then ignores perspective and shifts every hole
    reference by a column.
    """
    grey = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    grey = cv2.bilateralFilter(grey, 7, 40, 40)

    out: list[tuple[np.ndarray, float, float, str]] = []

    # A breadboard is a large pale slab. Otsu on brightness isolates it from most
    # benches without needing a tuned threshold.
    _, mask = cv2.threshold(grey, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    for c in sorted(contours, key=cv2.contourArea, reverse=True)[:4]:
        c_area = cv2.contourArea(c)
        if c_area <= 0:
            continue
        # A clean four-sided approximation is the best case: it gives the true
        # corners even when the board is tilted away from the camera.
        peri = cv2.arcLength(c, True)
        approx = cv2.approxPolyDP(c, 0.02 * peri, True)
        if len(approx) == 4 and cv2.isContourConvex(approx):
            a = cv2.contourArea(approx)
            if a > 0:
                out.append((approx.reshape(4, 2).astype(np.float32), a,
                            min(1.0, c_area / a), "quad"))
        # minAreaRect is the fallback: it survives a hand or a wire breaking the
        # outline, at the cost of ignoring perspective.
        rect = cv2.boxPoints(cv2.minAreaRect(c)).astype(np.float32)
        r_area = cv2.contourArea(rect)
        if r_area > 0:
            out.append((rect, r_area, min(1.0, c_area / r_area), "minAreaRect"))
    return out


def find_board(frame: np.ndarray, flipped: bool = False) -> BoardPose | NoBoard:
    """Locate the board and build the transforms. `flipped` chooses the pose."""
    h, w = frame.shape[:2]
    frame_area = float(h * w)
    if frame_area == 0:
        return NoBoard("empty frame")

    best: tuple[float, np.ndarray, float, str] | None = None
    for quad, area, fill, how in _candidate_quads(frame):
        if area / frame_area < MIN_AREA_FRACTION:
            continue
        ordered = _order_corners(quad)
        long_side = (np.linalg.norm(ordered[1] - ordered[0])
                     + np.linalg.norm(ordered[3] - ordered[2])) / 2
        short_side = (np.linalg.norm(ordered[2] - ordered[1])
                      + np.linalg.norm(ordered[0] - ordered[3])) / 2
        if short_side < 8:
            continue
        aspect = long_side / short_side
        if not ASPECT_TOLERANCE[0] <= aspect <= ASPECT_TOLERANCE[1]:
            continue
        # Score on how much this looks like a real board. The right aspect ratio
        # matters more than raw size, or a big pale desk wins; and a candidate the
        # detected region actually fills beats a larger one it does not, which is
        # what lets a true four-cornered fit win over a bounding rectangle.
        score = (area / frame_area
                 - 0.9 * abs(aspect - g.BOARD_ASPECT) / g.BOARD_ASPECT
                 + 0.5 * fill)
        if how == "quad":
            score += 0.05
        if best is None or score > best[0]:
            best = (score, ordered, area / frame_area, how)

    if best is None:
        return NoBoard(
            "no breadboard found in the frame",
            "Get the whole board in shot, roughly filling the width, on a "
            "background darker than the board itself.",
        )

    _, corners, coverage, how = best
    board_quad = _board_corners(flipped)
    H_img_to_board = cv2.getPerspectiveTransform(corners, board_quad)
    H_board_to_img = cv2.getPerspectiveTransform(board_quad, corners)
    H_img_to_rect = cv2.getPerspectiveTransform(
        corners, _rect_corners() if not flipped else _rect_corners()[[2, 3, 0, 1]])

    long_side = np.linalg.norm(corners[1] - corners[0])
    short_side = np.linalg.norm(corners[2] - corners[1])
    aspect = float(long_side / max(short_side, 1e-6))

    # Confidence is about how much to trust the hole references we derive, so it
    # tracks the two things that actually break them: a wrong aspect ratio means
    # we have not found the board, and a small board means sub-pitch precision.
    err = abs(aspect - g.BOARD_ASPECT) / g.BOARD_ASPECT
    if err < 0.12 and coverage > 0.12:
        confidence = "high"
    elif err < 0.3:
        confidence = "medium"
    else:
        confidence = "low"

    note = ""
    if how == "minAreaRect":
        note = "outline fitted as a rectangle; hole references drift if the board is tilted"
    if coverage < 0.1:
        note = "board is small in frame; move the camera closer for reliable hole references"

    return BoardPose(
        corners=corners,
        H_img_to_board=H_img_to_board,
        H_board_to_img=H_board_to_img,
        H_img_to_rect=H_img_to_rect,
        flipped=flipped,
        aspect=aspect,
        area_fraction=coverage,
        confidence=confidence,
        note=note,
        method=f"{how}-homography",
        registration_validation="outline-only",
    )


def hole_grid_mask(dilate_mm: float = 0.35) -> np.ndarray:
    """Mask of every hole in the rectified view.

    Holes are dark, and so are IC bodies and black jumper wires, so a brightness
    threshold alone cannot tell them apart. This is not used to erase pixels --
    that would eat the component sitting in the holes -- but to test whole blobs:
    a small blob lying almost entirely inside this mask is the board's own grid.
    The grid is known exactly, so this is a lookup, not a filter.
    """
    mask = np.zeros((RECT_H, RECT_W), np.uint8)
    r = max(1, int(round((1.5 / 2 + dilate_mm) * PX_PER_MM)))
    for _ref, x, z in g.all_holes():
        px, py = board_to_rect(x, z)
        cv2.circle(mask, (int(round(px)), int(round(py))), r, 255, -1)
    return mask


def printed_mask(width_mm: float | None = None) -> np.ndarray:
    """Mask of the printed red and blue rail stripes.

    These are saturated colour running the length of the board, which is exactly
    what a jumper wire looks like to a colour threshold. They sit at fixed
    distances from the rail holes, so they can be excluded by position.
    """
    mask = np.zeros((RECT_H, RECT_W), np.uint8)
    if width_mm is None:
        width_mm = float(g.PROFILE["railAppearance"]["stripeWidth"])
    half = width_mm / 2 * PX_PER_MM
    # Matches the stripe placement in web/src/three/Breadboard.tsx: just inboard
    # of each rail, offset by 0.78 of the hole pitch.
    for rail, side in (("T+", +1), ("T-", -1), ("B+", -1), ("B-", +1)):
        xz = g.hole_xz(f"{rail}1")
        if xz is None:
            continue
        _x, z = xz
        offset = float(g.PROFILE["railAppearance"]["stripeOffsetPitch"])
        _px, py = board_to_rect(0.0, z + side * g.PITCH * offset)
        cv2.rectangle(mask, (0, int(round(py - half))),
                      (RECT_W, int(round(py + half))), 255, -1)
    return mask


def rect_to_board(px: float, py: float) -> tuple[float, float]:
    """Rectified pixel -> board millimetre."""
    return (px / PX_PER_MM - g.BOARD_WIDTH / 2,
            g.BOARD_DEPTH / 2 - py / PX_PER_MM)


def board_to_rect(x: float, z: float) -> tuple[float, float]:
    """Board millimetre -> rectified pixel."""
    return ((x + g.BOARD_WIDTH / 2) * PX_PER_MM,
            (g.BOARD_DEPTH / 2 - z) * PX_PER_MM)
