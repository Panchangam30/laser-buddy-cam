import { useState } from "react";
import type { Project } from "../lib/types";
import { downloadProject, importProject, projectShareLink, MAX_PROJECT_BYTES } from "../lib/sharing";

export function ProjectPanel({ projects, activeId, busy, error, onClose, onOpen,
  onGoal, onExample, onDelete, activeProject, onImport,
}: {
  projects: Project[];
  activeId: string;
  busy: boolean;
  error: string;
  onClose: () => void;
  onOpen: (project: Project) => void;
  onGoal: (goal: string) => Promise<void>;
  onExample: () => void;
  onDelete: (project: Project) => void;
  activeProject: Project;
  onImport: (project: Project) => Promise<void>;
}) {
  const [goal, setGoal] = useState("");
  const [shareError, setShareError] = useState("");
  const [shareLink, setShareLink] = useState("");
  const [shareStatus, setShareStatus] = useState("");
  const [importing, setImporting] = useState(false);

  return (
    <div className="project-scrim" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="project-panel" role="dialog" aria-modal="true" aria-label="Projects">
        <header>
          <div><span className="eyebrow">PROJECT LIBRARY</span><h2>What are you building?</h2></div>
          <button className="closebtn" onClick={onClose} aria-label="Close projects">×</button>
        </header>

        <form className="goal-form" onSubmit={(event) => {
          event.preventDefault();
          const value = goal.trim();
          if (value) void onGoal(value);
        }}>
          <label htmlFor="project-goal">Start from a named goal</label>
          <div>
            <input id="project-goal" value={goal} onChange={(event) => setGoal(event.target.value)}
              placeholder="Make a servo sweep on a button press" disabled={busy} />
            <button disabled={busy || !goal.trim()}>{busy ? "Building…" : "Build plan"}</button>
          </div>
          <p>Goals outside the verified catalog are refused rather than given guessed wiring.</p>
          {error && <p className="error">{error}</p>}
        </form>

        <section className="project-sharing" aria-label="Share project">
          <h3>Take your project with you</h3>
          <p>Includes the plan, code, required parts, progress, and build replay. No account needed.</p>
          <div className="project-sharing-actions">
            <button onClick={() => {
              setShareError("");
              try { downloadProject(activeProject); }
              catch (error) { setShareError(error instanceof Error ? error.message : "Could not export project."); }
            }}>Export JSON</button>
            <label className="project-import">{importing ? "Importing…" : "Import JSON"}
              <input type="file" accept=".json,application/json" disabled={importing} aria-label="Import project JSON"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  setImporting(true); setShareError("");
                  try {
                    if (file.size > MAX_PROJECT_BYTES) throw new Error("Project files must be smaller than 10 MB.");
                    await onImport(importProject(await file.text()));
                  } catch (error) { setShareError(error instanceof Error ? error.message : "Could not import this file."); }
                  finally { setImporting(false); }
                }} />
            </label>
            <button onClick={async () => {
              setShareError(""); setShareStatus("");
              try { setShareLink(await projectShareLink(activeProject)); }
              catch (error) { setShareError(error instanceof Error ? error.message : "Could not create a link."); }
            }}>Create share link</button>
          </div>
          {shareLink && <div className="project-share-link">
            <label htmlFor="project-share-url">Anyone with this link can open a copy. Changes stay in each person's browser.</label>
            <input id="project-share-url" value={shareLink} readOnly onFocus={(event) => event.target.select()} />
            <button onClick={async () => {
              try { await navigator.clipboard.writeText(shareLink); setShareStatus("Link copied."); }
              catch { setShareStatus("Select the link above and copy it manually."); }
            }}>Copy link</button>
          </div>}
          {shareStatus && <p role="status">{shareStatus}</p>}
          {shareError && <p className="error" role="alert">{shareError}</p>}
        </section>

        <div className="project-list-head">
          <h3>Saved projects</h3>
          <button className="ghostbtn" onClick={onExample}>New LED example</button>
        </div>
        <div className="project-list">
          {projects.length === 0 && <p className="empty">No saved projects yet.</p>}
          {projects.map((project) => (
            <article key={project.id} className={project.id === activeId ? "active" : ""}>
              <button className="project-open" onClick={() => onOpen(project)}>
                <strong>{project.name}</strong>
                <span>{project.plan.source.kind} · {project.plan.steps.length} steps</span>
              </button>
              <button className="project-delete" onClick={() => onDelete(project)}
                aria-label={`Delete ${project.name}`}>Delete</button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
