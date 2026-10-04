import { useCallback, useEffect, useRef, useState } from "react";
import "./remote.css";

/**
 * The full remote: bench actions and the aim pad.
 *
 * /remote is now a single Start button and nothing else. This is kept at
 * /remote/aim for when the head needs nudging by hand.
 *
 * Served at /remote and added to an iPhone's Home Screen, where iOS launches it
 * fullscreen with its own icon. A web page rather than a native app because the
 * whole job is sending a handful of commands over the LAN.
 *
 * It deliberately senses nothing. The page loads over plain HTTP from the Mac's
 * LAN address, which iOS will not treat as a secure context, so camera and
 * microphone are unavailable here -- and should be. The Mac has the webcam
 * pointed at the bench; this is a remote, not a second sensor.
 *
 * Two tabs, because the two jobs want opposite layouts: running the bench is a
 * column of labelled actions, aiming is a pad you work by feel without reading.
 * Anything needing the Mac's webcam is queued through /api/vision/remote and
 * collected by the browser tab on the Mac. Laser commands go straight to the
 * service and work whether that tab is open or not.
 */

type Direction = "left" | "right" | "up" | "down";
type Step = "tiny" | "small" | "medium";
type Tab = "bench" | "aim";

type Status = {
  connected: boolean;
  laserOn: boolean;
  pan: number;
  tilt: number;
  tracking: boolean;
  parts: number;
  calibrated: boolean;
};

const EMPTY: Status = {
  connected: false, laserOn: false, pan: 90, tilt: 90,
  tracking: false, parts: 0, calibrated: false,
};

/** Degrees per press, matching the service's own step table. */
const STEP_DEG: Record<Step, number> = { tiny: 2, small: 5, medium: 12 };

/** Held down, the pad glides in fine steps instead of repeating the big one. */
const GLIDE_STEP: Step = "tiny";
const GLIDE_AFTER_MS = 320;
const GLIDE_EVERY_MS = 150;

