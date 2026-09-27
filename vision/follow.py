"""Point the laser at an object the camera can see, and keep pointing at it.

This is a different calibration from aim.py. That one maps board millimetres to
servo angles and needs the breadboard's grid. This one maps CAMERA PIXELS to
servo angles, which needs nothing but a surface the laser can mark and the
camera can see, so it works for any object rather than only for holes.

    .venv/bin/python -m vision.follow --camera 0

One limitation is physical and cannot be calibrated away. The laser and the
camera sit in different places, so a pixel only picks out a unique point in
space once you also fix the depth. Calibration happens against whatever surface
the laser is hitting -- the desk -- so tracking is accurate for objects at about
that depth. Hold something up high and the beam will pass behind it, because the
camera ray and the laser ray only meet at the plane they were calibrated on.

Keep the beam away from anyone's eyes. The firmware's 15 second cutout still
applies; this re-asserts it only while it is actually tracking.
"""

from __future__ import annotations

import argparse
import json
import os
import time

import cv2
import numpy as np

from .aim import _redness
from .laser import PAN_MAX, PAN_MIN, TILT_MAX, TILT_MIN, LaserLink

CALIBRATION_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                "pixel_calibration.json")

#: Minimum extra redness for the dot to count as found.
MIN_DOT_DIFF = 30
#: The dot is small; anything wider than this is a lighting change or a hand.
MAX_DOT_PX = 60

#: Don't chase sub-pixel wobble: the head takes ~0.24 s per move, and a target
#: that jitters by a few pixels would keep it permanently busy going nowhere.
DEADBAND_PX = 18

#: Never send moves faster than the head can finish them.
MIN_MOVE_INTERVAL_S = 0.22


def _design(u: float, v: float, quadratic: bool = True) -> np.ndarray:
    """Basis in normalised image coordinates.

    Two models, because which one is better depends on the rig. A quadratic
    captures the curvature of swinging a beam across a plane, but it needs
    samples spread over the whole area to be pinned down; when the laser can only
    reach a narrow strip, the quadratic is under-determined across the short axis
    and bends away absurdly just outside the samples. The affine model cannot
    bend, which in that situation makes it the more accurate of the two.
    """
    if quadratic:
        return np.array([1.0, u, v, u * v, u * u, v * v], dtype=np.float64)
    return np.array([1.0, u, v, u * v], dtype=np.float64)


class PixelAimer:
    """Maps image pixels to servo angles, learned by watching the dot."""

    def __init__(self, width: int = 1280, height: int = 720) -> None:
        self.w, self.h = width, height
        self.pan_coef: np.ndarray | None = None
        self.tilt_coef: np.ndarray | None = None
        self.samples: list[tuple[float, float, float, float]] = []
        self.rms_px: float | None = None
        self.quadratic = True
        #: Image regions holding a static red source, e.g. the emitter itself.
        self.zones: list[tuple[float, float, float]] = []

    @property
    def ready(self) -> bool:
        return self.pan_coef is not None

    def _norm(self, u: float, v: float) -> tuple[float, float]:
        # Scale to roughly [-1, 1]. Raw pixel values squared reach 10^6 and make
        # the normal equations badly conditioned.
        return (u / self.w - 0.5) * 2, (v / self.h - 0.5) * 2

    def _solve(self, quadratic: bool):
        A = np.array([_design(*self._norm(u, v), quadratic)
                      for _p, _t, u, v in self.samples])
        pan = np.array([p for p, _t, _u, _v in self.samples])
        tilt = np.array([t for _p, t, _u, _v in self.samples])
        pc, *_ = np.linalg.lstsq(A, pan, rcond=None)
        tc, *_ = np.linalg.lstsq(A, tilt, rcond=None)
        return pc, tc

    def _cv_error(self, quadratic: bool) -> float:
        """Leave-one-out error, in degrees.

        Fitting error alone always favours the bigger model -- a quadratic with
        six terms can pass closer to nineteen points than an affine with four,
        and still be useless a pixel outside them. Holding each point out in turn
        measures the thing that matters, which is how it does on a point it has
        not already seen.
        """
        n = len(self.samples)
        need = 6 if quadratic else 4
        if n <= need + 1:
            return float("inf")
        keep = self.samples
        errs = []
        for i in range(n):
            self.samples = keep[:i] + keep[i + 1:]
            try:
                pc, tc = self._solve(quadratic)
            except np.linalg.LinAlgError:
                self.samples = keep
                return float("inf")
            p, t, u, v = keep[i]
            d = _design(*self._norm(u, v), quadratic)
            errs.append(np.hypot(d @ pc - p, d @ tc - t))
        self.samples = keep
        return float(np.mean(errs)) if errs else float("inf")

    def fit(self) -> bool:
        if len(self.samples) < 8:
            return False
        quad_err, aff_err = self._cv_error(True), self._cv_error(False)
        self.quadratic = quad_err <= aff_err
        if not np.isfinite(min(quad_err, aff_err)):
            self.quadratic = False
        pc, tc = self._solve(self.quadratic)
        if not (np.all(np.isfinite(pc)) and np.all(np.isfinite(tc))):
            return False
        self.pan_coef, self.tilt_coef = pc, tc
        self.cv_error = min(quad_err, aff_err)
        return True

    def covers(self, u: float, v: float, margin: float = 40.0) -> bool:
        """Is this pixel inside the region the samples span?

        Outside it the fit is extrapolating, and a fit built from a narrow strip
        extrapolates badly. Refusing to aim is better than sending the head
        somewhere confident and wrong.
        """
        if not self.samples:
            return False
        x0, y0, x1, y1 = self.hull()
        return x0 - margin <= u <= x1 + margin and y0 - margin <= v <= y1 + margin

    def angles_for(self, u: float, v: float) -> tuple[float, float] | None:
        if not self.ready:
            return None
        d = _design(*self._norm(u, v), self.quadratic)
        return (float(np.clip(d @ self.pan_coef, PAN_MIN, PAN_MAX)),
                float(np.clip(d @ self.tilt_coef, TILT_MIN, TILT_MAX)))

    def hull(self) -> tuple[float, float, float, float]:
        us = [u for _p, _t, u, _v in self.samples]
        vs = [v for _p, _t, _u, v in self.samples]
        return (min(us), min(vs), max(us), max(vs)) if self.samples else (0, 0, 0, 0)

    def save(self) -> None:
        try:
            with open(CALIBRATION_FILE, "w") as fh:
                json.dump({"w": self.w, "h": self.h, "samples": self.samples,
                           "rmsPx": self.rms_px, "zones": self.zones,
                           "quadratic": self.quadratic}, fh)
        except OSError:
            pass

    @classmethod
    def load(cls, width: int, height: int) -> "PixelAimer":
        a = cls(width, height)
        try:
            with open(CALIBRATION_FILE) as fh:
                d = json.load(fh)
        except (OSError, json.JSONDecodeError):
            return a
        # A calibration taken at a different resolution maps to the wrong pixels.
        if d.get("w") != width or d.get("h") != height:
            return a
        a.samples = [tuple(s) for s in d.get("samples", [])]
        a.rms_px = d.get("rmsPx")
        a.zones = [tuple(z) for z in d.get("zones", [])]
        a.fit()
        return a


