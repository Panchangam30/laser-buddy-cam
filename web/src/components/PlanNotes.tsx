import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { ArrowUpRight, Eye, EyeOff, GripVertical, StickyNote, Undo2, X } from "lucide-react";
import {
  annotationKey, clampUnit, nearestAnnotationTarget, readAnnotations, removePlanNote,
  type AnnotationSceneBridge, type AnnotationTarget, type NotePoint, type PlanAnnotations, type PlanArrow, type PlanNote,
} from "../lib/annotations";
import "./PlanNotes.css";

const NOTE_WIDTH = 184;
const NOTE_HEIGHT = 152;
const COLORS: PlanNote["color"][] = ["yellow", "blue", "pink"];
type DraftArrow = { start: PlanArrow["start"]; end: PlanArrow["end"] };

export function PlanNotes({ projectId, step, bridge }: {
  projectId: string; step: number; bridge: RefObject<AnnotationSceneBridge | null>;
}) {
  const [doc, setDoc] = useState(() => readAnnotations(projectId));
  const [history, setHistory] = useState<PlanAnnotations[]>([]);
  const [tool, setTool] = useState<"select" | "note" | "arrow">("select");
  const [fromNote, setFromNote] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftArrow | null>(null);
  const [moving, setMoving] = useState<{ id: string; x: number; y: number } | null>(null);
  const [selectedArrow, setSelectedArrow] = useState<string | null>(null);
  const [focusedNote, setFocusedNote] = useState<string | null>(null);
  const [saveError, setSaveError] = useState("");
  const [targets, setTargets] = useState<AnnotationTarget[]>([]);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const layer = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; pointer: number; origin: NotePoint; start: NotePoint; last: NotePoint } | null>(null);
  const drawing = useRef<{ pointer: number; start: PlanArrow["start"]; end: PlanArrow["end"] } | null>(null);
  const marker = `note-arrow-${useId().replace(/:/g, "")}`;
  const visible = doc.visible;
  const hasAnchors = doc.arrows.some((arrow) => arrow.end.targetId);

  useEffect(() => {
    if (!layer.current) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: Math.max(1, entry.contentRect.width), height: Math.max(1, entry.contentRect.height) }));
    observer.observe(layer.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || (tool !== "arrow" && !hasAnchors)) return;
    const refresh = () => {
      const next = bridge.current?.targets() ?? [];
      setTargets((previous) => previous.length === next.length && previous.every((item, index) => item.id === next[index].id && Math.abs(item.x - next[index].x) < .0002 && Math.abs(item.y - next[index].y) < .0002) ? previous : next);
    };
    const timer = window.setInterval(refresh, 80);
    return () => window.clearInterval(timer);
  }, [bridge, visible, tool, hasAnchors]);
  useEffect(() => {
    if (tool === "select") return;
    const cancel = (event: KeyboardEvent) => { if (event.key === "Escape") { setTool("select"); setFromNote(null); setDraft(null); drawing.current = null; } };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [tool]);

  function commit(next: PlanAnnotations, remember = true) {
    if (remember) setHistory((items) => [...items.slice(-29), doc]);
    setDoc(next);
    try { localStorage.setItem(annotationKey(projectId), JSON.stringify(next)); setSaveError(""); }
    catch { setSaveError("Browser storage is unavailable. Notes will last for this session only."); }
  }
  function cancelTool() { setTool("select"); setFromNote(null); setDraft(null); drawing.current = null; }
  function undo() {
    const previous = history.at(-1);
    if (!previous) return;
    commit(previous, false); setHistory((items) => items.slice(0, -1)); cancelTool();
  }
  function removeNote(id: string) { commit(removePlanNote(doc, id)); setFocusedNote(null); }
  function point(event: { clientX: number; clientY: number }): NotePoint {
    const rect = layer.current!.getBoundingClientRect();
    return { x: clampUnit((event.clientX - rect.left) / rect.width), y: clampUnit((event.clientY - rect.top) / rect.height) };
  }
  function notePosition(note: PlanNote): NotePoint {
    const at = moving?.id === note.id ? moving : note;
    return { x: Math.min(at.x * size.width, Math.max(0, size.width - NOTE_WIDTH)), y: Math.min(at.y * size.height, Math.max(0, size.height - NOTE_HEIGHT)) };
  }
  function endAt(at: NotePoint): PlanArrow["end"] {
    const target = nearestAnnotationTarget(at, bridge.current?.targets() ?? [], size);
    return target ? { x: target.x, y: target.y, targetId: target.id, label: target.label } : at;
  }
  function startDrawing(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    const at = point(event);
    if (tool === "note") {
      if (doc.notes.length >= 100) return;
      const id = crypto.randomUUID();
      commit({ ...doc, notes: [...doc.notes, { id, ...at, text: "", color: "yellow", step }] });
      setFocusedNote(id); cancelTool(); return;
    }
    const note = doc.notes.find((item) => item.id === fromNote);
    const start = note ? { x: note.x, y: note.y, noteId: note.id } : at;
    drawing.current = { pointer: event.pointerId, start, end: endAt(at) };
    setDraft(drawing.current);
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveDrawing(event: ReactPointerEvent<HTMLDivElement>) {
    if (!drawing.current || drawing.current.pointer !== event.pointerId) return;
    drawing.current.end = endAt(point(event));
    setDraft({ ...drawing.current });
  }
  function finishDrawing(event: ReactPointerEvent<HTMLDivElement>) {
    if (!drawing.current || drawing.current.pointer !== event.pointerId) return;
    const current = drawing.current;
    const end = endAt(point(event));
    if (current.start.noteId || Math.hypot((end.x - current.start.x) * size.width, (end.y - current.start.y) * size.height) > 8) {
      if (doc.arrows.length < 200) commit({ ...doc, arrows: [...doc.arrows, { id: crypto.randomUUID(), start: current.start, end }] });
      cancelTool();
    } else { drawing.current = null; setDraft(null); }
  }
  function startDrag(event: ReactPointerEvent<HTMLDivElement>, note: PlanNote) {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    event.preventDefault(); event.stopPropagation();
    const at = notePosition(note);
    const origin = { x: at.x / size.width, y: at.y / size.height };
    drag.current = { id: note.id, pointer: event.pointerId, origin, start: point(event), last: origin };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    const at = point(event);
    const x = Math.max(0, Math.min(Math.max(0, 1 - NOTE_WIDTH / size.width), current.origin.x + at.x - current.start.x));
    const y = Math.max(0, Math.min(Math.max(0, 1 - NOTE_HEIGHT / size.height), current.origin.y + at.y - current.start.y));
    current.last = { x, y };
    setMoving({ id: current.id, x, y });
  }
  function finishDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    if (Math.abs(current.last.x - current.origin.x) + Math.abs(current.last.y - current.origin.y) > .002) commit({ ...doc, notes: doc.notes.map((note) => note.id === current.id ? { ...note, ...current.last } : note) });
    drag.current = null; setMoving(null);
  }
  function arrowPoints(arrow: DraftArrow) {
    const anchor = arrow.end.targetId ? targets.find((target) => target.id === arrow.end.targetId) : null;
    if (arrow.end.targetId && !anchor) return null;
    const end = { x: (anchor ?? arrow.end).x * size.width, y: (anchor ?? arrow.end).y * size.height };
    const note = arrow.start.noteId ? doc.notes.find((item) => item.id === arrow.start.noteId) : null;
    const at = note ? notePosition(note) : null;
    const start = at ? { x: at.x + (end.x < at.x + NOTE_WIDTH / 2 ? 0 : NOTE_WIDTH), y: at.y + NOTE_HEIGHT / 2 } : { x: arrow.start.x * size.width, y: arrow.start.y * size.height };
    return { start, end, path: `M ${start.x} ${start.y} L ${end.x} ${end.y}` };
  }

  return <>
    <div className="plan-notes-controls" role="toolbar" aria-label="Plan annotations">
      <button aria-label="Add sticky note" aria-pressed={tool === "note"} disabled={doc.notes.length >= 100} onClick={() => { if (!visible) commit({ ...doc, visible: true }, false); setTool(tool === "note" ? "select" : "note"); setFromNote(null); setSelectedArrow(null); }}><StickyNote size={14} />Note</button>
      <button aria-label="Draw arrow" aria-pressed={tool === "arrow"} disabled={doc.arrows.length >= 200} onClick={() => { if (!visible) commit({ ...doc, visible: true }, false); setTool(tool === "arrow" ? "select" : "arrow"); setFromNote(null); setSelectedArrow(null); }}><ArrowUpRight size={15} />Arrow</button>
      <button aria-label={visible ? "Hide notes" : "Show notes"} aria-pressed={!visible} onClick={() => { commit({ ...doc, visible: !visible }, false); cancelTool(); }}>{visible ? <EyeOff size={14} /> : <Eye size={14} />}{visible ? "Hide notes" : "Show notes"}</button>
      <button aria-label="Undo annotation change" title="Undo annotation change" disabled={!history.length} onClick={undo}><Undo2 size={14} /></button>
      {selectedArrow && <button aria-label="Delete selected arrow" onClick={() => { commit({ ...doc, arrows: doc.arrows.filter((arrow) => arrow.id !== selectedArrow) }); setSelectedArrow(null); }}><X size={14} /></button>}
    </div>
    {(tool !== "select" || saveError) && <p className="plan-notes-help" role="status">{saveError || (tool === "note" ? "Click the plan to place a note. Esc cancels." : fromNote ? "Click a part or location to connect this note. Esc cancels." : "Drag to draw an arrow. Ends snap to nearby parts. Esc cancels.")}</p>}
    <div ref={layer} className={`plan-annotations ${tool !== "select" ? "annotating" : ""}`} data-testid="plan-annotations" aria-label="Local plan notes">
      {visible && <>
        {tool !== "select" && <div className="annotation-capture" data-testid="annotation-capture" onPointerDown={startDrawing} onPointerMove={moveDrawing} onPointerUp={finishDrawing} onPointerCancel={() => { drawing.current = null; setDraft(null); }} />}
        <svg className="annotation-arrows" viewBox={`0 0 ${size.width} ${size.height}`} aria-label="Annotation arrows">
          <defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="10" markerHeight="10" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" /></marker></defs>
          {doc.arrows.map((arrow) => {
            const points = arrowPoints(arrow);
            if (!points) return null;
            return <g key={arrow.id} data-testid="annotation-arrow" data-target-id={arrow.end.targetId} className={selectedArrow === arrow.id ? "selected" : ""} role="button" tabIndex={tool === "select" ? 0 : -1} aria-label={arrow.end.label ? `Arrow to ${arrow.end.label}` : "Plan arrow"} onClick={() => setSelectedArrow(arrow.id)} onDoubleClick={() => commit({ ...doc, arrows: doc.arrows.filter((item) => item.id !== arrow.id) })} onKeyDown={(event) => { if (event.key === "Enter") setSelectedArrow(arrow.id); if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); event.stopPropagation(); commit({ ...doc, arrows: doc.arrows.filter((item) => item.id !== arrow.id) }); } }}>
              <title>{arrow.end.label ? `Points to ${arrow.end.label}. ` : ""}Double-click to delete arrow.</title><path className="arrow-hit" d={points.path} /><path className="arrow-line" d={points.path} markerEnd={`url(#${marker})`} />
            </g>;
          })}
          {draft && (() => { const points = arrowPoints(draft); return points ? <path className="arrow-line draft" d={points.path} markerEnd={`url(#${marker})`} /> : null; })()}
          {tool === "arrow" && targets.map((target) => <circle key={target.id} data-testid="annotation-target" data-target-id={target.id} cx={target.x * size.width} cy={target.y * size.height} r="6" className="annotation-target"><title>{target.label}</title></circle>)}
        </svg>
        {doc.notes.map((note, index) => {
          const at = notePosition(note);
          return <article className={`plan-sticky ${note.color}`} key={note.id} data-testid="plan-sticky" data-note-id={note.id} style={{ left: at.x, top: at.y }} aria-label={`Sticky note ${index + 1}`} tabIndex={0} onDoubleClick={() => removeNote(note.id)} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Delete" || event.key === "Backspace")) { event.preventDefault(); event.stopPropagation(); removeNote(note.id); } }}>
            <div className="plan-sticky-header" onPointerDown={(event) => startDrag(event, note)} onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={() => { drag.current = null; setMoving(null); }} title="Drag to move this note"><GripVertical size={13} /><span>Note {index + 1}</span><button aria-label={`Connect note ${index + 1} with an arrow`} onClick={() => { setFromNote(note.id); setTool("arrow"); setFocusedNote(null); }}><ArrowUpRight size={14} /></button><button className="note-color" aria-label={`Change note ${index + 1} color`} title="Change note color" onClick={() => commit({ ...doc, notes: doc.notes.map((item) => item.id === note.id ? { ...item, color: COLORS[(COLORS.indexOf(item.color) + 1) % COLORS.length] } : item) })} /><button aria-label={`Delete note ${index + 1}`} onClick={() => removeNote(note.id)}><X size={13} /></button></div>
            <textarea aria-label={`Note ${index + 1} text`} placeholder="Leave a thought…" maxLength={3000} value={note.text} autoFocus={focusedNote === note.id} onFocus={() => setFocusedNote(note.id)} onChange={(event) => commit({ ...doc, notes: doc.notes.map((item) => item.id === note.id ? { ...item, text: event.target.value } : item) }, false)} />
            <footer><span>Step {note.step}</span><span>Double-click to delete</span></footer>
          </article>;
        })}
      </>}
    </div>
  </>;
}
