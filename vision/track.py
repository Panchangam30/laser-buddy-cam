"""Give detected parts stable identities across frames.

Two reasons this exists rather than reporting raw detections. A student watching
the 3D view should see a part stay put, not flicker in and out as a shadow
crosses it; and every label costs an API call, so a part must be recognised as
the same part it was a moment ago or we pay to identify it again every frame.

Matching happens in board millimetres, not pixels, so a part keeps its identity
even when the camera moves.
"""

from __future__ import annotations

import itertools
import time
from dataclasses import dataclass, field

from .detect import Blob

#: Furthest a part may appear to move between frames and still be the same part.
#: A hand nudging a resistor moves it a few millimetres; anything further apart
#: is more likely two different parts.
MATCH_RADIUS_MM = 6.0

#: Sightings before a track is trusted enough to show or to pay to label.
STABLE_AFTER = 3

#: Frames a track may go unseen before it is dropped. At a few frames a second
#: this is a second or two of tolerance, enough to survive a hand passing over.
FORGET_AFTER = 10

#: Movement that invalidates a cached label: the part was picked up and replaced,
#: possibly with a different part.
RELABEL_DISTANCE_MM = 4.0


@dataclass
class Track:
    """One part, followed over time."""

    id: str
    blob: Blob
    first_seen: float
    last_seen: float
    sightings: int = 1
    missed: int = 0
    #: Filled in by label.py. None means "not identified yet", which is a
    #: different thing from "identified as unknown" and is reported as such.
    kind: str | None = None
    label: str | None = None
    value: str = ""
    polarised: bool = False
    unreadable: bool = False
    label_confidence: str = ""
    note: str = ""
    label_of: tuple[float, float] | None = None   # centre the label was taken at
    history: list[tuple[float, float]] = field(default_factory=list)

    @property
    def stable(self) -> bool:
        return self.sightings >= STABLE_AFTER

    @property
    def present(self) -> bool:
        return self.missed == 0

    @property
    def labelled(self) -> bool:
        return self.kind is not None

    def age_s(self) -> float:
        return self.last_seen - self.first_seen

    def clear_label(self) -> None:
        self.kind = self.label = None
        self.value = ""
        self.unreadable = False
        self.label_confidence = ""
        self.note = ""
        self.label_of = None


def _distance(a: Blob, b: Blob) -> float:
    ax, az = a.centre
    bx, bz = b.centre
    return ((ax - bx) ** 2 + (az - bz) ** 2) ** 0.5


def _compatible(a: Blob, b: Blob) -> bool:
    """Cheap sanity check before two blobs are considered the same part."""
    if a.colour_name != b.colour_name:
        return False
    # Area can change a lot as lighting shifts, but not by a factor of three.
    lo, hi = sorted((a.area_mm2, b.area_mm2))
    return hi <= max(lo * 3.0, lo + 6.0)


class Tracker:
    """Nearest-neighbour tracking over blobs measured in board millimetres."""

    def __init__(self) -> None:
        self.tracks: dict[str, Track] = {}
        self._ids = itertools.count(1)
        self.frames = 0

    def reset(self) -> None:
        self.tracks.clear()
        self.frames = 0

    def update(self, blobs: list[Blob], now: float | None = None) -> list[Track]:
        """Fold one frame's detections in. Returns the live tracks."""
        now = now or time.time()
        self.frames += 1

        # Greedy matching, closest pair first. A proper assignment solver would be
        # better in a crowd, but parts on a breadboard are spaced by the grid, and
        # greedy on distance is right whenever the spacing beats the jitter.
        pairs = sorted(
            ((_distance(t.blob, b), tid, bi)
             for tid, t in self.tracks.items()
             for bi, b in enumerate(blobs)
             if _distance(t.blob, b) <= MATCH_RADIUS_MM and _compatible(t.blob, b)),
            key=lambda p: p[0],
        )

        used_tracks: set[str] = set()
        used_blobs: set[int] = set()
        for _d, tid, bi in pairs:
            if tid in used_tracks or bi in used_blobs:
                continue
            used_tracks.add(tid)
            used_blobs.add(bi)
            self._absorb(self.tracks[tid], blobs[bi], now)

        for bi, blob in enumerate(blobs):
            if bi in used_blobs:
                continue
            tid = f"p{next(self._ids)}"
            self.tracks[tid] = Track(id=tid, blob=blob, first_seen=now, last_seen=now,
                                     history=[blob.centre])

        for tid, t in list(self.tracks.items()):
            if tid in used_tracks:
                continue
            t.missed += 1
            # A track that was never confirmed and has already gone is noise.
            if t.missed > FORGET_AFTER or (not t.stable and t.missed > 2):
                del self.tracks[tid]

        return self.live()

    def _absorb(self, track: Track, blob: Blob, now: float) -> None:
        track.blob = blob
        track.last_seen = now
        track.sightings += 1
        track.missed = 0
        track.history = (track.history + [blob.centre])[-30:]

        # A part that has moved since it was identified may not be the same part
        # any more -- a student swaps a 220 ohm resistor for a 10k and the holes
        # barely change. Dropping the label costs one API call; keeping a wrong
        # one costs them an afternoon.
        if track.label_of is not None:
            dx = blob.centre[0] - track.label_of[0]
            dz = blob.centre[1] - track.label_of[1]
            if (dx * dx + dz * dz) ** 0.5 > RELABEL_DISTANCE_MM:
                track.clear_label()

    def live(self) -> list[Track]:
        """Tracks worth showing: confirmed, and seen recently."""
        return sorted(
            (t for t in self.tracks.values() if t.stable),
            key=lambda t: t.blob.area_mm2, reverse=True,
        )

    def needing_labels(self, limit: int = 6) -> list[Track]:
        """Stable, present, and not yet identified -- oldest first."""
        return sorted(
            (t for t in self.tracks.values() if t.stable and t.present and not t.labelled),
            key=lambda t: t.first_seen,
        )[:limit]