def grab(cap, settle: int = 2):
    """Read a frame, discarding the buffered ones so it is actually current."""
    frame = None
    for _ in range(settle + 1):
        ok, f = cap.read()
        if ok:
            frame = f
    return frame


def find_dot_px(frame_on, frame_off, zones=()) -> tuple[float, float] | None:
    """Pixel position of the laser dot, by how much redder it made things.

    Redness is measured on each frame and then differenced, never the other way
    round: on a dark surface the dot lifts the red channel, but on a light one
    red is already near its ceiling and the dot instead drops blue and green. An
    absolute difference cannot tell those apart.
    """
    score = np.clip(_redness(frame_on) - _redness(frame_off), 0, 255).astype(np.uint8)
    score = cv2.GaussianBlur(score, (7, 7), 0)
    for zu, zv, zr in zones:
        cv2.circle(score, (int(zu), int(zv)), int(zr), 0, -1)
    peak = float(score.max())
    if peak < MIN_DOT_DIFF:
        return None

    _, mask = cv2.threshold(score, max(MIN_DOT_DIFF, peak * 0.6), 255, cv2.THRESH_BINARY)
    n, labels, stats, centroids = cv2.connectedComponentsWithStats(mask, connectivity=8)
    best, best_score = None, -1.0
    for i in range(1, n):
        side = max(stats[i, cv2.CC_STAT_WIDTH], stats[i, cv2.CC_STAT_HEIGHT])
        if side > MAX_DOT_PX or stats[i, cv2.CC_STAT_AREA] < 3:
            continue
        b = float(score[labels == i].mean())
        if b > best_score:
            best, best_score = i, b
    if best is None:
        return None
    return (float(centroids[best][0]), float(centroids[best][1]))


def _sample(cap, link, reference, pan, tilt, zones=()) -> tuple[float, float] | None:
    """Aim there and report where the dot landed in the image."""
    # Smooth: a scan is hundreds of moves, and hundreds of full-torque jumps in
    # a row is what browns out a board running its servos off USB power.
    link.move(float(pan), float(tilt), smooth=True)
    frame = grab(cap, settle=1)
    return None if frame is None else find_dot_px(frame, reference, zones)


def _scan(cap, link, reference, show=None) -> list[tuple[float, float, float, float]]:
    """Coarse scan of the servo range, keeping every position whose dot is seen.

    It scans all of it rather than stopping at the first hit, and that matters
    more than it sounds. The first hit tends to come from the edge of the
    reachable band, where the beam meets the surface at a grazing angle and a
    degree of tilt throws the dot a long way. Anchoring the whole calibration
    there measures a scale that is true nowhere else. Collecting every hit costs
    one pass and lets the anchor be chosen from the middle instead.

    Tilt is stepped more finely than pan: the band of angles that both reaches a
    surface and stays in the camera's view is usually shallow.
    """
    hits: list[tuple[float, float, float, float]] = []
    tilts = np.arange(TILT_MIN + 4, TILT_MAX - 4, 7.0)
    pans = np.arange(PAN_MIN + 4, PAN_MAX - 4, 13.0)
    total = len(tilts) * len(pans)
    n = 0
    for row, tilt in enumerate(tilts):
        for pan in (pans if row % 2 == 0 else pans[::-1]):
            n += 1
            hit = _sample(cap, link, reference, pan, tilt)
            if hit is not None:
                hits.append((link.pose.pan, link.pose.tilt, hit[0], hit[1]))
            if show is not None:
                show(grab(cap, settle=0), hit,
                     f"scanning {n}/{total} -- {len(hits)} seen")
    return hits


