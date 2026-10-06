import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Scene, type ViewMode } from "./three/Scene";
import { STATUS_COLOR } from "./three/World";
import { CameraPanel } from "./ui/CameraPanel";
import { BoardMap } from "./ui/BoardMap";
import { LaserPanel } from "./ui/LaserPanel";
import { MOCK_PLAN } from "./lib/mockPlan";
import { requestGoalPlan, requestPlan, speak, health } from "./lib/api";
import { analyseFrame, resetWorld, setOrientation, EMPTY_WORLD, type World } from "./lib/world";
import { reconcile, guidanceText } from "./lib/guidance";
import { PITCH, holePosition } from "./lib/breadboard";
import {
  pointAt, pointAtLocation, moveLaser, nudgeLaser, setLaserPower, laserCentre,
  laserConnect, laserStatus, laserOff, type Direction, type NudgeSize,
} from "./lib/laser";
import { anchorLocation, locationLabel } from "./lib/workspace";
import type { Project } from "./lib/types";
import { createProject } from "./lib/plans";
import {
  deleteProject, listProjects, loadLastProject, saveProject,
} from "./lib/projects";
import { ProjectPanel } from "./ui/ProjectPanel";
import { OpenAIVoiceSession } from "./lib/realtime";
import { GrokVoiceSession } from "./lib/grokVoice";
import type { RealtimeStatus, Utterance, VoiceSession } from "./lib/voice";
import {
  ComponentsDrawer, STARTER_KIT_PARTS, type PlacedKitPart,
  seatPart,
} from "./components/StarterKit";
import { SiteFooter } from "./components/SiteFooter";
import "./App.css";

/** How often a frame goes to the vision service while tracking is on. */
const TRACK_INTERVAL_MS = 450;

