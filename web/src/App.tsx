import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Scene, type ViewMode } from "./three/Scene";
import { STATUS_COLOR } from "./three/World";
import { CameraPanel } from "./ui/CameraPanel";
import { BoardMap } from "./ui/BoardMap";
import { LaserPanel } from "./ui/LaserPanel";
import { MOCK_PLAN } from "./lib/mockPlan";
import { requestPlan, speak, health } from "./lib/api";
import { analyseFrame, resetWorld, setOrientation, EMPTY_WORLD, type World } from "./lib/world";
import { reconcile, guidanceText } from "./lib/guidance";
import {
  pointAt, moveLaser, nudgeLaser, setLaserPower, laserCentre, laserConnect,
  laserStatus, type Direction, type NudgeSize,
} from "./lib/laser";
import type { Plan } from "./lib/types";
import { OpenAIVoiceSession } from "./lib/realtime";
import { GrokVoiceSession } from "./lib/grokVoice";
import type { RealtimeStatus, Utterance, VoiceSession } from "./lib/voice";
import {
  ComponentsDrawer, STARTER_KIT_PARTS, type PlacedKitPart,
} from "./components/StarterKit";
import { SiteFooter } from "./components/SiteFooter";
import "./App.css";

/** How often a frame goes to the vision service while tracking is on. */
const TRACK_INTERVAL_MS = 450;

