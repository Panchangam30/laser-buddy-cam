"""Teach the laser where the board's holes are, using the camera.

The head knows nothing about the board and the board knows nothing about the
head. What connects them is that the camera can see both: board.py already turns
any camera pixel into a millimetre position on the board, so if we switch the
laser on and find its dot in the frame, we learn where one pair of servo angles
lands. Do that enough times and the mapping is measured rather than assumed.

That is the whole reason this is a closed loop. Working out the angles from first
principles needs the laser's exact position and orientation relative to the
board, and every one of those numbers is a measurement nobody takes with a ruler
on a bench. Aiming, checking where the dot actually went, and correcting needs
none of them, and it absorbs servo nonlinearity and a crooked mount for free.

The fit maps board millimetres straight to servo angles -- the direction we
actually need -- so nothing has to be inverted at aim time.
"""

from __future__ import annotations

import json
import os
import threading
import time
from dataclasses import dataclass, field

import cv2
import numpy as np

from . import board as bd
from . import geometry as g
from .laser import PAN_MAX, PAN_MIN, TILT_MAX, TILT_MIN

#: A laser dot is small. Anything bigger than this in the difference image is a
#: hand, a reflection or a lighting change, not the dot.
MAX_DOT_MM = 9.0
MIN_DOT_MM = 0.4

#: How much brighter the dot has to be than the same pixel with the laser off.
MIN_DIFF = 38

#: Samples needed before a fit is allowed. Six is the minimum the quadratic
#: needs; below ten it fits the noise as happily as the geometry.
MIN_SAMPLES = 10

CALIBRATION_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                "calibration.json")


@dataclass
class Sample:
    """One measured correspondence: these angles put the dot here."""
    pan: float
    tilt: float
    x: float          # board mm
    z: float          # board mm


def find_dot(frame_on: np.ndarray, pose_on: bd.BoardPose,
             frame_off: np.ndarray, pose_off: bd.BoardPose) -> tuple[float, float] | None:
    """Board-millimetre position of the laser dot, or None if it is not visible.

    Works on the difference between laser-on and laser-off, which is what makes
    it robust: the board's own printed red rail stripes, a red LED and a red
    jumper are all present in both frames and cancel. Only something that turned
    on between them survives.

    Each frame is straightened with its OWN board pose before they are compared.
    Sharing one pose looks harmless and is not: calibration takes a minute, the
    camera or the board gets nudged in that time, and the two frames then differ
    everywhere, which reads as a dot the size of the board.
    """
    on = pose_on.rectify(frame_on)
    off = pose_off.rectify(frame_off)

    # How red each pixel is, relative to its own brightness -- computed on each
    # image separately, then differenced.
    #
    # Differencing the images first and looking for red in the result does not
    # work, and the failure is silent. On a dark hole the dot raises the red
    # channel and that is what you see; on light plastic, which is most of the
    # board, red is already near its ceiling, so the dot instead DROPS blue and
    # green. An absolute difference throws the sign away, the two cases look
    # opposite, and the dot is only ever found on the dark parts of the board.
    score = np.clip(_redness(on) - _redness(off), 0, 255).astype(np.uint8)
    score = cv2.GaussianBlur(score, (5, 5), 0)

    peak = float(score.max())
    if peak < MIN_DIFF:
        return None

    # Threshold relative to this frame's own peak: the dot's absolute brightness
    # depends on the surface it lands on and on how far the head is turned.
    _, mask = cv2.threshold(score, max(MIN_DIFF, peak * 0.55), 255, cv2.THRESH_BINARY)
    n, labels, stats, centroids = cv2.connectedComponentsWithStats(mask, connectivity=8)
    if n <= 1:
        return None

    best: tuple[float, int] | None = None
    for i in range(1, n):
        area_mm2 = stats[i, cv2.CC_STAT_AREA] / (bd.PX_PER_MM ** 2)
        side = max(stats[i, cv2.CC_STAT_WIDTH], stats[i, cv2.CC_STAT_HEIGHT]) / bd.PX_PER_MM
        if side > MAX_DOT_MM or side < MIN_DOT_MM:
            continue
        brightness = float(score[labels == i].mean())
        if best is None or brightness > best[0]:
            best = (brightness, i)
    if best is None:
        return None

    cx, cy = centroids[best[1]]
    return bd.rect_to_board(float(cx), float(cy))


def _redness(img: np.ndarray) -> np.ndarray:
    """How far each pixel leans red, as a signed value."""
    b, g_, r = cv2.split(img.astype(np.int16))
    return r - (b + g_) // 2


def _design(x: float, z: float) -> np.ndarray:
    """Quadratic basis in board position.

    Quadratic rather than linear because a laser swung on two axes across a flat
    board does not trace a straight grid -- the further it reaches, the faster a
    degree of pan travels. Quadratic captures that, and the residual it leaves is
    smaller than a hole.
    """
    return np.array([1.0, x, z, x * z, x * x, z * z], dtype=np.float64)


