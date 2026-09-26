"""Check the detector still reads back the holes we placed parts in.

    .venv/bin/python -m vision.selftest

Renders boards with known parts in known holes, runs the real pipeline over
them, and compares. This is the test that matters: a hole reference that is one
row out looks completely plausible in the 3D view, and nothing else in the
system can tell that it is wrong.

It needs no camera and makes no API calls -- identification is the model's job
and is not what is being checked here.
"""

from __future__ import annotations

import sys

from . import board as bd
from . import detect, geometry as g, synth
from .track import Tracker

#: Parts placed in known holes, and the holes each must be reported as covering.
#: Two tolerances are applied: a body is allowed to be measured a column wide at
#: each end, because the detector sees a body and not its thin leads.
CASES: list[tuple[str, list[dict], dict[str, set[str]]]] = [
    (
        "LED, resistor, two jumpers and a DIP chip",
        synth.GROUND_TRUTH,
        {
            "led":      {"E20", "E21", "E22"},
            "resistor": {"E22", "E23", "E24", "E25", "E26"},
            "wire-a":   {"A20", "T+20"},
            "wire-b":   {"A26", "B-26"},
            "ic":       {"E40", "F47"},
        },
    ),
]


def _holes(blob) -> set[str]:
    if blob.shape == "wire" and all(blob.endpoints):
        return {h for h in blob.endpoints if h}
    return set(blob.holes)


def _columns(holes: set[str]) -> set[int]:
    return {parsed[1] for h in holes if (parsed := g.parse_hole(h))}


def run(tilts: tuple[float, ...] = (0.0, 0.02, 0.03)) -> int:
    failures = 0
    for name, parts, expected in CASES:
        for tilt in tilts:
            frame = synth.render_board(parts, tilt=tilt)
            pose = bd.find_board(frame)
            if not isinstance(pose, bd.BoardPose):
                print(f"FAIL  {name} @ tilt {tilt}: no board found ({pose.reason})")
                failures += 1
                continue

            rect = pose.rectify(frame)
            tracker = Tracker()
            for i in range(4):
                tracker.update(detect.find_blobs(rect), now=float(i))
            found = tracker.live()

            print(f"\n{name}  tilt={tilt}  pose={pose.confidence}"
                  + (f"  note={pose.note}" if pose.note else ""))
            if len(found) != len(parts):
                print(f"  FAIL  expected {len(parts)} parts, detected {len(found)}")
                failures += 1

            # Match each detected blob to whichever expectation it overlaps most,
            # since the detector has no names -- only positions.
            for blob in (t.blob for t in found):
                got = _holes(blob)
                got_cols = _columns(got)
                best, best_hit = None, -1.0
                for key, want in expected.items():
                    hit = len(got_cols & _columns(want)) / max(1, len(_columns(want)))
                    if hit > best_hit:
                        best, best_hit = key, hit
                mark = "ok  " if best_hit >= 0.5 else "FAIL"
                if best_hit < 0.5:
                    failures += 1
                print(f"  {mark} {blob.describe():<52} -> {best} "
                      f"({best_hit * 100:.0f}% of its columns)")
    return failures


def main() -> None:
    failures = run()
    print(f"\n{'PASS' if failures == 0 else str(failures) + ' FAILURE(S)'}")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