export default function App() {
  const [plan, setPlan] = useState<Plan>(MOCK_PLAN);
  const [step, setStep] = useState(1);
  const [exploded, setExploded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [problem, setProblem] = useState("");
  const [narrate, setNarrate] = useState(true);
  const [keys, setKeys] = useState<{
    openai?: string; xai?: string; voiceProvider?: string; vision?: string;
  }>({});
  const [isMock, setIsMock] = useState(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // --- the live map of the board ---
  const [world, setWorld] = useState<World>(EMPTY_WORLD);
  const [tracking, setTracking] = useState(false);
  const [visionErr, setVisionErr] = useState("");
  const [mode, setMode] = useState<ViewMode>("plan");
  const [labels, setLabels] = useState(true);
  const [showMap, setShowMap] = useState(false);
  const [componentsOpen, setComponentsOpen] = useState(false);
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

  const last = plan.steps.length;
  const current = plan.steps.find((s) => s.n === step);

  const guidance = useMemo(
    () => reconcile(plan, world, step), [plan, world, step]);
  const worldRef = useRef(world); worldRef.current = world;
  const guidanceRef = useRef(guidance); guidanceRef.current = guidance;

  // Narrate whenever the step changes, cutting off whatever was playing.
  useEffect(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    if (!narrate || !current || voice === "live") return;
    const text = `Step ${current.n}. ${current.title}. ${current.instruction} ${current.warning ?? ""}`;
    let cancelled = false;
    speak(text).then((a) => {
      if (cancelled) a?.pause();
      else audioRef.current = a;
    });
    return () => { cancelled = true; };
  }, [step, narrate, current?.n, plan.title, voice]);

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
        const target = hole || guidanceRef.current.focus.holes[0];
        if (!target) return "There is nothing to point at yet.";
        try {
          const r = await pointAt(target);
          return r.ok
            ? `The laser is now pointing at ${r.hole ?? target}.`
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
    const offset = (kitParts.length % 5) * 7 - 14;
    const placedAt = position ?? [offset, 5.7, 8] as [number, number, number];
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

  async function onCapture(dataUrl: string) {
    setBusy(true); setError("");
    try {
      const p = await requestPlan(dataUrl);
      // `problem` can accompany a perfectly good plan -- a missing resistor is
      // still a working set of steps, and the student must see the warning.
      setProblem(p.problem ?? "");
      if (p.steps?.length) {
        setPlan(p); setStep(1); setIsMock(false);
      } else if (!p.problem) {
        setError("The model returned no assembly steps.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const visionDown = keys.vision === "not running";

  return (
    <div className="app">
      <aside className="panel">
        <header>
          <h1>{plan.title}</h1>
          <p className="summary">{plan.summary}</p>
          {isMock && <p className="mock-note">Example circuit — scan your bench to replace it.</p>}
        </header>

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

        <LaserPanel focus={guidance.focus.holes} why={guidance.focus.why} />

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
            <input name="q" placeholder="…or type a question" autoComplete="off" />
          </form>
        )}
        {talk.length > 0 && (
          <div className="talk">
            {talk.map((u, i) => (
              <p key={i} className={u.who}><span>{u.who === "you" ? "You" : "TA"}</span>{u.text}</p>
            ))}
          </div>
        )}
        {error && <p className="error">{error}</p>}
        {problem && <p className="problem"><strong>Before you power up:</strong> {problem}</p>}
        {keys.openai === "missing" && (
          <p className="error">OPENAI_API_KEY missing from .env — scanning is disabled.</p>
        )}

        <section>
          <h2>On the bench</h2>
          <ul className="detected">
            {plan.detected.map((d, i) => (
              <li key={i} className={d.confidence === "low" ? "low" : ""}>
                <span className="count">{d.count}&times;</span>
                <span className="label">{d.label}</span>
                {d.unreadable && <span className="flag" title="markings not legible">?</span>}
              </li>
            ))}
          </ul>
        </section>

        <section className="steps">
          <h2>Assembly</h2>
          {plan.steps.map((s) => {
            const done = guidance.completeSteps.includes(s.n);
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
        <SiteFooter compact />
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
          addKitPart(partId, [Math.max(-74, Math.min(74, x)), 5.7, Math.max(-45, Math.min(45, z))]);
        }}>
        <Scene plan={plan} step={step} exploded={exploded}
               mode={mode} world={world} guidance={guidance} labels={labels}
               kitParts={kitParts} selectedKitPart={selectedKitPart}
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
            {kitParts.length > 0 && (
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

        <div className="instruction">
          {mode !== "plan" && world.frame > 0 ? (
            <>
              <strong>Next</strong>
              <p>{guidance.nextAction}</p>
              {guidance.progress.expected > 0 && (
                <p className="tally">
                  {guidance.progress.placed} of {guidance.progress.expected} parts
                  due so far are in the right place.
                </p>
              )}
            </>
          ) : current && (
            <>
              <strong>Step {current.n} of {last} &mdash; {current.title}</strong>
              <p>{current.instruction}</p>
              {current.warning && <p className="warn">{current.warning}</p>}
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
      </main>
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
    (c) => c.status === "misplaced" || c.status === "missing");
  const loud = guidance.issues.filter((i) => i.severity !== "info");

  return (
    <section className="tracker">
      <h2>My board, live</h2>

      <div className="trackbar">
        <button className={`trackbtn ${tracking ? "on" : ""}`} onClick={onToggle} disabled={down}>
          <span className={`dot ${tracking ? (found ? "live" : "connecting") : ""}`} />
          {tracking ? "Stop tracking" : "Track my board"}
        </button>
        {tracking && <button className="ghostbtn" onClick={onShowMap}>
          {mapOpen ? "Hide view" : "What it sees"}
        </button>}
      </div>

      {down && (
        <p className="error">
          The vision service is not running. Start it with{" "}
          <code>.venv/bin/python -m vision.service</code>
        </p>
      )}
      {error && !down && <p className="error">{error}</p>}

      {tracking && !found && (
        <p className="hint">{world.board.hint || "Looking for the breadboard…"}</p>
      )}

      {found && (
        <>
          <p className="hint">
            {world.entities.length} part{world.entities.length === 1 ? "" : "s"} on the
            board · board seen with {world.board.confidence} confidence
          </p>
          <div className="trackbar">
            <button className="ghostbtn" onClick={onFlip} title="Which end of the board holds column 1">
              Column 1: {world.orientation?.flipped ? "right" : "left"}
            </button>
            <button className="ghostbtn" onClick={onReset}>Forget parts</button>
          </div>

          {loud.map((i, n) => (
            <p key={n} className={i.severity === "error" ? "problem" : "hint warnhint"}>
              {i.message}
            </p>
          ))}

          <ul className="checks">
            {interesting.length === 0 && guidance.progress.expected > 0 && (
              <li><span className="pip" style={{ background: STATUS_COLOR.placed }} />
                Everything due so far is in the right place.</li>
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
                {e.label} at {e.footprint} — not part of this circuit.
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
        {status === "connecting" ? "Connecting…" : live ? "End conversation" : "Talk to the TA"}
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
