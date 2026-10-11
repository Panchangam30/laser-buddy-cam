import { useEffect, useState } from "react";
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

/** The camera frame with every tracked box drawn on it, from the service. */
export function ObjectView({ live, scene }: { live: boolean; scene: Scene }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() =>
      setSrc(`/api/vision/debug.jpg?view=objects&t=${Date.now()}`), 500);
    return () => window.clearInterval(id);
  }, [live]);

  return (
    <div className="objectview">
      {live && src ? <img src={src} alt="What the camera sees, with tracked objects boxed" />
        : <p className="hint">Press <b>Track objects</b> to see what the camera sees.</p>}
      {live && <p className="hint">{scene.objects.length
        ? `${scene.objects.length} object${scene.objects.length === 1 ? "" : "s"} tracked`
        : scene.detecting ? "Looking…" : "No objects yet"}</p>}
    </div>
  );
}
