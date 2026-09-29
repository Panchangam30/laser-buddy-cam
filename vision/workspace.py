"""Workspace contracts and the registered breadboard implementation.

The detector still has one production workspace today, but the service now
publishes the capabilities it can actually support instead of making every
consumer infer them from the word "board".
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

from . import geometry as g


@dataclass(frozen=True)
class WorkspaceDescriptor:
    profile_id: str
    profile_version: int
    instance_id: str
    kind: str
    label: str
    capabilities: dict[str, Any]

    def serialise(self, pose: Any | None = None) -> dict:
        out = {
            "profileId": self.profile_id,
            "profileVersion": self.profile_version,
            "instanceId": self.instance_id,
            "kind": self.kind,
            "label": self.label,
            "capabilities": self.capabilities,
        }
        if pose is not None:
            out["registration"] = {
                "found": bool(getattr(pose, "found", True)),
                "confidence": getattr(pose, "confidence", None),
                "method": getattr(pose, "method", "unknown"),
                "validation": getattr(pose, "registration_validation", "unknown"),
                "note": getattr(pose, "note", ""),
            }
        return out

    def resolve_anchor(self, anchor_id: str) -> tuple[float, float] | None:
        return g.hole_xz(anchor_id)


class WorkspaceRuntime(Protocol):
    descriptor: WorkspaceDescriptor

    def locate(self, frame, *, flipped: bool = False): ...
    def rectify(self, frame, pose): ...
    def detect(self, rect): ...
    def resolve(self, target: dict) -> tuple[float, float] | None: ...


BREADBOARD = WorkspaceDescriptor(
    profile_id=g.PROFILE_ID,
    profile_version=g.PROFILE_VERSION,
    instance_id=f"{g.PROFILE_ID}:camera",
    kind=str(g.PROFILE["kind"]),
    label=str(g.PROFILE["label"]),
    capabilities=dict(g.PROFILE["capabilities"]),
)


class BreadboardRuntime:
    """Production adapter implementing registration, rectification and detection."""

    descriptor = BREADBOARD

    @staticmethod
    def locate(frame, *, flipped: bool = False):
        from . import board
        return board.find_board(frame, flipped=flipped)

    @staticmethod
    def rectify(frame, pose):
        return pose.rectify(frame)

    @staticmethod
    def detect(rect):
        from . import detect
        return detect.find_blobs(rect)

    def resolve(self, target: dict) -> tuple[float, float] | None:
        if target.get("workspaceInstanceId") != self.descriptor.instance_id:
            return None
        ref = target.get("ref") or {}
        if ref.get("kind") == "anchor":
            return self.descriptor.resolve_anchor(str(ref.get("anchorId", "")))
        if ref.get("kind") == "metric":
            x, z = ref.get("xMm"), ref.get("zMm")
            if isinstance(x, (int, float)) and isinstance(z, (int, float)):
                return float(x), float(z)
        return None


BREADBOARD_RUNTIME = BreadboardRuntime()
RUNTIMES: dict[str, WorkspaceRuntime] = {BREADBOARD.profile_id: BREADBOARD_RUNTIME}


def runtime(profile_id: str) -> WorkspaceRuntime | None:
    return RUNTIMES.get(profile_id)


def location(anchor_id: str) -> dict:
    """A scoped anchor reference suitable for world snapshots and laser tools."""
    return {
        "workspaceInstanceId": BREADBOARD.instance_id,
        "ref": {"kind": "anchor", "anchorId": anchor_id.upper()},
    }
