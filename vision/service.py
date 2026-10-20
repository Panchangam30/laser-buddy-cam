"""The vision service: frames in, world map out.

Runs on its own port and holds the board's state between frames. The browser
already owns the camera -- it has the live preview the student is looking at --
so frames are posted here rather than opened here. Two processes fighting over
one webcam is a bad time on macOS, and this way there is a single source of
truth for what the student can see.

    .venv/bin/python -m vision.service              # serve on :8788
    .venv/bin/python -m vision.service --camera 0   # standalone, own window

Endpoints
    POST /vision/analyze      {"image": "data:image/jpeg;base64,..."} -> world
    GET  /vision/world        the last snapshot, without analysing anything
    GET  /vision/debug.jpg    annotated view: ?view=rect (default) or frame
    POST /vision/orientation  {"flipped": true} -- which end holds column 1
    POST /vision/reset        forget every tracked part
    GET  /vision/health

  Object mode (any object on the desk, no breadboard needed -- see objects.py)
    POST /vision/objects/analyze   {"image": ...} -> tracked objects
    GET  /vision/objects           the last object snapshot
    POST /vision/objects/detect    {"image"?: ...} -- identify now and wait
    POST /vision/objects/point     {"object": "phone"} -- aim, closed loop
    POST /vision/objects/follow    {"object": "phone"} -- keep the beam on it
    POST /vision/objects/unfollow
    POST /vision/objects/reset
    POST /vision/laser/calibrate   {"mode": "pixels"} for the board-free map
"""

from __future__ import annotations

import argparse
import base64
import errno
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import cv2
import numpy as np

from . import board as bd
from . import camera as cam
from . import geometry as g, label, objects, pixelcal, world, workspace as ws
from .aim import Calibrator, find_dot
from .laser import LaserLink, find_port
from .track import Tracker

#: Never spend two identification calls inside this window.
LABEL_INTERVAL_S = 4.0

#: While the laser is on, ignore detections this close to where it is aimed.
#: A laser dot is a small bright red spot sitting on the board, which is a
#: perfectly good description of a red LED -- left alone it becomes a tracked
#: part, gets an identification spent on it, and appears in the world map.
LASER_IGNORE_MM = 7.0


def _load_env() -> None:
    """Read the project .env so both this and the Node API share one file."""
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
    try:
        with open(path) as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    except FileNotFoundError:
        pass


