export interface NotePoint { x: number; y: number }
export interface PlanNote extends NotePoint { id: string; text: string; color: "yellow" | "blue" | "pink"; step: number }
export interface PlanArrow {
  id: string;
  start: NotePoint & { noteId?: string };
  end: NotePoint & { targetId?: string; label?: string };
}
export interface PlanAnnotations { version: 1; visible: boolean; notes: PlanNote[]; arrows: PlanArrow[] }
export interface AnnotationTarget extends NotePoint { id: string; label: string }
export interface AnnotationSceneBridge { targets: () => AnnotationTarget[] }
export const EMPTY_ANNOTATIONS: PlanAnnotations = { version: 1, visible: true, notes: [], arrows: [] };
export const annotationKey = (projectId: string) => `laser-buddy:annotations:v1:${projectId}`;
export const clampUnit = (value: number) => Math.max(0, Math.min(1, value));

export function parseAnnotations(value: unknown): PlanAnnotations {
  if (!value || typeof value !== "object") return EMPTY_ANNOTATIONS;
  const row = value as Record<string, unknown>;
  if (row.version !== 1) return EMPTY_ANNOTATIONS;
  const object = (item: unknown): item is Record<string, unknown> => Boolean(item) && typeof item === "object";
  const point = (item: unknown): item is Record<string, unknown> & NotePoint => object(item) && typeof item.x === "number" && Number.isFinite(item.x) && typeof item.y === "number" && Number.isFinite(item.y);
  const id = (s: unknown): s is string => typeof s === "string" && s.length > 0 && s.length <= 150;
  const seenNotes = new Set<string>();
  const notes: PlanNote[] = (Array.isArray(row.notes) ? row.notes : []).slice(0, 100).flatMap((item) => {
    if (!point(item) || !id(item.id) || seenNotes.has(item.id) || typeof item.text !== "string" || !["yellow", "blue", "pink"].includes(String(item.color))) return [];
    seenNotes.add(item.id);
    return [{ id: item.id, x: clampUnit(item.x), y: clampUnit(item.y), text: item.text.slice(0, 3000), color: item.color as PlanNote["color"], step: typeof item.step === "number" && Number.isInteger(item.step) && item.step > 0 ? item.step : 1 }];
  });
  const seenArrows = new Set<string>();
  const arrows: PlanArrow[] = (Array.isArray(row.arrows) ? row.arrows : []).slice(0, 200).flatMap((item) => {
    if (!object(item) || !id(item.id) || seenArrows.has(item.id) || !point(item.start) || !point(item.end)) return [];
    if (item.start.noteId !== undefined && (!id(item.start.noteId) || !seenNotes.has(item.start.noteId))) return [];
    seenArrows.add(item.id);
    return [{ id: item.id,
      start: { x: clampUnit(item.start.x), y: clampUnit(item.start.y), ...(id(item.start.noteId) ? { noteId: item.start.noteId } : {}) },
      end: { x: clampUnit(item.end.x), y: clampUnit(item.end.y), ...(id(item.end.targetId) ? { targetId: item.end.targetId } : {}), ...(typeof item.end.label === "string" ? { label: item.end.label.slice(0, 200) } : {}) },
    }];
  });
  return { version: 1, visible: row.visible !== false, notes, arrows };
}

export function readAnnotations(projectId: string): PlanAnnotations {
  try { return parseAnnotations(JSON.parse(localStorage.getItem(annotationKey(projectId)) ?? "null")); }
  catch { return EMPTY_ANNOTATIONS; }
}

export function nearestAnnotationTarget(point: NotePoint, targets: AnnotationTarget[], size: { width: number; height: number }, radius = 24) {
  let closest: AnnotationTarget | null = null;
  let distance = radius;
  for (const target of targets) {
    const next = Math.hypot((point.x - target.x) * size.width, (point.y - target.y) * size.height);
    if (next < distance) { closest = target; distance = next; }
  }
  return closest;
}

export function removePlanNote(doc: PlanAnnotations, id: string): PlanAnnotations {
  return { ...doc, notes: doc.notes.filter((note) => note.id !== id), arrows: doc.arrows.filter((arrow) => arrow.start.noteId !== id) };
}
