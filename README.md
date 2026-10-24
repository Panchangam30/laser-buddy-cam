# Laser Buddy Cam

We built Laser Buddy to help with the confusing part of learning Arduino:
figuring out what goes where, and why the thing you just built does not work.
It combines a 3D breadboard guide, a camera view of your real circuit, code
tools, and an optional laser pointer that can point at the next connection.

**Start here: [SETUP.md](SETUP.md).** You can try the tutorials, code library,
and notes without a camera, Arduino, or API key.

## What it does

- **Build in 3D.** Step through a wiring plan, rotate the board, add starter-kit
  parts, and inspect connections. The component drawer has 32 visual entries.
- **Learn with examples.** There are 50 authored Arduino projects, 11 beginner
  guides, eight 3D fault challenges, and 216 help records at `/hub`.
- **Write code.** Sketch Studio has syntax coloring, local checks, line-linked
  explanations, `.ino` downloads, and 53 starter sketches. Each library entry
  has **Explain** and **Use sketch** buttons.
- **Ask for code feedback.** Optional Groq feedback reviews a sketch and your
  question, explains behavior, and suggests changes. You choose whether to use
  a suggested revision.
- **Leave notes.** Put sticky notes and arrows on the plan, drag them around,
  hide/show them, and undo deletions. Arrows can attach to rendered parts and
  follow them as you rotate the view.
- **Watch your real board.** OpenCV locates the supported breadboard and maps
  visible placements to its grid. AI can identify parts separately. Guidance
  compares the plan with the observed circuit.
- **Track objects on a desk.** The default camera mode follows objects outside
  the breadboard workflow. Identification and optional laser targeting need
  their own setup.
- **Keep and share builds.** Projects save in the browser. Export/import JSON
  or share a compatible project link.
- **Add voice or a laser.** Configured voice assistance can explain steps.
  A calibrated Arduino pan/tilt head can point at a hole or tracked object.
  `/remote` and `/remote/aim` provide phone controls for a reachable local rig.

## Quick start: just the website

Install Node.js **22.12 or newer** and Git, then:

```sh
git clone https://github.com/Panchangam30/laser-buddy-cam.git
cd laser-buddy-cam/web
npm ci
npm run dev:web
```

Open the address Vite prints, usually <http://localhost:5173>. Open **Projects**
for the tutorial catalog. For the 3D workbench, expand **Devices**, choose
**Breadboard**, and use **Plan**. **Bench tools** and **Code editor** are in the
left panel. Camera and provider features need the services in [SETUP.md](SETUP.md).

## Optional services and keys

Put real keys in a repository-root `.env`, copied from [`.env.example`](.env.example).
Local services read the keys; they are not bundled into the frontend.

| Feature | Needs |
| --- | --- |
| Tutorials, library explanations, local code checks, notes | Web app only |
| LLM code feedback | Node API and `GROQ_API_KEY` |
| Bench-photo plans and AI part identification | Node/Python services as applicable and `OPENAI_API_KEY` |
| Live board geometry/tracking | Python service and camera permission; geometry can run without AI labels |
| Grok voice and narration | Node API, `XAI_API_KEY`, and microphone permission for conversation |
| OpenAI voice alternative | Node API, `OPENAI_API_KEY`, and `VOICE_PROVIDER=openai` |
| Physical pointing | Connected rig, vision service, camera frames, and calibration |

Groq code feedback and xAI Grok voice are separate services and use different
keys. Only configure the features you want.

## What to expect

The 3D workbench is a wiring guide. Its behavior preview animates components;
it does not solve voltages/currents or run Arduino code. Compile and upload
sketches in the Arduino IDE, then perform the project's manual test.

The board locator targets the supplied 830-point breadboard profile. Hidden
leads, unreadable markings, off-board wiring, lighting, and overlapping parts
can limit what the camera verifies. Review the real circuit before powering it.
Laser accuracy depends on the setup and needs recalibration after the camera
or head moves. Never aim the beam at eyes or reflective surfaces.

## Where your work goes

Projects, sketch drafts, sticky notes, arrows, and visibility settings are saved
by the browser per project. Clearing browser site data removes that work.
Drafts and annotations are separate from project exports and share links.

Local checks, library explanations, and notes do not call an AI provider.
Requesting LLM feedback sends the sketch, question, and project title to Groq.
Configured scanning/identification can send images to OpenAI; voice uses the
selected provider. This is not a promise that every feature runs offline.

## Working on the code

| Directory | What's there |
| --- | --- |
| `web/src/` | React UI, 3D workbench, lessons, and browser storage |
| `web/server/` | Node API and provider requests |
| `vision/` | Python/OpenCV tracking, geometry, and laser control |
| `firmware/laserbuddy/` | Arduino firmware for the optional rig |
| `web/tests/` | Playwright browser and API tests |
| `web/src/workspaces/` | Shared breadboard geometry and workspace schema |

Measured board geometry supplies locations; the vision model labels component
identity. Python and TypeScript use the shared workspace profile. See the
[web notes](web/README.md) and [CONTRIBUTING.md](CONTRIBUTING.md) for more.

```sh
cd web
npm run build
npm test
```

From the root, the detector also has a camera-free synthetic self-test:

```sh
.venv/bin/python -m vision.selftest
```

Automated checks do not replace a test with a real camera, circuit, or laser rig.

## License and third-party assets

Project source code is available under the MIT License; see [LICENSE](LICENSE).
Third-party 3D model licenses and source credits are listed in
[`web/public/models/CREDITS.md`](web/public/models/CREDITS.md). Arduino is a
trademark of Arduino SA; this project is not affiliated with or endorsed by
Arduino.

## The team

Sriman Panchangam, Shivang Patel, Advait Chandrakar, and Abhinav Ramireddy.
