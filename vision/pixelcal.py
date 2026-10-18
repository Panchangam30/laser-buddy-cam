"""Camera-pixel <-> servo-angle calibration, by a physical model, not a curve fit.

For a flat surface (the desk) the mapping is known exactly up to 8 numbers. The
head turns the beam to a direction d(pan, tilt) on the unit sphere. The beam
leaves a single point (the head) and lands on a plane, which is a central
projection, and the camera then sees that plane through another projection.
Two projective maps compose into one: pixel ~ H . d, with H a 3x3 homography
acting on the direction vector. Any fixed mounting rotation of the head is
absorbed into H too, so a crooked mount calibrates out for free.

The one thing H cannot absorb is where the tilt servo's zero is, because tilt
rotates after pan. That single angle is found by a 1-D search: the right value
is the one where the samples fit a homography best.

Fitting is RANSAC over that model (normalised DLT), so a handful of bad dot
readings -- a glint, a hand -- are rejected instead of bending the whole map,
which is what made the old polynomial fit unreliable.

Sampling is a flood fill over the servo grid starting from wherever the dot is
first seen, so every move lands somewhere the camera can actually see.
"""

from __future__ import annotations

import json
import math
import os
import time

import cv2
import numpy as np

from .aim import _redness
from .laser import PAN_MAX, PAN_MIN, TILT_MAX, TILT_MIN

CALIBRATION_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                "pixel_homography.json")

#: How long after the laser or head changes before the camera's picture shows
#: it: the webcam's own pipeline (exposure, readout, the browser's video
#: element). Frames are judged by when they were CAPTURED, not when they
#: arrived -- arrival-based timing mixed up laser-on and laser-off pictures.
FRAME_LATENCY_S = 0.18

#: Servo-grid step for the flood fill, in degrees.
GRID_STEP = 5.0
#: Stop sampling after this many good points; more barely helps a homography.
TARGET_SAMPLES = 36
MAX_MOVES = 120
#: RANSAC inlier threshold, pixels.
RANSAC_PX = 6.0


# ----------------------------------------------------------------- the model

def direction(pan: float, tilt: float, tilt0: float) -> np.ndarray:
    """Unit beam direction for servo angles, in the head's own frame."""
    yaw = math.radians(pan - 90.0)
    pitch = math.radians(tilt - tilt0)
    return np.array([math.cos(pitch) * math.sin(yaw),
                     math.sin(pitch),
                     math.cos(pitch) * math.cos(yaw)])


def angles_from_direction(d: np.ndarray, tilt0: float) -> tuple[float, float]:
    d = d / np.linalg.norm(d)
    yaw = math.degrees(math.atan2(d[0], d[2]))
    pitch = math.degrees(math.asin(max(-1.0, min(1.0, d[1]))))
    return yaw + 90.0, pitch + tilt0


def _normaliser(pts: np.ndarray) -> np.ndarray:
    """Hartley normalisation for the 2D pixel side."""
    c = pts.mean(axis=0)
    s = math.sqrt(2) / max(1e-9, np.mean(np.linalg.norm(pts - c, axis=1)))
    return np.array([[s, 0, -s * c[0]], [0, s, -s * c[1]], [0, 0, 1]])


def fit_h(dirs: np.ndarray, px: np.ndarray) -> np.ndarray | None:
    """DLT: H such that px ~ H @ d. dirs Nx3 (unit), px Nx2. Needs N >= 4."""
    if len(dirs) < 4:
        return None
    T = _normaliser(px)
    p = (T @ np.c_[px, np.ones(len(px))].T).T
    rows = []
    for d, (u, v, _w) in zip(dirs, p):
        rows.append(np.r_[d, np.zeros(3), -u * d])
        rows.append(np.r_[np.zeros(3), d, -v * d])
    try:
        _, _, vt = np.linalg.svd(np.array(rows))
    except np.linalg.LinAlgError:
        return None
    Hn = vt[-1].reshape(3, 3)
    H = np.linalg.inv(T) @ Hn
    return H / np.linalg.norm(H)


def project(H: np.ndarray, dirs: np.ndarray) -> np.ndarray:
    q = (H @ dirs.T).T
    with np.errstate(divide="ignore", invalid="ignore"):
        return q[:, :2] / q[:, 2:3]


