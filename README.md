# laser-buddy-cam

A lab TA for a first-year engineering student's breadboard. Point a webcam at the
bench and it works out a circuit you can build from the parts it sees, shows the
assembly in 3D, watches what you actually build, talks you through it — and
**shines a laser on the hole you need next**.

The part that makes all of it worth anything is the **board map**: the system
knows which hole every part is in, because it solves for the board's position and
reads the holes off the board's own grid rather than asking a model to guess
coordinates. The laser then works because the map and the head are calibrated
against each other through the camera, so "point at E20" is a real instruction.

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
| `web/src/workspaces/breadboard-830.v1.json` | The versioned source of truth for dimensions, anchors, intrinsic nodes, registration limits and laser check points. |
| `geometry.py` / `breadboard.ts` | Python and TypeScript adapters over that shared workspace definition. |
| `board.py` | Finds the board and solves a homography from image pixels to board millimetres. |
| `detect.py` | Finds components on the straightened board and resolves each to the holes it covers. |
| `track.py` | Stable ids across frames, so parts do not flicker and are not re-identified every frame. |
| `label.py` | Asks the vision model *what* each part is. Never asks it where. |
| `world.py` | Assembles the snapshot, and runs the checks that follow from the wiring alone. |
| `service.py` | HTTP service, plus a standalone mode with its own window. |
| `selftest.py` | Renders boards with parts in known holes and checks they are read back correctly. |
| `laser.py` | Serial link to the pan/tilt head (`firmware/laserbuddy/`). |
| `aim.py` | Calibrates the head against the board, through the camera, and aims it. |
| `synth.py` | The synthetic board those tests use. Lets you work on the detector with no camera. |
| `fakehead.py` | A simulated laser rig, so the aiming loop is testable with no hardware. |

Run the accuracy check any time you touch the detector:

```sh
.venv/bin/python -m vision.selftest
```

And to work on it with a live camera and a window of your own:

```sh
.venv/bin/python -m vision.service --camera 0    # [f] flip  [r] reset  [v] view  [q] quit
```

### The laser

The head knows nothing about the board and the board knows nothing about the
head. What connects them is that the camera can see both: the vision service
already turns any camera pixel into a millimetre position on the board, so
switching the laser on and finding its dot tells us where one pair of servo
angles lands. Do that enough times and the mapping is measured, not assumed — no
tape measure, and a crooked mount calibrates out for free.

Calibration is not a blind sweep, because a blind sweep does not work. A head
300 mm from a 165 x 48 mm board sees it across about 30 degrees of pan and only
six of tilt, so any grid coarse enough to finish in a minute steps straight over
the board. Instead it searches outwards from wherever the head is already aimed
until the dot lands on the board, nudges each axis to measure how far a degree
moves the dot, aims at a grid of board positions using that, and finally checks
itself by aiming at named holes and measuring the miss. About forty moves.

That last number is the one reported in the UI: **RMS error in millimetres**,
and what it means in holes. Under half a hole pitch (1.27 mm) and the dot lands
in the hole you asked for.

```sh
.venv/bin/python -m vision.service --camera 0
#   [l] connect laser   [k] calibrate   [1-9] point at a hole   [0] laser off
```

The firmware switches the laser off after 15 seconds with no command. That is a
safety default and is left alone — the host re-asserts it only while it is
deliberately pointing at something, so closing the browser tab puts the laser
out. Don't look into the beam.

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

The voice assistant reads this through four tools — `check_progress`,
`describe_world`, `where_is` and `point_at` — so it can say "your resistor is in
column 25, it needs to be in 26" *and put the dot on column 26* instead of
saying "check your wiring".

### Projects and named goals

Plans live in a browser-local project library backed by IndexedDB. The selected
project and its current/manual step progress survive reloads; camera images are
not stored. A successful bench scan creates a project, while a failed scan leaves
the last good project alone.

The Projects panel also accepts named goals. Goal plans come from a verified,
deterministic catalog and include requirements, safety warnings, code and manual
test steps. Unsupported goals are refused rather than receiving model-invented
wiring. The initial catalog includes the button-controlled servo sweep.

### Workspace capabilities

World snapshots now identify their workspace profile and advertise location,
connectivity and absolute-targeting capabilities. Locations and laser requests
use scoped workspace references internally; legacy breadboard hole strings remain
at the renderer boundary for compatibility. The only production locator today is
the existing 830-point breadboard adapter. Perfboard and PCB support require
registered profiles/fiducials and are deliberately not presented as available yet.

### Known limits

- Two parts of the **same colour** that touch are measured as one part.
  Different-coloured ones separate correctly.
- A **red wire lying along the red rail stripe** is cut in two by stripe removal.
  It survives as two blobs, each with one good endpoint.
- Hole references at the **extreme ends of the board** are the least reliable, and
  parts there are reported at low confidence for that reason.
- A resistor is located by its **body**, not its leads: thin bare wire is usually
  invisible to a webcam, so its reported span is the body's, not lead to lead.
- The laser needs **recalibrating if the head or the camera is moved**. Nothing
  detects that automatically; the accuracy figure is from the last calibration.
- Calibration needs **board tracking on**, because it measures the dot through
  the same frames the browser is already sending.