@dataclass
class Aimer:
    """The learned map from board millimetres to servo angles."""

    samples: list[Sample] = field(default_factory=list)
    pan_coef: list[float] | None = None
    tilt_coef: list[float] | None = None
    #: RMS of where the dot actually landed against where it was aimed, in mm.
    rms_mm: float | None = None
    checked: int = 0
    at: float = 0.0

    @property
    def ready(self) -> bool:
        return self.pan_coef is not None and self.tilt_coef is not None

    def fit(self) -> bool:
        """Least squares over every sample. False if there are not enough."""
        if len(self.samples) < MIN_SAMPLES:
            return False
        A = np.array([_design(s.x, s.z) for s in self.samples])
        pan = np.array([s.pan for s in self.samples])
        tilt = np.array([s.tilt for s in self.samples])
        # lstsq rather than a normal-equation solve: the design matrix is
        # ill-conditioned whenever the samples cluster, which they do when half
        # the sweep misses the board.
        pc, *_ = np.linalg.lstsq(A, pan, rcond=None)
        tc, *_ = np.linalg.lstsq(A, tilt, rcond=None)
        if not (np.all(np.isfinite(pc)) and np.all(np.isfinite(tc))):
            return False
        self.pan_coef = [float(v) for v in pc]
        self.tilt_coef = [float(v) for v in tc]
        self.at = time.time()
        return True

    def angles_for(self, x: float, z: float) -> tuple[float, float] | None:
        if not self.ready:
            return None
        d = _design(x, z)
        return (float(d @ np.array(self.pan_coef)),
                float(d @ np.array(self.tilt_coef)))

    def angles_for_hole(self, ref: str) -> tuple[float, float] | None:
        xz = g.hole_xz(ref)
        return self.angles_for(*xz) if xz else None

    def covers(self, x: float, z: float, margin: float = 12.0) -> bool:
        """Is this point inside the region the samples actually span?

        Outside it the quadratic is extrapolating, and a quadratic extrapolates
        badly. Better to say the point was not calibrated than to send the head
        somewhere confident and wrong.
        """
        if not self.samples:
            return False
        xs = [s.x for s in self.samples]
        zs = [s.z for s in self.samples]
        return (min(xs) - margin <= x <= max(xs) + margin
                and min(zs) - margin <= z <= max(zs) + margin)

    # ------------------------------------------------------------- persistence

    def save(self, path: str = CALIBRATION_FILE) -> None:
        try:
            with open(path, "w") as fh:
                json.dump({
                    "workspaceProfileId": g.PROFILE_ID,
                    "workspaceProfileVersion": g.PROFILE_VERSION,
                    "panCoef": self.pan_coef, "tiltCoef": self.tilt_coef,
                    "rmsMm": self.rms_mm, "checked": self.checked, "at": self.at,
                    "samples": [[s.pan, s.tilt, s.x, s.z] for s in self.samples],
                }, fh, indent=1)
        except OSError:
            pass                  # a calibration that cannot be cached still works

    @classmethod
    def load(cls, path: str = CALIBRATION_FILE) -> "Aimer":
        try:
            with open(path) as fh:
                d = json.load(fh)
        except (OSError, json.JSONDecodeError):
            return cls()
        saved_profile = d.get("workspaceProfileId")
        saved_version = d.get("workspaceProfileVersion")
        if ((saved_profile is not None and saved_profile != g.PROFILE_ID)
                or (saved_version is not None and int(saved_version) != g.PROFILE_VERSION)):
            return cls()
        a = cls(
            samples=[Sample(*row) for row in d.get("samples", [])],
            pan_coef=d.get("panCoef"), tilt_coef=d.get("tiltCoef"),
            rms_mm=d.get("rmsMm"), checked=int(d.get("checked", 0)),
            at=float(d.get("at", 0.0)),
        )
        return a

    def status(self) -> dict:
        return {
            "ready": self.ready,
            "workspaceProfileId": g.PROFILE_ID,
            "workspaceProfileVersion": g.PROFILE_VERSION,
            "samples": len(self.samples),
            "rmsMm": round(self.rms_mm, 2) if self.rms_mm is not None else None,
            "checked": self.checked,
            "at": round(self.at, 1),
            "quality": self.quality(),
        }

    def quality(self) -> str:
        """What the accuracy means in the only unit that matters here: holes."""
        if not self.ready:
            return "Not calibrated"
        if self.rms_mm is None:
            return "Calibrated, accuracy not measured"
        # Worded for the panel, not for a log: whoever reads this wants to know
        # whether they can trust the dot, in holes rather than millimetres.
        tolerance = float(g.PROFILE["laser"]["anchorTolerance"])
        if self.rms_mm <= tolerance:
            return "Lands on the requested anchor"
        if self.rms_mm <= tolerance * 3:
            return "Can be an anchor out"
        return "Needs recalibrating"