def _ransac(dirs, px, iters=300, thresh=RANSAC_PX, rng=None):
    rng = rng or np.random.default_rng(0)
    n = len(dirs)
    best = np.zeros(n, bool)
    if n < 5:
        return np.ones(n, bool)
    for _ in range(iters):
        idx = rng.choice(n, 4, replace=False)
        H = fit_h(dirs[idx], px[idx])
        if H is None:
            continue
        err = np.linalg.norm(project(H, dirs) - px, axis=1)
        inl = np.nan_to_num(err, nan=1e9) < thresh
        if inl.sum() > best.sum():
            best = inl
    return best if best.sum() >= 5 else np.ones(n, bool)


def fit_model(samples, thresh=RANSAC_PX):
    """Best (H, tilt0, inliers, rms) over the tilt-zero search, or None.

    Ranked by TRIMMED error -- the RMS of the best-fitting points after setting
    aside the few worst -- not by how many points scrape under a threshold. With
    dozens of automatic samples the two agree; with the handful a person marks by
    hand, counting "inliers" first let a clearly wrong solution that roughly
    matched every point beat the right one that matched all but one precisely.
    The worst points are only set aside once there are enough to spare them:
    none below 7 points, then about one in eight.
    """
    n = len(samples)
    if n < 5:
        return None
    S = np.array(samples, float)
    px = S[:, 2:4]
    spare = 0 if n < 7 else max(1, n // 8)

    def score(t0):
        dirs = np.array([direction(p, t, t0) for p, t in S[:, :2]])
        inl = _ransac(dirs, px, thresh=thresh) if n >= 9 else np.ones(n, bool)
        H = fit_h(dirs[inl], px[inl])
        if H is None:
            return None
        err = np.nan_to_num(np.linalg.norm(project(H, dirs) - px, axis=1), nan=1e6)
        keep = np.zeros(n, bool)
        keep[np.argsort(err)[:n - spare]] = True
        H = fit_h(dirs[keep], px[keep])          # refit without the set-aside points
        if H is None:
            return None
        err = np.nan_to_num(np.linalg.norm(project(H, dirs) - px, axis=1), nan=1e6)
        trimmed = float(np.sqrt(np.mean(np.sort(err)[:n - spare] ** 2)))
        # Final inliers: anything not wildly worse than the fit as a whole.
        inl = err <= max(thresh * 2, 3.0 * float(np.median(err)))
        return (trimmed, H, t0, inl)

    best = None
    for t0 in np.arange(-90.0, 181.0, 3.0):            # coarse
        r = score(t0)
        if r and (best is None or r[0] < best[0]):
            best = r
    if best is None:
        return None
    for t0 in np.arange(best[2] - 3, best[2] + 3.01, 0.25):   # fine
        r = score(t0)
        if r and r[0] < best[0]:
            best = r
    rms, H, t0, inl = best
    return H, float(t0), inl, rms


class HomographyAimer:
    """Maps image pixels to servo angles through the fitted model."""

    def __init__(self, width: int, height: int) -> None:
        self.w, self.h = width, height
        self.H: np.ndarray | None = None
        self.Hinv: np.ndarray | None = None
        self.tilt0 = 90.0
        self.samples: list[tuple[float, float, float, float]] = []
        self.rms_px: float | None = None
        self.check_px: float | None = None
        self.inliers = 0
        self._ref_dir: np.ndarray | None = None
        self._mean_angles = (90.0, 90.0)

    @property
    def ready(self) -> bool:
        return self.H is not None

    def fit(self) -> bool:
        m = fit_model(self.samples)
        if m is None:
            return False
        H, t0, inl, rms = m
        self.H, self.tilt0, self.rms_px = H, t0, rms
        self.Hinv = np.linalg.inv(H)
        self.inliers = int(inl.sum())
        # Drop outliers for good; they would only drag a later refit around.
        self.samples = [s for s, k in zip(self.samples, inl) if k]
        dirs = np.array([direction(p, t, t0) for p, t, _u, _v in self.samples])
        self._ref_dir = dirs.mean(axis=0)
        self._mean_angles = (float(np.mean([x[0] for x in self.samples])),
                             float(np.mean([x[1] for x in self.samples])))
        return True

    def angles_for(self, u: float, v: float) -> tuple[float, float] | None:
        if self.Hinv is None:
            return None
        d = self.Hinv @ np.array([u, v, 1.0])
        # A homography fixes direction only up to sign; the beam points the way
        # the calibration samples did.
        if self._ref_dir is not None and d @ self._ref_dir < 0:
            d = -d
        pan, tilt = angles_from_direction(d, self.tilt0)
        # Every direction has two servo solutions: (pan, tilt) and the head
        # swung round with the tilt flipped over the top. Take the one the
        # servos can reach that is nearest where calibration sampled.
        flipped = (pan + 180.0 if pan < 90.0 else pan - 180.0,
                   2 * self.tilt0 + 180.0 - tilt if tilt >= self.tilt0 else 2 * self.tilt0 - 180.0 - tilt)
        mp, mt = self._mean_angles
        best = None
        for cp, ct in ((pan, tilt), flipped):
            if not (PAN_MIN - 1 <= cp <= PAN_MAX + 1 and TILT_MIN - 1 <= ct <= TILT_MAX + 1):
                continue
            dist = math.hypot(cp - mp, ct - mt)
            if best is None or dist < best[0]:
                best = (dist, cp, ct)
        if best is None:
            return None
        return best[1], best[2]

    def pixel_for(self, pan: float, tilt: float) -> tuple[float, float] | None:
        if self.H is None:
            return None
        q = self.H @ direction(pan, tilt, self.tilt0)
        if abs(q[2]) < 1e-9:
            return None
        return float(q[0] / q[2]), float(q[1] / q[2])

    def covers(self, u: float, v: float, margin: float = 0.0) -> bool:
        # The model is physical, so it extrapolates; reachability is the test.
        return (-margin <= u <= self.w + margin and -margin <= v <= self.h + margin
                and self.angles_for(u, v) is not None)

    def add_sample(self, pan, tilt, u, v) -> None:
        """A reading taken while aiming. Refit occasionally, keep it bounded."""
        self.samples.append((float(pan), float(tilt), float(u), float(v)))
        self.samples = self.samples[-200:]
        if len(self.samples) % 6 == 0:
            self.fit()

    def save(self) -> None:
        try:
            with open(CALIBRATION_FILE, "w") as fh:
                json.dump({"w": self.w, "h": self.h, "samples": self.samples,
                           "rmsPx": self.rms_px, "checkPx": self.check_px}, fh)
        except OSError:
            pass

    @classmethod
    def load(cls, width: int, height: int) -> "HomographyAimer":
        a = cls(width, height)
        try:
            with open(CALIBRATION_FILE) as fh:
                d = json.load(fh)
        except (OSError, json.JSONDecodeError):
            return a
        if d.get("w") != width or d.get("h") != height:
            return a
        a.samples = [tuple(s) for s in d.get("samples", [])]
        a.check_px = d.get("checkPx")
        a.fit()
        return a


# --------------------------------------------------------------- dot finding

#: The dot must stand out from its surroundings by at least this much, 0-255.
MIN_DOT_DIFF = 18
#: Bigger than this is a hand or a lighting change, not a laser dot.
MAX_DOT_PX = 60
#: If more than this fraction of the image changed locally, something moved.
MAX_CHANGED_FRACTION = 0.03
#: Size of the "local" neighbourhood a dot must stand out from, pixels.
LOCAL_PX = 31

#: What the detector last saw, for the debug view: (frame_on, score, dot, why).
LAST: dict = {}


def _change(on: np.ndarray, off: np.ndarray) -> np.ndarray:
    """How much each pixel brightened because of the laser, 0-255.

    Two corrections a real webcam needs, and a synthetic test never does:

    * Exposure. Turning a laser on makes many webcams nudge exposure and white
      balance, shifting the WHOLE picture. Each channel's median change is
      subtracted, so a global shift cancels and only the local change remains.
    * Saturation. The middle of a laser dot usually clips to white, where
      "redness" is zero; only its halo is red. So the score takes the strongest
      of: red rising, brightness rising, and redness rising.

    Then a top-hat keeps only things SMALLER than LOCAL_PX that brightened --
    a dot -- and drops broad changes like a shadow or a lamp.
    """
    on = cv2.GaussianBlur(on, (3, 3), 0).astype(np.int16)
    off = cv2.GaussianBlur(off, (3, 3), 0).astype(np.int16)
    d = on - off
    d -= np.median(d.reshape(-1, 3), axis=0).astype(np.int16)    # exposure shift
    dr = d[:, :, 2]
    grey = (d[:, :, 0] * 29 + d[:, :, 1] * 150 + d[:, :, 2] * 77) // 256
    red_on = on[:, :, 2] - (on[:, :, 0] + on[:, :, 1]) // 2
    red_off = off[:, :, 2] - (off[:, :, 0] + off[:, :, 1]) // 2
    dred = red_on - red_off
    score = np.clip(np.maximum(np.maximum(dr, grey), dred), 0, 255).astype(np.uint8)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (LOCAL_PX, LOCAL_PX))
    return cv2.morphologyEx(score, cv2.MORPH_TOPHAT, k)


