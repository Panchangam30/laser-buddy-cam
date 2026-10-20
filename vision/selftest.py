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

from . import aim, board as bd
from . import detect, geometry as g, synth
from .fakehead import rig
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


def run_aiming() -> int:
    """Calibrate against a simulated head and check it can hit named holes."""
    print("\n=== laser aiming ===")
    head, base = rig()
    pose = bd.find_board(base)
    if not isinstance(pose, bd.BoardPose):
        print("  FAIL  could not find the board in the test image")
        return 1

    # Stand in for the service: every 'frame' is the board as the head is
    # currently aiming it, which is exactly what the real loop sees.
    cal = aim.Calibrator()
    cal.aimer = aim.Aimer()                       # ignore any cached calibration
    # A synthetic rig's calibration must never land in the real file: the
    # service loads it and aims the actual head with it, believing it perfect.
    cal.aimer.save = lambda *_a, **_k: None
    cal.run(head, lambda: head.render(base, pose), lambda _f: pose)

    if cal.error:
        print(f"  FAIL  calibration failed: {cal.error}")
        return 1

    a = cal.aimer
    print(f"  {head.moves} moves, {len(a.samples)} samples, "
          f"rms {a.rms_mm:.2f} mm -- {a.quality()}")

    failures = 0
    if a.rms_mm is None or a.rms_mm > g.PITCH / 2:
        print(f"  FAIL  accuracy worse than half a hole pitch "
              f"({g.PITCH / 2:.2f} mm)")
        failures += 1

    # The real test: ask for a hole, and see which hole the dot lands in.
    exact = 0
    probes = ["E20", "E22", "E26", "A5", "J60", "T+12", "B-40", "E32"]
    for ref in probes:
        angles = a.angles_for_hole(ref)
        if angles is None:
            print(f"  FAIL  no aim solution for {ref}")
            failures += 1
            continue
        head.move(*angles)
        landed = g.nearest_hole(*head.hit(head.pose.pan, head.pose.tilt),
                                tolerance=g.PITCH)
        xz = g.hole_xz(ref)
        hx, hz = head.hit(head.pose.pan, head.pose.tilt)
        err = ((hx - xz[0]) ** 2 + (hz - xz[1]) ** 2) ** 0.5
        ok = landed == ref
        exact += ok
        print(f"  {'ok  ' if ok else 'MISS'} asked {ref:<5} -> landed {landed}  "
              f"({err:.2f} mm off)")
    print(f"  {exact}/{len(probes)} landed in the exact hole")
    if exact < len(probes) - 1:
        failures += 1
    return failures


def main() -> None:
    failures = run() + run_aiming()
    print(f"\n{'PASS' if failures == 0 else str(failures) + ' FAILURE(S)'}")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
