import { useEffect, useMemo, useState } from "react";
import { SiteFooter } from "../components/SiteFooter";
import { reconcile } from "../lib/guidance";
import { EMPTY_WORLD } from "../lib/world";
import { Scene } from "../three/Scene";
import {
  BUILD_GUIDES, CHALLENGES, HUB_CATEGORIES, HUB_PROBLEMS,
  categoryById, challengeById, problemById,
  type HubProblem, type TroubleshootingChallenge,
} from "./content";
import "./hub.css";

const PROGRESS_KEY = "laser-buddy:hub-progress:v1";
const HINTS_KEY = "laser-buddy:hub-hints:v1";

function readProgress(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch { return []; }
}

function readHints(): Record<string, number> {
  try {
    const value = JSON.parse(localStorage.getItem(HINTS_KEY) ?? "{}");
    return value && typeof value === "object" ? value as Record<string, number> : {};
  } catch { return {}; }
}

function HubHeader() {
  return (
    <header className="hub-topbar">
      <a className="hub-brand" href="/"><strong>Laser Buddy</strong><em>Learning Hub</em></a>
      <nav aria-label="Hub utilities"><a href="/">Workbench</a><a href="/docs">Docs</a></nav>
    </header>
  );
}

function Breadcrumb({ children }: { children: React.ReactNode }) {
  return <nav className="hub-breadcrumb" aria-label="Breadcrumb"><a href="/hub">Hub</a><span>/</span>{children}</nav>;
}

function Home() {
  const params = new URLSearchParams(window.location.search);
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [category, setCategory] = useState(params.get("category") ?? "all");
  const completed = readProgress();
  const results = useMemo(() => {
    const needles = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return HUB_PROBLEMS.filter((problem) => {
      const matchesCategory = category === "all" || problem.category === category;
      const haystack = `${problem.title} ${problem.symptom} ${problem.keywords.join(" ")}`.toLowerCase();
      return matchesCategory && needles.every((needle) => haystack.includes(needle));
    });
  }, [category, query]);

  useEffect(() => {
    const next = new URL(window.location.href);
    query ? next.searchParams.set("q", query) : next.searchParams.delete("q");
    category !== "all" ? next.searchParams.set("category", category) : next.searchParams.delete("category");
    history.replaceState(null, "", next);
  }, [category, query]);

  return (
    <div className="hub-site">
      <HubHeader />
      <main>
        <section className="hub-hero">
          <div className="hub-hero-copy">
            <span className="hub-eyebrow">ARDUINO HELP</span>
            <h1>Find the fault.<br /><em>Fix your circuit.</em></h1>
            <p>Wiring checks, build guides, and circuit exercises for Arduino Uno.</p>
            <label className="hub-search">
              <span aria-hidden="true">⌕</span>
              <input type="search" value={query} onChange={(event) => setQuery(event.target.value)}
                placeholder="Try “LED stays dark” or “upload failed”" aria-label="Search Arduino help" />
              {query && <button onClick={() => setQuery("")} aria-label="Clear search">×</button>}
            </label>
            <p className="hub-search-note">Search {HUB_PROBLEMS.length} troubleshooting guides</p>
          </div>
          <div className="hub-hero-card" aria-label="Five minute debug routine">
            <span className="hub-card-number">5:00</span>
            <h2>The five-minute check</h2>
            <ol><li><b>Power off.</b> Change wiring only when unplugged.</li><li><b>Check power.</b> Trace 5V and GND first.</li><li><b>Follow one path.</b> Pin → part → ground.</li><li><b>Start tiny.</b> Run the simplest example.</li></ol>
            <a href="/hub/problems/safety-i-am-not-sure-whether-it-is-safe-to-power">Is it safe to power? →</a>
          </div>
        </section>

        <section className="hub-section hub-path">
          <div className="hub-section-heading"><span className="hub-eyebrow">START A PATH</span><h2>New to Arduino? Begin here.</h2></div>
          <div className="hub-guides">
            {BUILD_GUIDES.map((guide, index) => (
              <details className="hub-guide" key={guide.id}>
                <summary><span>{String(index + 1).padStart(2, "0")}</span><div><h3>{guide.title}</h3><p>{guide.description}</p><small>{guide.time} · {guide.level}</small></div><b aria-hidden="true">+</b></summary>
                <div className="hub-guide-body"><strong>You need</strong><p>{guide.parts.join(" · ")}</p><ol>{guide.steps.map((step) => <li key={step}>{step}</li>)}</ol><a href={guide.resource} target="_blank" rel="noreferrer">Read the official guide ↗</a></div>
              </details>
            ))}
          </div>
        </section>

        <section className="hub-section hub-challenges" id="challenges">
          <div className="hub-section-heading split"><div><span className="hub-eyebrow">3D FAULT LAB</span><h2>Circuit exercises</h2></div><p>Inspect the 3D board, identify the fault, and check your answer.</p></div>
          <div className="hub-challenge-grid">
            {CHALLENGES.map((challenge, index) => (
              <a className="hub-challenge-card" href={`/hub/challenges/${challenge.id}`} key={challenge.id}>
                <div className="hub-challenge-visual"><span className="challenge-index">CASE {String(index + 1).padStart(2, "0")}</span><span className="challenge-glyph" aria-hidden="true">{index % 2 ? "⌁" : "⊘"}</span>{completed.includes(challenge.id) && <span className="challenge-solved">✓ Solved</span>}</div>
                <div><small>{challenge.kicker}</small><h3>{challenge.title}</h3><p>{challenge.prompt}</p><span>Inspect circuit →</span></div>
              </a>
            ))}
          </div>
        </section>

        <section className="hub-section hub-library" id="problems">
          <div className="hub-section-heading split"><div><span className="hub-eyebrow">FIX LIBRARY</span><h2>{results.length} troubleshooting guides</h2></div><p>Pick a topic or search by exactly what you see. Unplug power before changing any circuit.</p></div>
          <div className="hub-category-tabs" role="group" aria-label="Filter by topic">
            <button className={category === "all" ? "on" : ""} onClick={() => setCategory("all")}>All <span>{HUB_PROBLEMS.length}</span></button>
            {HUB_CATEGORIES.map((item) => <button key={item.id} className={category === item.id ? "on" : ""} onClick={() => setCategory(item.id)}>{item.title} <span>{item.topics.length}</span></button>)}
          </div>
          {results.length ? <div className="hub-problem-grid" data-testid="problem-results">
            {results.map((problem) => {
              const group = categoryById(problem.category)!;
              return <a className="hub-problem-card" href={`/hub/problems/${problem.id}`} key={problem.id} data-category={problem.category}>
                <span className="problem-icon" style={{ color: group.color }}>{group.icon}</span><div><small>{group.title}</small><h3>{problem.title}</h3><p>{problem.symptom}</p></div><b aria-hidden="true">→</b>
              </a>;
            })}
          </div> : <div className="hub-empty"><span>?</span><h3>No exact match yet</h3><p>Try fewer words, or search for the part that is giving you trouble.</p><button onClick={() => { setQuery(""); setCategory("all"); }}>Show all problems</button></div>}
        </section>
        <SiteFooter />
      </main>
    </div>
  );
}

