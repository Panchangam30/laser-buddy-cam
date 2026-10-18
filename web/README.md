# Bench Assembly (web)

Point the camera at parts laid out on a bench. The app works out a circuit you
can build from them, renders it in 3D on a breadboard, and walks you through
assembly step by step with spoken narration.

## Run it

    cd web
    npm install     # first time only
    npm run dev

Open http://localhost:5173. Three processes start: Vite on :5173, the Node API
on :8787, and the Python vision service on :8788. Create the root `.venv` first.
See [SETUP.md](../SETUP.md) for prerequisites, a web-only start, Windows commands,
and instructions for the optional camera, keys, and laser rig.

## Why there is a server at all

The browser never sees your API keys. Every model call goes through
`server/index.ts`, which reads the same `../.env` the Python CLI uses. Putting
`OPENAI_API_KEY` in frontend code would expose it to anyone who opens devtools.

| Endpoint | Does |
|---|---|
| `GET  /api/health` | reports which keys are configured |
| `POST /api/plan`   | photo -> assembly plan (OpenAI vision) |
| `POST /api/sketch/review` | sketch and question -> structured LLM feedback (Groq) |
| `POST /api/speak`  | step text -> mp3 (xAI Grok TTS) |
| `POST /api/realtime-token` | short-lived OpenAI token (only if VOICE_PROVIDER=openai) |
| `POST /api/xai-realtime-token` | short-lived xAI token for a Grok voice session |

## Local plan notes

In breadboard **Plan** view, use **Note** and click the plan to place a sticky.
Type directly in the note, drag its header to move it, or use the color button
to cycle yellow, blue, and pink. **Arrow** lets you drag between locations;
arrow ends snap to nearby rendered parts and follow those parts when the view
rotates. A note's arrow button connects that note to a part or location.

**Hide notes / Show notes** remains available in the plan toolbar and remembers
the setting for each project. Double-click a note to delete it and its attached
arrows; **Undo** restores the last annotation action. Arrows can also be selected
and deleted with the toolbar, double-click, or Delete/Backspace. Escape cancels
placing or drawing. Notes record the assembly step where they were created.

Annotations save only to this browser's local storage per project. They are
separate from project JSON/share links and are never sent for LLM feedback.
Part-attached arrows are hidden when their target is absent from the current
step; free arrows remain fixed to the view. The app reports storage failures
while keeping annotations editable for the session.

## Sketch Studio

Open **Code editor** in the circuit guide. Local checks explain common Arduino
patterns and work without a key. **Library** contains 53 starter sketches: the
50 authored tutorial projects plus three basic examples. Search by project or
part, filter by category, and select **Explain** for setup notes, expected
behavior, parts, and source code. **Use sketch** loads a copy after replacement
confirmation; it does not change the circuit plan or original project artifact.

The **LLM feedback** tab reviews the current sketch and an optional goal/question.
Set `GROQ_API_KEY` in the repository-root `.env` and restart the Node API with
`npm run dev:api`. The endpoint uses `GROQ_CODE_MODEL` when set, otherwise
`openai/gpt-oss-120b` hosted by Groq. The selected model must support Groq's
[strict structured outputs](https://console.groq.com/docs/structured-outputs).
No key is sent to or stored by the browser. The sketch, question, and project
title are sent to Groq only when you request LLM feedback. This code-review
feature uses a Groq key independently of the vision and voice providers.

Reviews include a summary, line-linked explanations and issues, suggested next
steps, and an optional revised sketch. **Use suggestion** requires confirmation.
Editing code or the question invalidates old feedback. Review calls can be
canceled and time out after 60 seconds. Missing-key, quota, provider, and invalid
output errors are shown without replacing the draft. Drafts stay in this browser
per project and can be downloaded as `.ino`; drafts are separate from project
JSON exports. Neither local nor LLM review compiles, executes, or uploads code.

## Talking to it

"Talk to the TA" opens a live voice session with **Grok** (`wss://api.x.ai/v1/realtime`). It
knows the current plan and which step you are on, and it can act:

| Tool | What it does |
|---|---|
| `goto_step` | moves the 3D view to the step it is talking about |
| `look_at_board` | takes a webcam photo and actually looks before answering |
| `rescan_bench` | rebuilds the plan when you change the parts |

Grok's realtime API is WebSocket-only, so `src/lib/audio.ts` owns the audio
path: mic capture through an AudioWorklet, 16-bit PCM at 24kHz, and a playback
scheduler for the audio coming back. Echo cancellation comes from
`getUserMedia` rather than WebRTC's integrated AEC -- **wear headphones**, or
it may hear itself through the speakers and interrupt its own sentences.

Grok voice sessions accept no image input, so `look_at_board` describes the
frame out-of-band (through the same vision call the scanner uses) and hands the
description back as the tool result.

Set `VOICE_PROVIDER=openai` in `.env` to switch to OpenAI Realtime over WebRTC
instead; both implement the same `VoiceSession` interface in `src/lib/voice.ts`.

Step narration (Grok TTS) switches off automatically while a voice session is
live, or the two talk over each other. There is a text box if the lab is loud.

## How the 3D stays accurate

A breadboard is a fixed grid: 2.54mm pitch, rows A-J, columns 1-63. So the model
never invents coordinates -- it names a hole (`"E12"`) and `src/lib/breadboard.ts`
derives the exact position. That is the whole trick, and it is why parts land on
real holes instead of floating approximately.

Endpoints that are not on the board -- an Arduino pin, a battery lead -- are
written `EXT:Arduino D13` and anchored just off the front edge.

## Layout

    server/index.ts       API, holds the keys
    server/prompt.ts      the vision prompt and its hard rules
    src/lib/breadboard.ts hole -> 3D position, electrical nets
    src/lib/types.ts      the schema the model fills in
    src/three/            Breadboard, Parts, Scene
    src/ui/CameraPanel    webcam capture
