import { useState } from "react";
import type { Project } from "../lib/types";

export function ProjectPanel({ projects, activeId, busy, error, onClose, onOpen,
  onGoal, onExample, onDelete,
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
}) {
  const [goal, setGoal] = useState("");

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