def _drop_static(hits, radius=35.0, angle_gap=25.0, min_votes=4):
    """Remove detections that do not move when the head does.

    The laser module's own emitter is usually in shot, and it glows red whenever
    the laser is on. That reads as a perfect dot: bright, small, and redder than
    it was a moment ago. What gives it away is that it stays put -- swinging the
    head forty degrees leaves it exactly where it was, while the projected dot
    crosses the frame. So any detection that keeps reappearing at one pixel
    across widely different servo angles is the source, not the spot, and every
    one of them has to go before fitting: they all say "these angles put the dot
    here" about the same pixel, which teaches the fit that the head does nothing.
    """
    kept, dropped = [], []
    for pan, tilt, u, v in hits:
        votes = sum(
            1 for p2, t2, u2, v2 in hits
            if np.hypot(u - u2, v - v2) <= radius
            and np.hypot(pan - p2, tilt - t2) >= angle_gap)
        (dropped if votes >= min_votes else kept).append((pan, tilt, u, v))
    return kept, dropped


def _static_zones(dropped, radius=45.0):
    """Circles covering the static sources, to mask out later."""
    zones: list[tuple[float, float, float]] = []
    for _p, _t, u, v in dropped:
        if not any(np.hypot(u - zu, v - zv) < radius for zu, zv, _r in zones):
            zones.append((u, v, radius))
    return zones


def _jacobian(cap, link, reference, pan, tilt, u, v, delta=6.0):
    """d(u, v) / d(pan, tilt) in pixels per degree, by finite difference."""
    cols = []
    for axis in (0, 1):
        moved = None
        for sign in (+1, -1):            # one direction may leave the view
            d = delta * sign
            hit = _sample(cap, link, reference,
                          pan + (d if axis == 0 else 0),
                          tilt + (d if axis == 1 else 0))
            if hit is not None:
                moved = ((hit[0] - u) / d, (hit[1] - v) / d)
                break
        if moved is None:
            return None
        cols.append(moved)
    J = np.array([[cols[0][0], cols[1][0]], [cols[0][1], cols[1][1]]])
    return J if abs(np.linalg.det(J)) > 1e-6 else None


def calibrate(cap, link: LaserLink, aimer: PixelAimer, show=None) -> bool:
    """Learn the pixel-to-angle map: search, measure the scale, then grid.

    Not a blind sweep over the servos. Only a slice of the room is both reachable
    by the laser and visible to the camera, so a grid coarse enough to finish
    quickly mostly points at walls and floor, and the handful of frames where
    nothing changed are then fitted to noise -- which produces a confident map
    that is entirely wrong. Finding the dot first and working outwards from it
    spends every move inside the region that actually works.
    """
    print("calibrating: scanning for the laser dot")
    link.set_laser(False)
    time.sleep(0.4)
    reference = grab(cap, settle=3)
    if reference is None:
        print("  no camera frames"); return False

    link.set_laser(True)
    hits = _scan(cap, link, reference, show)
    if not hits:
        print("  never saw the dot. Check the laser lights up, and that it "
              "points at something this camera can see.")
        link.set_laser(False)
        return False

    hits, static = _drop_static(hits)
    if static:
        aimer.zones = _static_zones(static)
        print(f"  ignoring {len(static)} detections that never moved with the head "
              f"-- that is the laser module's own glow, not its dot")
    if len(hits) < 8:
        print(f"  only {len(hits)} real moving detections; not enough to fit")
        link.set_laser(False)
        return False

    us = [h[2] for h in hits]; vs = [h[3] for h in hits]
    print(f"  the dot was visible at {len(hits)} of the scanned positions, "
          f"covering image x {min(us):.0f}-{max(us):.0f}, y {min(vs):.0f}-{max(vs):.0f}")

    # Anchor in the middle of what was seen, not at the edge of it.
    cu, cv = float(np.median(us)), float(np.median(vs))
    pan0, tilt0, u0, v0 = min(hits, key=lambda h: np.hypot(h[2] - cu, h[3] - cv))
    link.move(pan0, tilt0, smooth=True)
    print(f"  anchoring at pan {pan0:.0f} tilt {tilt0:.0f}, image ({u0:.0f}, {v0:.0f})")

    J = _jacobian(cap, link, reference, pan0, tilt0, u0, v0)
    if J is None:
        print("  the dot did not move predictably -- check both servos are free")
        link.set_laser(False)
        return False
    Jinv = np.linalg.inv(J)
    print(f"  scale near there: {abs(J[0,0]):.0f} px per degree of pan, "
          f"{abs(J[1,1]):.0f} px per degree of tilt")

    # Every scan hit is already a real measurement; keep them all and use the
    # grid pass to fill in between them rather than to start from scratch.
    samples = list(hits)
    targets = [(u, v)
               for u in np.linspace(min(us), max(us), 6)
               for v in np.linspace(min(vs), max(vs), 5)]
    for i, (tu, tv) in enumerate(targets, 1):
        dp, dt = Jinv @ np.array([tu - u0, tv - v0])
        pan, tilt = pan0 + dp, tilt0 + dt
        if not (PAN_MIN <= pan <= PAN_MAX and TILT_MIN <= tilt <= TILT_MAX):
            continue                     # that part of the image is out of reach
        hit = _sample(cap, link, reference, pan, tilt, aimer.zones)
        if show is not None:
            show(grab(cap, settle=0), hit, f"mapping {i}/{len(targets)}")
        if hit is not None:
            samples.append((link.pose.pan, link.pose.tilt, hit[0], hit[1]))

    aimer.samples = samples
    print(f"  {len(samples)} usable points")
    if not aimer.fit():
        print("  too few points to fit"); link.set_laser(False); return False

    # Accuracy, measured the only way that means anything: ask for an image
    # position, then look at where the dot actually went.
    # Inside the sampled region only. Testing where the laser cannot reach
    # measures the fit's extrapolation, which is not a number anyone needs.
    hx0, hy0, hx1, hy1 = aimer.hull()
    errs = []
    for tu, tv in [(hx0 + (hx1 - hx0) * fx, hy0 + (hy1 - hy0) * fy)
                   for fx in (0.25, 0.5, 0.75) for fy in (0.3, 0.7)]:
        angles = aimer.angles_for(tu, tv)
        if not angles:
            continue
        hit = _sample(cap, link, reference, *angles, zones=aimer.zones)
        if hit is not None:
            errs.append(float(np.hypot(hit[0] - tu, hit[1] - tv)))
    aimer.rms_px = float(np.sqrt(np.mean(np.square(errs)))) if errs else None
    link.set_laser(False)
    aimer.save()

    if aimer.rms_px is not None:
        print(f"  accuracy: {aimer.rms_px:.0f} px RMS over {len(errs)} checks "
              f"({'quadratic' if aimer.quadratic else 'affine'} fit)")
    x0, y0, x1, y1 = aimer.hull()
    print(f"  reachable image region: x {x0:.0f}-{x1:.0f}, y {y0:.0f}-{y1:.0f}")
    return True


