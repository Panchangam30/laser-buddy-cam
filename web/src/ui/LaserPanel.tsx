import { useEffect, useState } from "react";
import {
  calibrate, cancelCalibration, laserConnect, laserOff, laserStatus, pointAt,
  NO_LASER, type LaserStatus,
} from "../lib/laser";

/**
 * Controls for the pan/tilt laser.
 *
 * Three states, and the panel only ever offers the one action that makes sense:
 * not plugged in, plugged in but not calibrated, and ready to point. Calibration
 * is the step people skip, so until it has been done nothing else is offered.
 */
export function LaserPanel({ focus, why }: { focus: string[]; why: string }) {
  const [s, setS] = useState<LaserStatus>(NO_LASER);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

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

  const target = focus[0];

  return (
    <section className="laser">
      <h2>Laser pointer</h2>

      {!s.connected ? (
        <>
          <div className="trackbar">
            <button className="trackbtn" disabled={!!busy}
                    onClick={() => run("connect", laserConnect)}>
              <span className="dot" />
              {busy === "connect" ? "Connecting…" : "Connect the laser"}
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
                    disabled={!!busy || !cal.ready || !target}
                    onClick={() => run("point", () => pointAt(target))}
                    title={!cal.ready ? "Calibrate first"
                           : !target ? "Nothing to point at yet" : `Point at ${target}`}>
              <span className={`dot ${s.laserOn ? "live" : ""}`} />
              {target ? `Point at ${target}` : "Nothing to point at"}
            </button>
            {s.laserOn && (
              <button className="ghostbtn" onClick={() => run("off", laserOff)}>
                Laser off
              </button>
            )}
          </div>

          {target && why && <p className="hint">That is {why}.</p>}

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
              <button className="ghostbtn" disabled={!!busy}
                      onClick={() => run("calibrate", calibrate)}>
                {cal.ready ? "Recalibrate" : "Calibrate"}
              </button>
              <span className="hint" style={{ margin: 0 }}>
                {cal.ready
                  ? `${cal.quality}${cal.rmsMm !== null ? ` (${cal.rmsMm.toFixed(1)} mm)` : ""}`
                  : "not calibrated yet"}
              </span>
            </div>
          )}

          {!cal.ready && !cal.running && (
            <p className="hint">
              Calibration sweeps the head across the board and watches where the
              dot lands, so it learns the angles for every hole. Takes about a
              minute, and needs board tracking on.
            </p>
          )}
        </>
      )}

      {(err || s.error || cal.error) && (
        <p className="error">{err || s.error || cal.error}</p>
      )}
    </section>
  );
}