export default function App() {
  const [project, setProject] = useState<Project>(() =>
    createProject(MOCK_PLAN, "LED blink example"));
  const plan = project.plan;
  const [step, setStep] = useState(1);
  const [exploded, setExploded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [narrate, setNarrate] = useState(true);
  const [keys, setKeys] = useState<{
    openai?: string; xai?: string; voiceProvider?: string; vision?: string;
  }>({});
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [goalBusy, setGoalBusy] = useState(false);
  const [goalError, setGoalError] = useState("");
  const projectReady = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // --- the live map of the board ---
  const [world, setWorld] = useState<World>(EMPTY_WORLD);
  const [tracking, setTracking] = useState(false);
  const [visionErr, setVisionErr] = useState("");
  const [mode, setMode] = useState<ViewMode>("plan");
  const [labels, setLabels] = useState(true);
  const [showMap, setShowMap] = useState(false);
  const [showDevices, setShowDevices] = useState(true);
  const [componentsOpen, setComponentsOpen] = useState(false);
  const [simulationRunning, setSimulationRunning] = useState(false);
  const [simulationPowered, setSimulationPowered] = useState(true);
  const [simulationRate, setSimulationRate] = useState(1);
  const [simulationIncluded, setSimulationIncluded] = useState<string[]>([]);
  const [simulationDetailsOpen, setSimulationDetailsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [kitParts, setKitParts] = useState<PlacedKitPart[]>([]);
  const [selectedKitPart, setSelectedKitPart] = useState<string | null>(null);
  const nextKitId = useRef(1);

  // --- live voice ---
  const [voice, setVoice] = useState<RealtimeStatus>("idle");
  const [voiceErr, setVoiceErr] = useState("");
  const [muted, setMuted] = useState(false);
  const [talk, setTalk] = useState<Utterance[]>([]);
  const sessionRef = useRef<VoiceSession | null>(null);
  const grabRef = useRef<(() => string | null) | null>(null);
  // Kept in refs so tool handlers always see current state, not a stale closure.
  const planRef = useRef(plan); planRef.current = plan;
  const stepRef = useRef(step); stepRef.current = step;

  useEffect(() => { health().then(setKeys); }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const saved = await loadLastProject();
        if (cancelled) return;
        if (saved) {
          setProject(saved);
          setStep(saved.progress.currentStep);
        } else {
          await saveProject(project);
        }
        if (!cancelled) setProjects(await listProjects());
      } catch (e) {
        if (!cancelled) setError(`Could not open saved projects: ${e instanceof Error ? e.message : e}`);
      } finally {
        if (!cancelled) projectReady.current = true;
      }
    })();
    return () => { cancelled = true; };
    // The initial project is deliberately captured once while storage hydrates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!projectReady.current) return;
    const timer = window.setTimeout(() => {
      const current = plan.steps.find((item) => item.n === step);
      const updated: Project = {
        ...project,
        progress: { ...project.progress, currentStep: step, currentStepId: current?.id },
        updatedAt: new Date().toISOString(),
      };
      void saveProject(updated).then(() => {
        setProjects((items) => items.map((item) => item.id === updated.id ? updated : item));
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [project, plan.steps, step]);

  const openProject = useCallback((next: Project) => {
    setProject(next);
    setStep(next.progress.currentStep);
    setWorld(EMPTY_WORLD);
    setKitParts([]);
    setSelectedKitPart(null);
    setProjectsOpen(false);
    void saveProject(next);
  }, []);

  const addProject = useCallback(async (next: Project) => {
    await saveProject(next);
    setProjects((items) => [next, ...items.filter((item) => item.id !== next.id)]);
    openProject(next);
  }, [openProject]);

  const onCapture = useCallback(async (dataUrl: string) => {
    setBusy(true); setError("");
    try {
      const nextPlan = await requestPlan(dataUrl);
      await addProject(createProject(nextPlan, nextPlan.title));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [addProject]);

  const buildGoal = useCallback(async (goal: string) => {
    setGoalBusy(true); setGoalError("");
    try {
      const nextPlan = await requestGoalPlan(goal);
      await addProject(createProject(nextPlan, nextPlan.title, goal));
    } catch (e) {
      setGoalError(e instanceof Error ? e.message : String(e));
    } finally {
      setGoalBusy(false);
    }
  }, [addProject]);

  const removeProject = useCallback(async (target: Project) => {
    if (!window.confirm(`Delete “${target.name}”? This removes its saved progress from this browser.`)) return;
    await deleteProject(target.id);
    const remaining = projects.filter((item) => item.id !== target.id);
    setProjects(remaining);
    if (target.id === project.id) {
      const replacement = remaining[0] ?? createProject(MOCK_PLAN, "LED blink example");
      if (!remaining.length) await saveProject(replacement);
      openProject(replacement);
    }
  }, [openProject, project.id, projects]);

  const last = plan.steps.length;
  const current = plan.steps.find((s) => s.n === step);
  const isMock = plan.source.kind === "builtin";
  const problem = plan.problem
    ?? plan.warnings.find((warning) => warning.blocksPower)?.message
    ?? "";
  const currentManuallyDone = Boolean(current?.id
    && project.progress.manuallyCompletedStepIds.includes(current.id));

  const toggleManualStep = useCallback(() => {
    if (!current?.id) return;
    setProject((value) => {
      const done = value.progress.manuallyCompletedStepIds.includes(current.id!);
      return {
        ...value,
        progress: {
          ...value.progress,
          manuallyCompletedStepIds: done
            ? value.progress.manuallyCompletedStepIds.filter((id) => id !== current.id)
            : [...value.progress.manuallyCompletedStepIds, current.id!],
        },
      };
    });
  }, [current?.id]);

  const guidance = useMemo(
    () => reconcile(plan, world, step), [plan, world, step]);
  const worldRef = useRef(world); worldRef.current = world;
  const guidanceRef = useRef(guidance); guidanceRef.current = guidance;
  const narrationText = current
    ? `Step ${current.n}. ${current.title}. ${current.instruction} ${current.warning ?? ""}`
    : null;

  // Narrate whenever the step changes, cutting off whatever was playing.
  useEffect(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    if (!narrate || !narrationText || voice === "live") return;
    let cancelled = false;
    speak(narrationText).then((a) => {
      if (cancelled) a?.pause();
      else audioRef.current = a;
    });
    return () => { cancelled = true; };
  }, [narrate, narrationText, voice]);

  /**
   * Feed frames to the vision service while tracking is on.
   *
   * One request in flight at a time, and a widening gap after failures: if the
   * service is down, retrying four times a second fills the console with the
   * same error and achieves nothing.
   */
  useEffect(() => {
    if (!tracking) return;
    let stopped = false;
    let inFlight = false;
    let failures = 0;
    let timer: number;

    const tick = async () => {
      if (stopped) return;
      const frame = !inFlight ? grabRef.current?.() : null;
      if (frame) {
        inFlight = true;
        try {
          setWorld(await analyseFrame(frame));
          setVisionErr("");
          failures = 0;
        } catch (e) {
          failures++;
          setVisionErr(e instanceof Error ? e.message : String(e));
        } finally {
          inFlight = false;
        }
      }
      if (!stopped) {
        const backoff = Math.min(failures, 5) * 1500;
        timer = window.setTimeout(tick, TRACK_INTERVAL_MS + backoff);
      }
    };

    timer = window.setTimeout(tick, 0);
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [tracking]);

  /**
   * Act on commands from the phone remote.
   *
   * Polled rather than pushed: a websocket would be the tidier answer, but this
   * is one small GET every couple of seconds on a LAN, and it keeps the vision
   * service a plain request/response HTTP server with no connection state.
   *
   * These have to run here, in the tab, because this is where the webcam is --
   * the service cannot start a scan or board tracking on its own.
   */
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      try {
        const r = await fetch("/api/vision/remote");
        if (!r.ok) return;
        const { commands } = (await r.json()) as { commands?: { command: string }[] };
        for (const { command } of commands ?? []) {
          if (stopped) return;
          if (command === "start") { setTracking(true); setVisionErr(""); }
          if (command === "stop") { setTracking(false); laserOff().catch(() => {}); }
          if (command === "scan") {
            const frame = grabRef.current?.();
            if (frame) await onCapture(frame);
          }
          if (command === "point") {
            const hole = guidanceRef.current.focus.holes[0];
            if (hole) await pointAt(hole).catch(() => {});
          }
        }
      } catch {
        /* the service may be down; its own panel already says so */
      }
    };
    const id = window.setInterval(tick, 2000);
    return () => { stopped = true; window.clearInterval(id); };
  }, [onCapture]);

  const startTracking = useCallback(() => {
    setVisionErr("");
    setTracking(true);
  }, []);

  async function handleTool(name: string, args: Record<string, unknown>): Promise<string> {
    switch (name) {
      case "goto_step": {
        const n = Number(args.n);
        const total = planRef.current.steps.length;
        if (!Number.isFinite(n) || n < 1 || n > total) return `No step ${args.n}; there are ${total}.`;
        setStep(n);
        const s = planRef.current.steps.find((x) => x.n === n);
        return `Now showing step ${n}: ${s?.title ?? ""}`;
      }
      case "check_progress": {
        const w = await freshWorld();
        if (!w) return "I have no live view of the board. Ask the student to turn "
          + "on board tracking, or to point the camera at the breadboard.";
        const g = reconcile(planRef.current, w, stepRef.current);
        return guidanceText(planRef.current, w, g);
      }
      case "describe_world": {
        const w = await freshWorld();
        if (!w) return "I cannot see the board right now.";
        return w.summary;
      }
      case "move_laser": {
        // Connect on demand: being told "move left" and answering that the
        // laser is not plugged in, when it is, just wastes the student's turn.
        const ready = await ensureLaser();
        if (ready) return ready;

        const dir = String(args.direction ?? "").toLowerCase() as Direction;
        if (dir) {
          const amount = (String(args.amount ?? "small").toLowerCase() || "small") as NudgeSize;
          const r = await nudgeLaser(dir, amount);
          if (!r.ok) return `I could not move it: ${r.error}`;
          return `Moved ${dir}${r.atLimit ? ", and that axis is now at its limit" : ""}.`
            + ` Pan ${r.pan}, tilt ${r.tilt}.`;
        }
        const pan = args.pan === undefined ? undefined : Number(args.pan);
        const tilt = args.tilt === undefined ? undefined : Number(args.tilt);
        if (pan === undefined && tilt === undefined) {
          return "Tell me a direction, or a pan and tilt angle.";
        }
        const r = await moveLaser(pan, tilt);
        return r.ok ? `Now at pan ${r.pan}, tilt ${r.tilt}.`
                    : `I could not move it: ${r.error}`;
      }
      case "laser_power": {
        const ready = await ensureLaser();
        if (ready) return ready;
        const on = Boolean(args.on);
        const r = await setLaserPower(on);
        return r.ok ? `Laser ${on ? "on" : "off"}.`
                    : `I could not switch it: ${r.error}`;
      }
      case "centre_laser": {
        const ready = await ensureLaser();
        if (ready) return ready;
        const r = await laserCentre();
        return r?.ok === false
          ? `I could not centre it: ${r.error}`
          : "Centred, beam off.";
      }
      case "point_at": {
        const hole = String(args.hole ?? "").trim().toUpperCase();
        // An empty argument means "whatever you just told them to do", which is
        // the common case and saves the model having to restate a hole.
        const target = hole
          ? anchorLocation(hole)
          : guidanceRef.current.focus.targets[0];
        if (!target) return "There is nothing to point at yet.";
        try {
          const r = await pointAtLocation(target);
          const targetName = locationLabel(target);
          return r.ok
            ? `The laser is now pointing at ${r.hole ?? targetName}.`
            : `I could not point there: ${r.error}`;
        } catch (e) {
          return `I could not point there: ${e instanceof Error ? e.message : e}`;
        }
      }
      case "where_is": {
        const w = await freshWorld();
        if (!w) return "I cannot see the board right now.";
        return whereIs(String(args.part ?? ""), w);
      }
      case "look_at_board": {
        const frame = grabRef.current?.();
        if (!frame) return "The camera is not available, so I cannot look.";
        // Grok voice sessions take no image input, so the frame is described
        // out-of-band and the description is returned as the tool result.
        if (keys.voiceProvider === "grok") {
          try {
            const p = await requestPlan(frame);
            const seen = p.detected?.map((d) => `${d.count}x ${d.label}`).join(", ") || "nothing clear";
            return `Looking through the camera I can see: ${seen}.`
              + (p.problem ? ` Possible problem: ${p.problem}` : "");
          } catch (e) {
            return `I could not look: ${e instanceof Error ? e.message : e}`;
          }
        }
        sessionRef.current?.sendImage(frame, "This is the student's board right now.");
        return "Photo taken and added to the conversation.";
      }
      case "rescan_bench": {
        const frame = grabRef.current?.();
        if (!frame) return "The camera is not available.";
        await onCapture(frame);
        return "Re-scanned the bench and rebuilt the plan.";
      }
      default:
        return `Unknown tool ${name}.`;
    }
  }

  /**
   * Make sure the head is connected. Returns a sentence to say when it is not,
   * or "" when it is ready.
   */
  async function ensureLaser(): Promise<string> {
    try {
      const s = await laserStatus();
      if (s.connected) return "";
      const r = await laserConnect();
      if (r?.connected) return "";
      return r?.error
        ? `I cannot reach the laser: ${r.error}`
        : "The laser is not connected.";
    } catch (e) {
      return `I cannot reach the laser: ${e instanceof Error ? e.message : e}`;
    }
  }

  /**
   * The newest map, analysing a frame on the spot if tracking is off.
   *
   * The assistant asking "how am I doing" should get the board as it is now, not
   * whatever was last seen, so this never answers from a stale snapshot.
   */
  async function freshWorld(): Promise<World | null> {
    const frame = grabRef.current?.();
    if (frame) {
      try {
        const w = await analyseFrame(frame);
        setWorld(w);
        return w;
      } catch {
        // Fall through to whatever was last seen rather than refusing outright.
      }
    }
    return worldRef.current.frame > 0 ? worldRef.current : null;
  }

  function startVoice() {
    setVoiceErr(""); setTalk([]);
    // The step-change narration and the live voice would talk over each other.
    setNarrate(false);
    const opts = {
      plan: planRef.current,
      step: stepRef.current,
      onTool: handleTool,
      onStatus: (st: RealtimeStatus, err?: string) => { setVoice(st); if (err) setVoiceErr(err); },
      onUtterance: (u: Utterance) => setTalk((t) => {
        // A cumulative transcript replaces the previous one from the same speaker.
        if (u.replace && t.length && t[t.length - 1].who === u.who) {
          return [...t.slice(0, -1), u];
        }
        return [...t.slice(-30), u];
      }),
    };
    const s: VoiceSession = keys.voiceProvider === "openai"
      ? new OpenAIVoiceSession(opts)
      : new GrokVoiceSession({ ...opts, voice: undefined });
    sessionRef.current = s;
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__rt = s;
    s.connect();
  }

  function stopVoice() {
    sessionRef.current?.disconnect();
    sessionRef.current = null;
    setVoice("idle");
  }

  // Keep the model's context in sync with what the student is looking at, and
  // with what is on their board.
  // Deliberately narrow: the world is a new object every 450 ms, and pushing a
  // new system prompt that often would cost a round trip each time for nothing.
  // What the model needs to know is whether there is a map at all and what the
  // advice currently is, so those are the triggers.
  const haveMap = world.frame > 0;
  const advice = guidance.nextAction;

  useEffect(() => {
    if (!sessionRef.current?.live) return;
    sessionRef.current.refreshContext(
      plan, step, haveMap ? guidanceText(plan, worldRef.current, guidanceRef.current) : undefined);
  }, [plan, step, haveMap, advice]);

  useEffect(() => () => sessionRef.current?.disconnect(), []);

  const addKitPart = useCallback((partId: string, position?: [number, number, number]) => {
    const definition = STARTER_KIT_PARTS.find((part) => part.id === partId);
    if (!definition) return;
    const instanceId = `${partId}-${nextKitId.current++}`;
    // Clicking a card rather than dragging it: fan parts along row E, each in
    // its own column. Not z = 0 -- that is the centre channel, which is further
    // than a hole pitch from both E and F, so nothing snaps and the part comes
    // to rest in the gutter.
    const offset = (kitParts.length % 9) * PITCH * 4 - PITCH * 16;
    const row = holePosition("E1")!;
    const placedAt = position ?? seatPart(definition.shape, offset, row.z);
    setKitParts((items) => [...items, {
      ...definition, instanceId, position: placedAt, rotation: 0,
      ...(definition.shape === "wire" ? {
        wireStart: [placedAt[0] - 9, 7.5, placedAt[2]] as [number, number, number],
        wireEnd: [placedAt[0] + 9, 7.5, placedAt[2]] as [number, number, number],
      } : {}),
    }]);
    setSelectedKitPart(instanceId);
  }, [kitParts.length]);

  useEffect(() => {
    const handleAdd = (event: Event) => addKitPart((event as CustomEvent<string>).detail);
    window.addEventListener("add-starter-part", handleAdd);
    return () => window.removeEventListener("add-starter-part", handleAdd);
  }, [addKitPart]);

  const visionDown = keys.vision === "not running";

  return (
    <div className={`app ${sidebarOpen ? "" : "sidebar-collapsed"}`}>
      <aside className={`panel ${sidebarOpen ? "" : "collapsed"}`} aria-label="Circuit guide">
        <button className="sidebar-toggle" onClick={() => setSidebarOpen((open) => !open)}
          aria-expanded={sidebarOpen} aria-label={sidebarOpen ? "Close circuit guide" : "Open circuit guide"}
          title={sidebarOpen ? "Close circuit guide" : "Open circuit guide"}>
          <span aria-hidden="true">{sidebarOpen ? "‹" : "›"}</span>
          {!sidebarOpen && <span className="sidebar-toggle-label">Guide</span>}
        </button>
        <div className="panel-content">
        <header className="build">
          <div className="build-title-row">
            <h1>{plan.title}</h1>
            <button className="project-trigger" onClick={() => {
              setGoalError(""); setProjectsOpen(true);
            }}>Projects</button>
          </div>
          <p className="meta">
            {/* Each stat is one element: a flex gap falls between text nodes
                too, so "4 steps" arrived with a gap inside it. */}
            <span><b className="num">{plan.steps.length}</b> steps</span>
            <i />
            <span><b className="num">{plan.parts.length}</b> parts</span>
            {isMock && <><i /><span className="tag">Example</span></>}
          </p>
        </header>

        {/* The steps come first. They are the thing you work through, and they
            used to sit below a camera preview, three device panels and a
            transcript -- off the bottom of the panel on most screens. */}
        <section className="steps">
          <h2>Steps</h2>
          {plan.steps.map((s) => {
            const done = guidance.completeSteps.includes(s.n)
              || Boolean(s.id && project.progress.manuallyCompletedStepIds.includes(s.id));
            return (
              <button key={s.n}
                className={`step ${s.n === step ? "active" : ""} ${done || s.n < step ? "done" : ""}`}
                onClick={() => setStep(s.n)}>
                <span className="n">{done ? "✓" : s.n}</span>
                <span className="t">{s.title}</span>
              </button>
            );
          })}
        </section>

        <section>
          <h2>{plan.source.kind === "photo" ? "Parts seen" : "Required"}</h2>
          {plan.source.kind === "photo" ? (
            <ul className="detected">
              {plan.detected.map((d, i) => (
                <li key={i} className={d.confidence === "low" ? "low" : ""}>
                  <span className="count">{d.count}&times;</span>
                  <span className="label">{d.label}</span>
                  {d.unreadable && <span className="flag" title="Markings not legible">?</span>}
                </li>
              ))}
            </ul>
          ) : (
            <ul className="detected requirements">
              {plan.requirements.map((item) => (
                <li key={item.id} className={item.availability === "missing" ? "low" : ""}>
                  <span className="count">{item.count}&times;</span>
                  <span className="label">{item.label}</span>
                  <span className={`availability ${item.availability}`}>{item.availability}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {problem && <p className="problem"><strong>Before you power up</strong>{problem}</p>}
        {error && <p className="error">{error}</p>}
        {keys.openai === "missing" && (
          <p className="error">No OPENAI_API_KEY in .env, so scanning is off.</p>
        )}

        {/* One group for the hardware, not three. These are things you set up
            once; splitting them into separate headed sections gave a webcam
            toggle the same weight as the build itself. */}
        <section className="devices">
          <h2>
            <button className="grouptoggle" onClick={() => setShowDevices((v) => !v)}
                    aria-expanded={showDevices}>
              Devices
              <span className="chev" aria-hidden="true">{showDevices ? "\u2212" : "+"}</span>
            </button>
          </h2>

          {showDevices && (
            <div className="devicelist">
              <CameraPanel onCapture={onCapture} busy={busy}
                registerGrab={(fn) => { grabRef.current = fn; }} />

              <BoardTracker
                world={world} guidance={guidance} tracking={tracking} error={visionErr}
                down={visionDown}
                onToggle={() => (tracking ? setTracking(false) : startTracking())}
                onFlip={async () => {
                  await setOrientation(!(world.orientation?.flipped ?? false));
                  setWorld(EMPTY_WORLD);
                }}
                onReset={async () => { await resetWorld(); setWorld(EMPTY_WORLD); }}
                onShowMap={() => setShowMap((v) => !v)}
                mapOpen={showMap}
              />

              <LaserPanel targets={guidance.focus.targets} why={guidance.focus.why}
                tracking={tracking} boardFound={world.board.found} worldFrame={world.frame}
                onStartTracking={startTracking} />

              <div className="device">
                <VoiceBar
                  status={voice} error={voiceErr} muted={muted}
                  onStart={startVoice} onStop={stopVoice}
                  onMute={() => { const m = !muted; setMuted(m); sessionRef.current?.setMuted(m); }}
                />
                {voice === "live" && (
                  <form className="askform" onSubmit={(e) => {
                    e.preventDefault();
                    const el = (e.currentTarget.elements.namedItem("q") as HTMLInputElement);
                    const v = el.value.trim();
                    if (v) { sessionRef.current?.sendText(v); el.value = ""; }
                  }}>
                    <input name="q" placeholder="Type a question" autoComplete="off" />
                  </form>
                )}
              </div>
            </div>
          )}
        </section>

        {talk.length > 0 && (
          <div className="talk">
            {talk.map((u, i) => (
              <p key={i} className={u.who}><span>{u.who === "you" ? "You" : "TA"}</span>{u.text}</p>
            ))}
          </div>
        )}

        <SiteFooter compact />
        </div>
      </aside>

      <main className={`stage ${mode === "plan" ? "plan-stage" : ""}`}
        onDragOver={(event) => {
          if (mode !== "plan" || !event.dataTransfer.types.includes("application/x-starter-part")) return;
          event.preventDefault(); event.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(event) => {
          if (mode !== "plan") return;
          const partId = event.dataTransfer.getData("application/x-starter-part");
          if (!partId) return;
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          const x = ((event.clientX - rect.left) / rect.width - 0.5) * 150;
          const z = ((event.clientY - rect.top) / rect.height - 0.48) * 90;
          const found = STARTER_KIT_PARTS.find((part) => part.id === partId);
          addKitPart(partId, seatPart(found?.shape ?? "ic",
            Math.max(-74, Math.min(74, x)), Math.max(-45, Math.min(45, z))));
        }}>
        <Scene plan={plan} step={step} exploded={exploded}
               mode={mode} world={world} guidance={guidance} labels={labels}
               kitParts={kitParts} selectedKitPart={selectedKitPart}
               simulation={{ running: simulationRunning, powered: simulationPowered, rate: simulationRate,
                 includedIds: simulationIncluded }}
               onSelectKitPart={setSelectedKitPart}
               onMoveKitPart={(id, position) => setKitParts((items) => items.map((item) =>
                 item.instanceId === id ? { ...item, position } : item))}
               onWireChange={(id, end, position, target) => setKitParts((items) => items.map((item) => {
                 if (item.instanceId !== id) return item;
                 return end === "start"
                   ? { ...item, wireStart: position, wireStartTarget: target }
                   : { ...item, wireEnd: position, wireEndTarget: target };
               }))}
               onDeleteKitPart={(id) => {
                 setKitParts((items) => items.filter((item) => item.instanceId !== id));
                 setSelectedKitPart((selected) => selected === id ? null : selected);
               }} />

        {showMap && <BoardMap onClose={() => setShowMap(false)} live={tracking} />}

        <div className="viewswitch">
          {(["plan", "live"] as ViewMode[]).map((m) => (
            <button key={m} className={mode === m ? "on" : ""} onClick={() => setMode(m)}>
              {m === "plan" ? "Plan" : "My board"}
            </button>
          ))}
        </div>

        <a className="docs-trigger" href="/docs">Docs</a>

        {mode === "plan" && (
          <>
            <ComponentsDrawer open={componentsOpen} onToggle={() => setComponentsOpen((value) => !value)}
              count={kitParts.length} />
            <button className={`simulation-trigger ${simulationRunning ? "running" : ""}`}
              disabled={kitParts.length === 0}
              onClick={() => {
                setComponentsOpen(false);
                setSelectedKitPart(null);
                setSimulationRunning((running) => {
                  if (running) setSimulationDetailsOpen(false);
                  if (!running) setSimulationIncluded((included) => included.length
                    ? included.filter((id) => kitParts.some((part) => part.instanceId === id))
                    : kitParts.filter((part) => part.shape !== "wire").map((part) => part.instanceId));
                  return !running;
                });
              }}>
              <span aria-hidden="true">{simulationRunning ? "■" : "▶"}</span>
              {simulationRunning ? "Stop simulation" : "Play simulation"}
            </button>
            {simulationRunning && <button className={`simulation-more ${simulationDetailsOpen ? "on" : ""}`}
              onClick={() => setSimulationDetailsOpen((open) => !open)}
              aria-expanded={simulationDetailsOpen} aria-controls="simulation-details"
              aria-label={simulationDetailsOpen ? "Hide simulation details" : "Show simulation details"}
              data-tooltip={simulationDetailsOpen ? "Hide details" : "Show more"}>•••</button>}
            {simulationRunning && simulationDetailsOpen && (
              <aside className="simulation-panel" id="simulation-details" aria-label="Simulation settings">
                <div className="simulation-status"><span className={simulationPowered ? "live" : ""} />
                  <strong>{simulationPowered ? "Preview running" : "Power paused"}</strong>
                </div>
                <label><span>Behavior speed</span><output>{simulationRate.toFixed(1)}×</output>
                  <input type="range" aria-label="Simulation speed" min="0.25" max="2" step="0.25" value={simulationRate}
                    onChange={(event) => setSimulationRate(Number(event.target.value))} />
                </label>
                <button className="simulation-power" onClick={() => setSimulationPowered((powered) => !powered)}>
                  {simulationPowered ? "Pause power" : "Resume power"}
                </button>
                <div className="simulation-parts">
                  <div className="simulation-parts-heading">
                    <strong>Parts on your workbench</strong>
                    <span>{simulationIncluded.length} active</span>
                  </div>
                  {kitParts.filter((part) => part.shape !== "wire").map((part) => {
                    const connected = kitParts.some((wire) => wire.shape === "wire"
                      && (wire.wireStartTarget === part.instanceId || wire.wireEndTarget === part.instanceId));
                    return <label key={part.instanceId} className="simulation-part-row">
                      <input type="checkbox" checked={simulationIncluded.includes(part.instanceId)}
                        onChange={(event) => setSimulationIncluded((included) => event.target.checked
                          ? [...included, part.instanceId]
                          : included.filter((id) => id !== part.instanceId))} />
                      <span><strong>{part.name}</strong><small>{connected ? "Connected by jumper wire" : "Placed · no targeted wire"}</small></span>
                      <i className={connected ? "connected" : ""} title={connected ? "Connected" : "Not connected"} />
                    </label>;
                  })}
                  {kitParts.filter((part) => part.shape !== "wire").length === 0
                    && <p className="simulation-empty">Add a board or component to preview it.</p>}
                </div>
                <p><strong>Behavior preview</strong> animates every checked part and shows a moving signal on included wires while preserving the plan.</p>
                <p className="simulation-caveat">Electrical accuracy is unavailable until components have pin-level connections and Arduino code.</p>
              </aside>
            )}
            {kitParts.length > 0 && !simulationRunning && (
              <div className="part-actions">
                <span>{selectedKitPart ? "Part selected" : `${kitParts.length} placed`}</span>
                <button disabled={!selectedKitPart} onClick={() => setKitParts((items) => items.map((item) =>
                  item.instanceId === selectedKitPart ? { ...item, rotation: item.rotation + Math.PI / 4 } : item))}>Rotate</button>
                <button disabled={!selectedKitPart} onClick={() => {
                  setKitParts((items) => items.filter((item) => item.instanceId !== selectedKitPart));
                  setSelectedKitPart(null);
                }}>Delete</button>
                <button onClick={() => { setKitParts([]); setSelectedKitPart(null); }}>Clear</button>
              </div>
            )}
          </>
        )}

        <div className="stage-dock">
          <div className="instruction">
            {mode !== "plan" && world.frame > 0 ? (
              <>
                <strong>Next</strong>
                <p>{guidance.nextAction}</p>
                {guidance.progress.expected > 0 && (
                  <p className="tally">
                    {guidance.progress.placed} of {guidance.progress.expected} parts
                    placed correctly
                  </p>
                )}
              </>
            ) : current && (
              <>
                <strong>Step {current.n} of {last}</strong>
                <p>{current.instruction}</p>
                {current.warning && <p className="warn">{current.warning}</p>}
                {current.completion && current.completion !== "workspace" && (
                  <button className={`manual-complete ${currentManuallyDone ? "done" : ""}`}
                    onClick={toggleManualStep}>
                    {currentManuallyDone ? "✓ Marked complete" : current.completion === "test"
                      ? "Mark test passed" : "Mark step complete"}
                  </button>
                )}
                {current.artifactIds?.map((artifactId) => {
                  const artifact = plan.artifacts?.find((item) => item.id === artifactId);
                  return artifact ? (
                    <details className="artifact" key={artifact.id}>
                      <summary>{artifact.title}</summary>
                      <pre><code>{artifact.content}</code></pre>
                    </details>
                  ) : null;
                })}
              </>
            )}
          </div>

        <div className="controls">
          <button onClick={() => setStep((s) => Math.max(1, s - 1))} disabled={step === 1}>
            &larr; Back
          </button>
          <span className="progress">{step} / {last}</span>
          <button onClick={() => setStep((s) => Math.min(last, s + 1))} disabled={step === last}>
            Next &rarr;
          </button>
          <button className={exploded ? "toggle on" : "toggle"}
                  onClick={() => setExploded((e) => !e)}>Exploded</button>
          <button className={labels ? "toggle on" : "toggle"}
                  onClick={() => setLabels((v) => !v)}
                  disabled={mode === "plan"}>Labels</button>
          <button className={narrate ? "toggle on" : "toggle"}
                  onClick={() => setNarrate((n) => !n)}
                  disabled={keys.xai === "missing" || voice === "live"}
                  title={keys.xai === "missing" ? "XAI_API_KEY missing from .env" : ""}>
            Narrate
          </button>
          </div>
        </div>
      </main>

      {projectsOpen && (
        <ProjectPanel projects={projects} activeId={project.id} busy={goalBusy}
          error={goalError} onClose={() => setProjectsOpen(false)} onOpen={openProject}
          onGoal={buildGoal}
          onExample={() => { void addProject(createProject(MOCK_PLAN, "LED blink example")); }}
          onDelete={(target) => { void removeProject(target); }} />
      )}
    </div>
  );
}

/** Find one part by name, for the voice assistant. */
function whereIs(query: string, world: World): string {
  const q = query.toLowerCase().replace(/^(the|my|a)\s+/, "").trim();
  if (!q) return "Tell me which part you mean.";
  const words = q.split(/\s+/).filter((w) => w.length > 2);

  const scored = world.entities
    .map((e) => {
      const hay = `${e.label} ${e.kind ?? ""} ${e.colorName}`.toLowerCase();
      return { e, hits: words.filter((w) => hay.includes(w)).length };
    })
    .filter((s) => s.hits > 0)
    .sort((a, b) => b.hits - a.hits);

  if (!scored.length) {
    const seen = world.entities.map((e) => e.label).join(", ") || "nothing";
    return `I cannot see anything matching "${query}" on the board. What I can see is: ${seen}.`;
  }
  const { e } = scored[0];
  const caveat = e.confidence === "low"
    ? " I am not fully sure of that position -- it is near the end of the board." : "";
  const value = e.value ? ` It reads ${e.value}.`
    : e.unreadable ? " I could not read its markings." : "";
  return `${e.label} is at ${e.footprint}.${value}${caveat}`;
}

/** The live-map controls and the plan-versus-reality read-out. */
function BoardTracker({ world, guidance, tracking, error, down, onToggle, onFlip,
                        onReset, onShowMap, mapOpen }: {
  world: World;
  guidance: ReturnType<typeof reconcile>;
  tracking: boolean;
  error: string;
  down: boolean;
  onToggle: () => void;
  onFlip: () => void;
  onReset: () => void;
  onShowMap: () => void;
  mapOpen: boolean;
}) {
  const found = world.board.found;
  const interesting = guidance.checks.filter(
    (c) => c.status === "misplaced" || c.status === "missing" || c.status === "unverified");
  const loud = guidance.issues.filter((i) => i.severity !== "info");

  return (
    <section className="tracker">
      <h3>Board tracking</h3>

      <div className="trackbar">
        <button className={`trackbtn ${tracking ? "on" : ""}`} onClick={onToggle} disabled={down}>
          <span className={`dot ${tracking ? (found ? "live" : "connecting") : ""}`} />
          {tracking ? "Stop" : "Track my board"}
        </button>
        {tracking && <button className="ghostbtn" onClick={onShowMap}>
          {mapOpen ? "Hide" : "What it sees"}
        </button>}
      </div>

      {down && (
        <p className="error">
          Vision service is not running. Start it with{" "}
          <code>python -m vision.service</code>
        </p>
      )}
      {error && !down && <p className="error">{error}</p>}

      {tracking && !found && (
        <p className="hint">{world.board.hint || "Looking for the board…"}</p>
      )}

      {found && (
        <>
          <p className="hint">
            <span className="num">{world.entities.length}</span>{" "}
            part{world.entities.length === 1 ? "" : "s"} seen,{" "}
            {world.board.confidence} confidence
          </p>
          <div className="trackbar">
            <button className="ghostbtn" onClick={onFlip} title="Which end of the board holds column 1">
              Column 1: {world.orientation?.flipped ? "right" : "left"}
            </button>
            <button className="ghostbtn" onClick={onReset}>Forget</button>
          </div>

          {loud.map((i, n) => (
            <p key={n} className={i.severity === "error" ? "problem" : "hint warnhint"}>
              {i.message}
            </p>
          ))}

          <ul className="checks">
            {interesting.length === 0 && guidance.progress.expected > 0 && (
              <li><span className="pip" style={{ background: STATUS_COLOR.placed }} />
                Everything so far is right.</li>
            )}
            {interesting.map((c) => (
              <li key={c.part.id}>
                <span className="pip" style={{ background: STATUS_COLOR[c.status] }} />
                {c.detail}
              </li>
            ))}
            {guidance.extras.map((e) => (
              <li key={e.id} className="extra">
                <span className="pip" style={{ background: STATUS_COLOR.extra }} />
                {e.label} at {e.footprint}, not in this circuit.
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function VoiceBar({ status, error, muted, onStart, onStop, onMute }: {
  status: RealtimeStatus; error: string; muted: boolean;
  onStart: () => void; onStop: () => void; onMute: () => void;
}) {
  const live = status === "live";
  return (
    <div className="voicebar">
      <button className={`talkbtn ${live ? "live" : ""}`}
              onClick={live || status === "connecting" ? onStop : onStart}>
        <span className={`dot ${status}`} />
        {status === "connecting" ? "Connecting…" : live ? "End call" : "Talk to the TA"}
      </button>
      {live && (
        <button className={`mutebtn ${muted ? "on" : ""}`} onClick={onMute}>
          {muted ? "Unmute" : "Mute"}
        </button>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
