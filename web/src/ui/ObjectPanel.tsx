import { useState } from "react";
import type { Scene } from "../lib/objects";
import { followObject, pointAtObject, unfollowObject } from "../lib/objects";

/**
 * "On the desk": everything the camera is tracking right now, each with a
 * button to put the laser on it. Tracking itself is always on -- there is no
 * start button -- so this is a live view, not a control.
 */
export function DeskList({ scene, error, down, onLook }: {
  scene: Scene;
  error: string;
  down: boolean;
  onLook: () => void;
}) {
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [following, setFollowing] = useState("");

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

  const tracked = scene.objects.filter((o) => o.tracking || o.source === "llm");
  const live = scene.frame > 0 && !down;

  return (
    <section className="tracker desk">
      <h3 className="cardhead">On the desk
        {live && <span className={`livechip ${tracked.length ? "" : "wait"}`}>
          {scene.tracker === "loading" ? "Loading" : tracked.length ? `Live · ${tracked.length}` : "Watching"}
        </span>}
      </h3>

      {down ? <p className="hint">The vision service is not running.</p>
        : !live ? <p className="hint">Waiting for the camera…</p>
        : !tracked.length ? <p className="hint">{scene.detecting ? "Looking at the desk…"
            : "Nothing in view yet — put something on the desk."}</p>
        : (
        <ul className="objlist">
          {tracked.map((o) => (
            <li key={o.id} className={o.tracking ? "" : "lost"}>
              <span className="objname" title={[o.detail, o.where].filter(Boolean).join(" · ")}>
                {o.label}
              </span>
              <button className="pillbtn" disabled={!!busy}
                onClick={() => act(o.id, () => pointAtObject(o.id), `Pointing at ${o.label}`)}>
                {busy === o.id ? "…" : "Point"}
              </button>
              {following === o.id ? (
                <button className="pillbtn on" onClick={async () => {
                  await unfollowObject(); setFollowing("");
                }}>Stop</button>
              ) : (
                <button className="pillbtn" disabled={!!busy || !o.tracking}
                  onClick={async () => {
                    if (await act(o.id, () => followObject(o.id), `Following ${o.label}`)) setFollowing(o.id);
                  }}>Follow</button>
              )}
            </li>
          ))}
        </ul>
      )}

      {live && (
        <button className="ghostbtn desk-look" onClick={onLook} disabled={scene.detecting}>
          {scene.detecting ? "Looking…" : "Look again"}
        </button>
      )}
      {msg && <p className="hint">{msg}</p>}
      {(error || scene.error) && <p className="error">{error || scene.error}</p>}
    </section>
  );
}