class VisionEngine:
    """Holds the tracked world. One instance, guarded by a lock."""

    def __init__(self, api_key: str = "", labelling: bool = True) -> None:
        self.api_key = api_key
        self.labelling = labelling
        self.tracker = Tracker()
        self.laser = LaserLink()
        self.calibrator = Calibrator()
        self.workspace_runtime = ws.BREADBOARD_RUNTIME
        self._frame_at = 0.0
        self._aimed_at: tuple[float, float] | None = None
        self._aimed_hole = ""
        #: Commands posted by the phone remote, waiting for the Mac's browser
        #: tab to collect them. A queue rather than a direct call because the
        #: things worth starting -- board tracking above all -- run in that tab,
        #: where the webcam is. The service cannot start them on its own.
        self._remote: list[dict] = []
        self.flipped = False
        self.orientation_source = "assumed"
        self._lock = threading.Lock()
        self._frames = 0
        self._last_label = 0.0
        self._labelling_now = False
        self._rect: np.ndarray | None = None
        self._frame: np.ndarray | None = None
        self._pose: bd.BoardPose | bd.NoBoard = bd.NoBoard("no frame analysed yet")
        self._world = world.World(board={"found": False, "reason": "no frame analysed yet"})
        self._errors: list[str] = []
        self.scene = objects.ObjectScene(api_key)
        self._aiming = 0
        self.pixel_cal = objects.PixelCalibrator()
        self.follower = objects.Follower()
        #: The service's own webcam, when it has one (see camera.py). While it
        #: runs, frames uploaded by a browser are ignored: they are older and
        #: less precisely timed, and mixing them in would confuse laser checks.
        self.camera: cam.Camera | None = None

    # ----------------------------------------------------------------- camera

    #: How far ahead of "now" a frame must be stamped to be sure it shows the
    #: laser as just set. Browser frames carry a guessed timestamp and need a
    #: wide margin; the service's own are stamped when read.
    BROWSER_LATENCY_S = 0.18
    CAMERA_LATENCY_S = 0.10
    #: The tracker does not need every camera frame; this caps its CPU.
    SCENE_HZ = 10.0

    @property
    def owns_camera(self) -> bool:
        return self.camera is not None and self.camera.running

    CAMERA_PREFS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "camera_prefs.json")

    def saved_camera(self) -> int | None:
        """The camera chosen last time; None means leave it to the browser."""
        try:
            with open(self.CAMERA_PREFS) as fh:
                idx = json.load(fh).get("index", 0)
            return None if idx is None else int(idx)
        except (OSError, ValueError, TypeError):
            return 0

    def _save_camera(self, index: int | None) -> None:
        try:
            with open(self.CAMERA_PREFS, "w") as fh:
                json.dump({"index": index}, fh)
        except OSError:
            pass

    def use_camera(self, index: int) -> None:
        """Read frames from this webcam ourselves instead of waiting for uploads."""
        if self.camera is not None:
            self.camera.select(index)
            return
        self.camera = cam.Camera(index, on_frame=self._ingest)
        self.camera.start()
        if not getattr(self, "_scene_thread", None):
            self._scene_thread = threading.Thread(target=self._scene_loop, name="scene", daemon=True)
            self._scene_thread.start()

    def set_camera(self, body: dict) -> dict:
        """From the camera panel: next camera, a given one, or back to the browser."""
        if body.get("browser"):
            if self.camera is not None:
                self.camera.stop()
                self.camera = None
            self._save_camera(None)
            return self.camera_status()
        if body.get("next") and self.camera is not None:
            self.camera.select_next()
        else:
            idx = body.get("index")
            self.use_camera(int(idx) if isinstance(idx, (int, float)) else
                            (self.camera.index if self.camera else 0))
        # Remembered once the thread has settled on one; good enough to save now
        # for an explicit index, and saved again by camera_status for "next".
        self._camera_save_pending = True
        return {"ok": True, "switching": True}

    def _ingest(self, frame: np.ndarray, captured_at: float) -> None:
        """A camera frame: what every laser check and calibration reads."""
        with self._lock:
            self._frame = frame
            self._frame_at = time.time()
            self._frame_cap = captured_at
        pixelcal.FRAME_LATENCY_S = self.CAMERA_LATENCY_S

    def _scene_loop(self) -> None:
        """Keep the object tracker on the newest frame, independent of any browser."""
        seq = 0
        while True:
            camera = self.camera
            if camera is None:                       # handed back to the browser
                time.sleep(0.5)
                seq = 0
                continue
            frame, _t, new = camera.wait_newer(seq, timeout=1.0)
            if new < seq:                            # switched camera: counts restart
                seq = 0
            if frame is None or new == seq:
                continue
            seq = new
            started = time.time()
            try:
                self.scene.update(frame)
            except Exception as e:                   # keep tracking alive
                self.scene.error = f"tracker failed: {e}"
            time.sleep(max(0.0, 1.0 / self.SCENE_HZ - (time.time() - started)))

    # ------------------------------------------------------------ object mode

    #: Without a capture time, assume a frame was taken this long before it
    #: arrived (JPEG encode + upload). Conservative on purpose.
    UNSTAMPED_AGE_S = 0.15

    def analyse_objects(self, frame: np.ndarray, captured_at: float | None = None) -> dict:
        now = time.time()
        with self._lock:
            self._frames += 1
            self._frame = frame
            self._frame_at = now
            # When the browser says when it grabbed the frame, trust that over
            # arrival time: it is what decides whether the frame shows the laser
            # on or off. Same machine, same clock; reject nonsense anyway.
            ok = captured_at is not None and now - 5 < captured_at <= now + 0.05
            self._frame_cap = captured_at if ok else now - self.UNSTAMPED_AGE_S
        pixelcal.FRAME_LATENCY_S = self.BROWSER_LATENCY_S
        snap = self.scene.update(frame)
        # While the laser is being aimed or calibrated, ask the browser for
        # frames as fast as it can send them: every blink waits for fresh ones.
        snap["fast"] = bool(self._aiming or self.pixel_cal.running)
        return snap

    def _frame_size(self) -> tuple[int, int]:
        w, h = self.scene.size
        if not w and self._frame is not None:
            h, w = self._frame.shape[:2]
        return w, h

    def _pixel_aimer(self):
        w, h = self._frame_size()
        if not w:
            return None, "No camera frames yet. Turn on tracking first."
        aimer = self.pixel_cal.aimer_for(w, h)
        if not aimer.ready:
            return None, "The laser has not been calibrated for object mode yet."
        return aimer, ""

    def point_at_object(self, query: str, refine: bool = True) -> dict:
        problem = self._ready()
        if problem:
            return {"ok": False, "error": problem}
        obj = self.scene.find(query)
        if obj is None:
            names = ", ".join(o.label for o in self.scene.objects) or "nothing yet"
            return {"ok": False, "error": f"I cannot find {query!r}. I can see: {names}."}
        aimer, why = self._pixel_aimer()
        if aimer is None:
            return {"ok": False, "error": why}
        if self.pixel_cal.running:
            return {"ok": False, "error": "Calibration is running."}
        self.follower.stop()
        target = obj.centre
        if not aimer.covers(*target):
            return {"ok": False, "error":
                    f"The {obj.label} is outside the area the laser can reach."}
        oid = obj.id

        def target_now():
            o = self.scene.get(oid)
            return o.centre if o is not None and o.tracking else None

        self._aiming += 1
        try:
            r = objects.aim_closed_loop(self.laser, aimer, self.frame_after, target, refine,
                                        target_now=target_now)
        finally:
            self._aiming -= 1
        if r.get("ok"):
            aimer.save()
            with self._lock:
                self._aimed_hole = obj.label
        note = self._rough_note(obj)
        dot = r.get("dot")
        live = self.scene.get(oid) or obj
        # The verdict is the camera's, not the aim's: is the dot inside the box?
        on = dot is not None and objects._inside(dot, live.box, slack=0.1)
        return {**r, "object": obj.id, "label": obj.label, "onTarget": on,
                "landed": self.scene.locate(dot) if dot else "",
                **({"note": note} if note else {})}

    def _where_dot(self) -> str:
        """One blink: where the dot really is, in words, or "" if not seen.

        Reported after moves that do not look for themselves, so the assistant
        says where the beam is from the camera rather than from what it meant
        to do.
        """
        if (self._frame is None or time.time() - self._frame_at > 3.0
                or self.pixel_cal.running or self.calibrator.running):
            return ""
        aimer, _ = self._pixel_aimer()
        near = aimer.pixel_for(self.laser.pose.pan, self.laser.pose.tilt) if aimer else None
        self._aiming += 1
        try:
            dot = pixelcal.Eye(self.frame_after, self.laser).blink(near=near)
        finally:
            self._aiming -= 1
        return self.scene.locate(dot) if dot else ""

    def _rough_note(self, obj) -> str:
        """Say so when the target's position is only the vision model's guess.

        Objects the tracker cannot see keep the box the vision model drew, and
        those are often off by the object's own size -- so the laser lands
        dead on a spot the object is not at, and looks like bad aiming.
        """
        if obj.tracking:
            return ""
        note = (f"The {obj.label}'s position is only a rough guess from the vision model "
                "-- the tracker cannot see it -- so the beam may land beside it.")
        frame = self._frame
        if frame is not None and float(frame.mean()) < 45:
            note += " The picture is very dark; more light on the desk lets the tracker lock on."
        return note

    def follow_object(self, query: str) -> dict:
        problem = self._ready()
        if problem:
            return {"ok": False, "error": problem}
        obj = self.scene.find(query)
        if obj is None:
            return {"ok": False, "error": f"I cannot find {query!r}."}
        aimer, why = self._pixel_aimer()
        if aimer is None:
            return {"ok": False, "error": why}
        self.follower.start(obj.id, self.scene, self.laser, aimer)
        with self._lock:
            self._aimed_hole = obj.label
        return {"ok": True, "object": obj.id, "label": obj.label}

    def start_pixel_calibration(self) -> dict:
        if not self.laser.connected and not self.laser.connect():
            return {"ok": False, "error": self.laser.error or "The laser is not connected."}
        if self._frame is None or time.time() - self._frame_at > 3.0:
            return {"ok": False, "error":
                    "No recent camera frames. Turn on tracking and keep it running."}
        if not self.pixel_cal.claim():
            return {"ok": False, "error": "Already calibrating."}
        self.follower.stop()
        down = self._direction("down")[1]
        threading.Thread(target=self.pixel_cal.run,
                         args=(self.laser, self.frame_after, self._frame_size()),
                         kwargs={"down": down}, daemon=True).start()
        return {"ok": True}

    # ------------------------------------------------------------------ analyse

    def analyse(self, frame: np.ndarray, ingest: bool = True) -> dict:
        """Board mode. `ingest=False` for a camera frame, which is already the
        current frame with a better timestamp than this would give it."""
        with self._lock:
            self._frames += 1
            if ingest:
                self._frame = frame
                self._frame_at = time.time()
                self._frame_cap = self._frame_at - self.UNSTAMPED_AGE_S
            pose = self.workspace_runtime.locate(frame, flipped=self.flipped)
            self._pose = pose

            if isinstance(pose, bd.NoBoard):
                # Keep the tracks: a board that vanished for a frame because a hand
                # crossed it has not been rebuilt, and throwing the map away would
                # make the 3D view flicker.
                self._rect = None
                self._world = world.build(pose, self.tracker.live(), self._frames, self._errors[:])
                return self._world.serialise()

            rect = self.workspace_runtime.rectify(frame, pose)
            self._rect = rect
            self.tracker.update(self._without_laser_dot(self.workspace_runtime.detect(rect)))
            self._world = world.build(pose, self.tracker.live(), self._frames, self._errors[:])
            snapshot = self._world.serialise()
            snapshot["orientation"] = {"flipped": self.flipped, "source": self.orientation_source}
            should_label = (self.labelling and self.api_key
                            and not self._labelling_now
                            and time.time() - self._last_label > LABEL_INTERVAL_S
                            and self.tracker.needing_labels())

        # Outside the lock: identification is a network round trip and must not
        # hold up the next frame. Labels land in a later snapshot.
        if should_label:
            threading.Thread(target=self._label_pass, daemon=True).start()
        return snapshot

    def _without_laser_dot(self, blobs: list) -> list:
        """Drop the laser's own dot, so it is never mistaken for a component."""
        if not (self.laser.laser_on and self._aimed_at):
            return blobs
        ax, az = self._aimed_at
        return [b for b in blobs
                if (b.centre[0] - ax) ** 2 + (b.centre[1] - az) ** 2
                > LASER_IGNORE_MM ** 2]

    def frame_after(self, t: float, timeout: float = 3.0):
        """The first frame that ARRIVED after time `t` (which may be in the future).

        Object-mode calibration passes now + the camera's latency, so the frame
        it gets is known to show the laser and head as they are now -- a frame
        that merely arrives after the call may have been captured before it.
        """
        deadline = max(time.time(), t) + timeout
        while time.time() < deadline:
            with self._lock:
                cap = getattr(self, "_frame_cap", self._frame_at - self.UNSTAMPED_AGE_S)
                if self._frame is not None and cap > t:
                    return self._frame.copy()
            time.sleep(0.02)
        return None

    def next_frame(self, timeout: float = 3.0):
        """A frame that arrived after this call, for the calibration loop.

        Calibration has to know that what it is looking at is the scene AFTER the
        head moved, not the frame that was already in hand when it asked. The
        browser is streaming while tracking is on, so this just waits for the
        next one.
        """
        asked = time.time()
        deadline = asked + timeout
        while time.time() < deadline:
            with self._lock:
                if self._frame is not None and self._frame_at > asked:
                    return self._frame.copy()
            time.sleep(0.04)
        return None

    def pose_of(self, frame):
        return self.workspace_runtime.locate(frame, flipped=self.flipped)

    # ---------------------------------------------------------------- pointing

    def point_at(self, x: float, z: float, hole: str = "") -> dict:
        """Aim the laser at a board position and switch it on.

        Prefers the camera-pixel calibration, which needs no board in view to
        calibrate and self-corrects by watching the dot: the board's pose turns
        the hole into a camera pixel, and the pixel is aimed at like any object.
        Falls back to the older board-millimetre calibration.
        """
        problem = self._ready()
        if problem:
            return {"ok": False, "error": problem}
        pose = self._pose
        pix_aimer, _why = self._pixel_aimer()
        if pix_aimer is not None and not isinstance(pose, bd.NoBoard) and not self.pixel_cal.running:
            u, v = (float(c) for c in pose.to_image(np.array([[x, z]], np.float32))[0])
            if pix_aimer.covers(u, v):
                self.follower.stop()
                self._aiming += 1
                try:
                    r = objects.aim_closed_loop(self.laser, pix_aimer, self.frame_after, (u, v))
                finally:
                    self._aiming -= 1
                if r.get("ok"):
                    pix_aimer.save()
                    with self._lock:
                        self._aimed_at = (x, z)
                        self._aimed_hole = hole
                    dot = r.get("dot")
                    return {**r, "hole": hole,
                            "onTarget": r.get("missPx") is not None
                                        and r["missPx"] <= 2 * objects.AIM_TOLERANCE_PX,
                            "landed": self.scene.locate(dot) if dot else ""}
        if isinstance(pose, bd.NoBoard):
            # The fallback below assumes the board has not moved since it was
            # calibrated, and nothing checks that. Aiming blind and reporting
            # success is how the assistant came to say the beam was on the board
            # when it was nowhere near it.
            return {"ok": False, "error":
                    "I cannot see the breadboard in the camera, so I do not know where "
                    f"{hole or 'that hole'} is. If you meant the Arduino or another "
                    "object, point at the object instead."}
        aimer = self.calibrator.aimer
        if not aimer.ready:
            return {"ok": False, "error": "The laser has not been calibrated yet."}
        if not aimer.covers(x, z):
            return {"ok": False, "error":
                    f"{hole or 'that spot'} is outside the area the calibration "
                    f"covers, so I would only be guessing where to point"}

        angles = aimer.angles_for(x, z)
        if angles is None:
            return {"ok": False, "error": "No aim solution for that spot."}
        if not self.laser.move(*angles):
            return {"ok": False, "error": self.laser.error or "The head did not answer."}
        self.laser.set_laser(True)
        with self._lock:
            self._aimed_at = (x, z)
            self._aimed_hole = hole
        return {"ok": True, "hole": hole, "pan": round(angles[0], 1),
                "tilt": round(angles[1], 1), "accuracy": aimer.quality(),
                "onTarget": None, "landed": self._where_dot()}

    def point_at_hole(self, ref: str) -> dict:
        xz = g.hole_xz(ref)
        if xz is None:
            return {"ok": False, "error": f"{ref!r} is not a hole on this board"}
        return self.point_at(*xz, hole=ref.upper())

    def point_at_location(self, target: dict) -> dict:
        """Aim at a scoped workspace location without assuming every target is a hole."""
        ref = target.get("ref") or {}
        resolved = self.workspace_runtime.resolve(target)
        if resolved is None:
            return {"ok": False, "error": "That location is not targetable in the active workspace."}
        label = str(ref.get("anchorId", "metric target"))
        return self.point_at(*resolved, hole=label)

    #: Degrees per nudge. Sized for speech: "a bit" should be a visible change
    #: without being a lurch, and three of them should cross the working area.
    NUDGE = {"fine": 1.0, "tiny": 2.0, "small": 5.0, "medium": 12.0, "large": 25.0}

    #: Which way each spoken direction turns the servos. Pan is inverted because
    #: on this rig increasing pan carries the dot to the LEFT of the camera's
    #: view -- measured, not assumed, and worth stating because it is the one
    #: thing that makes voice control feel broken if it is backwards.
    DIRECTION = {
        "left":  (+1.0, 0.0),
        "right": (-1.0, 0.0),
        "up":    (0.0, +1.0),
        "down":  (0.0, -1.0),
    }

    PREFS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "laser_prefs.json")

    def _load_prefs(self) -> dict:
        try:
            with open(self.PREFS_FILE) as fh:
                d = json.load(fh)
            return {"invertPan": bool(d.get("invertPan")), "invertTilt": bool(d.get("invertTilt"))}
        except (OSError, json.JSONDecodeError):
            return {"invertPan": False, "invertTilt": False}

    def set_prefs(self, body: dict) -> dict:
        prefs = self._load_prefs()
        for k in ("invertPan", "invertTilt"):
            if k in body:
                prefs[k] = bool(body[k])
        try:
            with open(self.PREFS_FILE, "w") as fh:
                json.dump(prefs, fh)
        except OSError:
            pass
        return prefs

    def _direction(self, key: str) -> tuple[float, float]:
        """A spoken/arrow direction as servo signs, after this rig's flips.

        Heads are mounted every which way, so "up" turning the beam up is a
        setting, not an assumption: flip it once and the arrows, the voice and
        the calibration search all agree.
        """
        dp, dt = self.DIRECTION[key]
        prefs = self._load_prefs()
        return (-dp if prefs["invertPan"] else dp, -dt if prefs["invertTilt"] else dt)

    # -------------------------------------------------- manual calibration

    def manual_detect(self) -> dict:
        problem = self._ready()
        if problem:
            return {"ok": False, "error": problem}
        self._aiming += 1
        try:
            dot = pixelcal.Eye(self.frame_after, self.laser).blink(confirm=True)
        finally:
            self._aiming -= 1
        return {"ok": True, "dot": [round(dot[0]), round(dot[1])] if dot else None,
                "why": pixelcal.LAST.get("why", ""),
                "pan": self.laser.pose.pan, "tilt": self.laser.pose.tilt}

    def find_laser(self) -> dict:
        """Where the laser dot is right now, for the voice assistant.

        The same blink-and-confirm detector manual calibration uses, because
        nothing else can see the dot: the object tracker has no class for it,
        and Grok's voice cannot take a picture. Switches the beam on to look and
        leaves it on -- whoever asked wants to see where it is.
        """
        problem = self._ready()
        if problem:
            return {"ok": False, "error": problem}
        if self._frame is None or time.time() - self._frame_at > 3.0:
            return {"ok": False, "error": "No recent camera frames, so I cannot look for the "
                    "dot. The app's browser tab has stopped sending them -- keep it open with its "
                    "window visible."}
        if self.pixel_cal.running or self.calibrator.running:
            return {"ok": False, "error": "Calibration is running; it is using the laser."}
        self._aiming += 1
        try:
            dot = pixelcal.Eye(self.frame_after, self.laser).blink(confirm=True)
        finally:
            self._aiming -= 1
        why = pixelcal.LAST.get("why", "")
        pose = {"pan": self.laser.pose.pan, "tilt": self.laser.pose.tilt}
        if dot is None:
            return {"ok": True, "found": False, "dot": None, "why": why, **pose,
                    "summary": f"The laser is on but I cannot see its dot in the camera ({why}). "
                               "It is probably pointing outside the camera's view, or onto "
                               "something dark or shiny."}
        where = self.scene.locate(dot)
        return {"ok": True, "found": True, "dot": [round(dot[0]), round(dot[1])],
                "where": where, "why": why, **pose,
                "summary": f"The laser dot is {where}."}

    def manual_add(self, u=None, v=None) -> dict:
        problem = self._ready()
        if problem:
            return {"ok": False, "error": problem}
        if u is None or v is None:
            self._aiming += 1
            try:
                dot = pixelcal.Eye(self.frame_after, self.laser).blink(confirm=True)
            finally:
                self._aiming -= 1
            if dot is None:
                return {"ok": False, "error":
                        f"I could not find the dot ({pixelcal.LAST.get('why', 'not detected')}). "
                        "Click on it in the picture instead."}
            u, v = dot
        self.pixel_cal.manual.append((float(self.laser.pose.pan), float(self.laser.pose.tilt),
                                      float(u), float(v)))
        return {"ok": True, "count": len(self.pixel_cal.manual), "point": [round(u), round(v)]}

    def manual_finish(self, refine: bool) -> dict:
        size = self._frame_size()
        if not size[0]:
            return {"ok": False, "error": "No camera frames yet."}
        aimer, note = self.pixel_cal.finish_manual(size)
        if aimer is None:
            return {"ok": False, "error": note}
        result = {"ok": True, "fitPx": round(aimer.rms_px or 0, 1), "points": len(aimer.samples),
                  "note": note}
        if refine and self.pixel_cal.claim():
            threading.Thread(target=self.pixel_cal.run,
                             args=(self.laser, self.frame_after, size),
                             kwargs={"base": aimer}, daemon=True).start()
            result["refining"] = True
        return result

    def _ready(self) -> str:
        """Make sure the head is usable. Returns "" when it is, else why not.

        Reconnects by itself. Unplugging and replugging the board is a normal
        thing to do at a bench, and it should not leave every command failing
        until someone notices and restarts the service.
        """
        if self.laser.connected:
            return ""
        if self.laser.connect():
            return ""
        return self.laser.error or "The laser is not connected."

    def move_to(self, pan: float | None = None, tilt: float | None = None) -> dict:
        """Absolute move. Either axis may be left alone."""
        problem = self._ready()
        if problem:
            return {"ok": False, "error": problem}
        p = self.laser.pose.pan if pan is None else float(pan)
        t = self.laser.pose.tilt if tilt is None else float(tilt)
        if not self.laser.move(p, t):
            return {"ok": False, "error": self.laser.error or "The head did not answer."}
        return {"ok": True, "pan": self.laser.pose.pan, "tilt": self.laser.pose.tilt,
                **({"landed": self._where_dot()} if self.laser.laser_on else {})}

    def nudge(self, direction: str, amount: str = "small") -> dict:
        """Relative move in a spoken direction."""
        problem = self._ready()
        if problem:
            return {"ok": False, "error": problem}
        key = (direction or "").strip().lower()
        if key not in self.DIRECTION:
            return {"ok": False, "error": f"I can move left, right, up or down, not {direction!r}"}
        step = self.NUDGE.get((amount or "small").strip().lower(), self.NUDGE["small"])
        dp, dt = self._direction(key)
        want_p = self.laser.pose.pan + dp * step
        want_t = self.laser.pose.tilt + dt * step
        ok = self.laser.move(want_p, want_t)
        if not ok:
            return {"ok": False, "error": self.laser.error or "The head did not answer."}
        # Report when an axis is against its stop, so the assistant can say so
        # rather than repeating a move that will not do anything. Judged by where
        # the head says it went -- the firmware's reply -- not by this file's
        # constants, so a board still running older, narrower limits is caught.
        got_p, got_t = self.laser.pose.pan, self.laser.pose.tilt
        stuck = ("tilt" if abs(got_t - want_t) > 0.6 else
                 "pan" if abs(got_p - want_p) > 0.6 else "")
        limit = ""
        if stuck == "tilt":
            limit = (f"Tilt stopped at {got_t:.0f} degrees. "
                     + ("That is the servo's end of travel; to aim further, re-seat the "
                        "servo horn one tooth round or angle the head mount."
                        if got_t <= 0.5 or got_t >= 179.5 else
                        "That is a software limit in the Arduino firmware; re-upload "
                        "firmware/laserbuddy to use the servo's full range."))
        elif stuck == "pan":
            limit = f"Pan stopped at {got_p:.0f} degrees (its limit)."
        return {"ok": True, "pan": got_p, "tilt": got_t,
                "movedBy": step, "atLimit": bool(stuck), "limit": limit,
                **({"landed": self._where_dot()} if self.laser.laser_on else {})}

    def laser_power(self, on: bool) -> dict:
        problem = self._ready()
        if problem:
            return {"ok": False, "error": problem}
        return {"ok": self.laser.set_laser(bool(on)), "laserOn": self.laser.laser_on}

    def laser_off(self) -> dict:
        self.follower.stop()
        if not self.laser.connected:
            # Deliberately no reconnect: a disconnected laser is already off,
            # and opening the port resets the board, which is a strange thing
            # for "turn it off" to do.
            return {"ok": True, "laserOn": False}
        ok = self.laser.set_laser(False)
        with self._lock:
            self._aimed_at = None
            self._aimed_hole = ""
        return {"ok": ok}

    # ------------------------------------------------------------------ remote

    #: Commands that cancel each other. Start and Stop are one switch, so a new
    #: one replaces any pending either way: de-duplicating by name alone let a
    #: stale Stop and a fresh Start sit in the queue together, and whichever ran
    #: last decided the outcome -- tap Start, get stopped.
    _EXCLUSIVE = {"start": {"start", "stop"}, "stop": {"start", "stop"}}

    def push_remote(self, command: str, args: dict | None = None) -> dict:
        """Queue a command from the remote."""
        with self._lock:
            # One of each pending at a time: tapping Start three times because
            # nothing visibly happened should not start three scans.
            drop = self._EXCLUSIVE.get(command, {command})
            self._remote = [c for c in self._remote if c["command"] not in drop]
            self._remote.append({"command": command, "args": args or {},
                                 "at": round(time.time(), 3)})
            return {"ok": True, "queued": len(self._remote)}

    def take_remote(self) -> dict:
        """Hand over everything queued, and clear it."""
        with self._lock:
            out, self._remote = self._remote, []
            # Anything older than this was queued before the tab was listening,
            # and acting on it now would be surprising rather than helpful --
            # a Stop from a minute ago is not what anyone means by Start.
            fresh = [c for c in out if time.time() - c["at"] < 12]
            return {"commands": fresh}

    def laser_status(self) -> dict:
        return {**self.laser.status(),
                "aimedAt": self._aimed_hole,
                "calibration": self.calibrator.status(),
                "pixelCalibration": self.pixel_cal.status(*self._frame_size()),
                "prefs": self._load_prefs(),
                "following": self.follower.target_id,
                "portAvailable": find_port()}

    def start_calibration(self) -> dict:
        if not self.laser.connected:
            return {"ok": False, "error": self.laser.error or "The laser is not connected."}
        if self._frame is None or time.time() - self._frame_at > 3.0:
            return {"ok": False, "error":
                    "No recent camera frames. Turn on board tracking and keep it running."}
        if not self.calibrator.claim():
            return {"ok": False, "error": "Already calibrating."}
        try:
            threading.Thread(
                target=self.calibrator.run,
                args=(self.laser, self.next_frame, self.pose_of, True),
                daemon=True).start()
        except Exception:
            self.calibrator.running = False
            raise
        return {"ok": True}

    def _label_pass(self) -> None:
        with self._lock:
            if self._labelling_now or self._rect is None:
                return
            self._labelling_now = True
            self._last_label = time.time()
            rect = self._rect.copy()
            todo = self.tracker.needing_labels()
        try:
            hint, err = label.identify(rect, todo, self.api_key)
            with self._lock:
                self._errors = [err] if err else []
                if hint and self.orientation_source == "assumed":
                    flipped = hint == "right"
                    if flipped != self.flipped:
                        # The board was the other way round, so every millimetre
                        # measured so far is mirrored. Start the map again rather
                        # than carry positions that are quietly 180 degrees out.
                        self.flipped = flipped
                        self.tracker.reset()
                    self.orientation_source = "read from the board"
        finally:
            with self._lock:
                self._labelling_now = False

    # ------------------------------------------------------------------ control

    def set_flipped(self, flipped: bool, source: str = "set by hand") -> dict:
        with self._lock:
            if flipped != self.flipped:
                self.flipped = flipped
                self.tracker.reset()
            self.orientation_source = source
            return {"flipped": self.flipped, "source": self.orientation_source}

    def reset(self) -> None:
        with self._lock:
            self.tracker.reset()
            self.orientation_source = "assumed"
            self._errors = []

    def snapshot(self) -> dict:
        with self._lock:
            out = self._world.serialise()
            out["orientation"] = {"flipped": self.flipped, "source": self.orientation_source}
            return out

    def health(self) -> dict:
        with self._lock:
            return {
                "ok": True,
                "laser": self.laser.status(),
                "calibration": self.calibrator.status(),
                "frames": self._frames,
                "tracks": len(self.tracker.tracks),
                "stable": len(self.tracker.live()),
                "labelling": bool(self.labelling and self.api_key),
                "openai": "configured" if self.api_key else "missing",
                "orientation": {"flipped": self.flipped, "source": self.orientation_source},
                "workspace": self.workspace_runtime.descriptor.serialise(self._pose),
                "boardFound": not isinstance(self._pose, bd.NoBoard),
                "pxPerMm": bd.PX_PER_MM,
                "camera": self.camera_status(),
            }

    def camera_status(self) -> dict:
        if self.camera is None:
            return {"owned": False, "browser": True, "error": ""}
        st = self.camera.status()
        if st["owned"] and getattr(self, "_camera_save_pending", False):
            self._camera_save_pending = False
            self._save_camera(self.camera.index)
        return st

    # -------------------------------------------------------------------- debug

    def debug_image(self, view: str = "rect") -> np.ndarray | None:
        """The visualisation. This is what 'seeing what it sees' means."""
        with self._lock:
            pose, rect, frame = self._pose, self._rect, self._frame
            tracks = self.tracker.live()
            if frame is None:
                return None
            if view == "frame" or rect is None:
                return _annotate_frame(frame.copy(), pose, tracks)
            return _annotate_rect(rect.copy(), tracks)


