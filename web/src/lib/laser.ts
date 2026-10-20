import type { WorkspaceLocation } from "./workspace";

/**
 * The pan/tilt laser head.
 *
 * The board map and the laser are calibrated against each other through the
 * camera (see vision/aim.py), so "point at E20" is a real instruction here --
 * the service already knows which servo angles put the dot in that hole.
 */

export interface Calibration {
  ready: boolean;
  running: boolean;
  progress: string;
  error: string;
  done: number;
  total: number;
  samples: number;
  /** How far the dot lands from where it was aimed, in millimetres. */
  rmsMm: number | null;
  /** Object-mode calibration reports its miss in camera pixels instead. */
  rmsPx?: number | null;
  checked: number;
  at: number;
  /** The same number said in holes, which is the unit that matters. */
  quality: string;
  /** Manual calibration points so far: [pan, tilt, u, v]. */
  manual?: [number, number, number, number][];
  /** How well the points fit the model, in pixels. */
  fitPx?: number | null;
  workspaceProfileId?: string;
  workspaceProfileVersion?: number;
}

export interface LaserStatus {
  connected: boolean;
  port: string | null;
  pan: number;
  tilt: number;
  laserOn: boolean;
  error: string;
  /** The hole it is currently pointing at, if any. */
  aimedAt: string;
  calibration: Calibration;
  /** The board-free camera-pixel calibration used in object mode. */
  pixelCalibration?: Calibration;
  /** Which way the arrows turn the head on this rig. */
  prefs?: LaserPrefs;
  /** Id of the object the beam is following, or "". */
  following?: string;
  /** A serial port that looks like the Arduino, whether or not we are on it. */
  portAvailable: string | null;
}

export const NO_LASER: LaserStatus = {
  connected: false, port: null, pan: 90, tilt: 90, laserOn: false, error: "",
  aimedAt: "", portAvailable: null,
  calibration: {
    ready: false, running: false, progress: "", error: "", done: 0, total: 0,
    samples: 0, rmsMm: null, checked: 0, at: 0, quality: "not calibrated",
  },
};

async function call(path: string, body?: unknown): Promise<any> {
  const r = await fetch(`/api/vision/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok && !("ok" in data)) {
    throw new Error(data.detail || data.error || `HTTP ${r.status}`);
  }
  return data;
}

export const laserStatus = (): Promise<LaserStatus> => call("laser");
export const laserConnect = (port?: string) => call("laser/connect", port ? { port } : {});
export const laserDisconnect = () => call("laser/disconnect", {});
export const laserOff = () => call("laser/off", {});
export const laserCentre = () => call("laser/centre", {});
export const calibrate = () => call("laser/calibrate", {});
export const cancelCalibration = () => call("laser/cancel", {});

export type Direction = "left" | "right" | "up" | "down";
export type NudgeSize = "fine" | "tiny" | "small" | "medium" | "large";

export interface MoveResult {
  ok: boolean;
  error?: string;
  pan?: number;
  tilt?: number;
  movedBy?: number;
  /** True when an axis is against its stop and further nudges will do nothing. */
  atLimit?: boolean;
  /** Plain-language explanation when a move was stopped by a limit. */
  limit?: string;
  laserOn?: boolean;
  /** Where the camera saw the dot after the move, in words; "" if not seen. */
  landed?: string;
}

/** Absolute aim. Either axis may be omitted to leave it where it is. */
export const moveLaser = (pan?: number, tilt?: number): Promise<MoveResult> =>
  call("laser/move", { pan, tilt });

/** Relative move in a spoken direction -- what voice control mostly uses. */
export const nudgeLaser = (direction: Direction, amount: NudgeSize = "small"): Promise<MoveResult> =>
  call("laser/nudge", { direction, amount });

export const setLaserPower = (on: boolean): Promise<MoveResult> =>
  call("laser/power", { on });

/** Aim at a hole, e.g. "E20". Returns {ok} and an error when it cannot. */
export const pointAt = (hole: string): Promise<{ ok: boolean; error?: string; hole?: string }> =>
  call("laser/point", { hole });

/** Aim at a capability-checked workspace target. */
export const pointAtLocation = (
  target: WorkspaceLocation,
): Promise<{
  ok: boolean; error?: string; hole?: string;
  /** Camera verdict; null when the aim was blind and could not be checked. */
  onTarget?: boolean | null;
  landed?: string;
}> => {
  // Send the scoped target and its legacy coordinates together. Current vision
  // services use `target`; an already-running service from before the workspace
  // migration ignores it and falls back to `hole` or x/z instead of returning
  // the confusing "supply a hole" error.
  if (target.ref.kind === "anchor") {
    return call("laser/point", { target, hole: target.ref.anchorId });
  }
  if (target.ref.kind === "metric") {
    return call("laser/point", { target, x: target.ref.xMm, z: target.ref.zMm });
  }
  return call("laser/point", { target });
};

export interface LaserPrefs { invertPan: boolean; invertTilt: boolean; ok?: boolean; error?: string }
export const setLaserPrefs = (prefs: Partial<LaserPrefs>): Promise<LaserPrefs> => call("laser/prefs", prefs);

export interface FindLaserResult {
  ok: boolean;
  error?: string;
  found?: boolean;
  /** Camera pixel of the dot, when it was seen. */
  dot?: [number, number] | null;
  /** What it is on or next to, e.g. "on the phone (obj2), near left in the picture". */
  where?: string;
  /** One sentence for the assistant to work from. */
  summary?: string;
  why?: string;
}

/**
 * Find the dot by blinking the laser and differencing, the same detector manual
 * calibration uses. Leaves the beam on.
 */
export const findLaser = (): Promise<FindLaserResult> => call("laser/find", {});

/* Manual calibration: aim by hand, mark the dot, repeat, finish. */
export const manualDetect = (): Promise<{ ok: boolean; error?: string; dot: [number, number] | null; why?: string }> =>
  call("laser/manual/detect", {});
/** Record where the head points now. Without u/v the dot is found automatically. */
export const manualAdd = (u?: number, v?: number): Promise<{ ok: boolean; error?: string; count?: number }> =>
  call("laser/manual/add", u === undefined ? {} : { u, v });
export const manualUndo = () => call("laser/manual/undo", {});
export const manualClear = () => call("laser/manual/clear", {});
export const manualFinish = (refine: boolean): Promise<{
  ok: boolean; error?: string; fitPx?: number; points?: number; note?: string; refining?: boolean;
}> => call("laser/manual/finish", { refine });
export const calibrateAuto = () => call("laser/calibrate", { mode: "pixels" });
