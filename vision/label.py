"""Ask the vision model what each detected part is.

The division of labour is deliberate. OpenCV already knows where every part is
and how big it is, to a fraction of a hole pitch, and the model is never asked
about position -- only identity, which is the thing geometry cannot supply.

That split is also what keeps the cost down: one batched call identifies several
parts at once, results are cached against the tracker's ids, and a part that has
not moved is never paid for twice.
"""

from __future__ import annotations

import base64
import json
import os

import cv2
import numpy as np

from . import board as bd
from .track import Track

MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o")

#: The kinds the 3D renderer knows how to draw. Anything else becomes "module",
#: which draws as a labelled box rather than as nothing.
KINDS = ("resistor", "led", "capacitor", "ic", "transistor",
         "button", "potentiometer", "module", "wire")

PROMPT = """\
You are identifying electronic parts for a first-year engineering student's
breadboard. You are given close-up crops, each cut from a straight-on photo of
the board, one per part, numbered from 0.

You are NOT being asked where anything is. The positions are already measured
from the board's own grid and are more accurate than anything you could judge
from a crop. Identify WHAT each part is, nothing else.

Rules that matter more than being helpful:
- These crops are small and from a webcam. If you cannot actually READ a marking
  -- resistor colour bands, an IC part number, a capacitor code -- set "value" to
  "" and "unreadable" to true. Never guess a value and state it as fact: a
  student wires the wrong part and loses an afternoon.
- If a crop is too unclear to identify at all, use kind "module", label what you
  can see ("unidentified black body"), and set confidence "low". Do not invent.
- A crop may contain more than one part touching. Identify the most prominent and
  say so in "note".

Also report the board's orientation, once, for the whole board image that comes
first: which end of the board holds column 1, as printed on the board itself.
A rectangle looks identical rotated 180 degrees, so this cannot be worked out
from shape and is the one thing geometry cannot settle. If the printed numbers
are not legible, say "unsure" -- do not guess.

Reply as JSON:
{
  "columnOneAt": "left" | "right" | "unsure",
  "items": [
    {"i": 0, "kind": "resistor", "label": "Resistor (bands not legible)",
     "value": "", "polarised": false, "unreadable": true,
     "confidence": "low", "note": ""}
  ]
}
kind must be one of: %s
"label" is what you would call it out loud to a student, 2-5 words.
"polarised" is true only when the part will not work if reversed.
Return exactly one item per crop, with "i" matching the crop number.
""" % " ".join(KINDS)


def _encode(img: np.ndarray, quality: int = 88) -> str:
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise RuntimeError("failed to JPEG-encode crop")
    return "data:image/jpeg;base64," + base64.b64encode(buf).decode()


def crop_for(rect: np.ndarray, track: Track, min_px: int = 64) -> np.ndarray:
    """The part's crop, upscaled so small parts are actually legible.

    A resistor is 6 mm long, which at the rectified scale is 36 pixels. Sent as
    is, the model is being asked to read colour bands off something the size of a
    word in this sentence, so the crop is enlarged before it goes.
    """
    x0, y0, x1, y1 = track.blob.crop_rect
    patch = rect[y0:y1, x0:x1]
    if patch.size == 0:
        return np.zeros((min_px, min_px, 3), np.uint8)
    scale = max(1.0, min_px / max(1, min(patch.shape[0], patch.shape[1])))
    scale = min(scale, 6.0)
    if scale > 1.0:
        patch = cv2.resize(patch, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    return patch


def build_request(rect: np.ndarray, tracks: list[Track]) -> dict:
    """The chat-completions body for one batched identification."""
    content: list[dict] = [{
        "type": "text",
        "text": (f"{len(tracks)} parts to identify. The first image is the whole "
                 "board, for orientation only. Then one crop per part, in order."),
    }, {
        "type": "image_url",
        "image_url": {"url": _encode(rect), "detail": "high"},
    }]

    for i, t in enumerate(tracks):
        b = t.blob
        # The measurements go with the crop. Size and shape in millimetres rule
        # out most misidentifications on their own -- a 6 mm body is not an
        # Arduino -- and they come from the board's grid, not from the model.
        content.append({
            "type": "text",
            "text": (f"Crop {i}: {b.length_mm:.0f} x {b.width_mm:.0f} mm, "
                     f"{b.colour_name}, sitting at {b.footprint_text()}"
                     + (", spans the centre channel" if b.straddles_channel else "")
                     + (f", looks like a wire run {b.endpoints[0]} to {b.endpoints[1]}"
                        if b.shape == "wire" and all(b.endpoints) else "")),
        })
        content.append({
            "type": "image_url",
            "image_url": {"url": _encode(crop_for(rect, t)), "detail": "high"},
        })

    return {
        "model": MODEL,
        "max_tokens": 900,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": PROMPT},
            {"role": "user", "content": content},
        ],
    }


def apply_result(tracks: list[Track], data: dict) -> str | None:
    """Write a model reply back onto the tracks. Returns the orientation hint."""
    items = data.get("items")
    if isinstance(items, list):
        for item in items:
            try:
                i = int(item.get("i", -1))
            except (TypeError, ValueError):
                continue
            if not 0 <= i < len(tracks):
                continue
            t = tracks[i]
            kind = str(item.get("kind", "")).strip().lower()
            t.kind = kind if kind in KINDS else "module"
            t.label = str(item.get("label", "")).strip() or "unidentified part"
            t.value = str(item.get("value", "") or "").strip()
            t.polarised = bool(item.get("polarised"))
            t.unreadable = bool(item.get("unreadable")) or not t.value
            t.label_confidence = str(item.get("confidence", "") or "").lower() or "medium"
            t.note = str(item.get("note", "") or "").strip()
            t.label_of = t.blob.centre

    at = str(data.get("columnOneAt", "") or "").lower()
    return at if at in ("left", "right") else None


def identify(rect: np.ndarray, tracks: list[Track], api_key: str,
             timeout: float = 30.0) -> tuple[str | None, str | None]:
    """Identify `tracks` in one call. Returns (orientation hint, error)."""
    if not tracks:
        return None, None
    if not api_key:
        return None, "OPENAI_API_KEY missing -- parts are located but not identified"

    import urllib.error
    import urllib.request

    body = json.dumps(build_request(rect, tracks)).encode()
    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=body,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            payload = json.loads(r.read())
    except urllib.error.HTTPError as e:
        return None, f"OpenAI {e.code}: {e.read()[:200].decode(errors='replace')}"
    except Exception as e:
        return None, f"{type(e).__name__}: {e}"

    raw = payload.get("choices", [{}])[0].get("message", {}).get("content", "")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None, "model did not return valid JSON"

    return apply_result(tracks, data), None
