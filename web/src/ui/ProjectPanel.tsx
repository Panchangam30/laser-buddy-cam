import { useState } from "react";
import type { Project } from "../lib/types";
import { downloadProject, importProject, projectShareLink, MAX_PROJECT_BYTES } from "../lib/sharing";
import { buildTutorial, TUTORIALS, type TutorialCategory } from "../lib/tutorials";
import { createProject, normalizePlan } from "../lib/plans";

const CATEGORIES: Array<TutorialCategory | "All"> = ["All", "Servos", "LEDs", "Buttons", "Analog", "Sound"];

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
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<TutorialCategory | "All">("All");
  const [loadingTutorial, setLoadingTutorial] = useState("");
  const [tutorialError, setTutorialError] = useState("");
  const locked = busy || importing || Boolean(loadingTutorial);
  const matches = TUTORIALS.filter((item) => (category === "All" || item.category === category)
    && search.trim().toLowerCase().split(/\s+/).every((word) => `${item.title} ${item.description} ${item.category}`.toLowerCase().includes(word)));
  async function loadTutorial(id: string) {
    if (locked) return;
    setLoadingTutorial(id); setTutorialError("");
    try { await onImport(createProject(normalizePlan(buildTutorial(id)))); }
    catch (error) { setTutorialError(error instanceof Error ? error.message : "Could not load this tutorial."); }
    finally { setLoadingTutorial(""); }
  }

  return (
    <div className="project-scrim" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="project-panel" role="dialog" aria-modal="true" aria-label="Projects">
        <header>
          <div><span className="eyebrow">PROJECT LIBRARY</span><h2>What are you building?</h2></div>
          <button className="closebtn" onClick={onClose} aria-label="Close projects">×</button>
        </header>

        <section className="tutorial-catalog" aria-label="Arduino tutorials">
          <div className="tutorial-heading"><div><span className="eyebrow">FREQUENTLY SEARCHED IDEAS</span>
            <h3>Pick a project. Start building.</h3></div><span className="tutorial-count">50 tutorials</span></div>
          <p>Explore 50 beginner-friendly Arduino ideas. Every card opens a 3D wiring guide, parts list, and sketch. No account or API key needed.</p>
          <label className="tutorial-search" htmlFor="tutorial-search">Find a tutorial
            <input id="tutorial-search" type="search" placeholder="Try servo, blinking lights, or a button…"
              value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          <div className="tutorial-filters" role="group" aria-label="Tutorial categories">
            {CATEGORIES.map((value) => <button key={value} aria-pressed={category === value}
              onClick={() => setCategory(value)}>{value}</button>)}
          </div>
          <span className="tutorial-results" role="status">{matches.length} of 50 tutorials</span>
          <div className="tutorial-grid" aria-busy={Boolean(loadingTutorial)}>
            {matches.map((item) => <button className="tutorial-card" key={item.id} disabled={locked}
              onClick={() => void loadTutorial(item.id)} aria-label={`Load ${item.title}`}>
              <span className="tutorial-category">{item.category} <span aria-hidden="true">↗</span></span>
              <strong>{item.title}</strong><span>{item.description}</span>
              <small>{loadingTutorial === item.id ? "Opening…" : "3D guide · Code · Parts"}</small>
            </button>)}
            {!matches.length && <p className="empty">No matches yet. Try “LED”, “servo”, or another category.</p>}
          </div>
          {tutorialError && <p className="error" role="alert">{tutorialError}</p>}
        </section>

        <form className="goal-form" onSubmit={(event) => {
          event.preventDefault();
          const value = goal.trim();
          const tutorial = TUTORIALS.find((item) => item.title.toLowerCase() === value.toLowerCase() || item.id === value.toLowerCase());
          if (tutorial) void loadTutorial(tutorial.id);
          else if (value && !locked) void onGoal(value);
        }}>
          <label htmlFor="project-goal">Start from a named goal</label>
          <div>
            <input id="project-goal" value={goal} onChange={(event) => setGoal(event.target.value)}
              placeholder="Make a servo sweep on a button press" disabled={locked} />
            <button disabled={locked || !goal.trim()}>{busy ? "Building…" : "Build plan"}</button>
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
