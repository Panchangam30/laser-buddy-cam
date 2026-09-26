# laser-buddy-cam

A lab TA for a first-year engineering student's breadboard. Point a webcam at the
bench and it works out a circuit you can build from the parts it sees, shows the
assembly in 3D, watches what you actually build, and talks you through it.

The part that makes the guidance worth anything is the **board map**: the system
knows which hole every part is in, because it solves for the board's position and
reads the holes off the board's own grid rather than asking a model to guess
coordinates.

## Running it

```sh
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env          # then put a real OPENAI_API_KEY in it
cd web && npm install && npm run dev
```

`npm run dev` starts three things: the OpenCV vision service on :8788, the Node
API on :8787, and the web app on :5173. Open the web app, allow the camera, and
press **Track my board**.

There is also a standalone camera identifier, unrelated to the web app:

```sh
.venv/bin/python identify.py          # hold a part up, press SPACE
```

## How it fits together

```
webcam (browser)
   |
   |  frames, ~2/sec
   v
Node API :8787  --/api/vision/*-->  vision service :8788   (Python, OpenCV)
   |                                      |
   |  /api/plan, /api/speak               |  board pose -> homography
   v                                      |  blobs -> hole references
OpenAI / xAI                              |  tracking -> stable ids
                                          |  batched identification (OpenAI)
                                          v
                                    world snapshot (JSON)
                                          |
                        web app: 3D view, guidance panel, voice tools
```

### The board map

`vision/` is the new half. Its job is to answer "what is on the board, and in
which holes", and it answers it by measurement rather than by asking a model:

| File | What it does |
| --- | --- |
| `geometry.py` | The 830-point grid in millimetres. A port of `web/src/lib/breadboard.ts`; **the two must stay in step**. |
| `board.py` | Finds the board and solves a homography from image pixels to board millimetres. |
| `detect.py` | Finds components on the straightened board and resolves each to the holes it covers. |
| `track.py` | Stable ids across frames, so parts do not flicker and are not re-identified every frame. |
| `label.py` | Asks the vision model *what* each part is. Never asks it where. |
| `world.py` | Assembles the snapshot, and runs the checks that follow from the wiring alone. |
| `service.py` | HTTP service, plus a standalone mode with its own window. |
| `selftest.py` | Renders boards with parts in known holes and checks they are read back correctly. |
| `synth.py` | The synthetic board those tests use. Lets you work on the detector with no camera. |

Run the accuracy check any time you touch the detector:

```sh
.venv/bin/python -m vision.selftest
```

And to work on it with a live camera and a window of your own:

```sh
.venv/bin/python -m vision.service --camera 0    # [f] flip  [r] reset  [v] view  [q] quit
```

### What is measured and what is inferred

Everything in the world snapshot is one or the other, and the schema says which.

- **Measured** — positions, sizes, angles, which holes a part covers, which
  electrical nets it joins, and every fault derived from those nets. These come
  from the board's grid and are good to a fraction of a hole pitch.
- **Inferred** — what a part *is*, and what its markings say. This is the vision
  model's answer, and it carries its own confidence. A part with no `value` is
  one whose markings could not be read; nothing in the system fills that in.

The one thing geometry cannot settle is which end of the board holds column 1 —
a rectangle photographed from above is identical rotated 180°. The vision model
is asked to read the printed numbers, and there is a **Column 1: left/right**
button to override it. It is never silently guessed.

### Plan versus reality

`web/src/lib/guidance.ts` compares the plan against the map. It compares
**electrical nodes, not hole names**: A20 and E20 are the same node, so a
resistor the plan puts in E20 is correctly placed if you put it in A20. Each
planned part comes out as placed, misplaced, missing or not-yet-reached, plus
anything on the board that is not in the plan.

The voice assistant reads this through three tools — `check_progress`,
`describe_world` and `where_is` — so it can say "your resistor is in column 25,
it needs to be in 26" instead of "check your wiring".

### Known limits

- Two parts of the **same colour** that touch are measured as one part.
  Different-coloured ones separate correctly.
- A **red wire lying along the red rail stripe** is cut in two by stripe removal.
  It survives as two blobs, each with one good endpoint.
- Hole references at the **extreme ends of the board** are the least reliable, and
  parts there are reported at low confidence for that reason.
- A resistor is located by its **body**, not its leads: thin bare wire is usually
  invisible to a webcam, so its reported span is the body's, not lead to lead.
