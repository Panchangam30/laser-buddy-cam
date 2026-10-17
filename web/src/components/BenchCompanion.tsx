import { useState } from "react";
import { ArrowUpRight, Check, CircuitBoard, FlaskConical, ShieldCheck, Wrench, Zap } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "./ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { BAND_COLORS, formatOhms, ledResistor } from "../lib/bench";
import "./BenchCompanion.css";

const CHECKS = [
  ["Power is disconnected", "Remove USB and external power before touching wiring."],
  ["Polarity matches the plan", "Check LED legs, supply polarity, and component pin labels."],
  ["Any LEDs have a series resistor", "Confirm its value with the decoder or a meter; skip if there are no LEDs."],
  ["Power and ground are separate", "Trace the rails and check for accidental bridges."],
  ["Every connection has been inspected", "Compare the real wiring with the current plan, including hidden leads."],
];

function ResistorDecoder() {
  const [bands, setBands] = useState([2, 2, 1]);
  const [tolerance, setTolerance] = useState("5");
  const resistance = (bands[0] * 10 + bands[1]) * 10 ** bands[2];
  return <div className="bench-tool">
    <div className="bench-tool-heading"><h3>Decode a four-band resistor</h3><p>Read from the end opposite the spaced tolerance band, then match the colors below.</p></div>
    <div className="resistor-stage" aria-label={`${formatOhms(resistance)}, plus or minus ${tolerance} percent`}>
      <div className="resistor-lead" /><div className="resistor-body">{bands.map((band, i) => <i key={i} style={{ background: BAND_COLORS[band].hex }} />)}<i className="tolerance-band" style={{ background: tolerance === "5" ? "#b79042" : "#aeb6c0" }} /></div><div className="resistor-lead" />
      <span className="resistor-reading">{formatOhms(resistance)} <small>±{tolerance}%</small></span>
    </div>
    <div className="bench-fields four">{bands.map((band, i) => <label key={i}>{["1st digit", "2nd digit", "Multiplier"][i]}<select value={band} onChange={(event) => setBands((previous) => previous.map((value, index) => index === i ? Number(event.target.value) : value))}>{BAND_COLORS.filter((_, index) => i !== 0 || index !== 0).map((color) => <option value={BAND_COLORS.indexOf(color)} key={color.name}>{color.name}{i === 2 ? ` ×${10 ** BAND_COLORS.indexOf(color)}` : ""}</option>)}</select></label>)}<label>Tolerance<select value={tolerance} onChange={(event) => setTolerance(event.target.value)}><option value="5">Gold · ±5%</option><option value="10">Silver · ±10%</option></select></label></div>
    <p className="bench-note">Four-band decoder · integer multipliers · use a meter if colors are unclear.</p>
  </div>;
}

function LedCalculator() {
  const [supply, setSupply] = useState("5");
  const [forward, setForward] = useState("2");
  const [current, setCurrent] = useState("10");
  const result = ledResistor(Number(supply), Number(forward), Number(current));
  return <div className="bench-tool">
    <div className="bench-tool-heading"><h3>Choose an LED resistor</h3><p>Estimate a series resistor for one LED on a DC supply. Check your LED’s datasheet for its ratings.</p></div>
    <div className="bench-fields">{[{ label: "Supply voltage (V)", value: supply, set: setSupply }, { label: "LED forward voltage (V)", value: forward, set: setForward }, { label: "Target current (mA)", value: current, set: setCurrent }].map((field) => <label key={field.label}>{field.label}<input type="number" min="0.1" step="0.1" value={field.value} onChange={(event) => field.set(event.target.value)} /></label>)}</div>
    <div className="led-result" aria-live="polite">{result ? <><Zap size={26} /><div><span>Suggested E12 value</span><strong>{formatOhms(result.resistance)}</strong><p>Rounded up from {formatOhms(result.minimum)} to limit current.</p></div><div className="led-result-stats"><b>{result.actualMa.toFixed(1)} mA</b><span>estimated current</span><b>{result.watts.toFixed(3)} W</b><span>resistor dissipation</span></div></> : <p role="status">Enter positive values: supply up to 24 V, above the LED voltage, and current up to 30 mA.</p>}</div>
    <p className="bench-note">R = (V supply − V LED) / I · choose a resistor power rating above the estimated dissipation. Confirm the output pin’s current limit when driving from a microcontroller.</p>
  </div>;
}

function PowerChecklist({ projectId }: { projectId: string }) {
  const storageKey = `laser-buddy:bench-checks:v1:${projectId}`;
  const [checks, setChecks] = useState<number[]>(() => {
    try { const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]"); return Array.isArray(saved) ? [...new Set(saved.filter((n): n is number => Number.isInteger(n) && n >= 0 && n < CHECKS.length))] : []; } catch { return []; }
  });
  const [storageError, setStorageError] = useState(false);
  function update(next: number[]) {
    setChecks(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); setStorageError(false); } catch { setStorageError(true); }
  }
  return <div className="bench-tool">
    <div className="bench-tool-heading"><h3>Check the wiring before power</h3><p>A personal inspection checklist for this project. Reset it whenever you change the wiring.</p></div>
    <div className="bench-check-progress"><span>{checks.length} of {CHECKS.length} checked</span><button onClick={() => update([])}>Reset checks</button></div>
    <progress value={checks.length} max={CHECKS.length} aria-label="Inspection checklist completion" />
    <div className="bench-checks">{CHECKS.map(([title, detail], index) => <label key={title}><input type="checkbox" checked={checks.includes(index)} onChange={() => update(checks.includes(index) ? checks.filter((n) => n !== index) : [...checks, index])} /><span className="bench-check-icon"><Check size={14} /></span><span><strong>{title}</strong><small>{detail}</small></span></label>)}</div>
    <p className="bench-note" role="status">{storageError ? "Checks are available for this session; browser storage is unavailable." : "Saved in this browser for this project. These are your manual checks, not an automatic electrical verification."}</p>
  </div>;
}

export function BenchCompanion({ projectId }: { projectId: string }) {
  return <Dialog><DialogTrigger asChild><button className="project-tool" aria-label="Bench companion" title="Resistor decoder, LED calculator, and power checklist"><Wrench size={14} /><span>Bench tools</span></button></DialogTrigger>
    <DialogContent><header className="bench-header"><div><DialogTitle>Bench companion</DialogTitle><DialogDescription>Resistor values, LED sizing, and wiring checks.</DialogDescription></div></header>
      <Tabs defaultValue="resistor"><TabsList aria-label="Bench tools"><TabsTrigger value="resistor"><CircuitBoard size={16} />Resistor decoder</TabsTrigger><TabsTrigger value="led"><FlaskConical size={16} />LED calculator</TabsTrigger><TabsTrigger value="checks"><ShieldCheck size={16} />Power checklist</TabsTrigger></TabsList><TabsContent value="resistor"><ResistorDecoder /></TabsContent><TabsContent value="led"><LedCalculator /></TabsContent><TabsContent value="checks"><PowerChecklist key={projectId} projectId={projectId} /></TabsContent></Tabs>
      <footer className="bench-footer"><span><i />Works without camera or AI setup</span><a href="/hub#challenges">Practice in the Fault Lab <ArrowUpRight size={14} /></a></footer>
    </DialogContent>
  </Dialog>;
}
