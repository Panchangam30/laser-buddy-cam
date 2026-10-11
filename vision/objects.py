"""Track any everyday object on the desk -- a phone, a pencil, a mug -- and aim at it.

This is the general mode. The breadboard mode (board.py, aim.py) needs an
830-hole board in view and measures everything in board millimetres; this one
needs nothing but the camera and the desk, and works in camera pixels.

Three pieces:

* Detection. The vision model is shown the whole frame and asked what is on the
  desk and roughly where (a box). That is the only thing it is good at here and
  the only thing it is asked. It runs in the background, every few seconds or
  when the scene changes, never per frame.
* Tracking. Between detections each object is followed with an OpenCV MIL
  tracker, so boxes move with the object at frame rate and ids stay stable.
  A fresh detection is matched back onto the existing tracks by overlap.
* Aiming. A pixel-to-servo map (follow.PixelAimer) learned by watching the dot,
  then refined on every point by closed loop: aim, blink the laser to find
  where the dot actually landed, correct, repeat. The calibration only has to
  get the dot close; the loop puts it on the object.

Depth caveat, which no calibration removes: the camera and the laser sit in
different places, so the map is exact only at the depth it was calibrated on
(the desk). The closed-loop correction is what makes tall objects work anyway.
"""

from __future__ import annotations

import base64
import json
import os
import threading
import time
import urllib.error
import urllib.request

import cv2
import numpy as np

from . import follow
from .laser import PAN_MAX, PAN_MIN, TILT_MAX, TILT_MIN

MODEL = os.environ.get("OPENAI_SCENE_MODEL") or os.environ.get("OPENAI_MODEL", "gpt-4o")

#: Re-detect at least this often while tracking, so new objects appear.
REDETECT_S = 12.0
#: ...and sooner than that when the picture has visibly changed.
CHANGE_REDETECT_S = 3.0
#: Mean absolute grey difference (0-255) at which the scene counts as changed.
CHANGE_LEVEL = 9.0
#: A track not confirmed by any detection for this long is dropped.
FORGET_S = 30.0
#: Overlap needed to treat a fresh detection as an existing track.
MATCH_IOU = 0.3

#: Closed-loop aiming: stop once the dot is this close to the target, in pixels.
AIM_TOLERANCE_PX = 12.0
AIM_ITERATIONS = 5

PROMPT = """\
You are the eyes of a desk assistant that can point a laser at things. You are
shown one webcam photo of a desk or workbench. List the distinct physical
objects you can see: phones, pens, pencils, mugs, keyboards, tools, cables,
hands, papers, boards, anything.

For each object give a tight bounding box in the image, as [x0, y0, x1, y1]
with coordinates normalised to 0-1000 (0,0 is the top-left corner, 1000,1000
the bottom-right). Be precise: the laser is aimed at the centre of your box.

Rules:
- Only list things that are actually visible. Never invent an object.
- Use the plain name a person would say out loud: "phone", "pencil",
  "blue mug", "Arduino Uno". Add colour or a distinguishing detail when there
  are two of the same thing ("left pencil", "yellow pencil").
- Skip the desk surface itself, walls and background furniture.
- Skip a small bright red dot: that is the laser, not an object.
- If text on an object is legible (a brand, a label) put it in "detail".
  Never guess text you cannot read.
- At most 15 objects, most prominent first.

Reply with JSON only:
{"objects": [{"label": "phone", "detail": "black, face up, screen off",
  "box": [412, 300, 560, 610], "confidence": "high"}],
 "scene": "one sentence describing the desk as a whole"}
confidence is "high", "medium" or "low".
"""


def _encode(img: np.ndarray, quality: int = 85) -> str:
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise RuntimeError("failed to JPEG-encode frame")
    return "data:image/jpeg;base64," + base64.b64encode(buf).decode()


