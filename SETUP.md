# Setting up Laser Buddy

This is how we run the project on our computers. You do not need to build the
laser rig or buy API credits just to try the website. Start with the small
setup below and add the other stuff when you need it.

## 1. Get the website running

You need Git and a supported Node.js version: **20.19.x** or **22.12 or
newer**. (Node.js 21.x is not supported.) Check them in a terminal:

```sh
git --version
node --version
npm --version
```

Then download the project and install the web dependencies:

```sh
git clone https://github.com/Panchangam30/laser-buddy-cam.git
cd laser-buddy-cam/web
npm ci
npm run dev:web
```

Open the local address Vite prints, normally `http://localhost:5173`. Leave the
terminal running. Press Ctrl+C there when you want to stop it.

Camera/voice errors are expected when those services are not running yet.
You can still use the examples and local tools.

## 2. Try a project

1. Click **Projects** in the left panel and pick a tutorial. There are 50, with
   search and category filters.
2. Under **Devices**, choose **Breadboard**, then **Plan**. The app starts in
   desk-object mode, so this switch matters.
3. Use **Next** and **Back** to follow the wiring. Drag to rotate the 3D view
   and scroll to zoom. **Components** opens the starter kit.
4. Use the Arduino IDE to compile and upload the project's sketch, then do its
   manual test. The website's animation is only a behavior preview.

### Code and examples

Click **Code editor** to open Sketch Studio.

- **Library** has 53 starter sketches. **Explain** shows the setup, expected
  behavior, parts, and source code without needing a key.
- **Use sketch** opens a copy after you confirm replacing your current draft.
- **Check & explain** runs the simple local checks. Ctrl+Enter or Cmd+Enter
  does the same thing while you are typing in the editor.
- **LLM feedback** lets you ask a model about your code once Groq is configured.
- **Download .ino** saves a file for the Arduino IDE. If the IDE asks to move it
  into a matching sketch folder, let it do that.

Drafts save in this browser. They do not replace the original tutorial code and
are not included in project JSON exports.

### Notes on the plan

Click **Note**, then click where you want the sticky. Type in it and drag its
header to move it. The small circle changes the color.

Click **Arrow** and drag across the plan to draw. Ends snap to nearby rendered
parts. You can also use the arrow button on a note, then click a part or spot
to connect it. Attached arrows follow the part when you rotate the view.

**Hide notes** becomes **Show notes**, so you can bring everything back.
Double-click a note to delete it; **Undo** restores an accidental deletion.
Escape cancels placing a note or drawing an arrow.

Notes and arrows save locally per project. They are not sent to the model or
included in share links. Clearing this site's browser data deletes them.

## 3. Add keys for the features you want

From the repository root, copy the template:

```sh
cp .env.example .env
```

In Windows PowerShell, use `Copy-Item .env.example .env`. If you already made
`.env`, edit it instead of copying over it. The file belongs next to `README.md`,
not inside `web/`. Replace placeholder keys and leave unused key fields empty.

| Variable | What it is for |
| --- | --- |
| `GROQ_API_KEY` | Code feedback in Sketch Studio |
| `GROQ_CODE_MODEL` | Optional Groq code model; defaults to `openai/gpt-oss-120b` |
| `OPENAI_API_KEY` | Photo planning and AI part/object identification |
| `OPENAI_MODEL` | Vision/planning model |
| `XAI_API_KEY` | Grok voice and spoken narration |
| `VOICE_PROVIDER` | `grok` by default, or `openai` for the alternate voice session |

Groq and Grok sound similar but are different services. A Groq key goes in
`GROQ_API_KEY`; an xAI Grok key goes in `XAI_API_KEY`.

Restart the API after changing `.env`. Do not put keys in React files,
screenshots, or GitHub issues. Git ignores `.env`; `.env.example` is the safe
template we share.

### Start just the API and website

For code feedback you do not need Python. Open two terminals in `web/`:

```sh
# Terminal 1
npm run dev:api
```

```sh
# Terminal 2
npm run dev:web
```

Open **Code editor → LLM feedback** and click **Review with LLM**. It sends the
sketch, optional question, and project title to Groq through the local API.
Suggestions only replace your draft after you choose them and confirm.

