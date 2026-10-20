"""Track any everyday object on the desk -- a phone, a pencil, a mug -- and aim at it.

This is the general mode. The breadboard mode (board.py, aim.py) needs an
830-hole board in view and measures everything in board millimetres; this one
needs nothing but the camera and the desk, and works in camera pixels.

Three pieces:

* Tracking. YOLO-World (vision/yolo.py), a pretrained open-vocabulary detector,
  finds objects by name every frame and ByteTrack keeps their ids stable.
* Naming. Every few seconds, or when the scene changes, the vision language
  model looks at the whole frame to name things properly, read labels, and
  spot objects YOLO's vocabulary does not cover yet; those names are then
  added to YOLO so it starts tracking them too.
* Aiming. A camera-pixel <-> servo map fitted with a physical homography model
  (vision/pixelcal.py), then refined on every point by closed loop: aim, blink
  the laser to see where the dot actually landed, correct.

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

from . import pixelcal
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
        box = _clip(box, w, h)
        if box is None:
            continue
        out.append({
            "label": str(item.get("label", "")).strip() or "object",
            "detail": str(item.get("detail", "") or "").strip(),
            "confidence": str(item.get("confidence", "medium")).lower(),
            "box": box,
        })
    return out, str(data.get("scene", "") or "").strip(), None


def _clip(box, w: int, h: int, min_side: int = 6):
    """Clamp a box to the frame, or None when too little of it is left.

    This is not tidiness. The model happily returns boxes that run off the edge
    of the picture (an object half out of shot), and OpenCV's MIL tracker
    initialised on one of those does not raise -- it takes the process down
    with SIGKILL, which kills the whole vision service.
    """
    x, y, bw, bh = (int(v) for v in box)
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(w, x + bw), min(h, y + bh)
    if x1 - x0 < min_side or y1 - y0 < min_side:
        return None
    return (x0, y0, x1 - x0, y1 - y0)



#: A YOLO track that vanished is kept (as lost) this long before it is dropped,
#: so an object a hand passes over does not blink out of the list.
LOST_KEEP_S = 4.0
#: Language-model objects YOLO has not picked up are kept this long.
LLM_KEEP_S = 25.0


class SceneObject:
    def __init__(self, oid: str, label: str, box, source: str) -> None:
        self.id = oid
        self.label = label
        #: YOLO's own class name, kept separately from the display label.
        self.cls = label
        self.detail = ""
        self.confidence = "medium"
        self.box = box
        self.source = source              # "yolo" (tracked) or "llm" (named only)
        self.tid: int | None = None
        self.first_seen = self.confirmed = time.time()
        self.tracking = source == "yolo"

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
            "where": _where(cu / max(1, w), cv / max(1, h)),
            "tracking": self.tracking,
            "source": self.source,
            "ageS": round(time.time() - self.confirmed, 1),
        }


def _iou(a, b) -> float:
    ax0, ay0, aw, ah = a; bx0, by0, bw, bh = b
    ix = max(0, min(ax0 + aw, bx0 + bw) - max(ax0, bx0))
    iy = max(0, min(ay0 + ah, by0 + bh) - max(ay0, by0))
    inter = ix * iy
    union = aw * ah + bw * bh - inter
    return inter / union if union else 0.0


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


def describe(objs: list[dict], scene: str = "") -> str:
    if not objs:
        return "No objects identified yet." + (f" {scene}" if scene else "")
    lines = [f"- {o['label']} ({o['id']}), {o['where']}"
             + (f", {o['detail']}" if o["detail"] else "")
             + ("" if o["tracking"] else
                (", seen but not being tracked" if o.get("source") == "llm"
                 else ", lost track of it -- may have moved"))
             for o in objs]
    return (f"{scene}\n" if scene else "") + "\n".join(lines)


def _inside(pt, box, slack: float = 0.15) -> bool:
    x, y, w, h = box
    return (x - w * slack <= pt[0] <= x + w * (1 + slack)
            and y - h * slack <= pt[1] <= y + h * (1 + slack))


def _match_score(o: "SceneObject", d: dict) -> float:
    """How likely a language-model detection is this tracked object.

    The language model's boxes are loose -- often half the size or offset from
    the object -- so overlap alone misses obvious matches. A shared name
    ("keyboard" in "Logitech keyboard") plus either box's centre sitting inside
    the other is strong evidence on its own.
    """
    score = _iou(o.box, d["box"])
    words = set(d["label"].lower().split())
    named = bool(words & set(f"{o.cls} {o.label}".lower().split()))
    dx, dy, dw, dh = d["box"]
    centred = _inside(o.centre, d["box"]) or _inside((dx + dw / 2, dy + dh / 2), o.box)
    if named:
        score += 0.35
    if centred:
        score += 0.25
    if not named and not centred:
        score *= 0.5
    return score


def _proximity(a, b) -> tuple[float, float]:
    """(centre distance in units of the boxes' mean diagonal, area ratio a/b)."""
    ax, ay, aw, ah = a; bx, by, bw, bh = b
    dist = float(np.hypot(ax + aw / 2 - bx - bw / 2, ay + ah / 2 - by - bh / 2))
    diag = (float(np.hypot(aw, ah)) + float(np.hypot(bw, bh))) / 2
    return dist / max(1.0, diag), (aw * ah) / max(1.0, bw * bh)


def _conf_word(c: float) -> str:
    return "high" if c >= 0.5 else "medium" if c >= 0.25 else "low"


class ObjectScene:
    """Every object on the desk.

    YOLO-World + ByteTrack (vision/yolo.py) find and follow objects every frame.
    The language model looks every so often to name things properly, read
    labels, and spot objects YOLO's vocabulary does not cover yet -- those names
    are then added to YOLO, so it starts tracking them too.
    """

    def __init__(self, api_key: str, detector=None) -> None:
        self.api_key = api_key
        if detector is None:
            from .yolo import Detector
            detector = Detector()
        self.detector = detector
        self.objects: list[SceneObject] = []
        self.scene = ""
        self.error = ""
        self.frames = 0
        self.size = (0, 0)
        self._next_id = 1
        self._by_tid: dict[int, SceneObject] = {}
        self._last_detect = 0.0
        self._detecting = False
        self._detect_grey: np.ndarray | None = None
        self._lock = threading.Lock()
        self._done = threading.Condition(self._lock)
        self._detections = 0

    def reset(self) -> None:
        with self._lock:
            self.objects, self.scene, self.error = [], "", ""
            self._by_tid = {}
            self._last_detect = 0.0
            self._detect_grey = None

    def _new_id(self) -> str:
        oid = f"obj{self._next_id}"
        self._next_id += 1
        return oid

    # ---------------------------------------------------------------- per frame

    def update(self, frame: np.ndarray) -> dict:
        dets = self.detector.track(frame)          # outside the scene lock: ~15 ms
        with self._lock:
            self.frames += 1
            h, w = frame.shape[:2]
            self.size = (w, h)
            now = time.time()
            self._apply_yolo(dets, w, h, now)
            due = not self._detecting and self.api_key and (
                now - self._last_detect > REDETECT_S
                or (now - self._last_detect > CHANGE_REDETECT_S and self._changed(frame)))
            if due:
                self._detecting = True
                threading.Thread(target=self._detect, args=(frame.copy(),), daemon=True).start()
            return self._snapshot()

    def _apply_yolo(self, dets, w, h, now) -> None:
        seen: set[str] = set()
        for d in dets:
            box = _clip(d["box"], w, h)
            if box is None:
                continue
            obj = self._by_tid.get(d["tid"]) if d["tid"] is not None else None
            if obj is None:
                obj = self._adopt(d["label"], box, now)
                if d["tid"] is not None:
                    self._by_tid[d["tid"]] = obj
            if obj.id in seen:
                continue
            seen.add(obj.id)
            if obj.source == "llm":           # YOLO has now picked it up
                obj.source = "yolo"
            # Keep a name the language model gave it ("yellow pencil"); otherwise
            # the display name follows YOLO's class.
            if obj.label == obj.cls:
                obj.label = d["label"]
            obj.box, obj.cls = box, d["label"]
            obj.confidence = _conf_word(d["conf"])
            obj.tracking, obj.confirmed = True, now
        keep = []
        for o in self.objects:
            if o.id not in seen and o.source == "yolo":
                o.tracking = False
            limit = LOST_KEEP_S if o.source == "yolo" else LLM_KEEP_S
            if o.id in seen or now - o.confirmed < limit:
                keep.append(o)
        self.objects = keep
        live = {o.id for o in keep}
        self._by_tid = {t: o for t, o in self._by_tid.items() if o.id in live}

    def _adopt(self, label, box, now) -> SceneObject:
        """A new track: reuse a recently lost object of the same kind nearby.

        ByteTrack hands out a new id after an occlusion, and after the
        vocabulary changes. Without this the phone becomes obj9 every time a
        hand crosses it, and "point at obj3" stops working.
        """
        cu, cv = box[0] + box[2] / 2, box[1] + box[3] / 2
        best, best_d = None, 0.0
        for o in self.objects:
            if o.tracking and o.source == "yolo":
                continue
            same = o.cls == label or o.label.lower() == label
            ou, ov = o.centre
            dist = float(np.hypot(ou - cu, ov - cv))
            near = max(60.0, 0.6 * max(o.box[2], o.box[3]))
            ok = (same and dist < near * 2) or _iou(o.box, box) > 0.75
            if ok and (best is None or dist < best_d):
                best, best_d = o, dist
        if best is not None:
            return best
        obj = SceneObject(self._new_id(), label, box, "yolo")
        self.objects.append(obj)
        return obj

    def _changed(self, frame) -> bool:
        grey = cv2.cvtColor(cv2.resize(frame, (160, 90)), cv2.COLOR_BGR2GRAY)
        if self._detect_grey is None:
            return True
        return float(np.mean(cv2.absdiff(grey, self._detect_grey))) > CHANGE_LEVEL

    # ------------------------------------------------------ language-model look

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
                self._merge_llm(dets)
                self.scene = scene
            self._detections += 1
            self._done.notify_all()

    def _merge_llm(self, dets: list[dict]) -> None:
        """Put the language model's names and details onto tracked objects.

        The model's boxes can be the right size but shifted by most of their
        own width, and YOLO often has the right box under the wrong name (an
        Arduino tracked as "book"). Matching them to each other matters more
        than either alone: the tracked box is what the laser can hit, the name
        is what the user says. So tracked objects are tried first -- on strong
        evidence, then by proximity -- and only a name with no tracked object
        anywhere near it becomes a free-floating, untracked guess.
        """
        now = time.time()
        claimed: set[str] = set()
        matched: dict[int, SceneObject] = {}
        tracked = [o for o in self.objects if o.tracking]

        # 1. Strong evidence, tracked objects only. An untracked guess from an
        #    earlier look must not compete here: it carries the same name, so
        #    it would win every time and the bad box would never be corrected.
        for i, d in enumerate(dets):
            best, best_score = None, 0.3
            for o in tracked:
                if o.id in claimed:
                    continue
                score = _match_score(o, d)
                if score > best_score:
                    best, best_score = o, score
            if best is not None:
                claimed.add(best.id)
                matched[i] = best

        # 2. Proximity: a tracked object still showing YOLO's own class name,
        #    of similar size, nearest within about one box diagonal.
        for i, d in enumerate(dets):
            if i in matched:
                continue
            best, best_near = None, 1.25
            for o in tracked:
                if o.id in claimed or o.label != o.cls:
                    continue
                near, ratio = _proximity(o.box, d["box"])
                if 1 / 3 <= ratio <= 3 and near < best_near:
                    best, best_near = o, near
            if best is not None:
                claimed.add(best.id)
                matched[i] = best

        new_names = []
        for i, d in enumerate(dets):
            o = matched.get(i)
            if o is None:
                # 3. Nothing tracked fits: refresh an earlier guess of the same
                #    name, or start a new one.
                o = next((x for x in self.objects if x.source == "llm" and x.id not in claimed
                          and x.label.lower() == d["label"].lower()), None)
                if o is None:
                    o = SceneObject(self._new_id(), d["label"], d["box"], "llm")
                    self.objects.append(o)
                o.box, o.confirmed = d["box"], now
                o.confidence = d["confidence"]
                claimed.add(o.id)
            o.label, o.detail = d["label"], d["detail"]
            new_names.append(d["label"])
            # The bare noun as well: "yellow pencil" -> "pencil".
            new_names.append(d["label"].split()[-1])

        # A name now on a tracked object retires any untracked guess of it, or
        # "point at the Arduino" can still pick the guess.
        on_tracked = {o.label.lower() for o in matched.values() if o.tracking}
        self.objects = [o for o in self.objects
                        if not (o.source == "llm" and not o.tracking
                                and o.id not in claimed and o.label.lower() in on_tracked)]
        if self.detector.add_names(new_names):
            pass

    def detect_now(self, frame: np.ndarray | None, timeout: float = 35.0) -> dict:
        """Force a language-model look and wait for it. For 'what do you see?'."""
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
        objs.sort(key=lambda o: (not o["tracking"], o["id"]))
        err = self.error or ("" if self.detector.ready else self.detector.error)
        return {
            "mode": "objects", "at": round(time.time(), 3), "frame": self.frames,
            "size": [w, h], "objects": objs, "scene": self.scene,
            "detecting": self._detecting, "error": err,
            "tracker": "yolo-world" if self.detector.ready
                       else ("loading" if not self.detector.error else "unavailable"),
            "summary": describe(objs, self.scene),
        }

    def snapshot(self) -> dict:
        with self._lock:
            return self._snapshot()

    def get(self, oid: str) -> SceneObject | None:
        with self._lock:
            return next((o for o in self.objects if o.id == oid), None)

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
                name = f"{o.label} {o.cls} {o.detail}".lower()
                score = sum(1 for wd in words if wd in name) / len(words)
                if q in o.label.lower() or q == o.cls:
                    score += 1
                if o.tracking:
                    score += 0.1
                if score > best_score:
                    best, best_score = o, score
            return best if best_score >= 0.5 else None

    def locate(self, pt: tuple[float, float]) -> str:
        """A spot in the picture said the way a person would: what it is on or next to.

        For the laser dot, which the object list never contains -- it is a few
        red pixels, not a thing YOLO has a class for.
        """
        w, h = self.size
        where = _where(pt[0] / max(1, w), pt[1] / max(1, h)) if w else ""
        with self._lock:
            objs = [o for o in self.objects if o.tracking] or list(self.objects)
            hits = [o for o in objs if _inside(pt, o.box, slack=0.0)]
            if hits:
                # Smallest box wins: a dot on a phone lying on a book is on the phone.
                o = min(hits, key=lambda o: o.box[2] * o.box[3])
                return f"on the {o.label} ({o.id})" + (f", {where} of the picture" if where else "")
            if not objs:
                return f"{where} of the picture" if where else "in the picture"
            o = min(objs, key=lambda o: float(np.hypot(pt[0] - o.centre[0], pt[1] - o.centre[1])))
            dx, dy = pt[0] - o.centre[0], pt[1] - o.centre[1]
            # Image down is towards the camera, which is "in front of" from the user's seat.
            side = (("right of" if dx > 0 else "left of") if abs(dx) >= abs(dy)
                    else ("in front of" if dy > 0 else "behind"))
            return (f"{where} of the picture, " if where else "") + f"just {side} the {o.label} ({o.id})"

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

class PixelCalibrator:
    """Runs pixelcal.calibrate in the background and reports progress."""

    def __init__(self) -> None:
        self.aimer: pixelcal.HomographyAimer | None = None
        self.running = False
        self.progress = ""
        self.fraction = 0.0
        self.error = ""
        self.at = 0.0
        self._cancel = False
        self._lock = threading.Lock()
        self.manual: list[tuple[float, float, float, float]] = []

    def finish_manual(self, size) -> tuple["pixelcal.HomographyAimer | None", str]:
        """Fit the hand-aimed points. Returns (aimer, error)."""
        if len(self.manual) < self.MIN_MANUAL:
            return None, f"Add at least {self.MIN_MANUAL} points (you have {len(self.manual)})."
        a = pixelcal.HomographyAimer(*size)
        a.samples = list(self.manual)
        if not a.fit():
            return None, ("Those points do not fit together. Check each dot was marked "
                          "on the laser, and spread them out more.")
        dropped = len(self.manual) - len(a.samples)
        a.check_px = None
        a.save()
        self.aimer, self.at, self.error = a, time.time(), ""
        return a, (f"{dropped} point(s) looked wrong and were ignored." if dropped else "")

    def aimer_for(self, w: int, h: int) -> pixelcal.HomographyAimer:
        if self.aimer is None or (self.aimer.w, self.aimer.h) != (w, h):
            self.aimer = pixelcal.HomographyAimer.load(w, h)
        return self.aimer

    def claim(self) -> bool:
        with self._lock:
            if self.running:
                return False
            self.running, self.error, self.progress, self._cancel = True, "", "starting", False
            self.fraction = 0.0
            return True

    def cancel(self) -> None:
        self._cancel = True

    #: Manual calibration: points the user aimed at by hand, (pan, tilt, u, v).
    MIN_MANUAL = 5

    def run(self, link, frame_after, size, down: float = -1.0,
            base: "pixelcal.HomographyAimer | None" = None) -> None:
        """Automatic calibration, or -- given `base` -- refine a manual one."""
        def progress(msg, frac):
            self.progress, self.fraction = msg, frac
        try:
            eye = pixelcal.Eye(frame_after, link)
            if base is not None:
                self.aimer = pixelcal.refine(link, eye, base, progress, lambda: self._cancel)
            else:
                self.aimer = pixelcal.calibrate(link, eye, size, progress,
                                                lambda: self._cancel, down=down)
            self.at = time.time()
        except pixelcal.Cancelled:
            self.error = "Calibration stopped."
        except RuntimeError as e:
            self.error = str(e)
        except Exception as e:
            self.error = f"Calibration failed: {type(e).__name__}: {e}"
        finally:
            try:
                link.set_laser(False)
            except Exception:
                pass
            self.running = False

    def status(self, w: int, h: int) -> dict:
        a = self.aimer_for(w, h) if w and h else self.aimer
        ready = bool(a and a.ready)
        err = None
        if a and ready:
            err = a.check_px if a.check_px is not None else a.rms_px
        quality = ("not calibrated" if not ready else "calibrated" if err is None
                   else "good" if err < 10 else "rough" if err < 25 else "poor")
        return {"mode": "pixels", "ready": ready, "running": self.running,
                "progress": self.progress, "error": self.error,
                "done": round(self.fraction * 100), "total": 100 if self.running else 0,
                "samples": len(a.samples) if a else 0,
                "rmsPx": round(err, 1) if err is not None else None,
                "rmsMm": None, "checked": 0, "at": self.at, "quality": quality,
                "manual": [[round(p, 1), round(t, 1), round(u), round(v)]
                           for p, t, u, v in self.manual],
                "fitPx": round(a.rms_px, 1) if a and a.ready and a.rms_px is not None else None}


def _clamp(pan, tilt):
    return (max(PAN_MIN, min(PAN_MAX, float(pan))), max(TILT_MIN, min(TILT_MAX, float(tilt))))


def aim_closed_loop(link, aimer: pixelcal.HomographyAimer, frame_after,
                    target: tuple[float, float], refine: bool = True,
                    target_now=None) -> dict:
    """Put the dot on an image position: model guess, then correct by looking.

    Each correction blinks the laser to find the dot unambiguously, then moves
    by the remaining error. The step is computed through the model itself
    (where would the model have to aim to move the dot by this much), so it
    stays right even near the edges where a degree moves the dot further.
    Every reading is a fresh sample, so the calibration improves with use.
    `target_now`, if given, re-reads the target each round (it may be moving).
    """
    tu, tv = target
    angles = aimer.angles_for(tu, tv)
    if angles is None:
        return {"ok": False, "error": "The laser cannot reach that spot."}
    if not link.move(*_clamp(*angles)):
        return {"ok": False, "error": link.error or "The head did not answer."}
    link.set_laser(True)
    if not refine:
        return {"ok": True, "pan": round(link.pose.pan, 1), "tilt": round(link.pose.tilt, 1),
                "missPx": None}

    eye = pixelcal.Eye(frame_after, link)
    miss = None
    seen = False
    dot = None
    # One more look than corrections: the last move gets measured too, so the
    # miss reported is where the dot ended up, not where it was a move ago.
    for n in range(AIM_ITERATIONS + 1):
        if target_now is not None:
            tu, tv = target_now() or (tu, tv)
        # Tell the detector where the model expects the dot, to break ties with
        # reflections, and confirm the first reading with a second blink.
        expect = aimer.pixel_for(link.pose.pan, link.pose.tilt) or (tu, tv)
        dot = eye.blink(near=expect, confirm=(n == 0))
        if dot is None:
            miss = None          # lost it after a move: nothing true to report
            break
        seen = True
        aimer.add_sample(link.pose.pan, link.pose.tilt, *dot)
        miss = float(np.hypot(tu - dot[0], tv - dot[1]))
        if miss <= AIM_TOLERANCE_PX or n == AIM_ITERATIONS:
            break
        # Move by the difference between "aim for the target" and "aim for
        # where the dot actually is", through the model itself.
        a_t, a_d = aimer.angles_for(tu, tv), aimer.angles_for(*dot)
        if not (a_t and a_d):
            break
        dp = float(np.clip(a_t[0] - a_d[0], -10, 10))
        dt = float(np.clip(a_t[1] - a_d[1], -10, 10))
        link.move(*_clamp(link.pose.pan + dp, link.pose.tilt + dt))
    link.set_laser(True)
    out = {"ok": True, "pan": round(link.pose.pan, 1), "tilt": round(link.pose.tilt, 1),
           "missPx": None if miss is None else round(miss), "seen": seen,
           "dot": None if dot is None else [round(dot[0]), round(dot[1])]}
    if not seen:
        # Say so. Claiming success on an uncorrected guess is what made a far-off
        # aim look like the system thought it was right.
        out["warning"] = ("I aimed from the calibration but could not see the dot to "
                          f"correct it ({pixelcal.LAST.get('why', 'not detected')}).")
    return out


class Follower:
    """Keep the beam on one tracked object as it moves.

    Open loop through the calibrated model at ~8 Hz -- YOLO's box is updated
    every frame, so this just re-aims whenever the object moves.
    """

    DEADBAND_PX = 10.0

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
            gone = 0.0
            while not stop.wait(0.12):
                obj = scene.get(oid)
                if obj is None or not link.connected:
                    break
                if not obj.tracking:
                    gone = gone or time.time()
                    if time.time() - gone > 8:
                        break
                    continue
                gone = 0.0
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
