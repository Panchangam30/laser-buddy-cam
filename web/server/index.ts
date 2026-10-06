import express from "express";
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PLAN_PROMPT } from "./prompt.js";
import { planForGoal } from "./goalPlans.js";
import { validatePlanShape } from "./validatePlan.js";

// Reuse the same .env the Python CLI uses -- one place for both keys.
const here = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(here, "../../.env") });

const app = express();
app.use(express.json({ limit: "12mb" }));

const OPENAI_KEY = process.env.OPENAI_API_KEY ?? "";
const XAI_KEY = process.env.XAI_API_KEY ?? "";
const MODEL = process.env.OPENAI_MODEL || "gpt-4o";
const VOICE = process.env.XAI_VOICE_ID || "atlas";
const REALTIME_MODEL = process.env.REALTIME_MODEL || "gpt-realtime-2.1";
const REALTIME_VOICE = process.env.REALTIME_VOICE || "marin";
const GROK_VOICE_MODEL = process.env.GROK_VOICE_MODEL || "grok-voice-latest";
const VOICE_PROVIDER = (process.env.VOICE_PROVIDER || "grok").toLowerCase();
const VISION_URL = process.env.VISION_URL || "http://127.0.0.1:8788";
const MAX_GOAL_LENGTH = 500;

app.get("/api/health", async (_req, res) => {
  res.json({
    openai: OPENAI_KEY ? "configured" : "missing",
    xai: XAI_KEY ? "configured" : "missing",
    model: MODEL, voice: VOICE, realtimeModel: REALTIME_MODEL,
    voiceProvider: VOICE_PROVIDER, grokVoiceModel: GROK_VOICE_MODEL,
    vision: await visionHealth(),
  });
});

/** Is the Python vision service up? Reported so the UI can say so plainly. */
async function visionHealth(): Promise<string> {
  try {
    const r = await fetch(`${VISION_URL}/vision/health`, {
      signal: AbortSignal.timeout(1200),
    });
    return r.ok ? "running" : `error ${r.status}`;
  } catch {
    return "not running";
  }
}

/**
 * Everything under /api/vision goes to the Python service.
 *
 * Proxied rather than called directly from the browser so the whole app is one
 * origin: the camera frames are already flowing through here, and a second
 * origin would need its own CORS and its own failure mode in the UI.
 */
app.use("/api/vision", async (req, res) => {
  const target = `${VISION_URL}/vision${req.url}`;
  try {
    const r = await fetch(target, {
      method: req.method,
      headers: req.method === "GET" ? {} : { "Content-Type": "application/json" },
      body: req.method === "GET" ? undefined : JSON.stringify(req.body ?? {}),
      // A frame takes ~30 ms to analyse; anything near this is a hung service.
      signal: AbortSignal.timeout(15_000),
    });
    const type = r.headers.get("Content-Type") ?? "application/json";
    res.status(r.status).setHeader("Content-Type", type);
    // The debug view is a JPEG, so this has to pass bytes through, not JSON.
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    const offline = e instanceof Error
      && (e.name === "TimeoutError" || e.message.includes("fetch failed"));
    res.status(offline ? 503 : 500).json({
      error: offline
        ? "the vision service is not running"
        : String(e),
      detail: offline
        ? "Start it with:  .venv/bin/python -m vision.service"
        : undefined,
    });
  }
});

