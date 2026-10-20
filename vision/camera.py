"""The vision service's own webcam.

The browser used to own the camera and upload frames, which put a web page in
the middle of the laser's feedback loop. Every check the laser makes -- blink
it, look, blink, look -- waits for a fresh frame, and a page stops sending them
the moment it counts as hidden: a background tab, or on macOS a window merely
covered by another app. The voice assistant kept talking while every camera
check timed out. Frames also carried the browser's guess of when they were
taken, padded by a fixed latency allowance.

Owning the camera here removes both problems. A thread reads continuously, so
frames never stop and never queue up stale, and each one is stamped the moment
it is read. The web page only displays the stream.
"""

from __future__ import annotations

import threading
import time

import cv2
import numpy as np

#: Asked of the camera. The browser asked for the same, and the frames are
#: scaled to OUT_WIDTH exactly as it scaled them, so a pixel calibration made
#: from browser frames still applies: same framing, same size.
CAPTURE_W, CAPTURE_H = 1280, 720
OUT_WIDTH = 1024

#: How long before cap.read() returns the picture was actually exposed. Reading
#: nonstop keeps the driver's queue empty, so this is about one frame -- longer
#: in a dark room, where auto exposure drops the frame rate.
CAPTURE_LATENCY_S = 0.06

#: Wait between attempts to open the camera: it may be unplugged, in use, or
#: waiting on a macOS permission prompt.
REOPEN_S = 3.0

#: Indices tried when asked for "the next camera". macOS numbers real cameras
#: from 0; a Continuity Camera iPhone appears only while it is connected.
MAX_INDEX = 5

#: The live view is for people; it does not need every frame.
STREAM_FPS = 15
STREAM_QUALITY = 70


class Camera:
    """Reads one webcam on a thread and hands out timestamped frames."""

    def __init__(self, index: int, on_frame=None) -> None:
        self.index = index
        self.on_frame = on_frame                     # called (frame, captured_at)
        self.error = ""
        self.size = (0, 0)
        self.fps = 0.0
        self._cap: cv2.VideoCapture | None = None
        self._frame: np.ndarray | None = None
        self._at = 0.0
        self._seq = 0
        self._jpeg: tuple[int, bytes] | None = None
        self._cond = threading.Condition()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        #: Set by select()/select_next(); the capture thread acts on it, since
        #: it alone may touch the VideoCapture.
        self._want: int | str | None = None

    # ---------------------------------------------------------------- control

    @property
    def running(self) -> bool:
        """Frames are arriving now, not merely that the thread exists."""
        return self._frame is not None and time.time() - self._at < 2.0

    def start(self) -> None:
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="camera", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2.0)

    def select(self, index: int) -> None:
        """Switch to another camera; takes effect on the capture thread."""
        self._want = int(index)

    def select_next(self) -> None:
        """Switch to the next camera that opens, wrapping round."""
        self._want = "next"

    def _switch(self) -> None:
        want, self._want = self._want, None
        if self._cap is not None:
            self._cap.release()
            self._cap = None
        with self._cond:
            self._frame, self._jpeg = None, None
        if want != "next":
            self.index = int(want)
            return
        for step in range(1, MAX_INDEX + 1):
            self.index = (self.index + step) % MAX_INDEX
            if self._open():
                return
        self.error = "no other camera opened"

    def _open(self) -> bool:
        cap = cv2.VideoCapture(self.index)
        if not cap.isOpened():
            cap.release()
            self.error = (f"could not open camera {self.index} -- allow camera access for the "
                          "app that started the service (System Settings > Privacy & "
                          "Security > Camera), and check nothing else has it")
            return False
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, CAPTURE_W)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, CAPTURE_H)
        self._cap = cap
        self.error = ""
        return True

    def _run(self) -> None:
        fails = 0
        window_start, window_frames = time.time(), 0
        while not self._stop.is_set():
            if self._want is not None:
                self._switch()
            if self._cap is None and not self._open():
                self._stop.wait(REOPEN_S)
                continue
            ok, frame = self._cap.read()
            t = time.time() - CAPTURE_LATENCY_S
            if not ok or frame is None:
                fails += 1
                if fails >= 30:                      # about a second of nothing
                    self.error = "the camera stopped sending frames; reopening it"
                    self._cap.release()
                    self._cap = None
                    fails = 0
                continue
            fails = 0
            h, w = frame.shape[:2]
            if w > OUT_WIDTH:
                frame = cv2.resize(frame, (OUT_WIDTH, round(h * OUT_WIDTH / w)),
                                   interpolation=cv2.INTER_AREA)
            with self._cond:
                self._frame, self._at = frame, t
                self._seq += 1
                self.size = (frame.shape[1], frame.shape[0])
                self._cond.notify_all()
            window_frames += 1
            if time.time() - window_start >= 2.0:
                self.fps = window_frames / (time.time() - window_start)
                window_start, window_frames = time.time(), 0
            if self.on_frame is not None:
                try:
                    self.on_frame(frame, t)
                except Exception as e:               # never let a consumer kill capture
                    self.error = f"frame handler failed: {e}"
        if self._cap is not None:
            self._cap.release()
            self._cap = None

    # ----------------------------------------------------------------- frames

    def latest(self) -> tuple[np.ndarray | None, float, int]:
        with self._cond:
            return self._frame, self._at, self._seq

    def wait_newer(self, seq: int, timeout: float = 1.0) -> tuple[np.ndarray | None, float, int]:
        """The next frame after `seq`, or the current one if none comes in time."""
        with self._cond:
            self._cond.wait_for(lambda: self._seq > seq or self._stop.is_set(), timeout)
            return self._frame, self._at, self._seq

    def jpeg(self) -> tuple[int, bytes] | None:
        """The latest frame as JPEG, encoded once however many viewers there are."""
        frame, _t, seq = self.latest()
        if frame is None:
            return None
        cached = self._jpeg
        if cached is not None and cached[0] == seq:
            return cached
        ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, STREAM_QUALITY])
        if not ok:
            return None
        self._jpeg = (seq, buf.tobytes())
        return self._jpeg

    def status(self) -> dict:
        return {"owned": self.running, "index": self.index, "size": list(self.size),
                "fps": round(self.fps, 1), "error": "" if self.running else self.error}