def detect(frame: np.ndarray, api_key: str, timeout: float = 30.0) -> tuple[list[dict], str, str | None]:
    """Ask the vision model what is in the frame. Returns (objects, scene, error)."""
    if not api_key:
        return [], "", "OPENAI_API_KEY missing -- objects cannot be identified"
    h, w = frame.shape[:2]
    body = json.dumps({
        "model": MODEL,
        "max_tokens": 1200,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": PROMPT},
            {"role": "user", "content": [
                {"type": "text", "text": f"The photo is {w}x{h} pixels."},
                {"type": "image_url", "image_url": {"url": _encode(frame), "detail": "high"}},
            ]},
        ],
    }).encode()
    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions", data=body,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            payload = json.loads(r.read())
    except urllib.error.HTTPError as e:
        return [], "", f"OpenAI {e.code}: {e.read()[:200].decode(errors='replace')}"
    except Exception as e:
        return [], "", f"{type(e).__name__}: {e}"

    raw = payload.get("choices", [{}])[0].get("message", {}).get("content", "")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return [], "", "model did not return valid JSON"

    out = []
    for item in data.get("objects") or []:
        try:
            x0, y0, x1, y1 = (float(v) for v in item.get("box", []))
        except (TypeError, ValueError):
            continue
        x0, x1 = sorted((x0, x1)); y0, y1 = sorted((y0, y1))
        box = (int(x0 / 1000 * w), int(y0 / 1000 * h),
               int((x1 - x0) / 1000 * w), int((y1 - y0) / 1000 * h))
        if box[2] < 4 or box[3] < 4:
            continue
        out.append({
            "label": str(item.get("label", "")).strip() or "object",
            "detail": str(item.get("detail", "") or "").strip(),
            "confidence": str(item.get("confidence", "medium")).lower(),
            "box": box,
        })
    return out, str(data.get("scene", "") or "").strip(), None


def _iou(a, b) -> float:
    ax0, ay0, aw, ah = a; bx0, by0, bw, bh = b
    ix = max(0, min(ax0 + aw, bx0 + bw) - max(ax0, bx0))
    iy = max(0, min(ay0 + ah, by0 + bh) - max(ay0, by0))
    inter = ix * iy
    union = aw * ah + bw * bh - inter
    return inter / union if union else 0.0


class SceneObject:
    #: MIL is not cheap at full resolution; track on a half-size frame.
    SCALE = 0.5

    def __init__(self, oid: str, det: dict, frame: np.ndarray) -> None:
        self.id = oid
        self.label = det["label"]
        self.detail = det["detail"]
        self.confidence = det["confidence"]
        self.box = det["box"]
        self.first_seen = self.confirmed = time.time()
        self.tracking = False
        self.tracker = None
        self._start(frame)

    def _start(self, frame) -> None:
        x, y, w, h = self.box
        s = self.SCALE
        small = cv2.resize(frame, None, fx=s, fy=s)
        try:
            t = cv2.TrackerMIL_create()
            t.init(small, (int(x * s), int(y * s), max(4, int(w * s)), max(4, int(h * s))))
            self.tracker, self.tracking = t, True
        except cv2.error:
            self.tracker, self.tracking = None, False

    def reseed(self, det: dict, frame) -> None:
        self.label, self.detail, self.confidence = det["label"], det["detail"], det["confidence"]
        self.box = det["box"]
        self.confirmed = time.time()
        self._start(frame)

    def update(self, small) -> None:
        if self.tracker is None:
            return
        ok, box = self.tracker.update(small)
        self.tracking = bool(ok)
        if ok:
            s = self.SCALE
            x, y, w, h = box
            self.box = (int(x / s), int(y / s), int(w / s), int(h / s))

    @property
    def centre(self) -> tuple[float, float]:
        x, y, w, h = self.box
        return (x + w / 2.0, y + h / 2.0)

    def serialise(self, w: int, h: int) -> dict:
        x, y, bw, bh = self.box
        cu, cv = self.centre
        return {
            "id": self.id, "label": self.label, "detail": self.detail,
            "confidence": self.confidence if self.tracking else "low",
            "box": [x, y, bw, bh],
            "centre": [round(cu), round(cv)],
            # Where it sits, in words, for the assistant and the UI.
            "where": _where(cu / max(1, w), cv / max(1, h)),
            "tracking": self.tracking,
            "ageS": round(time.time() - self.confirmed, 1),
        }


def _where(fx: float, fy: float) -> str:
    col = "left" if fx < 0.33 else "right" if fx > 0.67 else "centre"
    row = "far" if fy < 0.33 else "near" if fy > 0.67 else "middle"
    if col == "centre" and row == "middle":
        return "in the middle"
    if col == "centre":
        return f"{row} centre"
    return f"{row} {col}" if row != "middle" else f"on the {col}"