def _colour_for(track) -> tuple[int, int, int]:
    if not track.labelled:
        return (120, 120, 200)            # unidentified: dull red
    return {"high": (90, 220, 120), "medium": (60, 200, 230),
            "low": (80, 140, 250)}.get(track.label_confidence, (200, 200, 200))


def _annotate_rect(rect: np.ndarray, tracks: list) -> np.ndarray:
    """Boxes and hole references on the straightened board."""
    pad = 34
    out = np.full((rect.shape[0] + pad, rect.shape[1], 3), 24, np.uint8)
    out[pad:, :] = rect

    for t in tracks:
        b = t.blob
        x0, y0 = bd.board_to_rect(b.bbox[0], b.bbox[3])
        x1, y1 = bd.board_to_rect(b.bbox[2], b.bbox[1])
        col = _colour_for(t)
        cv2.rectangle(out, (int(x0), int(y0) + pad), (int(x1), int(y1) + pad), col, 1)
        where = (f"{b.endpoints[0]}-{b.endpoints[1]}"
                 if b.shape == "wire" and all(b.endpoints) else b.footprint_text())
        text = f"{t.id} {t.label or b.colour_name + ' ' + b.shape} @{where}"
        # Drawn on a dark plate: white-on-breadboard at this size is unreadable.
        ty = max(12, int(y0) + pad - 4)
        (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.42, 1)
        cv2.rectangle(out, (int(x0) - 2, ty - th - 3), (int(x0) + tw + 3, ty + 3),
                      (18, 18, 20), -1)
        cv2.putText(out, text, (int(x0), ty),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.42, col, 1, cv2.LINE_AA)

    cv2.putText(out, f"rectified board  {len(tracks)} tracked  "
                     f"{bd.PX_PER_MM:.0f} px/mm  {g.COLUMNS} columns",
                (8, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (190, 190, 190), 1, cv2.LINE_AA)
    return out


def _annotate_frame(frame: np.ndarray, pose, tracks: list) -> np.ndarray:
    """The board outline and part positions, drawn back onto the camera view."""
    if isinstance(pose, bd.NoBoard):
        cv2.putText(frame, f"no board: {pose.reason}", (12, 28),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (90, 90, 240), 2, cv2.LINE_AA)
        return frame

    quad = pose.corners.astype(np.int32)
    cv2.polylines(frame, [quad], True, (90, 220, 120), 2, cv2.LINE_AA)
    for i, name in enumerate(("near-L", "near-R", "far-R", "far-L")):
        cv2.putText(frame, name, tuple(quad[i]), cv2.FONT_HERSHEY_SIMPLEX,
                    0.4, (90, 220, 120), 1, cv2.LINE_AA)

    for t in tracks:
        b = t.blob
        corners = np.array([[b.bbox[0], b.bbox[1]], [b.bbox[2], b.bbox[1]],
                            [b.bbox[2], b.bbox[3]], [b.bbox[0], b.bbox[3]]], np.float32)
        px = pose.to_image(corners).astype(np.int32)
        col = _colour_for(t)
        cv2.polylines(frame, [px], True, col, 1, cv2.LINE_AA)
        cv2.putText(frame, t.label or b.colour_name, tuple(px[0]),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.4, col, 1, cv2.LINE_AA)

    cv2.putText(frame, f"{pose.confidence} confidence  "
                       f"col 1 {'right' if pose.flipped else 'left'}",
                (12, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (200, 200, 200), 1, cv2.LINE_AA)
    return frame


def decode_data_url(url: str) -> np.ndarray:
    """data URL or bare base64 -> BGR frame."""
    payload = url.split(",", 1)[1] if "," in url else url
    buf = np.frombuffer(base64.b64decode(payload), np.uint8)
    img = cv2.imdecode(buf, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("could not decode the image")
    return img


def make_handler(engine: VisionEngine):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *_args) -> None:
            pass                     # one line per frame is not useful output

        def _send(self, code: int, body: bytes, ctype: str) -> None:
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            # The Vite dev server proxies /api to Node, which proxies here, but
            # allow direct browser calls too so the debug view can be opened alone.
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()
            self.wfile.write(body)

        def _json(self, code: int, obj: dict) -> None:
            self._send(code, json.dumps(obj).encode(), "application/json")

        def do_OPTIONS(self) -> None:          # noqa: N802
            self._send(204, b"", "text/plain")

        def _stream(self) -> None:
            """The camera as MJPEG, for the web page to show. Runs until the viewer leaves."""
            if not engine.owns_camera:
                return self._json(404, {"error": "the service is not reading a camera"})
            self.send_response(200)
            self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            seq, gap = 0, 1.0 / cam.STREAM_FPS
            try:
                while engine.camera is not None:
                    _f, _t, seq = engine.camera.wait_newer(seq, timeout=2.0)
                    shot = engine.camera.jpeg()
                    if shot is None:
                        continue
                    self.wfile.write(b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
                                     + str(len(shot[1])).encode() + b"\r\n\r\n" + shot[1] + b"\r\n")
                    self.wfile.flush()
                    time.sleep(gap)
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass                                   # the viewer went away
            self.close_connection = True

        def do_GET(self) -> None:              # noqa: N802
            path, _, query = self.path.partition("?")
            if path == "/vision/health":
                return self._json(200, engine.health())
            if path == "/vision/world":
                return self._json(200, engine.snapshot())
            if path == "/vision/laser":
                return self._json(200, engine.laser_status())
            if path == "/vision/remote":
                return self._json(200, engine.take_remote())
            if path == "/vision/objects":
                return self._json(200, engine.scene.snapshot())
            if path == "/vision/camera":
                return self._json(200, engine.camera_status())
            if path == "/vision/frame.jpg":
                shot = engine.camera.jpeg() if engine.owns_camera else None
                if shot is None:
                    return self._json(404, {"error": "the service is not reading a camera"})
                return self._send(200, shot[1], "image/jpeg")
            if path == "/vision/stream.mjpg":
                return self._stream()
            if path == "/vision/laser/dot.jpg":
                img = pixelcal.debug_image()
                if img is None:
                    return self._json(404, {"error": "the detector has not looked yet"})
                ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 85])
                return self._send(200, buf.tobytes(), "image/jpeg")
            if path == "/vision/debug.jpg" and "view=objects" in query:
                frame = engine._frame
                if frame is None:
                    return self._json(404, {"error": "no frame analysed yet"})
                img = engine.scene.annotate(frame.copy())
                ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 82])
                return self._send(200, buf.tobytes(), "image/jpeg")
            if path == "/vision/debug.jpg":
                view = "frame" if "view=frame" in query else "rect"
                img = engine.debug_image(view)
                if img is None:
                    return self._json(404, {"error": "no frame analysed yet"})
                ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 82])
                if not ok:
                    return self._json(500, {"error": "could not encode the debug view"})
                return self._send(200, buf.tobytes(), "image/jpeg")
            self._json(404, {"error": f"no such path {path}"})

        def do_POST(self) -> None:             # noqa: N802
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b"{}"
            try:
                body = json.loads(raw or b"{}")
            except json.JSONDecodeError:
                return self._json(400, {"error": "body was not JSON"})

            if self.path == "/vision/analyze":
                if engine.owns_camera:
                    frame, _t, _seq = engine.camera.latest()
                    return self._json(200, engine.analyse(frame, ingest=False))
                image = body.get("image")
                if not isinstance(image, str) or not image:
                    return self._json(400, {"error": "no image supplied"})
                try:
                    frame = decode_data_url(image)
                except Exception as e:
                    return self._json(400, {"error": str(e)})
                return self._json(200, engine.analyse(frame))

            if self.path in ("/vision/objects/analyze", "/vision/objects/detect") and engine.owns_camera:
                # The service's own frames are already flowing into the tracker.
                if self.path.endswith("detect"):
                    return self._json(200, engine.scene.detect_now(engine._frame))
                snap = engine.scene.snapshot()
                snap["fast"] = bool(engine._aiming or engine.pixel_cal.running)
                return self._json(200, snap)

            if self.path in ("/vision/objects/analyze", "/vision/objects/detect"):
                image = body.get("image")
                frame = None
                if isinstance(image, str) and image:
                    try:
                        frame = decode_data_url(image)
                    except Exception as e:
                        return self._json(400, {"error": str(e)})
                if self.path.endswith("detect"):
                    if frame is not None:
                        engine.analyse_objects(frame)
                    return self._json(200, engine.scene.detect_now(
                        frame if frame is not None else engine._frame))
                if frame is None:
                    return self._json(400, {"error": "no image supplied"})
                cap = body.get("capturedAt")
                return self._json(200, engine.analyse_objects(
                    frame, float(cap) if isinstance(cap, (int, float)) else None))

            if self.path == "/vision/objects/point":
                return self._json(200, engine.point_at_object(
                    str(body.get("object", "")), refine=body.get("refine", True) is not False))

            if self.path == "/vision/objects/follow":
                return self._json(200, engine.follow_object(str(body.get("object", ""))))

            if self.path == "/vision/objects/unfollow":
                engine.follower.stop()
                return self._json(200, {"ok": True})

            if self.path == "/vision/objects/reset":
                engine.follower.stop()
                engine.scene.reset()
                return self._json(200, {"ok": True})

            if self.path == "/vision/orientation":
                return self._json(200, engine.set_flipped(bool(body.get("flipped"))))

            if self.path == "/vision/remote":
                cmd = str(body.get("command", "")).strip()
                if not cmd:
                    return self._json(400, {"error": "no command"})
                return self._json(200, engine.push_remote(cmd, body.get("args")))

            if self.path == "/vision/camera":
                return self._json(200, engine.set_camera(body))

            if self.path == "/vision/laser/connect":
                ok = engine.laser.connect(body.get("port") or None)
                return self._json(200 if ok else 503,
                                  {"ok": ok, **engine.laser_status()})

            if self.path == "/vision/laser/disconnect":
                engine.laser.disconnect()
                return self._json(200, {"ok": True, **engine.laser_status()})

            if self.path == "/vision/laser/point":
                target = body.get("target")
                if isinstance(target, dict):
                    return self._json(200, engine.point_at_location(target))
                hole = body.get("hole")
                if isinstance(hole, str) and hole.strip():
                    return self._json(200, engine.point_at_hole(hole))
                x, z = body.get("x"), body.get("z")
                if isinstance(x, (int, float)) and isinstance(z, (int, float)):
                    return self._json(200, engine.point_at(float(x), float(z)))
                return self._json(400, {"error": "supply a hole, or x and z in mm"})

            if self.path == "/vision/laser/move":
                return self._json(200, engine.move_to(body.get("pan"), body.get("tilt")))

            if self.path == "/vision/laser/nudge":
                return self._json(200, engine.nudge(str(body.get("direction", "")),
                                                    str(body.get("amount", "small"))))

            if self.path == "/vision/laser/power":
                return self._json(200, engine.laser_power(bool(body.get("on"))))

            if self.path == "/vision/laser/off":
                return self._json(200, engine.laser_off())

            if self.path == "/vision/laser/centre":
                # Report what actually happened. Saying "centred" when the head
                # never moved is worse than an error: the student trusts it.
                problem = engine._ready()
                ok = False if problem else engine.laser.centre()
                return self._json(200, {"ok": ok, "error": problem or None,
                                        **engine.laser_status()})

            if self.path == "/vision/laser/calibrate":
                if body.get("mode") == "pixels":
                    return self._json(200, engine.start_pixel_calibration())
                return self._json(200, engine.start_calibration())

            if self.path == "/vision/laser/prefs":
                return self._json(200, engine.set_prefs(body))
            if self.path == "/vision/laser/manual/detect":
                return self._json(200, engine.manual_detect())
            if self.path == "/vision/laser/find":
                return self._json(200, engine.find_laser())
            if self.path == "/vision/laser/manual/add":
                u, v = body.get("u"), body.get("v")
                ok = isinstance(u, (int, float)) and isinstance(v, (int, float))
                return self._json(200, engine.manual_add(u if ok else None, v if ok else None))
            if self.path == "/vision/laser/manual/undo":
                if engine.pixel_cal.manual:
                    engine.pixel_cal.manual.pop()
                return self._json(200, {"ok": True, "count": len(engine.pixel_cal.manual)})
            if self.path == "/vision/laser/manual/clear":
                engine.pixel_cal.manual.clear()
                return self._json(200, {"ok": True, "count": 0})
            if self.path == "/vision/laser/manual/finish":
                return self._json(200, engine.manual_finish(bool(body.get("refine"))))

            if self.path == "/vision/laser/cancel":
                engine.calibrator.cancel()
                engine.pixel_cal.cancel()
                return self._json(200, {"ok": True})

            if self.path == "/vision/reset":
                engine.reset()
                return self._json(200, {"ok": True})

            self._json(404, {"error": f"no such path {self.path}"})

    return Handler