def find_dot(frame_on: np.ndarray, frame_off: np.ndarray,
             near: tuple[float, float] | None = None) -> tuple[float, float] | None:
    """Where the laser dot is, from one laser-on and one laser-off frame.

    `near` is where the dot is expected (where the head was aimed). It is only
    used to choose between candidates that are otherwise too close to call --
    a reflection off something shiny versus the dot itself.
    """
    score = _change(frame_on, frame_off)
    LAST.clear()
    LAST.update(on=frame_on, score=score, dot=None, why="", near=near, at=time.time())
    peak = float(score.max())
    if peak < MIN_DOT_DIFF:
        LAST["why"] = f"nothing changed enough (strongest change {peak:.0f}, need {MIN_DOT_DIFF})"
        return None
    if (score > max(MIN_DOT_DIFF, peak * 0.35)).mean() > MAX_CHANGED_FRACTION:
        LAST["why"] = "too much of the picture changed -- something moved"
        return None
    _, mask = cv2.threshold(score, max(MIN_DOT_DIFF, peak * 0.45), 255, cv2.THRESH_BINARY)
    n, labels, stats, cents = cv2.connectedComponentsWithStats(mask, connectivity=8)
    blobs = []
    for i in range(1, n):
        side = max(stats[i, cv2.CC_STAT_WIDTH], stats[i, cv2.CC_STAT_HEIGHT])
        if side > MAX_DOT_PX or stats[i, cv2.CC_STAT_AREA] < 2:
            continue
        blobs.append((float(score[labels == i].max()), i))
    if not blobs:
        LAST["why"] = "only large changes, nothing dot-sized"
        return None
    blobs.sort(reverse=True)
    best = blobs[0][1]
    if len(blobs) > 1 and blobs[1][0] > 0.8 * blobs[0][0]:
        # Too close to call on strength. Use the expected position if we have it.
        close = [b for b in blobs if b[0] > 0.8 * blobs[0][0]]
        if near is None:
            LAST["why"] = f"{len(close)} equally strong spots (a reflection?)"
            return None
        best = min(close, key=lambda b: float(np.hypot(*(cents[b[1]] - np.array(near)))))[1]
    ys, xs = np.nonzero(labels == best)
    wts = score[ys, xs].astype(np.float64)
    dot = (float((xs * wts).sum() / wts.sum()), float((ys * wts).sum() / wts.sum()))
    LAST.update(dot=dot, why=f"found (strength {peak:.0f})")
    return dot