def describe(objs: list[dict], scene: str = "") -> str:
    if not objs:
        return "No objects identified yet." + (f" {scene}" if scene else "")
    lines = [f"- {o['label']} ({o['id']}), {o['where']}"
             + (f", {o['detail']}" if o["detail"] else "")
             + ("" if o["tracking"] else ", lost track of it -- may have moved")
             for o in objs]
    return (f"{scene}\n" if scene else "") + "\n".join(lines)


class ObjectScene:
    """Every object currently tracked, with background re-detection."""

    def __init__(self, api_key: str) -> None:
        self.api_key = api_key
        self.objects: list[SceneObject] = []
        self.scene = ""
        self.error = ""
        self.frames = 0
        self.size = (0, 0)
        self._next_id = 1
        self._last_detect = 0.0
        self._detecting = False
        self._detect_grey: np.ndarray | None = None
        self._lock = threading.Lock()
        self._done = threading.Condition(self._lock)
        self._detections = 0

    def reset(self) -> None:
        with self._lock:
            self.objects, self.scene, self.error = [], "", ""
            self._last_detect = 0.0
            self._detect_grey = None

    # ---------------------------------------------------------------- per frame

    def update(self, frame: np.ndarray) -> dict:
        with self._lock:
            self.frames += 1
            h, w = frame.shape[:2]
            self.size = (w, h)
            small = cv2.resize(frame, None, fx=SceneObject.SCALE, fy=SceneObject.SCALE)
            for o in self.objects:
                o.update(small)
            now = time.time()
            self.objects = [o for o in self.objects if now - o.confirmed < FORGET_S]
            due = not self._detecting and self.api_key and (
                now - self._last_detect > REDETECT_S
                or (now - self._last_detect > CHANGE_REDETECT_S and self._changed(frame)))
            if due:
                self._detecting = True
                threading.Thread(target=self._detect, args=(frame.copy(),), daemon=True).start()
            return self._snapshot()

    def _changed(self, frame) -> bool:
        grey = cv2.cvtColor(cv2.resize(frame, (160, 90)), cv2.COLOR_BGR2GRAY)
        if self._detect_grey is None:
            return True
        return float(np.mean(cv2.absdiff(grey, self._detect_grey))) > CHANGE_LEVEL

    def _detect(self, frame) -> None:
        try:
            dets, scene, err = detect(frame, self.api_key)
        except Exception as e:                       # never kill the thread silently
            dets, scene, err = [], "", f"{type(e).__name__}: {e}"
        with self._lock:
            self._detecting = False
            self._last_detect = time.time()
            self._detect_grey = cv2.cvtColor(cv2.resize(frame, (160, 90)), cv2.COLOR_BGR2GRAY)
            self.error = err or ""
            if not err:
                self._merge(dets, frame)
                self.scene = scene
            self._detections += 1
            self._done.notify_all()

    def _merge(self, dets: list[dict], frame) -> None:
        unmatched = list(self.objects)
        kept = []
        for d in dets:
            best, best_iou = None, MATCH_IOU
            for o in unmatched:
                score = _iou(o.box, d["box"])
                # Same name counts for a lot: a phone that moved should stay "obj3".
                if o.label.lower() == d["label"].lower():
                    score += 0.15
                if score > best_iou:
                    best, best_iou = o, score
            if best is not None:
                unmatched.remove(best)
                best.reseed(d, frame)
                kept.append(best)
            else:
                kept.append(SceneObject(f"obj{self._next_id}", d, frame))
                self._next_id += 1
        # The model did not list these this time. Keep them while their tracker
        # still holds -- one missed detection is not the object leaving.
        kept += [o for o in unmatched if o.tracking]
        self.objects = kept

    def detect_now(self, frame: np.ndarray | None, timeout: float = 35.0) -> dict:
        """Force a detection and wait for it. For 'what do you see?'."""
        with self._lock:
            start = self._detections
            if frame is not None and not self._detecting:
                self._detecting = True
                threading.Thread(target=self._detect, args=(frame.copy(),), daemon=True).start()
            if self._detecting:
                self._done.wait_for(lambda: self._detections > start, timeout=timeout)
            return self._snapshot()

    def _snapshot(self) -> dict:
        w, h = self.size
        objs = [o.serialise(w, h) for o in self.objects]
        return {
            "mode": "objects", "at": round(time.time(), 3), "frame": self.frames,
            "size": [w, h], "objects": objs, "scene": self.scene,
            "detecting": self._detecting, "error": self.error,
            "summary": describe(objs, self.scene),
        }

    def snapshot(self) -> dict:
        with self._lock:
            return self._snapshot()

    def find(self, query: str) -> SceneObject | None:
        """Best match for a spoken name: 'the phone', 'obj3', 'yellow pencil'."""
        q = (query or "").lower().strip()
        for junk in ("the ", "my ", "a ", "an ", "that "):
            if q.startswith(junk):
                q = q[len(junk):]
        if not q:
            return None
        with self._lock:
            for o in self.objects:
                if o.id == q:
                    return o
            words = set(q.split())
            best, best_score = None, 0.0
            for o in self.objects:
                name = f"{o.label} {o.detail}".lower()
                score = sum(1 for wd in words if wd in name) / len(words)
                if q in o.label.lower():
                    score += 1
                if o.tracking:
                    score += 0.1
                if score > best_score:
                    best, best_score = o, score
            return best if best_score >= 0.5 else None

    def annotate(self, frame: np.ndarray) -> np.ndarray:
        with self._lock:
            for o in self.objects:
                x, y, w, h = o.box
                colour = (90, 220, 120) if o.tracking else (80, 140, 250)
                cv2.rectangle(frame, (x, y), (x + w, y + h), colour, 2)
                cv2.putText(frame, f"{o.id} {o.label}", (x + 3, max(14, y - 6)),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.5, colour, 1, cv2.LINE_AA)
        return frame


