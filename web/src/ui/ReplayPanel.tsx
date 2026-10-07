import { useEffect, useState } from "react";
import type { BuildSnapshot } from "../lib/types";

export function ReplayPanel({ snapshots, selected, onSelect, onClose }: {
  snapshots: BuildSnapshot[]; selected: number | null;
  onSelect: (index: number | null) => void; onClose: () => void;
}) {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  useEffect(() => {
    if (!playing || selected === null) return;
    if (selected >= snapshots.length - 1) { setPlaying(false); return; }
    const timer = window.setTimeout(() => onSelect(selected + 1), 1500 / speed);
    return () => window.clearTimeout(timer);
  }, [playing, selected, snapshots.length, speed, onSelect]);
  const snapshot = selected === null ? null : snapshots[selected];
  return <aside className="replay-panel" aria-label="Build replay">
    <header><div><span>BUILD TIMELINE</span><strong>{snapshot ? "Viewing a recorded board" : "Live board"}</strong></div><button onClick={onClose} aria-label="Close build replay">×</button></header>
    {!snapshots.length ? <p>Turn on board tracking to record your build. A change is saved after three consistent observations. Camera images are never saved.</p> : <>
      <div className="replay-actions">
        <button onClick={() => { if (!playing && (selected === null || selected === snapshots.length - 1)) onSelect(0); setPlaying(!playing); }}>{playing ? "Pause replay" : "Play replay"}</button>
        <button disabled={selected === null || selected === 0} onClick={() => { setPlaying(false); onSelect((selected ?? 1) - 1); }}>Previous snapshot</button>
        <button disabled={selected === null || selected >= snapshots.length - 1} onClick={() => { setPlaying(false); onSelect((selected ?? -1) + 1); }}>Next snapshot</button>
        <button onClick={() => { setPlaying(false); onSelect(null); }}>Return to live</button>
        <label>Speed <select aria-label="Replay speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option></select></label>
      </div>
      <input type="range" aria-label="Build timeline" min={0} max={snapshots.length - 1} value={selected ?? snapshots.length - 1} onChange={(e) => { setPlaying(false); onSelect(Number(e.target.value)); }} />
      {snapshot && <div className="replay-summary"><strong>{snapshot.summary}</strong><span>{new Date(snapshot.at).toLocaleTimeString()} · Step {snapshot.step} · {selected! + 1} / {snapshots.length}</span><p>{snapshot.world.issues.length ? snapshot.world.issues.map((i) => i.message).join(" · ") : "No wiring issues reported in this snapshot."}</p></div>}
      <ol>{snapshots.map((item, index) => <li key={item.id}><button className={selected === index ? "on" : ""} onClick={() => { setPlaying(false); onSelect(index); }}><time>{new Date(item.at).toLocaleTimeString()}</time><span>{item.summary}</span>{item.world.issues.some((i) => i.severity === "error") && <b>Fault</b>}</button></li>)}</ol>
      <p>Latest 300 changes retained. Export the project JSON to share the replay. Playback follows saved changes, not real elapsed time.</p>
    </>}
  </aside>;
}
