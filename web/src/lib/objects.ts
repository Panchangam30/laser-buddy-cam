/**
 * Object mode: anything on the desk, not just a breadboard.
 *
 * Mirrors vision/objects.py. The vision model names what is in view and gives a
 * rough box; OpenCV follows each box between identifications; the laser aims
 * at a box's centre through a camera-pixel calibration and then corrects itself
 * by watching where the dot actually landed.
 */

export interface SceneObject {
  id: string;
  label: string;
  detail: string;
  confidence: "high" | "medium" | "low";
  /** x, y, width, height in frame pixels. */
  box: [number, number, number, number];
  centre: [number, number];
  /** "near left", "in the middle" -- position in words. */
  where: string;
  /** False when the tracker has lost it since the last identification. */
  tracking: boolean;
  ageS: number;
  /** "yolo": followed every frame. "llm": named by the language model, not tracked yet. */
  source?: "yolo" | "llm";
}

export interface Scene {
  mode: "objects";
  at: number;
  frame: number;
  size: [number, number];
  objects: SceneObject[];
  scene: string;
  detecting: boolean;
  error: string;
  summary: string;
  tracker?: "yolo-world" | "loading" | "unavailable";
  /** The service is aiming or calibrating and wants frames as fast as possible. */
  fast?: boolean;
}

export const EMPTY_SCENE: Scene = {
  mode: "objects", at: 0, frame: 0, size: [0, 0], objects: [], scene: "",
  detecting: false, error: "", summary: "Nothing seen yet.",
};

export type TrackMode = "objects" | "board";

async function call<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`/api/vision/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok && !("ok" in data)) throw new Error(data.detail || data.error || `HTTP ${r.status}`);
  return data as T;
}

/** `capturedAt` is when the frame was grabbed (seconds since epoch): the laser
 *  calibration needs to know which pictures show the beam on and which off. */
export const analyseObjects = (image: string, capturedAt?: number) =>
  call<Scene>("objects/analyze", { image, capturedAt });
/** The tracker's current view, when the service reads the camera itself. */
export const getScene = () => call<Scene>("objects");
/** Identify right now and wait for the answer -- for "what do you see?". */
export const detectObjects = (image?: string | null) =>
  call<Scene>("objects/detect", image ? { image } : {});
export const resetObjects = () => call<{ ok: boolean }>("objects/reset", {});

export interface PointResult {
  ok: boolean;
  error?: string;
  label?: string;
  object?: string;
  /** How far the dot ended up from the object's centre, in pixels. */
  missPx?: number | null;
  /** False when the dot could not be seen, so the aim was not corrected. */
  seen?: boolean;
  warning?: string;
  /** Set when the target's position is only the vision model's rough guess. */
  note?: string;
  /** The camera's verdict: was the dot seen inside the target after aiming. */
  onTarget?: boolean;
  /** Where the camera saw the dot end up, in words. */
  landed?: string;
}

export const pointAtObject = (object: string) => call<PointResult>("objects/point", { object });
export const followObject = (object: string) => call<PointResult>("objects/follow", { object });
export const unfollowObject = () => call<{ ok: boolean }>("objects/unfollow", {});
export const calibratePixels = () => call<{ ok: boolean; error?: string }>("laser/calibrate", { mode: "pixels" });