class Calibrator:
    """Finds the board with the laser, then learns the map. Runs in the background.

    A blind grid sweep over the servos' full travel does not work, and it is worth
    saying why. A head 300 mm from a 165 x 48 mm board sees it across about 30
    degrees of pan and only 6 of tilt, so a grid coarse enough to finish in a
    minute steps straight over the board and finds nothing at all. Instead:

      1. search outwards from where the head is already aimed until the dot
         lands on the board at all;
      2. nudge each axis and measure how far the dot moved, which gives the local
         degrees-per-millimetre and therefore the board's extent in angle;
      3. aim at a grid of board positions using that linear estimate, and record
         where the dot actually went;
      4. fit the quadratic to those, then check it against known holes.

    That is around forty moves rather than several hundred, and it works whatever
    distance the head happens to be at.
    """

    def __init__(self) -> None:
        self.aimer = Aimer.load()
        self.running = False
        self.progress = ""
        self.error = ""
        self.done = 0
        self.total = 0
        self._cancel = threading.Event()
        self._lock = threading.Lock()
        # Set for the duration of a run; declared here so the object is never
        # half-built if something asks for status before the first calibration.
        self._frames = lambda: None
        self._pose_of = lambda _f: None
        self._ref = None
        self._ref_pose = None

    def cancel(self) -> None:
        self._cancel.set()

    def status(self) -> dict:
        return {
            "running": self.running, "progress": self.progress, "error": self.error,
            "done": self.done, "total": self.total, **self.aimer.status(),
        }

    # ------------------------------------------------------------------ helpers

    def _check(self) -> None:
        if self._cancel.is_set():
            raise RuntimeError("cancelled")

    def _shoot(self, link, pan: float, tilt: float) -> tuple[float, float] | None:
        """Aim, then report where the dot landed in board millimetres."""
        self._check()
        self.done += 1
        if not link.move(pan, tilt):
            return None
        return self._measure()

    def _measure(self) -> tuple[float, float] | None:
        shot = self._frames()
        if shot is None:
            return None
        pose = self._pose_of(shot)
        if not isinstance(pose, bd.BoardPose):
            return None
        return find_dot(shot, pose, self._ref, self._ref_pose)

    def _search(self, link) -> tuple[float, float, float, float] | None:
        """Spiral out from the head's current aim until the dot hits the board.

        Starting where the head already points rather than at centre: whoever set
        the rig up aimed it at the board, and that guess is worth more than any
        search order.
        """
        p0 = min(max(link.pose.pan, PAN_MIN), PAN_MAX)
        t0 = min(max(link.pose.tilt, TILT_MIN), TILT_MAX)

        for ring, radius in enumerate([0.0, 4.0, 8.0, 13.0, 19.0, 26.0, 34.0, 44.0]):
            steps = 1 if radius == 0 else max(6, int(ring * 4))
            for k in range(steps):
                angle = 2 * np.pi * k / steps
                pan = p0 + radius * float(np.cos(angle))
                # Tilt travel is the scarce one, so search it more tightly: the
                # board is a shallow strip and overshooting in tilt misses it.
                tilt = t0 + radius * 0.45 * float(np.sin(angle))
                if not (PAN_MIN <= pan <= PAN_MAX and TILT_MIN <= tilt <= TILT_MAX):
                    continue
                self.progress = f"looking for the dot on the board ({self.done} tried)"
                hit = self._shoot(link, pan, tilt)
                if hit is not None and _on_board(*hit):
                    return (link.pose.pan, link.pose.tilt, *hit)
        return None

    def _jacobian(self, link, pan: float, tilt: float, x: float, z: float,
                  delta: float = 3.0) -> np.ndarray | None:
        """d(x, z) / d(pan, tilt) near this aim point, by finite difference."""
        self.progress = "measuring how far a degree moves the dot"
        cols = []
        for axis in (0, 1):
            moved = None
            # Try the step in both directions: one of them may run off the board.
            for sign in (+1, -1):
                d = delta * sign
                hit = self._shoot(link, pan + (d if axis == 0 else 0),
                                  tilt + (d if axis == 1 else 0))
                if hit is not None and _on_board(*hit):
                    moved = ((hit[0] - x) / d, (hit[1] - z) / d)
                    break
            if moved is None:
                return None
            cols.append(moved)
        J = np.array([[cols[0][0], cols[1][0]], [cols[0][1], cols[1][1]]])
        return J if abs(np.linalg.det(J)) > 1e-6 else None

    # ---------------------------------------------------------------------- run

    def claim(self) -> bool:
        """Reserve one calibration run before its worker thread is scheduled."""
        with self._lock:
            if self.running:
                return False
            self.running = True
            self.error = ""
            self.progress = "starting calibration"
            self.done = 0
            self.total = 0
            return True

    def run(self, link, frames, pose_of, claimed: bool = False) -> None:
        """Calibrate. `frames` returns a fresh frame, `pose_of` locates the board."""
        if not claimed and not self.claim():
            return
        self._cancel.clear()
        self._frames = frames
        self._pose_of = pose_of
        samples: list[Sample] = []

        try:
            if not link.connected:
                raise RuntimeError("the laser is not connected")

            # One laser-off reference, kept with the pose it was taken at so the
            # comparison stays valid even if the camera is nudged later.
            link.set_laser(False)
            self._ref = frames()
            if self._ref is None:
                raise RuntimeError("No camera frames yet. Turn on board tracking first.")
            self._ref_pose = pose_of(self._ref)
            if not isinstance(self._ref_pose, bd.BoardPose):
                raise RuntimeError("Cannot see the breadboard. Point the camera at it "
                                   "and wait for it to be found.")

            link.set_laser(True)

            found = self._search(link)
            if found is None:
                raise RuntimeError(
                    "could not find the laser dot anywhere on the board. Aim the "
                    "head roughly at the board, check the laser comes on, and make "
                    "sure the camera can see the dot.")
            pan0, tilt0, x0, z0 = found
            samples.append(Sample(pan0, tilt0, x0, z0))

            J = self._jacobian(link, pan0, tilt0, x0, z0)
            if J is None:
                raise RuntimeError("The dot did not move predictably. Check that both "
                                   "servos are free and powered.")
            Jinv = np.linalg.inv(J)          # millimetres -> degrees

            # Grid over the board, aimed using the linear estimate. Inset from
            # the edges so a slightly wrong estimate still lands on the board.
            targets = [(x, z)
                       for x in np.linspace(-g.BOARD_WIDTH / 2 + 12, g.BOARD_WIDTH / 2 - 12, 6)
                       for z in np.linspace(-g.BOARD_DEPTH / 2 + 7, g.BOARD_DEPTH / 2 - 7, 3)]
            self.total = self.done + len(targets) + len(_CHECK_HOLES)

            for i, (tx, tz) in enumerate(targets, 1):
                self.progress = f"mapping the board ({i}/{len(targets)})"
                dp, dt = Jinv @ np.array([tx - x0, tz - z0])
                hit = self._shoot(link, pan0 + dp, tilt0 + dt)
                if hit is not None and _on_board(*hit):
                    samples.append(Sample(link.pose.pan, link.pose.tilt, *hit))

            if len(samples) < MIN_SAMPLES:
                raise RuntimeError(
                    f"only {len(samples)} points landed on the board, and at least "
                    f"{MIN_SAMPLES} are needed. Check the whole board is in shot "
                    f"and the dot is visible to the camera.")

            self.aimer.samples = samples
            if not self.aimer.fit():
                raise RuntimeError("the samples did not produce a usable fit")

            # The only meaningful test: aim at known holes and measure the miss.
            self.progress = "checking accuracy"
            errors: list[float] = []
            for ref in _CHECK_HOLES:
                self._check()
                xz = g.hole_xz(ref)
                angles = self.aimer.angles_for(*xz) if xz else None
                if xz is None or angles is None:
                    continue
                hit = self._shoot(link, *angles)
                if hit is None or not _on_board(*hit):
                    continue
                errors.append(float(np.hypot(hit[0] - xz[0], hit[1] - xz[1])))
                # Fold the check points back in: they sit exactly where accuracy
                # matters, which makes them the most valuable samples we have.
                samples.append(Sample(link.pose.pan, link.pose.tilt, *hit))

            self.aimer.samples = samples
            self.aimer.fit()
            if errors:
                self.aimer.rms_mm = float(np.sqrt(np.mean(np.square(errors))))
                self.aimer.checked = len(errors)
            self.aimer.save()
            self.progress = f"done -- {self.aimer.quality()}"
            self.total = self.done

        except Exception as e:
            self.error = str(e)
            self.progress = ""
        finally:
            try:
                link.set_laser(False)
            except Exception:
                pass
            self.running = False


def _on_board(x: float, z: float, margin: float = 2.0) -> bool:
    return (abs(x) <= g.BOARD_WIDTH / 2 + margin
            and abs(z) <= g.BOARD_DEPTH / 2 + margin)


#: Holes used to check the fit. Spread to the corners and the middle, because a
#: fit that is good in the centre and wrong at the ends is the usual failure.
_CHECK_HOLES = list(g.PROFILE["laser"]["verificationAnchors"])
