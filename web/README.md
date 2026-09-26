# Bench Assembly (web)

Point the camera at parts laid out on a bench. The app works out a circuit you
can build from them, renders it in 3D on a breadboard, and walks you through
assembly step by step with spoken narration.

## Run it

    cd web
    npm install     # first time only
    npm run dev

Open http://localhost:5173. Two processes start: the Vite dev server and the API
server on :8787.

## Why there is a server at all

The browser never sees your API keys. Every model call goes through
`server/index.ts`, which reads the same `../.env` the Python CLI uses. Putting
`OPENAI_API_KEY` in frontend code would expose it to anyone who opens devtools.

| Endpoint | Does |
|---|---|
| `GET  /api/health` | reports which keys are configured |
| `POST /api/plan`   | photo -> assembly plan (OpenAI vision) |
| `POST /api/speak`  | step text -> mp3 (xAI Grok TTS) |
| `POST /api/realtime-token` | short-lived OpenAI token (only if VOICE_PROVIDER=openai) |
| `POST /api/xai-realtime-token` | short-lived xAI token for a Grok voice session |

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
