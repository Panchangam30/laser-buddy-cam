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
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import cv2
import numpy as np

from . import board as bd
from . import detect, geometry as g, label, world
from .track import Tracker

#: Never spend two identification calls inside this window.
LABEL_INTERVAL_S = 4.0


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

    # ------------------------------------------------------------------ analyse

    def analyse(self, frame: np.ndarray) -> dict:
        with self._lock:
            self._frames += 1
            self._frame = frame
            pose = bd.find_board(frame, flipped=self.flipped)
            self._pose = pose

            if isinstance(pose, bd.NoBoard):
                # Keep the tracks: a board that vanished for a frame because a hand
                # crossed it has not been rebuilt, and throwing the map away would
                # make the 3D view flicker.
                self._rect = None
                self._world = world.build(pose, self.tracker.live(), self._frames, self._errors[:])
                return self._world.serialise()

            rect = pose.rectify(frame)
            self._rect = rect
            self.tracker.update(detect.find_blobs(rect))
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
                "frames": self._frames,
                "tracks": len(self.tracker.tracks),
                "stable": len(self.tracker.live()),
                "labelling": bool(self.labelling and self.api_key),
                "openai": "configured" if self.api_key else "missing",
                "orientation": {"flipped": self.flipped, "source": self.orientation_source},
                "boardFound": not isinstance(self._pose, bd.NoBoard),
                "pxPerMm": bd.PX_PER_MM,
            }

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

        def do_GET(self) -> None:              # noqa: N802
            path, _, query = self.path.partition("?")
            if path == "/vision/health":
                return self._json(200, engine.health())
            if path == "/vision/world":
                return self._json(200, engine.snapshot())
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
                image = body.get("image")
                if not isinstance(image, str) or not image:
                    return self._json(400, {"error": "no image supplied"})
                try:
                    frame = decode_data_url(image)
                except Exception as e:
                    return self._json(400, {"error": str(e)})
                return self._json(200, engine.analyse(frame))

            if self.path == "/vision/orientation":
                return self._json(200, engine.set_flipped(bool(body.get("flipped"))))

            if self.path == "/vision/reset":
                engine.reset()
                return self._json(200, {"ok": True})

            self._json(404, {"error": f"no such path {self.path}"})

    return Handler


def serve(port: int, engine: VisionEngine) -> None:
    server = ThreadingHTTPServer(("127.0.0.1", port), make_handler(engine))
    print(f"vision service on http://127.0.0.1:{port}")
    print(f"  labelling: {'on' if engine.labelling and engine.api_key else 'off'}"
          f"   debug view: http://127.0.0.1:{port}/vision/debug.jpg")
    server.serve_forever()


def standalone(camera: int, engine: VisionEngine) -> None:
    """Own the camera and show the annotated view. For working on the detector."""
    cap = cv2.VideoCapture(camera)
    if not cap.isOpened():
        raise SystemExit("could not open camera -- check macOS camera permissions "
                         "(System Settings > Privacy & Security > Camera)")
    print("[f] flip which end is column 1   [r] reset   [q] quit")
    view = "rect"
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            engine.analyse(frame)
            img = engine.debug_image(view)
            if img is not None:
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
    finally:
        cap.release()
        cv2.destroyAllWindows()


def main() -> None:
    _load_env()
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--port", type=int, default=int(os.environ.get("VISION_PORT", "8788")))
    ap.add_argument("--camera", type=int, default=None,
                    help="run standalone on this camera index instead of serving")
    ap.add_argument("--no-label", action="store_true",
                    help="locate parts but do not spend API calls identifying them")
    args = ap.parse_args()

    engine = VisionEngine(api_key=os.environ.get("OPENAI_API_KEY", ""),
                          labelling=not args.no_label)
    if args.camera is not None:
        standalone(args.camera, engine)
    else:
        serve(args.port, engine)


if __name__ == "__main__":
    main()
