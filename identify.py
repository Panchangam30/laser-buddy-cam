"""Engineering component identifier -- webcam + GPT vision, for beginner students.

Hold a component, instrument, part or schematic in front of the camera and press
SPACE. The frame is sent to OpenAI's vision model and explained in the terminal.

    export OPENAI_API_KEY=sk-...
    .venv/bin/python identify.py

    .venv/bin/python identify.py --list-models   # see what your key can access
    .venv/bin/python identify.py --model <id>    # use a specific model

Keys:  SPACE  identify what's in frame     q / Esc  quit
"""

import argparse
import base64
import json
import os
import queue
import textwrap
import threading

import cv2
from dotenv import load_dotenv
from openai import APIConnectionError, AuthenticationError, NotFoundError, OpenAI

from speech import Speaker, spoken_summary

# Load .env from next to this file, so it works from any working directory.
# Real environment variables already set take precedence over the file.
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

SYSTEM_PROMPT = """\
You help first-year engineering students identify things on their bench. You will
be shown a webcam photo of one of: an electronic component, a lab instrument or
hand tool, a piece of mechanical hardware, or a circuit diagram / breadboard layout.

Identify it and explain it the way a good lab TA would -- plain language, no
condescension, assume they have never seen it before.

Rules that matter more than being helpful:
- Webcam images are low resolution. If you cannot actually READ a marking
  (resistor colour bands, an IC part number, a capacitor code, a thread size),
  say so and tell them how to reshoot it. Never guess a value and state it as
  fact -- a student wiring up a wrong part number loses an afternoon.
- Separate what you can SEE from what you INFER. "Three-pin TO-92 package" is
  seen; "probably a 2N3904" is inferred, and should be flagged as such.
- If several parts are in frame, describe the most prominent one and note the others.
- If it is a schematic, explain what the circuit DOES, not just its symbols.

Reply as JSON with exactly these keys:
  "name"        short identification, e.g. "Ceramic capacitor (104 = 0.1uF)"
  "confidence"  one of "high", "medium", "low"
  "what_it_is"  2-3 sentences in plain language: what it is and what it does
  "markings"    what is legible on the part and what it decodes to; say plainly
                if nothing is legible enough to read
  "typical_use" the most common thing a student would use this for
  "watch_out"   the one mistake beginners make with this (polarity, pinout,
                max ratings, direction, units). Empty string if genuinely none.
  "reshoot"     if confidence is low, how to re-photograph it; else empty string
"""

FIELDS = [
    ("what_it_is", "WHAT IT IS"),
    ("markings", "MARKINGS"),
    ("typical_use", "TYPICAL USE"),
    ("watch_out", "WATCH OUT"),
    ("reshoot", "RESHOOT IT"),
]


def encode_frame(frame, max_side=1024, quality=90):
    """Downscale and JPEG-encode a BGR frame into a base64 data URL."""
    h, w = frame.shape[:2]
    if max(h, w) > max_side:
        s = max_side / max(h, w)
        frame = cv2.resize(frame, (int(w * s), int(h * s)), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise RuntimeError("failed to JPEG-encode frame")
    return "data:image/jpeg;base64," + base64.b64encode(buf).decode()


def identify(client, model, data_url, detail):
    resp = client.chat.completions.create(
        model=model,
        max_tokens=700,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": [
                {"type": "text",
                 "text": "What is this? Reply as JSON in the format described."},
                {"type": "image_url",
                 "image_url": {"url": data_url, "detail": detail}},
            ]},
        ],
    )
    raw = resp.choices[0].message.content
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        # Model ignored JSON mode -- show its prose rather than crashing.
        return {"name": "(unstructured reply)", "confidence": "",
                "what_it_is": raw, "markings": "", "typical_use": "",
                "watch_out": "", "reshoot": ""}


def render(result):
    wrap = textwrap.TextWrapper(width=74, initial_indent="  ",
                                subsequent_indent="  ")
    conf = str(result.get("confidence", "")).lower()
    mark = {"high": "**", "medium": "~", "low": "!!"}.get(conf, "")

    print("\n" + "=" * 78)
    print(f"  {result.get('name', 'unknown')}"
          + (f"   [{conf} confidence {mark}]" if conf else ""))
    print("=" * 78)
    for key, heading in FIELDS:
        val = str(result.get(key, "") or "").strip()
        # The model sometimes fills in reshoot advice even when it's confident;
        # showing it there just undercuts a good answer.
        if key == "reshoot" and conf != "low":
            continue
        if val:
            print(f"\n{heading}")
            print(wrap.fill(val))
    if conf == "low":
        print("\n  (low confidence -- treat the above as a starting point, "
              "not an answer)")
    print("=" * 78 + "\n[SPACE] identify   [q] quit")