/** Photo of the bench -> assembly plan. */
app.post("/api/plan", async (req, res) => {
  const { image } = req.body as { image?: string };
  if (!image) return res.status(400).json({ error: "no image supplied" });
  if (!OPENAI_KEY) return res.status(500).json({ error: "OPENAI_API_KEY missing from .env" });

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2500,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: PLAN_PROMPT },
          { role: "user", content: [
            { type: "text", text: "What can I build with these? Reply as JSON." },
            { type: "image_url", image_url: { url: image, detail: "high" } },
          ]},
        ],
      }),
    });

    if (!r.ok) {
      const body = await r.text();
      return res.status(r.status).json({ error: `OpenAI ${r.status}`, detail: body.slice(0, 400) });
    }

    const data = await r.json() as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = data.choices?.[0]?.message?.content ?? "";
    try {
      const parsed = JSON.parse(raw);
      const invalid = validatePlanShape(parsed);
      if (invalid) return res.status(502).json({ error: "model returned an unsafe plan", detail: invalid });
      res.json(parsed);
    } catch {
      res.status(502).json({ error: "model did not return valid JSON", detail: raw.slice(0, 400) });
    }
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/** Named goal -> a validated, deterministic plan. */
app.post("/api/plan/goal", (req, res) => {
  const goal = typeof req.body?.goal === "string"
    ? req.body.goal.trim().replace(/\s+/g, " ") : "";
  if (!goal) return res.status(400).json({ error: "Describe what you want to build." });
  if (goal.length > MAX_GOAL_LENGTH) {
    return res.status(400).json({
      error: `Keep the project goal under ${MAX_GOAL_LENGTH} characters.`,
    });
  }
  const result = planForGoal(goal);
  if (!result) {
    return res.status(422).json({
      error: "That goal is not in the verified project catalog yet.",
      detail: "Try “make a servo sweep on a button press”. Unsupported goals are refused instead of receiving invented wiring.",
    });
  }
  const invalid = validatePlanShape(result.plan);
  if (invalid) return res.status(500).json({ error: "verified template failed validation", detail: invalid });
  res.json(result.plan);
});

/** Step text -> spoken audio, via Grok TTS. Returns mp3 bytes. */
app.post("/api/speak", async (req, res) => {
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text) return res.status(400).json({ error: "no text" });
  if (!XAI_KEY) return res.status(503).json({ error: "XAI_API_KEY missing -- narration disabled" });

  try {
    const r = await fetch("https://api.x.ai/v1/tts", {
      method: "POST",
      headers: { Authorization: `Bearer ${XAI_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        text: text.slice(0, 450), voice_id: VOICE, language: "en",
        speed: Number(process.env.TTS_SPEED ?? 1.1),
      }),
    });
    if (!r.ok) {
      return res.status(r.status).json({ error: `xAI ${r.status}`, detail: (await r.text()).slice(0, 300) });
    }
    res.setHeader("Content-Type", "audio/mpeg");
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/**
 * Mint a short-lived token so the browser can open a Realtime session directly.
 * The real API key never leaves this process.
 */
app.post("/api/realtime-token", async (req, res) => {
  if (!OPENAI_KEY) return res.status(500).json({ error: "OPENAI_API_KEY missing from .env" });
  const { instructions, tools } = req.body as { instructions?: string; tools?: unknown[] };

  try {
    const r = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model: REALTIME_MODEL,
          instructions,
          tools,
          tool_choice: "auto",
          audio: { output: { voice: REALTIME_VOICE } },
        },
      }),
    });
    const body = await r.text();
    if (!r.ok) return res.status(r.status).json({ error: `OpenAI ${r.status}`, detail: body.slice(0, 400) });

    const data = JSON.parse(body);
    const token = data?.value ?? data?.client_secret?.value;
    if (!token) return res.status(502).json({ error: "no token in response", detail: body.slice(0, 300) });
    res.json({ token, model: REALTIME_MODEL });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/** Short-lived xAI token so the browser can open a Grok voice session. */
app.post("/api/xai-realtime-token", async (_req, res) => {
  if (!XAI_KEY) return res.status(500).json({ error: "XAI_API_KEY missing from .env" });
  try {
    const r = await fetch("https://api.x.ai/v1/realtime/client_secrets", {
      method: "POST",
      headers: { Authorization: `Bearer ${XAI_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ expires_after: { seconds: 600 } }),
    });
    const body = await r.text();
    if (!r.ok) return res.status(r.status).json({ error: `xAI ${r.status}`, detail: body.slice(0, 400) });
    const data = JSON.parse(body);
    if (!data?.value) return res.status(502).json({ error: "no token in response", detail: body.slice(0, 300) });
    res.json({ token: data.value, expiresAt: data.expires_at, model: GROK_VOICE_MODEL, voice: VOICE });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

const PORT = Number(process.env.API_PORT ?? 8787);
app.listen(PORT, () => console.log(`api listening on http://localhost:${PORT}`));
