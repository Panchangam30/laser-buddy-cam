"""Per-frame object detection and tracking with a pretrained open-vocabulary model.

YOLO-World (Ultralytics) finds objects by NAME -- "pencil", "phone", "sticky
note" -- without being trained on them, and ByteTrack gives each one an id that
holds across frames. That is the right tool for following things at frame rate;
the language model (objects.detect) is only asked occasionally what the objects
are called, and its names are fed in here as the vocabulary.

Runs on the Mac's GPU (MPS) when available: about 15 ms a frame at 640 px.
Loading takes a few seconds, so it happens on a background thread and the
scene falls back to language-model boxes until it is ready.
"""

from __future__ import annotations

import os
import threading
import time

MODEL_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models")
WEIGHTS = os.environ.get("YOLO_WEIGHTS", "yolov8s-worldv2.pt")

#: Things that are on desks. The language model adds anything else it sees.
DEFAULT_VOCAB = [
    "phone", "pencil", "pen", "marker", "keyboard", "computer mouse", "laptop",
    "mug", "cup", "water bottle", "notebook", "book", "paper", "sticky note",
    "scissors", "ruler", "eraser", "calculator", "headphones", "earbuds case",
    "remote control", "wallet", "keys", "glasses", "watch", "charger", "cable",
    "tape", "stapler", "screwdriver", "pliers", "circuit board", "breadboard",
    "battery", "game controller", "tablet", "plate", "spoon", "apple", "banana",
    "toy", "box", "hand",
]

#: Detections below this are mostly noise for an open-vocabulary model.
CONF = 0.15
IMGSZ = 640


class Detector:
    def __init__(self) -> None:
        self.model = None
        self.device = "cpu"
        self.ready = False
        self.error = ""
        self.vocab = list(DEFAULT_VOCAB)
        self._pending_vocab: list[str] | None = None
        self._lock = threading.Lock()
        threading.Thread(target=self._load, daemon=True).start()

    def _load(self) -> None:
        try:
            import torch
            from ultralytics import YOLOWorld
            os.makedirs(MODEL_DIR, exist_ok=True)
            cwd = os.getcwd()
            os.chdir(MODEL_DIR)              # weights download next to the others
            try:
                model = YOLOWorld(WEIGHTS)
            finally:
                os.chdir(cwd)
            model.set_classes(self.vocab)
            self.device = "mps" if torch.backends.mps.is_available() else "cpu"
            with self._lock:
                self.model = model
                self.ready = True
            print(f"  yolo: {WEIGHTS} on {self.device}, {len(self.vocab)} names")
        except Exception as e:                       # missing package, no network...
            self.error = f"object detector unavailable: {type(e).__name__}: {e}"
            print(f"  yolo: {self.error}")

    def add_names(self, names: list[str]) -> bool:
        """Teach it new object names. Applied before the next frame."""
        new = [n.strip().lower() for n in names
               if n and n.strip().lower() not in self.vocab]
        if not new:
            return False
        with self._lock:
            self.vocab = (self.vocab + new)[-80:]
            self._pending_vocab = list(self.vocab)
        return True

    def track(self, frame) -> list[dict]:
        """Detections with persistent ids: [{tid, label, conf, box(x,y,w,h)}]."""
        with self._lock:
            if not self.ready:
                return []
            if self._pending_vocab is not None:
                self.model.set_classes(self._pending_vocab)
                # The tracker caches class names; a fresh one picks up the new
                # vocabulary. Ids restart, which the scene smooths over.
                self.model.predictor = None
                self._pending_vocab = None
            try:
                r = self.model.track(frame, persist=True, tracker="bytetrack.yaml",
                                     conf=CONF, imgsz=IMGSZ, device=self.device,
                                     verbose=False)[0]
            except Exception as e:
                self.error = f"{type(e).__name__}: {e}"
                return []
        out = []
        for b in r.boxes:
            x0, y0, x1, y1 = (float(v) for v in b.xyxy[0])
            out.append({
                "tid": int(b.id) if b.id is not None else None,
                "label": r.names[int(b.cls)],
                "conf": float(b.conf),
                "box": (int(x0), int(y0), int(x1 - x0), int(y1 - y0)),
            })
        return out