class _Server(ThreadingHTTPServer):
    # Without this a restart inside the TCP TIME_WAIT window is refused, which
    # makes an ordinary stop-and-start look like the port is occupied.
    allow_reuse_address = True


def serve(port: int, engine: VisionEngine) -> None:
    try:
        server = _Server(("127.0.0.1", port), make_handler(engine))
    except OSError as e:
        if e.errno != errno.EADDRINUSE:
            raise
        # A traceback here says nothing useful. The cause is nearly always a
        # second copy already running -- often one started by hand earlier,
        # which is invisible from a `npm run dev` that just failed.
        raise SystemExit(
            f"Port {port} is already in use, so the vision service cannot start.\n"
            f"  Almost always this is another copy already running. Check with:\n"
            f"      lsof -ti:{port}\n"
            f"  and stop it with:\n"
            f"      pkill -f vision.service\n"
            f"  Or run this one elsewhere:  --port {port + 1}  "
            f"(and set VISION_URL to match)") from None

    print(f"vision service on http://127.0.0.1:{port}")
    if engine.camera is not None:
        print(f"  camera: reading webcam {engine.camera.index} itself "
              f"(live view: http://127.0.0.1:{port}/vision/stream.mjpg)")
    print(f"  labelling: {'on' if engine.labelling and engine.api_key else 'off'}"
          f"   debug view: http://127.0.0.1:{port}/vision/debug.jpg")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopping")
    finally:
        # Leave the head safe: a service that dies with the beam on is exactly
        # the situation the firmware's timeout exists to cover, and relying on
        # that when we could just switch it off is careless.
        try:
            if engine.laser.connected:
                engine.laser.set_laser(False)
                engine.laser.disconnect()
        except Exception:
            pass
        server.server_close()


