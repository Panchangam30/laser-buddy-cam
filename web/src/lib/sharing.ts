import { createProject, normalizeProject } from "./plans";
import type { Project } from "./types";

export const MAX_PROJECT_BYTES = 10_000_000;
const MAX_BYTES = MAX_PROJECT_BYTES;
const MAX_LINK_LENGTH = 32_000;

export function exportProject(project: Project): string {
  const json = JSON.stringify({ format: "laser-buddy-project", version: 1, project }, null, 2);
  if (new TextEncoder().encode(json).length > MAX_BYTES) throw new Error("Project exceeds the 10 MB sharing limit.");
  return json;
}

/** Imports always receive a new local identity; existing projects are never overwritten. */
export function importProject(json: string): Project {
  if (new TextEncoder().encode(json).length > MAX_BYTES) throw new Error("Project files must be smaller than 10 MB.");
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { throw new Error("This file is not valid JSON."); }
  if (!raw || typeof raw !== "object") throw new Error("This is not a Laser Buddy project.");
  const envelope = raw as Record<string, unknown>;
  if (envelope.format !== "laser-buddy-project" || envelope.version !== 1) {
    throw new Error("Unsupported project file. Choose a JSON export from Laser Buddy.");
  }
  const project = normalizeProject(envelope.project);
  if (!project.plan.source || !["builtin", "photo", "goal", "challenge"].includes(project.plan.source.kind)) {
    throw new Error("The project contains an invalid plan source.");
  }
  if (project.plan.requirements.some((r) => !r || typeof r.id !== "string" || typeof r.label !== "string" || !Number.isFinite(r.count)
    || !["seen", "confirmed", "unknown", "missing"].includes(r.availability))) {
    throw new Error("The project contains invalid required parts.");
  }
  if (project.plan.warnings.some((w) => !w || typeof w.message !== "string" || !["error", "warn", "info"].includes(w.severity))) {
    throw new Error("The project contains invalid warnings.");
  }
  if (project.plan.artifacts?.some((a) => !a || typeof a.id !== "string" || typeof a.title !== "string" || typeof a.content !== "string")) {
    throw new Error("The project contains invalid code or notes.");
  }
  return { ...project, id: createProject(project.plan).id, updatedAt: new Date().toISOString() };
}

export function downloadProject(project: Project): void {
  const url = URL.createObjectURL(new Blob([exportProject(project)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${project.name.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 80) || "project"}.laser-buddy.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function projectShareLink(project: Project): Promise<string> {
  if (typeof CompressionStream === "undefined") throw new Error("This browser cannot create share links. Export JSON instead.");
  const stream = new Blob([exportProject(project)]).stream().pipeThrough(new CompressionStream("gzip"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  const encoded = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const url = new URL("/", window.location.origin);
  url.hash = `project=v1.${encoded}`;
  if (url.href.length > MAX_LINK_LENGTH) throw new Error("This project is too large for a reliable link. Export JSON instead.");
  return url.href;
}

export async function projectFromLink(hash: string): Promise<Project | null> {
  if (!hash.startsWith("#project=")) return null;
  const payload = hash.slice("#project=".length);
  if (!payload.startsWith("v1.") || payload.length > MAX_LINK_LENGTH) throw new Error("Unsupported or oversized project link.");
  if (typeof DecompressionStream === "undefined") throw new Error("This browser cannot open share links. Ask for a JSON export instead.");
  try {
    const binary = atob(payload.slice(3).replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")).getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > MAX_BYTES) { await reader.cancel(); throw new Error("Project exceeds the 10 MB limit."); }
      chunks.push(next.value);
    }
    const output = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
    return importProject(new TextDecoder().decode(output));
  } catch (error) {
    throw new Error(`Could not open shared project: ${error instanceof Error ? error.message : "invalid link"}`);
  }
}