function ProblemPage({ id }: { id: string }) {
  const problem = problemById(id);
  if (!problem) return <NotFound />;
  return <ProblemDetail problem={problem} />;
}

function ProblemDetail({ problem }: { problem: HubProblem }) {
  const category = categoryById(problem.category)!;
  const related = HUB_PROBLEMS.filter((item) => item.category === problem.category && item.id !== problem.id).slice(0, 4);
  useEffect(() => { document.title = `${problem.title} · Laser Buddy Hub`; }, [problem.title]);
  return <div className="hub-site"><HubHeader /><main className="hub-detail"><Breadcrumb><a href={`/hub?category=${category.id}`}>{category.title}</a><span>/</span><span>{problem.title}</span></Breadcrumb>
    <article className="problem-detail">
      <header><span className="hub-eyebrow" style={{ color: category.color }}>{category.title.toUpperCase()}</span><h1>{problem.title}</h1><p>{problem.symptom}</p><div><span>{problem.level}</span><span>About 5 minutes</span></div></header>
      {problem.safety && <aside className="hub-safety"><strong>Power off first</strong><p>{problem.safety}</p></aside>}
      <section><span className="detail-number">01</span><div><h2>What usually causes this</h2><ul>{problem.causes.map((cause) => <li key={cause}>{cause}</li>)}</ul></div></section>
      <section><span className="detail-number">02</span><div><h2>Try these checks in order</h2><ol className="fix-steps">{problem.steps.map((step, index) => <li key={step}><span>{index + 1}</span><p>{step}</p></li>)}</ol></div></section>
      <section><span className="detail-number">03</span><div><h2>Still stuck?</h2><p>Return to the smallest working example, then reconnect one part at a time. The first step that brings the problem back tells you where to look.</p><a className="hub-official" href={problem.resource.url} target="_blank" rel="noreferrer">{problem.resource.label} ↗</a></div></section>
      <section className="related"><span className="detail-number">04</span><div><h2>Related problems</h2>{related.map((item) => <a key={item.id} href={`/hub/problems/${item.id}`}>{item.title}<span>→</span></a>)}</div></section>
    </article><SiteFooter /></main></div>;
}

function ChallengePage({ id }: { id: string }) {
  const challenge = challengeById(id);
  if (!challenge) return <NotFound />;
  return <ChallengeLesson challenge={challenge} />;
}