def standalone(camera: int, engine: VisionEngine) -> None:
    """Own the camera and show the annotated view. For working on the detector."""
    cap = cv2.VideoCapture(camera)
    if not cap.isOpened():
        raise SystemExit("could not open camera -- check macOS camera permissions "
                         "(System Settings > Privacy & Security > Camera)")
    print("[f] flip column 1   [r] reset   [v] view   [q] quit")
    print("[l] connect laser   [k] calibrate   [1-9] point at a hole   [0] laser off")
    view = "rect"
    # Spread across the board, so the number keys are a quick way to see whether
    # the calibration holds at the ends as well as in the middle.
    spots = ["E4", "E12", "E20", "E28", "E32", "E40", "E48", "E56", "E60"]
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            engine.analyse(frame)
            img = engine.debug_image(view)
            if img is not None:
                if engine.calibrator.running:
                    c = engine.calibrator
                    cv2.putText(img, f"calibrating {c.done}/{c.total}  {c.progress}",
                                (8, img.shape[0] - 10), cv2.FONT_HERSHEY_SIMPLEX,
                                0.5, (80, 220, 255), 1, cv2.LINE_AA)
                cv2.imshow("vision -- board map", img)
            k = cv2.waitKey(1) & 0xFF
            if k in (ord("q"), 27):
                break
            if k == ord("f"):
                engine.set_flipped(not engine.flipped)
            if k == ord("r"):
                engine.reset()
            if k == ord("v"):
                view = "frame" if view == "rect" else "rect"
            if k == ord("l"):
                print("laser:", "connected" if engine.laser.connect()
                      else f"failed -- {engine.laser.error}")
            if k == ord("k"):
                print("calibrating:", engine.start_calibration())
            if k == ord("0"):
                engine.laser_off()
            if ord("1") <= k <= ord("9"):
                print(engine.point_at_hole(spots[k - ord("1")]))
    finally:
        cap.release()
        cv2.destroyAllWindows()


def main() -> None:
    _load_env()
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--port", type=int, default=int(os.environ.get("VISION_PORT", "8788")))
    ap.add_argument("--camera", type=int, default=None,
                    help="run standalone on this camera index instead of serving")
    ap.add_argument("--serve-camera", default=os.environ.get("VISION_CAMERA"),
                    help="webcam index the service reads itself while serving (default: "
                         "the one last chosen in the app, else 0; or VISION_CAMERA); "
                         "'off' leaves the camera to the browser")
    ap.add_argument("--no-label", action="store_true",
                    help="locate parts but do not spend API calls identifying them")
    args = ap.parse_args()

    engine = VisionEngine(api_key=os.environ.get("OPENAI_API_KEY", ""),
                          labelling=not args.no_label)
    if args.camera is not None:
        standalone(args.camera, engine)
    else:
        choice = args.serve_camera
        if choice is None:
            saved = engine.saved_camera()
            choice = "off" if saved is None else str(saved)
        if str(choice).lower() not in ("off", "none", "browser", ""):
            engine.use_camera(int(choice))
        serve(args.port, engine)


if __name__ == "__main__":
    main()
