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
  checked: number;
  at: number;
  /** The same number said in holes, which is the unit that matters. */
  quality: string;
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
export type NudgeSize = "tiny" | "small" | "medium" | "large";

export interface MoveResult {
  ok: boolean;
  error?: string;
  pan?: number;
  tilt?: number;
  movedBy?: number;
  /** True when an axis is against its stop and further nudges will do nothing. */
  atLimit?: boolean;
  laserOn?: boolean;
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