def debug_image() -> np.ndarray | None:
    """The last laser-on frame with what the detector saw drawn on it."""
    if "on" not in LAST:
        return None
    on, score = LAST["on"].copy(), LAST["score"]
    heat = cv2.applyColorMap(cv2.normalize(score, None, 0, 255, cv2.NORM_MINMAX), cv2.COLORMAP_INFERNO)
    img = cv2.addWeighted(on, 0.55, heat, 0.45, 0)
    if LAST.get("near") is not None:
        cv2.drawMarker(img, tuple(int(c) for c in LAST["near"]), (255, 200, 80),
                       cv2.MARKER_CROSS, 26, 2)
    if LAST.get("dot") is not None:
        cv2.circle(img, tuple(int(c) for c in LAST["dot"]), 16, (90, 255, 120), 2)
    cv2.putText(img, LAST.get("why", ""), (12, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.7,
                (255, 255, 255), 2, cv2.LINE_AA)
    return img


class Eye:
    """Frames from the browser, with the timing guarantees calibration needs."""

    def __init__(self, next_frame_after, link) -> None:
        self.after = next_frame_after
        self.link = link

    def settled(self):
        """A frame known to show the scene as it is now."""
        return self.after(time.time() + FRAME_LATENCY_S)

    def _once(self, near):
        self.link.set_laser(True)
        on = self.settled()
        self.link.set_laser(False)
        off = self.settled()
        self.link.set_laser(True)
        if on is None or off is None:
            LAST.update(why="no camera frames arrived")
            return None
        return find_dot(on, off, near)

    def blink(self, near: tuple[float, float] | None = None,
              confirm: bool = False) -> tuple[float, float] | None:
        """Laser on, look; laser off, look; difference. Leaves the laser on.

        With `confirm`, blink again and only answer if both readings agree --
        one stray glint can no longer drag the aim somewhere wrong.
        """
        a = self._once(near)
        if not confirm or a is None:
            return a
        b = self._once(a)
        if b is None:
            return a
        if np.hypot(a[0] - b[0], a[1] - b[1]) <= 10:
            return ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        c = self._once(near or a)
        if c is None:
            return None
        # Two of three agreeing wins.
        for x, y in ((a, c), (b, c)):
            if np.hypot(x[0] - y[0], x[1] - y[1]) <= 10:
                return ((x[0] + y[0]) / 2, (x[1] + y[1]) / 2)
        LAST.update(why="readings disagreed -- the dot may be on something shiny")
        return None


# ---------------------------------------------------------------- calibrate

class Cancelled(Exception):
    pass


def calibrate(link, eye: Eye, size: tuple[int, int], progress=lambda msg, frac: None,
              cancelled=lambda: False, down: float = -1.0) -> HomographyAimer:
    """Find the dot, flood-fill the servo grid where it is visible, fit, verify.

    Raises RuntimeError with a plain-language reason on failure.
    """
    aimer = HomographyAimer(*size)
    moves = 0

    def sample(pan, tilt):
        nonlocal moves
        if cancelled():
            raise Cancelled()
        moves += 1
        link.move(float(pan), float(tilt), smooth=True)
        hit = eye.blink()
        if hit is not None:
            aimer.samples.append((link.pose.pan, link.pose.tilt, hit[0], hit[1]))
        return hit

    # 1. Find the dot: where the head already points, then outward.
    progress("looking for the laser dot", 0.02)
    p0, t0 = link.pose.pan, link.pose.tilt
    start = None
    # Search DOWNWARD first -- toward the desk -- from wherever the head was
    # left aimed. `down` is the sign of the tilt change that lowers the beam on
    # this rig. Sweeping upward first sent the beam at walls and ceilings.
    seeds = [(p0, t0)] + [(p0 + dp, t0 + dt * down)
                          for r in (8, 16, 26, 38)
                          for dp, dt in ((0, r), (r, r), (-r, r), (r, 0), (-r, 0),
                                         (0, -r), (r, -r), (-r, -r))]
    far = sorted((40, 60, 80, 100, 120), key=lambda t: t * down)   # lowest beam first
    seeds += [(p, t) for t in far for p in (90, 60, 120, 40, 140)]
    for i, (p, t) in enumerate(seeds):
        if not (PAN_MIN <= p <= PAN_MAX and TILT_MIN <= t <= TILT_MAX):
            continue
        progress(f"looking for the laser dot ({i + 1}/{len(seeds)})", 0.02 + 0.15 * i / len(seeds))
        if sample(p, t) is not None:
            start = (link.pose.pan, link.pose.tilt)
            break
    if start is None:
        raise RuntimeError("The camera never saw the laser dot. Aim the head so the beam "
                           "lands on the desk inside the camera's view, and keep the room "
                           "lighting steady.")

    # 2. Flood fill over the grid from there, visiting only where the dot shows.
    seen = {(round(start[0]), round(start[1]))}
    frontier = [start]
    misses = 0
    while frontier and len(aimer.samples) < TARGET_SAMPLES and moves < MAX_MOVES:
        p, t = frontier.pop(0)
        for dp, dt in ((GRID_STEP, 0), (-GRID_STEP, 0), (0, GRID_STEP), (0, -GRID_STEP)):
            q = (p + dp, t + dt)
            key = (round(q[0]), round(q[1]))
            if key in seen or not (PAN_MIN <= q[0] <= PAN_MAX and TILT_MIN <= q[1] <= TILT_MAX):
                continue
            seen.add(key)
            progress(f"mapping the desk: {len(aimer.samples)} points",
                     0.18 + 0.62 * len(aimer.samples) / TARGET_SAMPLES)
            if sample(*q) is not None:
                frontier.append(q)
            else:
                misses += 1

    if len(aimer.samples) < 8:
        raise RuntimeError(f"Only saw the dot at {len(aimer.samples)} positions. The beam "
                           "needs a bigger patch of desk in camera view.")
    progress("fitting", 0.82)
    if not aimer.fit():
        raise RuntimeError("The readings did not fit a flat surface. Keep hands out of "
                           "view and make sure the camera and head are not moving.")

    # 3. Verify: aim at pixels it has NOT sampled, measure the miss.
    progress("checking accuracy", 0.88)
    us = [s[2] for s in aimer.samples]; vs = [s[3] for s in aimer.samples]
    errs = []
    for fx, fy in ((0.25, 0.3), (0.75, 0.3), (0.5, 0.5), (0.25, 0.7), (0.75, 0.7)):
        tu = min(us) + (max(us) - min(us)) * fx
        tv = min(vs) + (max(vs) - min(vs)) * fy
        a = aimer.angles_for(tu, tv)
        if not a:
            continue
        hit = sample(*a)
        if hit is not None:
            errs.append(math.hypot(hit[0] - tu, hit[1] - tv))
    aimer.check_px = float(np.sqrt(np.mean(np.square(errs)))) if errs else None
    aimer.fit()                      # the checks are good samples too
    link.set_laser(False)
    aimer.save()
    progress("done", 1.0)
    return aimer


def refine(link, eye: Eye, aimer: HomographyAimer, progress=lambda msg, frac: None,
           cancelled=lambda: False) -> HomographyAimer:
    """Add automatic points INSIDE the area a manual calibration covered.

    The manual points already define where the desk is, so every aim here lands
    somewhere known to be visible -- it cannot wander up a wall. Then refit and
    measure the error on positions it was not given.
    """
    us = [s[2] for s in aimer.samples]; vs = [s[3] for s in aimer.samples]
    u0, u1, v0, v1 = min(us), max(us), min(vs), max(vs)
    grid = [(u0 + (u1 - u0) * fx, v0 + (v1 - v0) * fy)
            for fy in (0.1, 0.37, 0.63, 0.9) for fx in (0.1, 0.37, 0.63, 0.9)]
    for i, (tu, tv) in enumerate(grid):
        if cancelled():
            raise Cancelled()
        progress(f"adding points: {i + 1}/{len(grid)}", 0.1 + 0.7 * i / len(grid))
        a = aimer.angles_for(tu, tv)
        if not a:
            continue
        link.move(*a, smooth=True)
        hit = eye.blink()
        if hit is not None:
            aimer.samples.append((link.pose.pan, link.pose.tilt, hit[0], hit[1]))
    progress("fitting", 0.82)
    aimer.fit()
    progress("checking accuracy", 0.88)
    errs = []
    for fx, fy in ((0.25, 0.25), (0.75, 0.25), (0.5, 0.5), (0.25, 0.75), (0.75, 0.75)):
        tu, tv = u0 + (u1 - u0) * fx, v0 + (v1 - v0) * fy
        a = aimer.angles_for(tu, tv)
        if not a:
            continue
        link.move(*a, smooth=True)
        hit = eye.blink()
        if hit is not None:
            errs.append(math.hypot(hit[0] - tu, hit[1] - tv))
    aimer.check_px = float(np.sqrt(np.mean(np.square(errs)))) if errs else aimer.check_px
    link.set_laser(False)
    aimer.save()
    progress("done", 1.0)
    return aimer
