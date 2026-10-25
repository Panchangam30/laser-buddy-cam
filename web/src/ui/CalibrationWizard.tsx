import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  calibrateAuto, laserStatus, manualAdd, manualClear, manualDetect, manualFinish, manualUndo,
  nudgeLaser, setLaserPower, setLaserPrefs, NO_LASER, type Direction, type LaserStatus,
} from "../lib/laser";

/**
 * Manual laser calibration.
 *
 * You steer the beam onto the desk with the arrows, mark where the dot is
 * (found automatically by blinking the laser, or by clicking on it), and repeat
 * at spots spread over the area you care about. Six points pin the model down;
 * an optional refine then adds more automatically -- only inside the area you
 * marked, so it never wanders up a wall.
 */
/** Where to put points: corners and middle first, then the edge midpoints. */
const GUIDES: [number, number][] = [
  [0.12, 0.14], [0.88, 0.14], [0.12, 0.86], [0.88, 0.86], [0.5, 0.5],
  [0.5, 0.14], [0.5, 0.86], [0.12, 0.5], [0.88, 0.5],
];
const MIN_POINTS = 5;

export function CalibrationWizard({ frameSize, onClose }: {
  /** Pixel size of the frames the vision service sees, for mapping clicks. */
  frameSize: [number, number];
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [s, setS] = useState<LaserStatus>(NO_LASER);
  const [stepSize, setStepSize] = useState<"fine" | "tiny" | "small" | "medium">("small");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [marked, setMarked] = useState<[number, number] | null>(null);
  const [refine, setRefine] = useState(true);
  const [camErr, setCamErr] = useState("");
  /** Cache-busted URL of the detector's last view, shown after a look. */
  const [dotView, setDotView] = useState("");
  const showDetector = () => setDotView(`/api/vision/laser/dot.jpg?t=${Date.now()}`);

  const refresh = useCallback(async () => {
    try { setS(await laserStatus()); } catch { /* service down: shown elsewhere */ }
  }, []);

  useEffect(() => {
    let stream: MediaStream | null = null;
    navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } } })
      .then((st) => { stream = st; if (videoRef.current) videoRef.current.srcObject = st; })
      .catch((e) => setCamErr(`Camera unavailable: ${e?.message ?? e}`));
    void refresh();
    // The beam on is what makes this usable: you are steering what you can see.
    void setLaserPower(true).then(refresh);
    return () => { stream?.getTracks().forEach((t) => t.stop()); };
  }, [refresh]);

  const cal = s.pixelCalibration;
  const points = cal?.manual ?? [];
  const running = Boolean(cal?.running);

  // Poll while an automatic pass runs, so its progress shows.
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(refresh, 700);
    return () => window.clearInterval(t);
  }, [running, refresh]);

  async function act<T extends { ok?: boolean; error?: string }>(label: string, fn: () => Promise<T>) {
    setBusy(label); setErr(""); setMsg("");
    try {
      const r = await fn();
      if (r && r.ok === false && r.error) setErr(r.error);
      await refresh();
      return r;
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy("");
    }
  }

  const stepRef = useRef(stepSize); stepRef.current = stepSize;
  const move = useCallback(async (dir: Direction) => {
    setMarked(null);
    const r = await nudgeLaser(dir, stepSize).catch(() => null);
    setErr(r?.limit ?? "");
    void refresh();
  }, [stepSize, refresh]);

  // Keyboard arrows steer; shift for bigger steps.
  useEffect(() => {
    const key: Record<string, Direction> = {
      ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      const d = key[e.key];
      if (!d || (e.target as HTMLElement)?.tagName === "INPUT") return;
      e.preventDefault();
      setMarked(null);
      void nudgeLaser(d, e.shiftKey ? "medium" : e.altKey ? "fine" : stepRef.current)
        .then((r) => { setErr(r?.limit ?? ""); return refresh(); }).catch(() => null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, refresh]);

  function clickImage(e: React.MouseEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const u = ((e.clientX - r.left) / r.width) * frameSize[0];
    const v = ((e.clientY - r.top) / r.height) * frameSize[1];
    setMarked([Math.round(u), Math.round(v)]);
    setMsg("Marked. Press Add point to use this spot.");
  }

  async function find() {
    const r = await act("find", manualDetect);
    showDetector();
    if (r?.ok) {
      if (r.dot) { setMarked(r.dot); setMsg("Found the dot. Press Add point if the ring is on it."); }
      else setErr(`I could not see the dot${r.why ? ` (${r.why})` : ""}. Click on it in the picture.`);
    }
  }

  async function add() {
    const r = await act("add", () => marked ? manualAdd(marked[0], marked[1]) : manualAdd());
    if (!marked) showDetector();
    if (r?.ok) {
      setMarked(null);
      const n = r.count ?? points.length + 1;
      setMsg(n < MIN_POINTS ? `Point ${n} added. Move to the next circle and add another.`
        : n < 9 ? `Point ${n} added. You can finish now; the edge midpoints make it more robust.`
        : `Point ${n} added. That is plenty — finish when ready.`);
    }
  }

  async function finish() {
    const r = await act("finish", () => manualFinish(refine));
    if (r?.ok) {
      setMsg(`Calibrated from ${r.points} points (${r.fitPx} px fit).`
        + (r.note ? ` ${r.note}` : "") + (r.refining ? " Adding more points automatically…" : ""));
    }
  }

  const prefs = s.prefs ?? { invertPan: false, invertTilt: false };
  const [fw, fh] = frameSize[0] ? frameSize : [16, 9];
  const done = cal?.ready && !running && cal.at > 0;

  // Rendered at page level, so it does not pick up the sidebar's styles.
  return createPortal(
    <div className="calwiz-backdrop" role="dialog" aria-modal="true" aria-label="Calibrate the laser">
      <div className="calwiz">
        <header className="calwiz-head">
          <div>
            <h2>Calibrate the laser</h2>
            <p>Steer the dot onto the desk and mark it at each target circle: the four corners
              and the middle at least, the edge midpoints too for the best accuracy. Keep points a
              little inside the picture's edge.</p>
          </div>
          <button className="calwiz-close" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="calwiz-body">
          <div className="calwiz-view" onClick={clickImage} style={{ aspectRatio: `${fw} / ${fh}` }}
            title="Click on the laser dot to mark it">
            <video ref={videoRef} autoPlay muted playsInline />
            <svg viewBox={`0 0 ${fw} ${fh}`} preserveAspectRatio="none" aria-hidden="true">
              {GUIDES.map(([gx, gy], i) => {
                const x = gx * fw, y = gy * fh;
                const hit = points.some(([, , u, v]) => Math.hypot(u - x, v - y) < fw * 0.13);
                return <circle key={`g${i}`} className={`calguide ${hit ? "hit" : ""} ${i < 5 ? "key" : ""}`}
                  cx={x} cy={y} r={fw * 0.035} />;
              })}
              {points.map(([, , u, v], i) => (
                <g key={i} className="calpt">
                  <circle cx={u} cy={v} r={13} />
                  <text x={u} y={v + 5}>{i + 1}</text>
                </g>
              ))}
              {marked && <circle className="calmark" cx={marked[0]} cy={marked[1]} r={18} />}
            </svg>
            {camErr && <p className="calwiz-camerr">{camErr}</p>}
          </div>
          {dotView && (
            <figure className="calwiz-dot">
              <img src={dotView} alt="What the laser-dot detector saw" onError={() => setDotView("")} />
              <figcaption>What the detector saw: bright = changed when the laser blinked.
                Green ring = the dot it picked; blue cross = where it expected it.</figcaption>
            </figure>
          )}

          <aside className="calwiz-side">
            <div className="calwiz-section">
              <span className="calwiz-label">1 · Steer</span>
              <div className="dpad">
                <button className="up" onClick={() => move("up")} aria-label="Up">↑</button>
                <button className="left" onClick={() => move("left")} aria-label="Left">←</button>
                <button className="right" onClick={() => move("right")} aria-label="Right">→</button>
                <button className="down" onClick={() => move("down")} aria-label="Down">↓</button>
              </div>
              <div className="seg">
                {([["fine", "Fine", "1°"], ["tiny", "Small", "2°"], ["small", "Normal", "5°"], ["medium", "Big", "12°"]] as const)
                  .map(([k, label, deg]) => (
                    <button key={k} className={stepSize === k ? "on" : ""} onClick={() => setStepSize(k)}
                      title={`${deg} per press`}>{label}</button>
                  ))}
              </div>
              <p className="calwiz-hint">Keyboard arrows use the size selected above; hold Shift for
                Big, Alt for Fine.</p>
              <div className="calwiz-flips">
                <label><input type="checkbox" checked={prefs.invertTilt}
                  onChange={(e) => act("prefs", () => setLaserPrefs({ invertTilt: e.target.checked }))} />
                  Flip up/down</label>
                <label><input type="checkbox" checked={prefs.invertPan}
                  onChange={(e) => act("prefs", () => setLaserPrefs({ invertPan: e.target.checked }))} />
                  Flip left/right</label>
              </div>
              <p className="calwiz-hint">If ↓ moves the dot up, tick Flip up/down. Buddy's
                "move it down" follows the same setting.</p>
            </div>

            <div className="calwiz-section">
              <span className="calwiz-label">2 · Mark the dot</span>
              <div className="calwiz-row">
                <button className="pill ghost" onClick={find} disabled={!!busy || running}>
                  {busy === "find" ? "Looking…" : "Find dot"}</button>
                <button className="pill" onClick={add} disabled={!!busy || running}>
                  {busy === "add" ? "Adding…" : "Add point"}</button>
              </div>
              <p className="calwiz-hint">Add point finds the dot by blinking the laser. If it picks
                the wrong spot, click the dot in the picture first.</p>
              <div className="calwiz-row">
                <span className="calwiz-count">{points.length} point{points.length === 1 ? "" : "s"}</span>
                <button className="pill ghost sm" onClick={() => act("undo", manualUndo)}
                  disabled={!points.length || !!busy || running}>Undo</button>
                <button className="pill ghost sm" onClick={() => act("clear", manualClear)}
                  disabled={!points.length || !!busy || running}>Clear</button>
              </div>
            </div>

            <div className="calwiz-section">
              <span className="calwiz-label">3 · Finish</span>
              <label className="calwiz-check"><input type="checkbox" checked={refine}
                onChange={(e) => setRefine(e.target.checked)} />
                Then add more points automatically</label>
              <button className="pill wide" onClick={finish}
                disabled={points.length < MIN_POINTS || !!busy || running}>
                {points.length < MIN_POINTS ? `Add ${MIN_POINTS - points.length} more point${MIN_POINTS - points.length === 1 ? "" : "s"}`
                  : busy === "finish" ? "Fitting…" : "Finish calibration"}
              </button>
              <button className="pill ghost wide" onClick={() => act("auto", calibrateAuto)}
                disabled={!!busy || running}
                title="Searches downward from where the head is aimed now">
                Auto-calibrate from here
              </button>
            </div>

            {running && (
              <div className="calwiz-progress">
                <span>{cal?.progress || "working…"}</span>
                <div className="calbar"><span style={{ width: `${cal?.done ?? 0}%` }} /></div>
              </div>
            )}
            {done && (
              <p className="calwiz-ok">
                Calibrated: {cal?.quality}{cal?.rmsPx != null ? `, about ${Math.round(cal.rmsPx)} px off` : ""}.
              </p>
            )}
            {msg && <p className="calwiz-msg">{msg}</p>}
            {(err || cal?.error) && <p className="calwiz-err">{err || cal?.error}</p>}
            <span className="calwiz-pose">pan {s.pan} · tilt {s.tilt}</span>
          </aside>
        </div>
      </div>
    </div>,
    document.body,
  );
}