def worker(client, model, detail, jobs, results):
    while True:
        data_url = jobs.get()
        if data_url is None:
            return
        try:
            results.put(identify(client, model, data_url, detail))
        except Exception as e:
            results.put({"name": "request failed", "confidence": "",
                         "what_it_is": f"{type(e).__name__}: {e}",
                         "markings": "", "typical_use": "", "watch_out": "",
                         "reshoot": ""})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--camera", type=int,
                    default=int(os.environ.get("CAMERA_INDEX", "0")))
    ap.add_argument("--model", default=os.environ.get("OPENAI_MODEL", "gpt-4o"),
                    help="vision-capable model id (default gpt-4o)")
    ap.add_argument("--detail", default=os.environ.get("IMAGE_DETAIL", "high"),
                    choices=["low", "high", "auto"],
                    help="high reads small markings better; low is cheaper")
    ap.add_argument("--list-models", action="store_true",
                    help="list models your key can access, then exit")
    ap.add_argument("--voices", action="store_true",
                    help="list xAI TTS voices, then exit")
    ap.add_argument("--no-speak", action="store_true",
                    help="show answers as text only, don't speak them")
    ap.add_argument("--voice", default=os.environ.get("XAI_VOICE_ID", "eve"),
                    help="xAI voice id (default eve)")
    args = ap.parse_args()

    if not os.environ.get("OPENAI_API_KEY"):
        raise SystemExit(
            "OPENAI_API_KEY is not set.\n"
            "  Put it in the .env file next to this script:\n"
            "      OPENAI_API_KEY=sk-...\n"
            "  (copy .env.example to .env if you don't have one yet)")
    client = OpenAI()

    speak_on = not args.no_speak and os.environ.get("SPEAK", "1") != "0"
    speaker = Speaker(enabled=speak_on, voice=args.voice)

    if args.voices:
        if not speaker.key:
            raise SystemExit("XAI_API_KEY is not set in .env")
        print(json.dumps(speaker.list_voices(), indent=2))
        return

    # Check the key and the model up front -- a clear message now beats a
    # traceback after the student has already lined up a component.
    try:
        if args.list_models:
            for m in sorted(x.id for x in client.models.list()):
                print(m)
            return
        client.models.retrieve(args.model)
    except AuthenticationError:
        raise SystemExit(
            "OpenAI rejected the API key.\n"
            "  Check OPENAI_API_KEY in your .env -- the placeholder from\n"
            "  .env.example won't work; paste a real key from\n"
            "  https://platform.openai.com/api-keys")
    except NotFoundError:
        raise SystemExit(
            f"Your key cannot access the model '{args.model}'.\n"
            "  Run:  .venv/bin/python identify.py --list-models\n"
            "  then set OPENAI_MODEL in .env to one of those ids.")
    except APIConnectionError as e:
        raise SystemExit(f"Could not reach OpenAI -- check your connection.\n  {e}")

    cap = cv2.VideoCapture(args.camera)
    if not cap.isOpened():
        raise SystemExit("could not open camera -- check macOS camera permissions "
                         "(System Settings > Privacy & Security > Camera)")

    jobs, results = queue.Queue(), queue.Queue()
    threading.Thread(target=worker,
                     args=(client, args.model, args.detail, jobs, results),
                     daemon=True).start()

    busy = False
    if speaker.reason:
        print(f"  note: {speaker.reason}")
    voice_state = f"voice: {speaker.voice}" if speaker.enabled else "voice: off"
    print(f"model: {args.model} | detail: {args.detail} | {voice_state}")
    print("[SPACE] identify   [q] quit")

    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break

            view = frame.copy()
            h, w = view.shape[:2]
            msg = "identifying ..." if busy else "SPACE = what is this?"
            col = (0, 200, 255) if busy else (0, 255, 0)
            cv2.rectangle(view, (0, h - 42), (w, h), (0, 0, 0), -1)
            cv2.putText(view, msg, (12, h - 14), cv2.FONT_HERSHEY_SIMPLEX,
                        0.7, col, 2, cv2.LINE_AA)
            cv2.imshow("identify -- engineering", view)

            try:
                result = results.get_nowait()
                render(result)
                speaker.say(spoken_summary(result))
                busy = False
            except queue.Empty:
                pass

            k = cv2.waitKey(1) & 0xFF
            if k in (ord("q"), 27):
                break
            if k == ord(" ") and not busy:
                speaker.stop()          # cut off the previous answer
                busy = True
                print("\nidentifying ...")
                jobs.put(encode_frame(frame))
    finally:
        speaker.stop()
        cap.release()
        cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