# --------------------------------------------------------------------- aiming

class FrameSource:
    """Looks like cv2.VideoCapture to follow.py, but reads browser frames.

    The browser owns the webcam, so the calibration routines that were written
    against a capture device get the frames the tab is already posting.
    """

    def __init__(self, next_frame) -> None:
        self.next_frame = next_frame

    def read(self):
        f = self.next_frame()
        return (f is not None), f


class PixelCalibrator:
    """Runs follow.calibrate in the background and reports progress."""

    def __init__(self) -> None:
        self.aimer: follow.PixelAimer | None = None
        self.running = False
        self.progress = ""
        self.error = ""
        self.at = 0.0
        self._cancel = False
        self._lock = threading.Lock()

    def aimer_for(self, w: int, h: int) -> follow.PixelAimer:
        if self.aimer is None or (self.aimer.w, self.aimer.h) != (w, h):
            self.aimer = follow.PixelAimer.load(w, h)
        return self.aimer

    def claim(self) -> bool:
        with self._lock:
            if self.running:
                return False
            self.running, self.error, self.progress, self._cancel = True, "", "starting", False
            return True

    def cancel(self) -> None:
        self._cancel = True

    def run(self, link, next_frame, size) -> None:
        cap = FrameSource(next_frame)
        aimer = follow.PixelAimer(*size)

        def show(_frame, _hit, caption):
            self.progress = caption
            if self._cancel:
                raise _Cancelled()

        try:
            ok = follow.calibrate(cap, link, aimer, show=show)
            if ok:
                self.aimer = aimer
                self.at = time.time()
                self.progress = "done"
            else:
                self.error = ("Calibration failed: the camera never saw the laser dot "
                              "move. Aim the head at the desk in view and try again.")
        except _Cancelled:
            self.error = "Calibration stopped."
        except Exception as e:
            self.error = f"Calibration failed: {e}"
        finally:
            try:
                link.set_laser(False)
            except Exception:
                pass
            self.running = False

    def status(self, w: int, h: int) -> dict:
        a = self.aimer_for(w, h) if w and h else self.aimer
        ready = bool(a and a.ready)
        rms = a.rms_px if a else None
        if not ready:
            quality = "not calibrated"
        elif rms is None:
            quality = "calibrated"
        else:
            quality = "good" if rms < 15 else "rough" if rms < 40 else "poor"
        return {"mode": "pixels", "ready": ready, "running": self.running,
                "progress": self.progress, "error": self.error,
                "done": 0, "total": 0, "samples": len(a.samples) if a else 0,
                "rmsPx": round(rms, 1) if rms is not None else None,
                "rmsMm": None, "checked": 0, "at": self.at,
                "quality": quality}


