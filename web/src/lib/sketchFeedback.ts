export interface SketchFeedback {
  summary: string;
  explanation: { line: number | null; text: string }[];
  issues: { line: number | null; severity: "error" | "warning" | "info"; title: string; explanation: string; suggestion: string }[];
  nextSteps: string[];
  suggestedCode: string | null;
}

export const MAX_SKETCH_LENGTH = 40000;
export const MAX_SKETCH_QUESTION = 2000;

export function parseSketchFeedback(value: unknown, lineCount: number): SketchFeedback | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const text = (s: unknown, max = 8000): s is string => typeof s === "string" && s.length <= max;
  const record = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
  const line = (v: unknown) => v === null || (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= lineCount);
  if (!text(item.summary) || !Array.isArray(item.explanation) || item.explanation.length > 16 || !item.explanation.every((row) => record(row) && line(row.line) && text(row.text))
    || !Array.isArray(item.issues) || item.issues.length > 12 || !item.issues.every((row) => record(row) && line(row.line) && ["error", "warning", "info"].includes(String(row.severity)) && text(row.title, 250) && text(row.explanation) && text(row.suggestion))
    || !Array.isArray(item.nextSteps) || item.nextSteps.length > 8 || !item.nextSteps.every((row) => text(row, 2000))
    || !(item.suggestedCode === null || text(item.suggestedCode, MAX_SKETCH_LENGTH))) return null;
  return item as unknown as SketchFeedback;
}
