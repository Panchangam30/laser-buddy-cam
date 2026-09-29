import { useEffect, useState } from "react";
import {
  calibrate, cancelCalibration, laserConnect, laserOff, laserStatus, pointAtLocation,
  NO_LASER, type LaserStatus,
} from "../lib/laser";
import { isTargetable, locationLabel, type WorkspaceLocation } from "../lib/workspace";

/**
 * Controls for the pan/tilt laser.
 *
 * Three states, and the panel only ever offers the one action that makes sense:
 * not plugged in, plugged in but not calibrated, and ready to point. Calibration
 * is the step people skip, so until it has been done nothing else is offered.
 */
export function LaserPanel({ targets, why, tracking, boardFound, worldFrame, onStartTracking }: {
  targets: WorkspaceLocation[];
  why: string;
  tracking: boolean;
  boardFound: boolean;
  worldFrame: number;
  onStartTracking: () => void;
}) {
  const [s, setS] = useState<LaserStatus>(NO_LASER);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [calibrationQueuedAfter, setCalibrationQueuedAfter] = useState<number | null>(null);

  const cal = s.calibration;

  // Poll quickly while calibrating so the sweep's progress is visible, slowly
  // otherwise -- the rest of the time nothing changes without a click.
  useEffect(() => {
    let stop = false;
    const poll = async () => {
      try {
        const next = await laserStatus();
        if (!stop) setS(next);
      } catch {
        /* the vision service is down; its own panel already says so */
      }
    };
    poll();
    const id = window.setInterval(poll, cal.running ? 700 : 4000);
    return () => { stop = true; window.clearInterval(id); };
  }, [cal.running]);

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label); setErr("");
    try {
      const r = (await fn()) as { ok?: boolean; error?: string };
      if (r && r.ok === false && r.error) setErr(r.error);
      setS(await laserStatus());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  // Recalibration needs a frame captured after tracking starts. A previous
  // calibration left both a valid-looking world and a cached frame behind, so
  // accepting either one made the button appear to do nothing: the calibration
  // worker started, waited for a new frame that never came, then failed later.
  useEffect(() => {
    if (calibrationQueuedAfter === null || !tracking || !boardFound
        || worldFrame <= calibrationQueuedAfter || busy) return;
    setCalibrationQueuedAfter(null);
    void run("calibrate", calibrate);
  }, [calibrationQueuedAfter, tracking, boardFound, worldFrame, busy]);

  function startCalibration() {
    setErr("");
    if (!tracking || !boardFound) {
      setCalibrationQueuedAfter(worldFrame);
      if (!tracking) onStartTracking();
      return;
    }
    void run("calibrate", calibrate);
  }

  const target = targets[0];
  const targetLabel = target ? locationLabel(target) : "";
  const canTarget = Boolean(target && isTargetable(target));

  return (
    <section className="laser">
      <h3>Laser</h3>

      {!s.connected ? (
        <>
          <div className="trackbar">
            <button className="trackbtn" disabled={!!busy}
                    onClick={() => run("connect", laserConnect)}>
              <span className="dot" />
              {busy === "connect" ? "Connecting…" : "Connect"}
            </button>
          </div>
          <p className="hint">
            {s.portAvailable
              ? `Found an Arduino on ${s.portAvailable}.`
              : "No Arduino found — check the USB cable."}
          </p>
        </>
      ) : (
        <>
          <div className="trackbar">
            <button className={`trackbtn ${s.laserOn ? "on" : ""}`}
                    disabled={!!busy || !cal.ready || !canTarget}
                    onClick={() => run("point", () => pointAtLocation(target))}
                    title={!cal.ready ? "Calibrate first"
                           : !target ? "Nothing to point at yet"
                           : !canTarget ? "This workspace only supports regional guidance"
                           : `Point at ${targetLabel}`}>
              <span className={`dot ${s.laserOn ? "live" : ""}`} />
              {target ? `Point at ${targetLabel}` : "Nothing to point at"}
            </button>
            {s.laserOn && (
              <button className="ghostbtn" onClick={() => run("off", laserOff)}>
                Laser off
              </button>
            )}
          </div>

          {target && why && <p className="hint">Pointing at {why}.</p>}

          {cal.running ? (
            <>
              <p className="hint">
                {cal.progress || "calibrating…"}
                {cal.total > 0 && ` · ${cal.done}/${cal.total}`}
              </p>
              <div className="calbar">
                <span style={{ width: `${cal.total ? (cal.done / cal.total) * 100 : 0}%` }} />
              </div>
              <button className="ghostbtn" onClick={() => run("cancel", cancelCalibration)}>
                Stop
              </button>
            </>
          ) : (
            <div className="trackbar">
              <button className="ghostbtn"
                      disabled={!!busy || calibrationQueuedAfter !== null}
                      onClick={startCalibration}>
                {calibrationQueuedAfter !== null ? "Finding board…"
                  : busy === "calibrate" ? "Starting…"
                  : cal.ready ? "Recalibrate" : "Calibrate"}
              </button>
              <span className="hint" style={{ margin: 0 }}>
                {calibrationQueuedAfter !== null
                  ? "Board tracking is starting automatically"
                  : !tracking
                    ? "Tracking will start automatically"
                    : !boardFound
                      ? "Keep the whole breadboard in view"
                : cal.ready
                  ? `${cal.quality}${cal.rmsMm !== null ? `, ${cal.rmsMm.toFixed(1)} mm off` : ""}`
                  : "Not calibrated yet"}
              </span>
            </div>
          )}

          {!cal.ready && !cal.running && calibrationQueuedAfter === null && (
            <p className="hint">Needs board tracking on. Takes about a minute.</p>
          )}
        </>
      )}

      {(err || s.error || cal.error) && (
        <p className="error">{err || s.error || cal.error}</p>
      )}
    </section>
  );
}
