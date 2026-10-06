import type { Plan } from "./types";
import { normalizePlan } from "./plans";

async function responseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); }
  catch { return text; }
}

function responseError(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const row = body as Record<string, unknown>;
    if (typeof row.detail === "string" && row.detail) return row.detail;
    if (typeof row.error === "string" && row.error) return row.error;
  }
  if (typeof body === "string" && body.trim()) return body.trim().slice(0, 300);
  return `HTTP ${status}`;
}

export async function requestPlan(imageDataUrl: string): Promise<Plan> {
  const r = await fetch("/api/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: imageDataUrl }),
  });
  const body = await responseBody(r);
  if (!r.ok) throw new Error(responseError(body, r.status));
  return normalizePlan(body, { kind: "photo", generatedAt: new Date().toISOString() });
}

export async function requestGoalPlan(goal: string): Promise<Plan> {
  const r = await fetch("/api/plan/goal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ goal }),
  });
  const body = await responseBody(r);
  if (!r.ok) throw new Error(responseError(body, r.status));
  return normalizePlan(body);
}

/** Narrate a step. Silently does nothing if TTS isn't configured. */
export async function speak(text: string, signal?: AbortSignal): Promise<HTMLAudioElement | null> {
  const r = await fetch("/api/speak", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal,
  });
  if (!r.ok) return null;
  const url = URL.createObjectURL(await r.blob());
  const audio = new Audio(url);
  audio.addEventListener("ended", () => URL.revokeObjectURL(url), { once: true });
  await audio.play().catch(() => {});
  return audio;
}

export async function health() {
  try { return await (await fetch("/api/health")).json(); }
  catch { return { openai: "unreachable", xai: "unreachable" }; }
}
