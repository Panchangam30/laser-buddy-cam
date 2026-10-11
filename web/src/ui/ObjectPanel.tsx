import { useEffect, useRef, useState } from "react";
import type { Scene } from "../lib/objects";
import { followObject, pointAtObject, unfollowObject } from "../lib/objects";

/**
 * Object mode's tracker panel: start/stop, and every object it has found with
 * a button to put the laser on it. Mirrors BoardTracker's shape on purpose.
 */
export function ObjectPanel({ scene, tracking, error, down, onToggle, onReset, onLook }: {
  scene: Scene;
  tracking: boolean;
  error: string;
  down: boolean;
  onToggle: () => void;
  onReset: () => void;
  onLook: () => void;
}) {
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [following, setFollowing] = useState("");

  useEffect(() => { if (!tracking) setFollowing(""); }, [tracking]);

  async function act(id: string, fn: () => Promise<{ ok: boolean; error?: string; missPx?: number | null }>,
    done: string) {
    setBusy(id); setMsg("");
    try {
      const r = await fn();
      setMsg(r.ok ? done + (r.missPx != null ? ` (${r.missPx}px off)` : "") : r.error ?? "Failed");
      return r.ok;
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="tracker">
      <h3>Object tracking</h3>
      <div className="trackbar">
        <button className={`trackbtn ${tracking ? "on" : ""}`} onClick={onToggle} disabled={down}>
          <span className={`dot ${tracking ? (scene.objects.length ? "live" : "connecting") : ""}`} />
          {tracking ? "Stop" : "Track objects"}
        </button>
        {tracking && <button className="ghostbtn" onClick={onLook} disabled={scene.detecting}>
          {scene.detecting ? "Looking…" : "Look again"}
        </button>}
        {tracking && <button className="ghostbtn" onClick={onReset}>Reset</button>}
      </div>

      {down && <p className="hint">The vision service is not running.</p>}
      {tracking && !scene.objects.length && (
        <p className="hint">{scene.detecting ? "Identifying what is on the desk…"
          : "Put something in view — a phone, a pencil, a mug."}</p>
      )}
      {scene.scene && <p className="hint">{scene.scene}</p>}

      {scene.objects.length > 0 && (
        <ul className="objlist">
          {scene.objects.map((o) => (
            <li key={o.id} className={o.tracking ? "" : "lost"}>
              <span className="objname" title={o.detail}>
                {o.label}<small> · {o.where}{o.tracking ? "" : " · lost"}</small>
              </span>
              <button className="ghostbtn" disabled={!!busy}
                onClick={() => act(o.id, () => pointAtObject(o.id), `Pointing at ${o.label}`)}>
                {busy === o.id ? "…" : "Point"}
              </button>
              {following === o.id ? (
                <button className="ghostbtn on" onClick={async () => {
                  await unfollowObject(); setFollowing("");
                }}>Stop</button>
              ) : (
                <button className="ghostbtn" disabled={!!busy}
                  onClick={async () => {
                    if (await act(o.id, () => followObject(o.id), `Following ${o.label}`)) setFollowing(o.id);
                  }}>Follow</button>
              )}
            </li>
          ))}
        </ul>
      )}

      {msg && <p className="hint">{msg}</p>}
      {(error || scene.error) && <p className="error">{error || scene.error}</p>}
    </section>
  );
}

/**
 * The live webcam with every tracked object boxed on top.
 *
 * Draws over the browser's own video rather than fetching an annotated JPEG
 * from the service: the picture never depends on the service being fast, and
 * the boxes are just the latest scene in the same pixel space as the frames
 * that were sent (the overlay's viewBox is the frame size).
 */
export function ObjectView({ live, scene, onStart }: {
  live: boolean; scene: Scene; onStart: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState("");
  const [dims, setDims] = useState<[number, number]>([16, 9]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } } })
      .then((s) => {
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }
        stream = s;
        if (videoRef.current) videoRef.current.srcObject = s;
      })
      .catch((e) => setErr(`Camera unavailable: ${e?.message ?? e}`));
    return () => { cancelled = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, []);

  const [w, h] = scene.size[0] ? scene.size : dims;

  return (
    <div className="objectview">
      <div className="objectframe" style={{ aspectRatio: `${dims[0]} / ${dims[1]}` }}>
        <video ref={videoRef} autoPlay muted playsInline
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            if (v.videoWidth) setDims([v.videoWidth, v.videoHeight]);
          }} />
        {live && (
          <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
            {scene.objects.map((o) => {
              const [x, y, bw, bh] = o.box;
              return (
                <g key={o.id} className={o.tracking ? "obj" : "obj lost"}>
                  <rect x={x} y={y} width={bw} height={bh} rx={6} />
                  <text x={x + 6} y={Math.max(18, y - 8)}>{o.label}</text>
                </g>
              );
            })}
          </svg>
        )}
      </div>
      {err ? <p className="error">{err}</p>
        : !live ? <button className="capture" style={{ width: "auto", padding: "10px 22px" }}
            onClick={onStart}>Track objects</button>
        : <p className="hint">{scene.objects.length
            ? `${scene.objects.length} object${scene.objects.length === 1 ? "" : "s"} tracked`
              + (scene.detecting ? " · looking again…" : "")
            : scene.detecting ? "Looking at the desk…" : "No objects yet"}</p>}
    </div>
  );
}
