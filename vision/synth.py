"""Render a synthetic breadboard photo with known ground truth.

Two jobs. It lets the pipeline be developed and tested without a webcam, and
more importantly it makes accuracy measurable: because we placed the parts in
named holes, we can check that the detector reads back the holes we put them in.
A pipeline that only ever ran against a live camera could be wrong by a row and
nobody would notice.
"""

from __future__ import annotations

import cv2
import numpy as np

from . import board as bd
from . import geometry as g

BG = (42, 40, 38)
PLASTIC = (216, 225, 228)          # BGR of the board's warm off-white
HOLE = (82, 78, 74)


def render_board(parts: list[dict], scale: float = 7.0,
                 tilt: float = 0.0, seed: int = 0) -> np.ndarray:
    """A top-down board with `parts` placed in named holes.

    Each part is {"kind": ..., "pins": ["E20","E22"], "colour": (b,g,r)}.
    `tilt` shears the result to imitate a camera that is not square-on.
    """
    rng = np.random.default_rng(seed)
    W = int(g.BOARD_WIDTH * scale)
    H = int(g.BOARD_DEPTH * scale)
    pad = int(28 * scale / 7)
    img = np.full((H + pad * 2, W + pad * 2, 3), BG, np.uint8)
    img += rng.integers(-6, 6, img.shape, dtype=np.int16).astype(np.uint8)

    def to_px(x: float, z: float) -> tuple[int, int]:
        return (int(round((x + g.BOARD_WIDTH / 2) * scale)) + pad,
                int(round((g.BOARD_DEPTH / 2 - z) * scale)) + pad)

    cv2.rectangle(img, (pad, pad), (pad + W, pad + H), PLASTIC, -1)

    # Printed rail stripes, at the same offsets the 3D board draws them.
    for rail, side in (("T+", +1), ("T-", -1), ("B+", -1), ("B-", +1)):
        _x, z = g.hole_xz(f"{rail}1")            # type: ignore[misc]
        col = (58, 62, 205) if rail[1] == "+" else (205, 110, 58)
        y = to_px(0, z + side * g.PITCH * 0.78)[1]
        cv2.line(img, (pad + 6, y), (pad + W - 6, y), col, max(1, int(scale * 0.8)))

    # The centre channel, slightly darker and recessed.
    cz0 = g.Z0 + g.row_offset("E")
    cz1 = g.Z0 + g.row_offset("F")
    cv2.rectangle(img, to_px(-g.BOARD_WIDTH / 2, cz1 - g.PITCH * 0.55),
                  to_px(g.BOARD_WIDTH / 2, cz0 + g.PITCH * 0.55), (196, 202, 206), -1)

    r = max(1, int(round(0.75 * scale)))
    for _ref, x, z in g.all_holes():
        cv2.rectangle(img, (to_px(x, z)[0] - r, to_px(x, z)[1] - r),
                      (to_px(x, z)[0] + r, to_px(x, z)[1] + r), HOLE, -1)

    for part in parts:
        pins = [g.hole_xz(p) for p in part["pins"]]
        pins = [p for p in pins if p]
        if not pins:
            continue
        colour = tuple(int(c) for c in part.get("colour", (60, 60, 60)))
        a = to_px(*pins[0])
        b = to_px(*pins[-1])
        kind = part["kind"]
        if kind == "wire":
            cv2.line(img, a, b, colour, max(2, int(scale * 1.1)), cv2.LINE_AA)
        elif kind == "resistor":
            cv2.line(img, a, b, (170, 175, 180), max(1, int(scale * 0.4)), cv2.LINE_AA)
            mid = ((a[0] + b[0]) // 2, (a[1] + b[1]) // 2)
            axis = np.array([b[0] - a[0], b[1] - a[1]], np.float32)
            half = np.linalg.norm(axis) * 0.3
            u = axis / (np.linalg.norm(axis) or 1)
            p0 = (int(mid[0] - u[0] * half), int(mid[1] - u[1] * half))
            p1 = (int(mid[0] + u[0] * half), int(mid[1] + u[1] * half))
            cv2.line(img, p0, p1, colour, max(3, int(scale * 1.6)), cv2.LINE_AA)
        elif kind == "ic":
            cv2.rectangle(img, a, b, colour, -1)
        else:
            cv2.circle(img, ((a[0] + b[0]) // 2, (a[1] + b[1]) // 2),
                       max(3, int(scale * 1.3)), colour, -1, cv2.LINE_AA)

    if tilt:
        src = np.array([[pad, pad], [pad + W, pad], [pad + W, pad + H], [pad, pad + H]], np.float32)
        dx = tilt * W
        dst = np.array([[pad + dx, pad + tilt * H * 0.4], [pad + W - dx, pad],
                        [pad + W, pad + H], [pad, pad + H - tilt * H * 0.3]], np.float32)
        M = cv2.getPerspectiveTransform(src, dst)
        img = cv2.warpPerspective(img, M, (img.shape[1], img.shape[0]), borderValue=BG)

    return cv2.GaussianBlur(img, (3, 3), 0)


#: The mock plan the web app ships, as physical parts -- so the synthetic frame
#: and web/src/lib/mockPlan.ts describe the same circuit.
GROUND_TRUTH = [
    {"kind": "led",       "pins": ["E20", "E22"], "colour": (48, 58, 235)},
    {"kind": "resistor",  "pins": ["E22", "E26"], "colour": (138, 192, 217)},
    {"kind": "wire",      "pins": ["A20", "T+20"], "colour": (235, 130, 47)},
    {"kind": "wire",      "pins": ["A26", "B-26"], "colour": (30, 30, 30)},
    {"kind": "ic",        "pins": ["E40", "F47"], "colour": (38, 38, 40)},
]

