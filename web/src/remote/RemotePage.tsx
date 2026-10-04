import { useCallback, useEffect, useRef, useState } from "react";
import "./remote.css";

/**
 * The phone remote: one control.
 *
 * It is a targeting reticle rather than a button-shaped button, because the
 * thing it starts is a laser that aims at holes. Pressing it locks the reticle
 * on -- the segmented ring snaps into line, the inner ring closes, and the
 * centre lights up as the dot. That one moment is the whole interface.
 *
 * Amber while armed, red while live: the same two meanings the rest of the app
 * uses, amber for "what to do next" and red for "the beam is on".
 *
 * Start queues a command for the Mac's browser tab, because board tracking runs
 * there where the webcam is, and connects the laser directly. The aim pad and
 * the rest of the controls are at /remote/aim.
 */

/**
 * A frame older than this means tracking has stopped, not merely paused. The
 * Mac sends one roughly every half second, so this is several missed frames --
 * and short enough that pressing Stop is confirmed in a few seconds rather
 * than looking ignored.
 */
const LIVE_WITHIN_S = 3;

/** How long the lock-on sequence runs; the shockwave is timed to it. */
const LOCK_MS = 720;

/**
 * How long to wait for the bench to agree with a press before believing it.
 *
 * The bench lags in both directions. A start has to reach the Mac's browser
 * tab, which polls every two seconds, and then get a frame through; a stop
 * leaves the last frame looking fresh for a few seconds after. Reconciling
 * straight away flipped the button back either way -- Start to Stop to Start,
 * a moment after each press.
 */
const CONFIRM_WITHIN_MS = 9000;

async function post(path: string, body?: unknown) {
  const r = await fetch(`/api/vision/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  return r.json().catch(() => ({}));
}

/** Tick marks round the outer ring: a long one every 30 degrees. */
const TICKS = Array.from({ length: 72 }, (_, i) => {
  const a = (i * 5 - 90) * (Math.PI / 180);
  const major = i % 6 === 0;
  const r1 = major ? 128 : 133;
  const r2 = 140;
  return {
    x1: 150 + r1 * Math.cos(a), y1: 150 + r1 * Math.sin(a),
    x2: 150 + r2 * Math.cos(a), y2: 150 + r2 * Math.sin(a),
    major,
  };
});

/** Circumference of the segmented ring, for its dash pattern. */
const MID_R = 108;
const MID_C = 2 * Math.PI * MID_R;
const SEGMENT = (MID_C * 64) / 360;     // four arcs of 64 degrees
const GAP = (MID_C * 26) / 360;         // with 26-degree gaps

export function RemotePage() {
  const [live, setLive] = useState(false);
  const [locking, setLocking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [problem, setProblem] = useState("");
  /** Shown while a press is waiting for the bench to catch up. State, not a
   *  ref: a ref changing does not redraw, so "Starting" stuck after it went
   *  live. */
  const [phase, setPhase] = useState<"idle" | "starting" | "stopping">("idle");
  const lockTimer = useRef<number | null>(null);
  /** What the last press asked for, and how long to wait for it. */
  const intent = useRef<{ want: boolean; until: number } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const world = await fetch("/api/vision/world").then((r) => r.json());
      setReachable(true);
      // The bench is the authority, not the last tap: start it from the Mac and
      // the phone catches up. Liveness is "a frame arrived recently" -- the
      // frame counter only goes up, so testing it for zero meant Stop forever.
      const fresh = world.at ? Date.now() / 1000 - world.at < LIVE_WITHIN_S : false;
      if (busy) return;
      const asked = intent.current;
      if (asked) {
        if (fresh === asked.want) {                       // the bench agrees
          intent.current = null;
          setPhase("idle");
          setProblem("");
          setLive(fresh);
          return;
        }
        if (Date.now() < asked.until) return;             // not there yet
        // It never caught up. For a start that means nothing picked the
        // command up, which is worth saying -- a silent flip back looks like
        // a button that does not work.
        intent.current = null;
        setPhase("idle");
        if (asked.want) setProblem("Nothing started. Is Laser Buddy open on the Mac?");
      }
      setLive(fresh);
    } catch {
      setReachable(false);
    }
  }, [busy]);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, 2500);
    return () => window.clearInterval(id);
  }, [refresh]);

  useEffect(() => () => {
    if (lockTimer.current !== null) window.clearTimeout(lockTimer.current);
  }, []);

  async function toggle() {
    const next = !live;
    setLive(next);                      // answer the press at once
    setProblem("");
    intent.current = { want: next, until: Date.now() + CONFIRM_WITHIN_MS };
    setPhase(next ? "starting" : "stopping");
    if (next) {
      setLocking(true);
      lockTimer.current = window.setTimeout(() => setLocking(false), LOCK_MS);
    }
    setBusy(true);
    try {
      if (next) {
        await post("remote", { command: "start" });
        await post("laser/connect");
      } else {
        await post("remote", { command: "stop" });
        await post("laser/off");
      }
    } catch {
      setLive(!next);                   // it did not happen; say so
    } finally {
      setBusy(false);
      refresh();
    }
  }

  const down = reachable === false;
  const state = live ? "live" : "armed";

  return (
    <div className={`scope ${state} ${locking ? "locking" : ""}`}>
      <button className="reticle" onClick={toggle} disabled={down}
              aria-pressed={live}
              aria-label={live ? "Stop the bench" : "Start the bench"}>
        <svg viewBox="0 0 300 300" aria-hidden="true">
          <defs>
            <filter id="bloom" x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur stdDeviation="7" result="b" />
              <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <radialGradient id="glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#ff5a4a" stopOpacity=".55" />
              <stop offset="45%" stopColor="#ff5a4a" stopOpacity=".18" />
              <stop offset="100%" stopColor="#ff5a4a" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="dot" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#fff2ef" />
              <stop offset="35%" stopColor="#ff6a5a" />
              <stop offset="100%" stopColor="#c8261a" />
            </radialGradient>
          </defs>

          {/* The shockwave, fired once on lock. */}
          <circle className="shock" cx="150" cy="150" r="108" />

          <g className="ring-outer">
            {TICKS.map((t, i) => (
              <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2}
                    className={t.major ? "tick major" : "tick"} />
            ))}
          </g>

          <circle className="ring-mid" cx="150" cy="150" r={MID_R}
                  strokeDasharray={`${SEGMENT} ${GAP}`} />

          <g className="cross">
            <line x1="150" y1="52" x2="150" y2="74" />
            <line x1="150" y1="226" x2="150" y2="248" />
            <line x1="52" y1="150" x2="74" y2="150" />
            <line x1="226" y1="150" x2="248" y2="150" />
          </g>

          <circle className="ring-inner" cx="150" cy="150" r="70" />

          <circle className="core-halo" cx="150" cy="150" r="30" />
          <circle className="core" cx="150" cy="150" r="8" />
        </svg>

        <span className="reticle-label">{live ? "Stop" : "Start"}</span>
      </button>

      <p className={`scope-status ${problem || down ? "warn" : ""}`} aria-live="polite">
        {down ? "Can’t reach the Mac. Same Wi-Fi?"
          : problem ? problem
          : reachable === null ? "Connecting"
          : phase === "starting" ? "Starting"
          : phase === "stopping" ? "Stopping"
          : live ? "Live" : "Ready"}
      </p>
    </div>
  );
}
