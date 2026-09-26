import type { Plan } from "./types";

export async function requestPlan(imageDataUrl: string): Promise<Plan> {
  const r = await fetch("/api/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: imageDataUrl }),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(body.detail || body.error || `HTTP ${r.status}`);
  return body as Plan;
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