class _Cancelled(Exception):
    pass


def _clamp(pan, tilt):
    return (max(PAN_MIN, min(PAN_MAX, pan)), max(TILT_MIN, min(TILT_MAX, tilt)))


def _angle_jacobian(aimer: follow.PixelAimer, u: float, v: float, d: float = 15.0):
    """d(pan, tilt) / d(u, v) of the calibrated map, by finite difference."""
    a0 = aimer.angles_for(u, v)
    au = aimer.angles_for(u + d, v)
    av = aimer.angles_for(u, v + d)
    if not (a0 and au and av):
        return None
    return np.array([[(au[0] - a0[0]) / d, (av[0] - a0[0]) / d],
                     [(au[1] - a0[1]) / d, (av[1] - a0[1]) / d]])


def aim_closed_loop(link, aimer: follow.PixelAimer, next_frame, target: tuple[float, float],
                    refine: bool = True) -> dict:
    """Put the dot on an image position: open-loop guess, then correct by looking.

    Each correction blinks the laser off for one frame to find the dot without
    ambiguity (follow.find_dot_blink), then moves by the remaining error through
    the local slope of the calibrated map. Every reading is also a fresh
    calibration sample, so the map gets better around where it is used.
    """
    tu, tv = target
    angles = aimer.angles_for(tu, tv)
    if angles is None:
        return {"ok": False, "error": "No aim solution for that spot."}
    pan, tilt = _clamp(*angles)
    if not link.move(pan, tilt):
        return {"ok": False, "error": link.error or "The head did not answer."}
    link.set_laser(True)
    if not refine:
        return {"ok": True, "pan": round(pan, 1), "tilt": round(tilt, 1), "missPx": None}

    cap = FrameSource(next_frame)
    miss = None
    for _ in range(AIM_ITERATIONS):
        dot = follow.find_dot_blink(cap, link, aimer.zones)
        if dot is None:
            break                       # beam is off the visible surface; keep the guess
        aimer.samples.append((link.pose.pan, link.pose.tilt, dot[0], dot[1]))
        err = np.array([tu - dot[0], tv - dot[1]])
        miss = float(np.hypot(*err))
        if miss <= AIM_TOLERANCE_PX:
            break
        J = _angle_jacobian(aimer, *dot)
        if J is None:
            break
        dp, dt = np.clip(J @ err * 0.85, -10, 10)
        pan, tilt = _clamp(float(link.pose.pan + dp), float(link.pose.tilt + dt))
        link.move(pan, tilt)
    # Keep the map learning, but not unboundedly.
    if len(aimer.samples) > 400:
        aimer.samples = aimer.samples[-400:]
    aimer.fit()
    link.set_laser(True)
    return {"ok": True, "pan": round(link.pose.pan, 1), "tilt": round(link.pose.tilt, 1),
            "missPx": None if miss is None else round(miss)}


class Follower:
    """Keep the beam on one tracked object as it moves. Open loop, ~4 Hz."""

    DEADBAND_PX = 14.0

    def __init__(self) -> None:
        self.target_id = ""
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    @property
    def active(self) -> bool:
        return bool(self._thread and self._thread.is_alive())

    def start(self, oid: str, scene: ObjectScene, link, aimer) -> None:
        self.stop()
        self.target_id = oid
        self._stop = threading.Event()
        stop = self._stop

        def run():
            last = None
            while not stop.wait(0.25):
                obj = next((o for o in scene.objects if o.id == oid), None)
                if obj is None or not link.connected:
                    break
                if not obj.tracking:
                    continue
                c = obj.centre
                if last is not None and np.hypot(c[0] - last[0], c[1] - last[1]) < self.DEADBAND_PX:
                    continue
                angles = aimer.angles_for(*c)
                if angles:
                    link.move(*_clamp(*angles), smooth=False)
                    link.set_laser(True)
                    last = c
            self.target_id = ""

        self._thread = threading.Thread(target=run, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self.target_id = ""
