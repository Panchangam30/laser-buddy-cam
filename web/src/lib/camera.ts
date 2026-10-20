/**
 * Who owns the webcam.
 *
 * Normally the vision service reads it itself (vision/camera.py), so the laser's
 * camera checks never depend on this tab staying visible, and the page only
 * shows the service's stream. The browser's own camera is the fallback, used
 * when the service is set to leave the camera alone or cannot be reached.
 */

export type CameraSource = "unknown" | "service" | "browser";

export interface CameraStatus {
  /** Frames are arriving at the service right now. */
  owned: boolean;
  /** The service has handed the camera to the browser. */
  browser?: boolean;
  index?: number;
  size?: [number, number];
  fps?: number;
  error?: string;
}

async function post(body: unknown): Promise<unknown> {
  const r = await fetch("/api/vision/camera", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json().catch(() => ({}));
}

export async function cameraStatus(): Promise<CameraStatus> {
  const r = await fetch("/api/vision/camera");
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as CameraStatus;
}

/** The service moves on to the next camera that opens. */
export const nextCamera = () => post({ next: true });
/** The service reads the camera (the last one it used). */
export const serviceCamera = () => post({});
/** Hand the camera back to this tab. */
export const browserCamera = () => post({ browser: true });

/** The live view, with a cache-buster so a reconnect really reconnects. */
export const streamUrl = (n: number) => `/api/vision/stream.mjpg?c=${n}`;