class ObjectTracker:
    """Locks onto an object shown to the camera, then follows it.

    Acquisition is from motion: whatever moves is what is being put in front of
    the camera. Tracking is then handed to MIL, which models the object's
    appearance in greyscale.

    Appearance rather than colour, deliberately. The obvious approach is a hue
    histogram and CamShift, and it works well for something brightly coloured --
    but a TV remote is black, a black object has no meaningful hue and almost no
    saturation, and a histogram tracker simply cannot hold on to one. Worse, it
    fails by matching every other dark thing in the room rather than by
    reporting that it is lost.
    """

    #: Smaller than this is noise; larger is usually an arm, or the lighting.
    MIN_AREA = 2500
    MAX_AREA = 160_000

    #: MIL is not cheap at 720p, so it runs on a half-size frame.
    SCALE = 0.5

    def __init__(self, log=print) -> None:
        self.bg = cv2.createBackgroundSubtractorMOG2(history=200, varThreshold=36,
                                                     detectShadows=False)
        self.tracker = None
        self.box: tuple[int, int, int, int] | None = None
        self.lost = 0
        self.log = log

    def reset(self) -> None:
        self.tracker = None
        self.box = None
        self.lost = 0

    def _moving_box(self, frame, ignore) -> tuple[int, int, int, int] | None:
        fg = self.bg.apply(frame)
        fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
        fg = cv2.morphologyEx(fg, cv2.MORPH_DILATE, np.ones((13, 13), np.uint8))
        if ignore is not None:
            # The laser dot sweeps across the desk and is, to a motion detector,
            # a small moving object. Left in, the rig locks onto its own dot and
            # then chases it around the desk.
            cv2.circle(fg, ignore, 60, 0, -1)
        contours, _ = cv2.findContours(fg, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        best = None
        for c in contours:
            area = cv2.contourArea(c)
            if not (self.MIN_AREA <= area <= self.MAX_AREA):
                continue
            if best is None or area > cv2.contourArea(best):
                best = c
        return None if best is None else cv2.boundingRect(best)

    @staticmethod
    def _refine(frame, box):
        """Shrink a motion box onto the object inside it.

        What moves is the object AND the hand carrying it, so the motion box
        covers both and the tracker ends up centred on a knuckle. The laser then
        points at the hand, which is worse than useless.

        The object is separated from the hand by contrast rather than by colour
        or brightness directly: the patch border is mostly background, so the
        region that differs most from it is the thing being held. That works for
        a white case on a dark desk and for a dark remote on a light one, which
        picking "the bright part" would not.
        """
        x, y, w, h = box
        patch = frame[y:y + h, x:x + w]
        if patch.size == 0 or min(w, h) < 12:
            return box
        grey = cv2.cvtColor(patch, cv2.COLOR_BGR2GRAY)

        border = np.concatenate([grey[0, :], grey[-1, :], grey[:, 0], grey[:, -1]])
        bg = float(np.median(border))
        diff = cv2.absdiff(grey, np.full_like(grey, int(bg)))
        _, mask = cv2.threshold(diff, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))

        n, labels, stats, _c = cv2.connectedComponentsWithStats(mask, connectivity=8)
        if n <= 1:
            return box
        i = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        bx, by = stats[i, cv2.CC_STAT_LEFT], stats[i, cv2.CC_STAT_TOP]
        bw, bh = stats[i, cv2.CC_STAT_WIDTH], stats[i, cv2.CC_STAT_HEIGHT]

        # Only accept a refinement that is a sensible piece of the original: a
        # sliver is a shadow edge, and the whole patch means nothing was gained.
        frac = (bw * bh) / float(w * h)
        if not (0.12 <= frac <= 0.92) or min(bw, bh) < 10:
            return box
        return (x + int(bx), y + int(by), int(bw), int(bh))

    def _start(self, frame, box) -> bool:
        x, y, w, h = box
        s = self.SCALE
        small = cv2.resize(frame, None, fx=s, fy=s)
        try:
            t = cv2.TrackerMIL_create()
            t.init(small, (int(x * s), int(y * s), max(4, int(w * s)), max(4, int(h * s))))
        except cv2.error:
            return False
        self.tracker, self.box, self.lost = t, box, 0
        self.log(f"locked on: {w}x{h} px object at ({x + w // 2}, {y + h // 2})")
        return True

    def update(self, frame, ignore=None) -> tuple[int, int, int, int] | None:
        if self.tracker is None:
            box = self._moving_box(frame, ignore)
            if box is not None:
                self._start(frame, self._refine(frame, box))
            return self.box

        # Keep the background model fed so a later re-acquisition still works.
        self.bg.apply(frame, learningRate=0.002)

        s = self.SCALE
        small = cv2.resize(frame, None, fx=s, fy=s)
        ok, box = self.tracker.update(small)
        if not ok:
            self.lost += 1
            if self.lost > 15:
                self.log("lost it -- move the object to re-acquire")
                self.reset()
            return None
        self.lost = 0
        x, y, w, h = box
        self.box = (int(x / s), int(y / s), int(w / s), int(h / s))
        return self.box


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--camera", type=int, default=0)
    ap.add_argument("--recalibrate", action="store_true")
    ap.add_argument("--seconds", type=float, default=0.0,
                    help="stop after this long (0 = until q)")
    ap.add_argument("--open-loop", action="store_true",
                    help="use the fitted pixel-to-angle map instead of servoing")
    args = ap.parse_args()

    if not args.open_loop:
        # Closed loop by default: it needs no global calibration and corrects its
        # own aim, which matters most on a rig where the laser only grazes the
        # surface the camera is watching.
        saved = PixelAimer.load(1280, 720)
        servo_follow(args.camera, args.seconds, saved.zones)
        return

    cap = cv2.VideoCapture(args.camera)
    if not cap.isOpened():
        raise SystemExit(f"could not open camera {args.camera}")
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
    for _ in range(40):                  # let auto-exposure settle
        cap.read()
    probe = grab(cap, settle=3)
    h, w = probe.shape[:2]
    print(f"camera {args.camera}: {w}x{h}")

    link = LaserLink()
    if not link.connect():
        raise SystemExit(f"laser: {link.error}")
    print(f"laser on {link.port}")
    link.centre()

    def show(frame, dot, caption):
        view = frame.copy()
        if dot:
            cv2.circle(view, (int(dot[0]), int(dot[1])), 14, (0, 255, 255), 2)
        cv2.putText(view, caption, (12, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7,
                    (0, 255, 255), 2, cv2.LINE_AA)
        cv2.imshow("laser follow", view)
        cv2.waitKey(1)

    aimer = PixelAimer.load(w, h)
    if args.recalibrate or not aimer.ready:
        if not calibrate(cap, link, aimer, show):
            link.disconnect(); cap.release(); raise SystemExit(1)
    else:
        print(f"using the saved calibration ({len(aimer.samples)} points)")

    print("\nhold the object up to the camera and move it a little so it is seen")
    print("[space] re-acquire   [q] quit")

    tracker = ObjectTracker()
    aimed_px: tuple[int, int] | None = None
    last_move = 0.0
    started = time.time()
    tracking = False

    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break

            box = tracker.update(frame, ignore=aimed_px)
            view = frame.copy()

            if box is not None:
                x, y, bw, bh = box
                cx, cy = x + bw // 2, y + bh // 2
                cv2.rectangle(view, (x, y), (x + bw, y + bh), (90, 220, 120), 2)
                cv2.circle(view, (cx, cy), 5, (90, 220, 120), -1)

                now = time.time()
                far = aimed_px is None or np.hypot(cx - aimed_px[0], cy - aimed_px[1]) > DEADBAND_PX
                if far and now - last_move > MIN_MOVE_INTERVAL_S and aimer.covers(cx, cy):
                    angles = aimer.angles_for(cx, cy)
                    if angles:
                        link.move(*angles, smooth=False)
                        if not tracking:
                            link.set_laser(True); tracking = True
                        aimed_px = (cx, cy)
                        last_move = time.time()
                reachable = aimer.covers(cx, cy)
                cv2.putText(view,
                            f"tracking  pan {link.pose.pan:.0f} tilt {link.pose.tilt:.0f}"
                            if reachable else "target is outside the laser's reach",
                            (12, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7,
                            (90, 220, 120) if reachable else (60, 200, 230), 2, cv2.LINE_AA)
                if not reachable and tracking:
                    link.set_laser(False); tracking = False
            else:
                if tracking:
                    link.set_laser(False); tracking = False
                    aimed_px = None
                cv2.putText(view, "looking for something to track -- move it a little",
                            (12, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (60, 200, 230), 2, cv2.LINE_AA)

            hx0, hy0, hx1, hy1 = aimer.hull()
            cv2.rectangle(view, (int(hx0), int(hy0)), (int(hx1), int(hy1)),
                          (70, 70, 90), 1)
            cv2.putText(view, "laser can reach inside this box", (int(hx0) + 6, int(hy0) + 18),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.45, (110, 110, 130), 1, cv2.LINE_AA)
            cv2.imshow("laser follow", view)
            k = cv2.waitKey(1) & 0xFF
            if k in (ord("q"), 27):
                break
            if k == ord(" "):
                tracker.reset(); aimed_px = None
                print("re-acquiring")
            if args.seconds and time.time() - started > args.seconds:
                break
    finally:
        link.set_laser(False)
        link.centre()
        link.disconnect()
        cap.release()
        cv2.destroyAllWindows()
        print("done")



# --------------------------------------------------------------------------
# Visual servoing
# --------------------------------------------------------------------------
#
# The open-loop path above predicts the angles for a pixel from a fitted map.
# That needs the laser to reach a decent spread of the camera's view, and on a
# head sitting level with the desk it does not: the beam grazes the surface
# across a narrow band of tilt and flies over it everywhere else, so the fit is
# built from a thin, badly-conditioned strip and is wrong as soon as it leaves
# it.
#
# Closing the loop removes the need for that map entirely. Look at where the dot
# IS, look at where it should be, move to shrink the difference, repeat. The only
# thing needed is a rough idea of which way the dot moves when each servo turns,
# and errors correct themselves on the next frame instead of accumulating.

#: Fraction of the measured error to remove per step. Well below 1 because the
#: Jacobian starts out rough: aiming to close half the gap converges steadily,
#: while aiming to close all of it overshoots and rings.
SERVO_GAIN = 0.4

#: Recent (angle change, dot movement) pairs kept for re-fitting the Jacobian.
#: The loop measures the dot before and after every correction, so each step is
#: a free calibration reading. They are accumulated and least-squares fitted
#: rather than folded in one at a time: a rank-1 update divides by the size of
#: the step, so one bad dot reading on a small move rewrites the Jacobian with
#: a wild value and the loop then drives itself into the stops.
JACOBIAN_MEMORY = 10

#: Ignore readings too small to be informative -- they are mostly noise.
MIN_STEP_DEG = 2.0
MIN_DOT_MOVE_PX = 6.0

#: Physically plausible bounds. Beyond this the fit has gone wrong, not the rig.
MAX_PX_PER_DEG = 120.0

#: Where to start looking. A head mounted level with the desk only grazes it
#: across a shallow band of tilt -- aim above the band and the beam sails over
#: the desk onto a wall, aim below and it hits the near edge. Both leave the
#: camera seeing nothing, so the loop has to begin inside the band.
HOME_PAN, HOME_TILT = 80.0, 35.0

#: Keep the loop inside that band. Without this it walks the tilt out of the
#: usable range chasing a target, loses the dot, and has to re-home every time.
BAND_TILT_MIN, BAND_TILT_MAX = 26.0, 46.0

#: Largest correction in one step, per axis.
MAX_STEP_DEG = 12.0

#: Stop correcting once the dot is this close; smaller than the dot itself.
SERVO_DEADBAND_PX = 14

#: How red a pixel must be, over its own brightness, to be the dot.
DOT_REDNESS = 60


def find_dot_direct(frame, zones=(), near=None, radius=260.0):
    """Find the dot in a single frame, with no laser-off reference.

    Servoing needs the dot's position every frame while the laser stays on, so
    the differencing trick is not available. The dot is instead found on its own
    terms: a small region far redder than its own brightness. `near` restricts
    the search to where the dot was last seen, which keeps a red object in the
    scene from stealing the lock.
    """
    score = np.clip(_redness(frame), 0, 255).astype(np.uint8)
    for zu, zv, zr in zones:
        cv2.circle(score, (int(zu), int(zv)), int(zr), 0, -1)
    if near is not None:
        mask = np.zeros(score.shape, np.uint8)
        cv2.circle(mask, (int(near[0]), int(near[1])), int(radius), 255, -1)
        score = cv2.bitwise_and(score, mask)

    score = cv2.GaussianBlur(score, (5, 5), 0)
    peak = float(score.max())
    if peak < DOT_REDNESS:
        return None
    _, mask = cv2.threshold(score, max(DOT_REDNESS, peak * 0.7), 255, cv2.THRESH_BINARY)
    n, labels, stats, centroids = cv2.connectedComponentsWithStats(mask, connectivity=8)
    best, best_score = None, -1.0
    for i in range(1, n):
        side = max(stats[i, cv2.CC_STAT_WIDTH], stats[i, cv2.CC_STAT_HEIGHT])
        if side > MAX_DOT_PX or stats[i, cv2.CC_STAT_AREA] < 4:
            continue
        b = float(score[labels == i].mean())
        if b > best_score:
            best, best_score = i, b
    if best is None:
        return None
    return (float(centroids[best][0]), float(centroids[best][1]))


def find_dot_blink(cap, link, zones=()):
    """Locate the dot by switching the laser off for one frame and differencing.

    Detecting it in a single frame does not work on a real bench. The test can
    only be "small, bright, red", and a desk has other things that satisfy that
    -- a glare highlight, a reflection off a white object, an LED. Worse, it
    fails by locking onto one of them and holding still, which to a servo loop
    looks like a dot that refuses to move, so it drives the head to the stops
    trying to shift something that was never the laser.

    Blinking removes the ambiguity entirely. Two frames a few tens of
    milliseconds apart differ in exactly one respect -- the laser -- so whatever
    changed IS the dot. Nothing else on the desk turns off on command.
    """
    link.set_laser(True)
    on = grab(cap, settle=1)
    link.set_laser(False)
    off = grab(cap, settle=1)
    link.set_laser(True)
    if on is None or off is None:
        return None
    return find_dot_px(on, off, zones)


def find_visible_aim(cap, link, zones=()):
    """Search the band for a position whose dot the camera can actually see."""
    for tilt in (35, 31, 39, 28, 43):
        for pan in (80, 65, 95, 50, 110):
            link.move(float(pan), float(tilt))
            hit = find_dot_blink(cap, link, zones)
            if hit is not None:
                return hit
    return None


def measure_jacobian(cap, link, zones, step=3.0):
    """Which way, and how far, the dot moves for a degree of each servo."""
    base = find_dot_blink(cap, link, zones)
    if base is None:
        return None, None
    p0, t0 = link.pose.pan, link.pose.tilt
    cols = []
    for axis in (0, 1):
        moved = None
        for sign in (+1, -1):
            d = step * sign
            link.move(p0 + (d if axis == 0 else 0), t0 + (d if axis == 1 else 0),
                      smooth=True)
            hit = find_dot_blink(cap, link, zones)
            if hit is not None and np.hypot(hit[0] - base[0], hit[1] - base[1]) > 2:
                moved = ((hit[0] - base[0]) / d, (hit[1] - base[1]) / d)
                break
        link.move(p0, t0, smooth=True)
        if moved is None:
            return None, None
        cols.append(moved)
    J = np.array([[cols[0][0], cols[1][0]], [cols[0][1], cols[1][1]]])
    if abs(np.linalg.det(J)) < 1e-6:
        return None, None
    return J, base


def _fit_jacobian(history):
    """Least-squares Jacobian from recent (angle change, dot movement) pairs.

    Returns None when the readings do not yet pin it down -- all the moves so
    far being nearly parallel, or the result being physically absurd. Keeping
    the previous estimate is always better than adopting a bad one.
    """
    if len(history) < 3:
        return None
    A = np.array([h[0] for h in history])           # angle changes, N x 2
    B = np.array([h[1] for h in history])           # dot movements, N x 2
    # Needs moves in genuinely different directions, or the fit is ambiguous.
    if np.linalg.matrix_rank(A, tol=1e-3) < 2:
        return None
    try:
        sol, *_ = np.linalg.lstsq(A, B, rcond=None)  # B ~= A @ sol
    except np.linalg.LinAlgError:
        return None
    J = sol.T
    if not np.all(np.isfinite(J)) or np.abs(J).max() > MAX_PX_PER_DEG:
        return None
    if abs(np.linalg.det(J)) < 1e-3:
        return None
    return J, np.linalg.inv(J)


def servo_follow(camera: int, seconds: float = 0.0, zones=()) -> None:
    """Keep the laser on whatever object the camera is shown, by closed loop."""
    cap = cv2.VideoCapture(camera)
    if not cap.isOpened():
        raise SystemExit(f"could not open camera {camera}")
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
    for _ in range(40):
        cap.read()

    link = LaserLink()
    if not link.connect():
        raise SystemExit(f"laser: {link.error}")
    print(f"laser on {link.port}")

    # Start where the beam is known to reach the desk in view, then let the loop
    # take over. Servoing corrects its own aim, so this only has to be close
    # enough that the dot is visible at all.
    link.move(HOME_PAN, HOME_TILT)
    link.set_laser(True)
    time.sleep(0.5)

    print("measuring which way the dot moves (blinking the laser)...")
    J, dot = measure_jacobian(cap, link, zones)
    if J is None:
        print("  not visible from the home position; searching the band...")
        if find_visible_aim(cap, link, zones) is not None:
            J, dot = measure_jacobian(cap, link, zones)
    if J is None:
        link.set_laser(False); link.centre(); link.disconnect(); cap.release()
        raise SystemExit("could not see the dot move -- is it hitting the desk "
                         "somewhere the camera can see?")
    Jinv = np.linalg.inv(J)
    print(f"  {abs(J[0,0]):.1f} px per degree of pan, {abs(J[1,1]):.1f} of tilt")
    print("\nput the object in view and move it a little\n[space] re-acquire  [q] quit")

    aimer_h, aimer_w = 720, 1280
    probe = grab(cap, settle=1)
    if probe is not None:
        aimer_h, aimer_w = probe.shape[:2]

    tracker = ObjectTracker()
    history: list = []
    started = time.time()
    last_move = 0.0
    misses = 0
    last_report = 0.0
    best_dist = None

    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            view = frame.copy()

            ignore = (int(dot[0]), int(dot[1])) if dot else None
            box = tracker.update(frame, ignore=ignore)

            if dot:
                cv2.circle(view, (int(dot[0]), int(dot[1])), 16, (0, 220, 255), 2)
                cv2.putText(view, "dot", (int(dot[0]) + 20, int(dot[1])),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 220, 255), 1, cv2.LINE_AA)

            if box is not None and dot is not None:
                x, y, bw, bh = box
                cx, cy = x + bw // 2, y + bh // 2
                cv2.rectangle(view, (x, y), (x + bw, y + bh), (90, 220, 120), 2)

                err = np.array([cx - dot[0], cy - dot[1]], dtype=float)
                dist = float(np.hypot(*err))
                cv2.line(view, (int(dot[0]), int(dot[1])), (cx, cy), (90, 220, 120), 1)

                now = time.time()
                if dist > SERVO_DEADBAND_PX and now - last_move > MIN_MOVE_INTERVAL_S:
                    # Re-measure the dot before every correction. A stale
                    # position is what makes the loop chase its own error, and
                    # blinking costs two frames rather than a wrong move.
                    fresh = find_dot_blink(cap, link, zones)
                    if fresh is not None and (fresh[0] < 6 or fresh[1] < 6
                                              or fresh[0] > aimer_w - 6
                                              or fresh[1] > aimer_h - 6):
                        # Hard against the frame border: the real dot is most
                        # likely outside the view, so its position is a floor
                        # value, not a measurement. Back off toward the middle.
                        print("  dot has run off the edge -- re-homing")
                        link.move(HOME_PAN, HOME_TILT)
                        last_move = now
                        continue
                    if fresh is None:
                        misses += 1
                        if misses > 6:
                            print("  lost the dot -- re-homing")
                            link.move(HOME_PAN, HOME_TILT); misses = 0
                        last_move = now
                        cv2.imshow("laser follow", view); cv2.waitKey(1)
                        continue
                    dot = fresh
                    err = np.array([cx - dot[0], cy - dot[1]], dtype=float)
                    dist = float(np.hypot(*err))
                    misses = 0
                    if dist <= SERVO_DEADBAND_PX:
                        last_move = now
                        cv2.imshow("laser follow", view); cv2.waitKey(1)
                        continue
                    dp, dt = Jinv @ (err * SERVO_GAIN)
                    # Cap each correction: a rough Jacobian should nudge the
                    # head, never fling it to the stops.
                    dp = float(np.clip(dp, -MAX_STEP_DEG, MAX_STEP_DEG))
                    dt = float(np.clip(dt, -MAX_STEP_DEG, MAX_STEP_DEG))
                    before = (dot[0], dot[1])
                    commanded = np.array([dp, dt], dtype=float)
                    # Smooth, not jump. A jump always costs the firmware's
                    # delay(350), while a small smooth move is a few 12 ms steps
                    # plus delay(150) -- so it is both quicker for corrections
                    # this size and gentler on the supply, because the servos
                    # ramp instead of slamming to position.
                    link.move(link.pose.pan + dp,
                              float(np.clip(link.pose.tilt + dt,
                                            BAND_TILT_MIN, BAND_TILT_MAX)),
                              smooth=True)
                    last_move = now

                    # Every correction is also a calibration reading: a known
                    # angle change with a measured dot movement. Keep the recent
                    # ones and re-fit, so the estimate improves as it runs.
                    after = find_dot_blink(cap, link, zones)
                    if after is not None:
                        observed = np.array([after[0] - before[0],
                                             after[1] - before[1]], dtype=float)
                        if (np.hypot(*commanded) >= MIN_STEP_DEG
                                and MIN_DOT_MOVE_PX <= np.hypot(*observed) < 900):
                            history.append((commanded.copy(), observed))
                            del history[:-JACOBIAN_MEMORY]
                            fitted = _fit_jacobian(history)
                            if fitted is not None:
                                J, Jinv = fitted
                        dot = after
                    misses = 0
                status = f"following -- {dist:.0f} px off"
                colour = (90, 220, 120)
                best_dist = dist if best_dist is None else min(best_dist, dist)
                if time.time() - last_report > 2.0:
                    print(f"  target ({cx},{cy})  dot ({dot[0]:.0f},{dot[1]:.0f})  "
                          f"off by {dist:.0f} px  best {best_dist:.0f}  "
                          f"pan {link.pose.pan:.0f} tilt {link.pose.tilt:.0f}  "
                          f"J [{J[0,0]:.1f} {J[0,1]:.1f}; {J[1,0]:.1f} {J[1,1]:.1f}]")
                    last_report = time.time()
            else:
                misses += 1
                status = ("looking for the dot" if dot is None
                          else "show me something and move it a little")
                colour = (60, 200, 230)
                if misses % 90 == 0:
                    print(f"  waiting: {'dot not visible' if dot is None else 'no target yet'}")

            cv2.putText(view, status, (12, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7,
                        colour, 2, cv2.LINE_AA)
            cv2.imshow("laser follow", view)
            k = cv2.waitKey(1) & 0xFF
            if k in (ord("q"), 27):
                break
            if k == ord(" "):
                tracker.reset()
                print("re-acquiring")
            if seconds and time.time() - started > seconds:
                break
    finally:
        link.set_laser(False)
        link.centre()
        link.disconnect()
        cap.release()
        cv2.destroyAllWindows()
        print("done")

if __name__ == "__main__":
    main()