function ChallengeLesson({ challenge }: { challenge: TroubleshootingChallenge }) {
  const [hintCount, setHintCount] = useState(() => Math.max(0, Math.min(3, Number(readHints()[challenge.id]) || 0)));
  const [choice, setChoice] = useState<string | null>(null);
  const [solved, setSolved] = useState(() => readProgress().includes(challenge.id));
  const plan = solved ? challenge.solutionPlan : challenge.faultyPlan;
  const guidance = useMemo(() => reconcile(plan, EMPTY_WORLD, 1), [plan]);
  const highlights = hintCount >= 2 ? challenge.hints[hintCount - 1].partIds : [];
  useEffect(() => { document.title = `${challenge.title} · 3D Fault Lab`; }, [challenge.title]);

  function answer(id: string) {
    setChoice(id);
    const selected = challenge.options.find((option) => option.id === id);
    if (!selected?.correct) return;
    setSolved(true);
    const next = [...new Set([...readProgress(), challenge.id])];
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(next));
  }

  function unlockHint() {
    const next = Math.min(3, hintCount + 1);
    setHintCount(next);
    localStorage.setItem(HINTS_KEY, JSON.stringify({ ...readHints(), [challenge.id]: next }));
  }

  return <div className="hub-site challenge-page"><HubHeader /><main><Breadcrumb><a href="/hub#challenges">3D Fault Lab</a><span>/</span><span>{challenge.title}</span></Breadcrumb>
    <div className="challenge-layout">
      <section className="challenge-scene-wrap">
        <div className="challenge-scene-bar"><span className={solved ? "solved" : ""}>{solved ? "CORRECTED CIRCUIT" : "FAULTY CIRCUIT — DO NOT POWER"}</span><span>Drag to rotate · Scroll to zoom</span></div>
        <Scene plan={plan} step={1} exploded={false} mode="plan" world={EMPTY_WORLD} guidance={guidance} labels={false} highlightPartIds={highlights} />
        {hintCount === 3 && challenge.hints[2].holes.length > 0 && <div className="hole-target">Check {challenge.hints[2].holes.join(" and ")}</div>}
      </section>
      <aside className="challenge-panel">
        <span className="hub-eyebrow">{challenge.kicker.toUpperCase()} · {challenge.difficulty}</span><h1>{challenge.title}</h1><p className="challenge-prompt">{challenge.prompt}</p>
        {challenge.safety && <div className="mini-safety"><strong>Safety note</strong>{challenge.safety}</div>}
        <fieldset><legend>Choose the best diagnosis</legend>{challenge.options.map((option) => <button key={option.id} className={`${choice === option.id ? "chosen" : ""} ${choice === option.id ? (option.correct ? "right" : "wrong") : ""}`} onClick={() => answer(option.id)} disabled={solved}><span>{option.id.toUpperCase()}</span>{option.label}</button>)}</fieldset>
        {choice && <p className={`answer-feedback ${solved ? "right" : "wrong"}`}>{challenge.options.find((option) => option.id === choice)?.feedback}</p>}
        <div className="hint-stack"><div><strong>Need a clue?</strong><span>{hintCount} / 3 unlocked</span></div>{challenge.hints.slice(0, hintCount).map((hint, index) => <article key={hint.title}><span>HINT {index + 1}</span><strong>{hint.title}</strong><p>{hint.text}</p></article>)}{hintCount < 3 && !solved && <button onClick={unlockHint}>Unlock hint {hintCount + 1}</button>}</div>
        {solved && <div className="challenge-success"><span>✓</span><div><strong>Case solved</strong><p>The board now shows the corrected circuit.</p></div></div>}
        <div className="challenge-actions"><a className="primary" href={`/?challenge=${challenge.id}`}>Try on my board</a><button onClick={() => { setSolved(false); setChoice(null); setHintCount(0); }}>Reset case</button></div>
      </aside>
    </div>
  </main></div>;
}

function NotFound() {
  return <div className="hub-site"><HubHeader /><main className="hub-not-found"><span>404</span><h1>That lesson wandered off.</h1><p>The circuit is still here. The page you requested is not.</p><a href="/hub">Return to the Learning Hub</a></main></div>;
}

export function HubPage() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/hub";
  const challenge = path.match(/^\/hub\/challenges\/([^/]+)$/);
  const problem = path.match(/^\/hub\/problems\/([^/]+)$/);
  useEffect(() => {
    if (path === "/hub") document.title = "Arduino Learning Hub · Laser Buddy";
  }, [path]);
  if (challenge) return <ChallengePage id={decodeURIComponent(challenge[1])} />;
  if (problem) return <ProblemPage id={decodeURIComponent(problem[1])} />;
  if (path !== "/hub") return <NotFound />;
  return <Home />;
}
