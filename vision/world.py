"""The world model: what is on the board, in a form a language model can read.

This is the artefact the rest of the system consumes. Everything in it is either
measured from the board's grid (positions, sizes, which holes, which electrical
nets) or identified by the vision model (what a part is) -- and every field says
which, so a consumer can tell a measurement from an opinion.

It also carries the checks that follow from the wiring alone. Whether a jumper
shorts out a component is a fact about nets, not a matter of judgement, so it is
settled here rather than left to a model to notice. Whether the board matches the
plan the student is following is a different question, answered in
web/src/lib/guidance.ts.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

from . import geometry as g, workspace as ws
from .detect import Blob
from .track import Track

_RANK = {"high": 3, "medium": 2, "low": 1, "": 1}

#: Kinds that only work one way round, whatever the model said about the part.
_ALWAYS_POLARISED = {"led", "transistor"}

#: Kinds that carry a readable value. A jumper wire has no markings, so calling
#: it "markings not legible" is noise that trains a student to ignore the flag.
_VALUE_KINDS = {"resistor", "capacitor", "ic", "transistor", "potentiometer"}


@dataclass
class Issue:
    """Something wrong with the board as wired, provable from the nets."""

    severity: str            # "error" | "warn" | "info"
    message: str
    entities: tuple[str, ...] = ()

    def serialise(self) -> dict:
        return {"severity": self.severity, "message": self.message,
                "entities": list(self.entities)}


def _weakest(*confidences: str) -> str:
    """Overall confidence is the weakest link, never an average."""
    ranks = [_RANK.get(c, 1) for c in confidences if c]
    r = min(ranks) if ranks else 1
    return {3: "high", 2: "medium", 1: "low"}[r]


def pins_for(blob: Blob) -> list[str]:
    """The holes the renderer should draw the part between.

    A jumper is its two ends. A body is drawn across the extremes of the holes it
    covers, which is what the 3D parts already expect.
    """
    if blob.shape == "wire" and all(blob.endpoints):
        return [blob.endpoints[0] or "", blob.endpoints[1] or ""]
    if not blob.holes:
        return []
    if len(blob.holes) == 1:
        return [blob.holes[0]]
    return [blob.holes[0], blob.holes[-1]]


def _entity(track: Track, pose_confidence: str) -> dict:
    b = track.blob
    at_edge = b.columns[0] <= 2 or b.columns[1] >= g.COLUMNS - 1

    # Stability earns confidence: a part seen in thirty frames is not a shadow.
    stability = "high" if track.sightings >= 8 else "medium"
    confidence = _weakest(pose_confidence, track.label_confidence or "medium", stability)
    if at_edge:
        # The board outline is least accurate at its ends, so hole references
        # there are the ones most likely to be a column out.
        confidence = "low"

    kind = track.kind
    expects_value = kind in _VALUE_KINDS

    # A jumper is defined by where its two ends go; a body by the holes it covers.
    if b.shape == "wire" and all(b.endpoints):
        where = f"{b.endpoints[0]} to {b.endpoints[1]}"
    else:
        where = b.footprint_text()

    return {
        "id": track.id,
        "identified": track.labelled,
        "kind": kind,
        "label": track.label or f"unidentified {b.colour_name} {b.shape}",
        "value": track.value,
        "unreadable": (track.unreadable if track.labelled else True) and expects_value,
        "polarised": bool(track.polarised) or kind in _ALWAYS_POLARISED,
        "confidence": confidence,
        "shape": b.shape,
        "pins": pins_for(b),
        "locations": [ws.location(p) for p in pins_for(b) if p],
        # Wire endpoints are observed at their ends. For a body, the camera often
        # sees the body but not its bare leads, so its terminal attachment is an
        # explicit inference rather than silently presented as equal evidence.
        "terminalEvidence": "measured" if b.shape == "wire" and all(b.endpoints) else "inferred",
        "holes": list(b.holes),
        "footprint": where,
        "footprintBox": b.footprint_text(),
        "nets": list(b.nets),
        "straddlesChannel": b.straddles_channel,
        "atEdge": at_edge,
        "colorHex": b.colour_hex,
        "colorName": b.colour_name,
        "sizeMm": {"length": b.length_mm, "width": b.width_mm, "area": b.area_mm2},
        "centreMm": {"x": b.centre[0], "z": b.centre[1]},
        "angleDeg": b.angle_deg,
        "present": track.present,
        "seenFrames": track.sightings,
        "ageS": round(track.age_s(), 1),
        "note": track.note,
        "describe": b.describe(),
    }


def _net_map(entities: list[dict]) -> dict[str, list[str]]:
    nets: dict[str, list[str]] = {}
    for e in entities:
        for n in e["nets"]:
            nets.setdefault(n, []).append(e["id"])
    return nets


def check_wiring(entities: list[dict], nets: dict[str, list[str]]) -> list[Issue]:
    """Faults that follow from the nets alone.

    Deliberately narrow. Everything here is a fact about which holes are joined
    to which, so it can be stated plainly. Anything needing judgement about intent
    belongs with the plan, not here.
    """
    issues: list[Issue] = []
    by_id = {e["id"]: e for e in entities}

    for e in entities:
        pins = [p for p in e["pins"] if p]
        own = [g.net_of(p) for p in pins]
        # Both legs of a two-lead part in the same node: the board itself joins
        # them, so the part carries no current and does nothing.
        if len(own) >= 2 and own[0] is not None and len(set(own)) == 1:
            what = e["label"]
            measured = e.get("terminalEvidence") == "measured"
            issues.append(Issue(
                "error" if measured else "warn",
                (f"{what} has both terminals in {pins[0]} and {pins[1]}, which are "
                 f"the same node -- the board already connects them, so it is "
                 f"shorted out and will do nothing."
                 if measured else
                 f"{what}'s visible body lies over one node at {pins[0]} and {pins[1]}. "
                 f"Its bare leads are not visible, so check that its actual terminals "
                 f"do not enter that same node."),
                (e["id"],)))

    # A jumper straight across a supply is a short circuit, not a mistake in
    # degree. Worth calling out before anything is powered.
    for e in entities:
        if e["shape"] != "wire":
            continue
        pins = [p for p in e["pins"] if p]
        if len(pins) < 2:
            continue
        rails = [g.net_of(p) for p in pins]
        if all(r and r.startswith("rail:") for r in rails) and rails[0] != rails[1]:
            a = (rails[0] or "")[-1]
            b = (rails[1] or "")[-1]
            if {a, b} == {"+", "-"}:
                issues.append(Issue(
                    "error",
                    f"{e['label']} joins a positive rail to a negative rail "
                    f"({pins[0]} to {pins[1]}). That is a short across the supply "
                    f"-- do not power this up.",
                    (e["id"],)))

    # Every LED needs something to limit its current. This checks only what is
    # visible: a resistor sharing one of the LED's two nodes.
    resistors = [e for e in entities if e["kind"] == "resistor"]
    for e in entities:
        if e["kind"] != "led":
            continue
        led_nets = set(e["nets"])
        protected = any(led_nets & set(r["nets"]) for r in resistors)
        if not protected:
            issues.append(Issue(
                "warn",
                f"I cannot verify a resistor sharing either visible node of "
                f"{e['label']} at {e['footprint']}. The camera may not see its bare "
                f"leads, so check the real terminals before powering it; every LED "
                f"needs a series resistor.",
                (e["id"],)))

    for net, ids in nets.items():
        if len(ids) > 4 and net.startswith("col:"):
            labels = ", ".join(by_id[i]["label"] for i in ids[:4])
            issues.append(Issue(
                "info",
                f"{len(ids)} parts share node {net.split(':')[1]} "
                f"({labels}...). Check that is deliberate -- everything in one "
                f"column of five holes is one wire electrically.",
                tuple(ids)))

    for e in entities:
        if not e["identified"]:
            issues.append(Issue(
                "info",
                f"There is something at {e['footprint']} that has not been "
                f"identified yet ({e['describe']}).",
                (e["id"],)))
        elif e["atEdge"]:
            issues.append(Issue(
                "info",
                f"{e['label']} sits at the very end of the board, where the hole "
                f"references are least reliable. Treat {e['footprint']} as "
                f"approximate.",
                (e["id"],)))

    return issues


@dataclass
class World:
    """One snapshot of the board."""

    at: float = field(default_factory=time.time)
    frame: int = 0
    board: dict = field(default_factory=lambda: {"found": False})
    workspace: dict = field(default_factory=lambda: ws.BREADBOARD.serialise())
    entities: list[dict] = field(default_factory=list)
    nets: dict[str, list[str]] = field(default_factory=dict)
    issues: list[Issue] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    def serialise(self) -> dict:
        return {
            "at": round(self.at, 3),
            "frame": self.frame,
            "board": self.board,
            "workspace": self.workspace,
            "entities": self.entities,
            "nets": self.nets,
            "issues": [i.serialise() for i in self.issues],
            "errors": self.errors,
            "summary": self.summary(),
        }

    def summary(self) -> str:
        """A few lines of prose, so a language model needs no preprocessing."""
        if not self.board.get("found"):
            return (f"No breadboard is visible. {self.board.get('hint', '')}").strip()
        if not self.entities:
            return ("The breadboard is in view and empty -- nothing is placed on it "
                    "yet.")
        lines = [f"The breadboard is in view with {len(self.entities)} "
                 f"part{'s' if len(self.entities) != 1 else ''} on it:"]
        for e in self.entities:
            bits = [f"  - {e['label']} at {e['footprint']}"]
            if e["value"]:
                bits.append(f"value {e['value']}")
            elif e["unreadable"] and e["identified"]:
                bits.append("markings not legible")
            if e["confidence"] == "low":
                bits.append("position uncertain")
            lines.append(", ".join(bits))
        errs = [i for i in self.issues if i.severity == "error"]
        warns = [i for i in self.issues if i.severity == "warn"]
        for i in errs + warns:
            lines.append(f"  ! {i.message}")
        return "\n".join(lines)


def build(pose: Any, tracks: list[Track], frame: int,
          errors: list[str] | None = None) -> World:
    """Assemble a snapshot from a pose and the live tracks."""
    if getattr(pose, "found", True) is False:
        return World(frame=frame, board=pose.serialise(),
                     workspace=ws.BREADBOARD.serialise(pose), errors=errors or [])

    entities = [_entity(t, pose.confidence) for t in tracks]
    nets = _net_map(entities)
    issues = check_wiring(entities, nets)
    if pose.note:
        issues.append(Issue("info", pose.note))
    return World(frame=frame, board=pose.serialise(),
                 workspace=ws.BREADBOARD.serialise(pose), entities=entities,
                 nets=nets, issues=issues, errors=errors or [])