async function post(path: string, body?: unknown) {
  const r = await fetch(`/api/vision/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  return r.json().catch(() => ({}));
}

export function AimPage() {
  const [tab, setTab] = useState<Tab>("bench");
  const [s, setS] = useState<Status>(EMPTY);
  const [step, setStep] = useState<Step>("small");
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [reachable, setReachable] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [laser, world] = await Promise.all([
        fetch("/api/vision/laser").then((r) => r.json()),
        fetch("/api/vision/world").then((r) => r.json()),
      ]);
      setReachable(true);
      setS({
        connected: !!laser.connected,
        laserOn: !!laser.laserOn,
        pan: laser.pan ?? 90,
        tilt: laser.tilt ?? 90,
        tracking: (world.frame ?? 0) > 0,
        parts: world.entities?.length ?? 0,
        calibrated: !!laser.calibration?.ready,
      });
    } catch {
      setReachable(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, 2500);
    return () => window.clearInterval(id);
  }, [refresh]);

  // --- aiming -------------------------------------------------------------

  const glide = useRef<number | null>(null);
  const delay = useRef<number | null>(null);
  const inFlight = useRef(false);
  const moved = useRef(false);

  const nudge = useCallback(async (direction: Direction, amount: Step) => {
    // One request at a time. A move takes about a quarter of a second end to
    // end, so without this a held key stacks up and the head carries on
    // travelling well after the finger lifts.
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const r = await post("laser/nudge", { direction, amount });
      if (r && typeof r.pan === "number") {
        setS((v) => ({ ...v, pan: r.pan, tilt: r.tilt, connected: true }));
        moved.current = true;
      }
      if (r?.ok === false && r.error) setNote(r.error);
      else if (r?.atLimit) setNote("That axis is at its limit.");
    } catch {
      /* the poll reports the link */
    } finally {
      inFlight.current = false;
    }
  }, []);

  const release = useCallback(() => {
    if (delay.current !== null) window.clearTimeout(delay.current);
    if (glide.current !== null) window.clearInterval(glide.current);
    delay.current = glide.current = null;
  }, []);

  /**
   * Tap gives one step of the size you chose. Hold glides in fine steps.
   *
   * Repeating the chosen step instead made holding "Big" lurch the head twelve
   * degrees at a time; a tap wants to be decisive and a hold wants to be
   * smooth, and they are not the same movement.
   */
  const press = useCallback((direction: Direction) => {
    setNote("");
    nudge(direction, step);
    release();
    delay.current = window.setTimeout(() => {
      glide.current = window.setInterval(
        () => nudge(direction, GLIDE_STEP), GLIDE_EVERY_MS);
    }, GLIDE_AFTER_MS);
  }, [nudge, step, release]);

  useEffect(() => release, [release]);

  // --- everything else ----------------------------------------------------

  async function run(label: string, fn: () => Promise<unknown>, said: string) {
    setBusy(label);
    setNote("");
    try {
      const r = (await fn()) as { ok?: boolean; error?: string };
      setNote(r && r.ok === false && r.error ? r.error : said);
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
      refresh();
    }
  }

  const toggleBeam = () => {
    const next = !s.laserOn;
    setS((v) => ({ ...v, laserOn: next }));      // answer the tap at once
    run("beam", () => post("laser/power", { on: next }),
        next ? "Laser on." : "Laser off.");
  };

  const down = reachable === false;

  return (
    <div className="remote">
      <header>
        <h1>Laser Buddy</h1>
        <p className={`link ${down ? "bad" : ""}`}>
          {reachable === null ? "Connecting…"
            : down ? "Can't reach the Mac. Same Wi-Fi?"
            : tab === "aim"
              ? <>Pan <span className="num">{Math.round(s.pan)}</span>° · Tilt{" "}
                  <span className="num">{Math.round(s.tilt)}</span>°</>
              : "Connected to the bench"}
        </p>
      </header>

      <main>
        {tab === "bench" ? (
          <>
            <button className="go" onClick={() => run("start", async () => {
              await post("remote", { command: "start" });
              return post("laser/connect");
            }, "Started. Check the Mac.")} disabled={!!busy || down}>
              {busy === "start" ? "Starting…" : "Start"}
            </button>

            <div className="readout">
              <div><b>{s.tracking ? "On" : "Off"}</b><span>Tracking</span></div>
              <div><b className="num">{s.parts}</b><span>Parts seen</span></div>
              <div><b>{s.connected ? (s.laserOn ? "On" : "Ready") : "Off"}</b><span>Laser</span></div>
            </div>

            <div className="keys">
              <button onClick={() => run("point", () => post("remote", { command: "point" }),
                                         "Pointing at the next hole.")} disabled={!!busy}>
                Point at next hole
              </button>
              <button onClick={() => run("scan", () => post("remote", { command: "scan" }),
                                         "Scanning the bench.")} disabled={!!busy}>
                Scan the bench
              </button>
              <button onClick={() => run("centre", () => post("laser/centre"), "Centred.")}
                      disabled={!!busy}>
                Centre the head
              </button>
              <button onClick={() => run("stop", () => post("remote", { command: "stop" }),
                                         "Stopped.")} disabled={!!busy}>
                Stop everything
              </button>
            </div>
          </>
        ) : (
          <>
            {/* The beam sits in the middle of the pad because while you are
                aiming it is the control you reach for, and your thumb is
                already there. Centring lives on the Bench tab -- it is a
                tidy-up, not part of aiming. */}
            <div className="pad">
              {([
                ["up", "↑", "Up"], ["left", "←", "Left"],
                ["right", "→", "Right"], ["down", "↓", "Down"],
              ] as [Direction, string, string][]).map(([dir, glyph, label]) => (
                <button key={dir} className={`pad-${dir}`} aria-label={label} disabled={down}
                        onPointerDown={(e) => { e.preventDefault(); press(dir); }}
                        onPointerUp={release} onPointerLeave={release}
                        onPointerCancel={release}>
                  <span aria-hidden="true">{glyph}</span>
                </button>
              ))}
              <button className={`pad-beam ${s.laserOn ? "on" : ""}`} onClick={toggleBeam}
                      disabled={!!busy || down}
                      aria-label={s.laserOn ? "Turn laser off" : "Turn laser on"}>
                <span className="pad-beam-dot" />
                <span className="pad-beam-text">{s.laserOn ? "On" : "Off"}</span>
              </button>
            </div>

            <div className="stepsize" role="group" aria-label="Step size">
              {([["tiny", "Fine"], ["small", "Step"], ["medium", "Big"]] as [Step, string][])
                .map(([v, label]) => (
                  <button key={v} className={step === v ? "on" : ""} onClick={() => setStep(v)}>
                    {label}<small>{STEP_DEG[v]}°</small>
                  </button>
                ))}
            </div>

            <p className="hold-hint">Tap to step. Hold to glide.</p>
          </>
        )}

        {note && <p className="note">{note}</p>}
        {tab === "bench" && s.connected && !s.calibrated && (
          <p className="note quiet">The laser is not calibrated. Do that on the Mac.</p>
        )}
      </main>

      <nav className="tabbar" aria-label="Sections">
        {([["bench", "Bench"], ["aim", "Aim"]] as [Tab, string][]).map(([v, label]) => (
          <button key={v} className={tab === v ? "on" : ""} onClick={() => { release(); setTab(v); }}
                  aria-current={tab === v}>
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