## 4. Add the camera service

Install Python 3.12 or newer. From the repository root, on macOS/Linux:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cd web
npm run dev
```

The combined command starts three services:

| Service | Default address |
| --- | --- |
| Website | `http://localhost:5173` |
| Node API | `http://localhost:8787` |
| Python vision service | `http://127.0.0.1:8788` |

On Windows the combined command uses a Unix virtual-environment path, so start
the services separately. From the root, in PowerShell:

```powershell
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m vision.service
```

Leave that running. In two more terminals inside `web/`, run `npm run dev:api`
and `npm run dev:web`. We have not verified a full Windows hardware setup.

Allow camera access in the browser. Choose **Breadboard** in Devices and click
**Track my board**. Geometry can run without AI labels; recognizing the parts
and planning from a photo need the OpenAI key. Choose **Anything on the desk**
for general object tracking instead.

Keep the camera steady and use decent lighting. The board locator supports
the supplied 830-point breadboard profile.

The vision service reads the webcam itself and the app shows its live stream,
so the laser's camera checks keep working when the browser window is hidden or
covered. macOS asks for camera permission for the app that started the service
(your terminal or editor) the first time. If the preview shows the wrong
camera, press **Switch camera** under it; the choice is remembered. **Use
browser camera** hands the webcam back to the page instead (the older path),
and `VISION_CAMERA=<index>` or `VISION_CAMERA=off` sets it from the command
line. Do not open `identify.py` or a standalone Python camera window on the same
webcam at the same time.

## 5. Optional laser rig

You can skip this. The rest of the app works without the rig.

Open `firmware/laserbuddy/laserbuddy.ino` in the Arduino IDE, choose the board
and port, and upload it to the controller for the pan/tilt head. It expects
pan control on D9, tilt on D10, a laser switch on D7, and serial at 115200 baud.
D7 is a switch-control signal: use a suitable driver and supply for your
hardware, not an arbitrary laser load directly on a pin. Exact mechanics and
power wiring depend on your rig.

Start the services, connect the controller, and use the web app's Laser controls.
Calibration needs incoming camera frames. Recalibrate if the camera or head
moves. Keep the beam away from eyes and reflective things.

The phone pages are `/remote` and `/remote/aim` on your running web server.
Use your computer's LAN address and the same reachable web port. The computer
still needs its camera tab and services running. Keep this development setup
on a trusted network instead of exposing it to the internet.

## 6. Save or share a build

**Projects** has JSON export/import and share-link controls. Share links create
a separate copy for whoever opens them. Check what you are sharing because the
link contains the project data.

Exports include the plan, original code artifacts, and progress. They do not
include camera images, voice audio, edited sketch drafts, or plan notes. Use
**Download .ino** for an edited sketch. Back up work before clearing browser
site data.

## If something does not work

- **Missing `.venv/bin/python`:** create the Python environment at the root or
  run the three services separately.
- **Code feedback asks for a key:** check `GROQ_API_KEY` in the root `.env` and
  restart the API. Rejected keys, quota problems, and unsupported models show
  separate errors. Custom Groq models need strict structured-output support.
- **Blank camera:** check browser/OS camera permissions, close other camera
  apps, and use `localhost` on the computer with the webcam.
- **Vision service is not running:** from the root, run
  `.venv/bin/python -m vision.service`, or use the Windows path above.
- **Backwards board:** use the column-1 orientation control.
- **Port already in use:** stop the other copy of the dev server. If Vite picks
  a different port, use the URL it prints.
- **Missing OpenAI/xAI keys:** those are for scanning/voice. Local tools and
  Groq code feedback have their own requirements.

## Checks before a pull request

From `web/`:

```sh
npm run build
npx playwright install chromium
npm test
```

If a dev server already uses port 5173, on macOS/Linux:

```sh
PLAYWRIGHT_PORT=5191 npm test
```

In PowerShell, set `$env:PLAYWRIGHT_PORT="5191"` first, then run `npm test`.
From the repository root, the geometry and fake-head tests do not need a camera:

```sh
.venv/bin/python -m vision.selftest
```

Automated checks do not test a real provider account or your physical rig.
Say what you actually tested when you send a change.
