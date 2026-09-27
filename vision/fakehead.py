"""A simulated LaserBuddy, for testing the aiming loop without hardware.

Models the real geometry: a laser on a two-axis mount some distance from the
board, whose beam traces a polar pattern across it -- deliberately NOT the
quadratic that aim.py fits, so the fit has to genuinely approximate something
else rather than recover its own formula. It also honours the firmware's angle
limits and clamps silently, exactly as the real head does.

Used by selftest.py. Nothing in the running system imports it.
"""

from __future__ import annotations

import math

import cv2
import numpy as np

from . import geometry as g
from . import synth
from .laser import PAN_MAX, PAN_MIN, TILT_MAX, TILT_MIN, Pose


class FakeHead:
    """Stands in for LaserLink: same attributes and methods the Calibrator uses."""

    def __init__(self, height: float = 300.0, back: float = 200.0,
                 skew: float = 1.5, pan0: float = 96.0, tilt0: float = 52.0) -> None:
        self.height = height
        self.back = back
        self.skew = skew                 # degrees of mount rotation, so the axes
        self.pose = Pose(pan0, tilt0)    # are not neatly aligned with the board
        self.laser_on = False
        self.connected = True
        self.error = ""
        self.moves = 0

    def hit(self, pan: float, tilt: float) -> tuple[float, float]:
        """Where the beam lands on the board plane, in board millimetres."""
        a = math.radians(pan - 90.0)
        b = math.radians(90.0 - tilt)
        x = self.height * math.tan(a)
        z = self.height * math.tan(b) - self.back
        # A crooked mount: the head's axes are not parallel to the board's.
        s = math.radians(self.skew)
        return (x * math.cos(s) - z * math.sin(s),
                x * math.sin(s) + z * math.cos(s))

    def move(self, pan: float, tilt: float, smooth: bool = True) -> bool:
        self.pose = Pose(max(PAN_MIN, min(PAN_MAX, pan)),
                         max(TILT_MIN, min(TILT_MAX, tilt)))
        self.moves += 1
        return True

    def set_laser(self, on: bool) -> bool:
        self.laser_on = on
        return True

    def render(self, base: np.ndarray, pose) -> np.ndarray:
        """The camera's view, with the dot drawn where the beam actually lands."""
        frame = base.copy()
        if self.laser_on:
            x, z = self.hit(self.pose.pan, self.pose.tilt)
            if abs(x) <= g.BOARD_WIDTH / 2 and abs(z) <= g.BOARD_DEPTH / 2:
                pt = pose.to_image(np.array([[x, z]], np.float32))[0]
                cv2.circle(frame, (int(round(pt[0])), int(round(pt[1]))), 4,
                           (45, 45, 255), -1)
        # Blur both cases equally. Blurring only the laser-on frame would leave a
        # difference everywhere the image has an edge, which flatters any detector
        # that works by differencing and hides exactly the bugs this is for.
        return cv2.GaussianBlur(frame, (5, 5), 0)


def rig(seed: int = 0, **kw) -> tuple[FakeHead, np.ndarray]:
    """A fake head and a synthetic board photo to shine it on."""
    return FakeHead(**kw), synth.render_board(synth.GROUND_TRUTH, seed=seed)
