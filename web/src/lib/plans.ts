import { netOf, parseHole } from "./breadboard";
import { legacyPinLocation } from "./workspace";
import type {
  DetectedPart, ExternalDevice, ExternalDeviceKind, ExternalDevicePort,
  Part, PartKind, Plan, PlanSource, Project, Requirement, Step, BuildSnapshot,
} from "./types";
import type { Entity, World } from "./world";
import { REPLAY_LIMIT } from "./replay";

const PART_KINDS = new Set<PartKind>([
  "resistor", "led", "capacitor", "ic", "transistor",
  "button", "potentiometer", "module", "wire",
]);
const DEVICE_KINDS = new Set<ExternalDeviceKind>([
  "arduino-uno", "micro-servo", "power-supply", "generic",
]);
const STEP_KINDS = new Set<NonNullable<Step["kind"]>>([
  "placement", "configure", "code", "test", "safety",
]);
const STEP_COMPLETIONS = new Set<NonNullable<Step["completion"]>>([
  "workspace", "manual", "test",
]);

function uid(prefix: string): string {
  const id = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${id}`;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function positiveInteger(value: unknown, fallback = 1): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function finiteInteger(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function detectedOf(value: unknown): DetectedPart[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const label = text(row.label);
    if (!label) return [];
    return [{
      label,
      count: positiveInteger(row.count),
      confidence: text(row.confidence, "low"),
      unreadable: Boolean(row.unreadable),
    }];
  });
}

function requirementsFrom(inventory: DetectedPart[]): Requirement[] {
  return inventory.map((item, index) => ({
    id: `observed-${index + 1}`,
    label: item.label,
    count: item.count,
    availability: "seen",
    note: item.unreadable ? "Markings were not legible." : undefined,
  }));
}

function partsOf(value: unknown): Part[] {
  if (!Array.isArray(value)) throw new Error("The plan has no parts list.");
  const ids = new Set<string>();
  return value.map((item, index) => {
    if (!item || typeof item !== "object") throw new Error(`Part ${index + 1} is invalid.`);
    const row = item as Record<string, unknown>;
    const id = text(row.id);
    const kind = text(row.kind) as PartKind;
    const label = text(row.label);
    const pins = Array.isArray(row.pins) ? row.pins.map((pin) => text(pin)).filter(Boolean) : [];
    if (!id || ids.has(id)) throw new Error(`Part ${index + 1} has a missing or duplicate id.`);
    if (!PART_KINDS.has(kind)) throw new Error(`${label || id} has unsupported kind ${kind || "(empty)"}.`);
    if (!label || pins.length === 0) throw new Error(`${id} needs a label and at least one location.`);
    for (const pin of pins) {
      if (!parseHole(pin) && !pin.toUpperCase().startsWith("EXT:")) {
        throw new Error(`${label} uses unknown location ${pin}.`);
      }
    }
    if (kind !== "wire" && pins.length === 2) {
      const nodes = pins.map(netOf).filter((node): node is string => node !== null);
      if (nodes.length === 2 && nodes[0] === nodes[1]) {
        throw new Error(`${label} has both terminals on ${nodes[0]}.`);
      }
    }
    ids.add(id);
    return {
      id, kind, label, pins,
      terminals: pins.map((pin, pinIndex) => ({
        terminalId: `terminal-${pinIndex + 1}`,
        target: legacyPinLocation(pin),
      })),
      color: text(row.color) || undefined,
      value: text(row.value) || undefined,
      polarised: Boolean(row.polarised),
    };
  });
}

function defaultPorts(kind: ExternalDeviceKind): ExternalDevicePort[] {
  if (kind === "arduino-uno") {
    return ["D2", "D9", "D13", "5V", "GND"].map((label) => ({
      id: label.toLowerCase(), label,
    }));
  }
  if (kind === "micro-servo") {
    return ["signal", "5V", "GND"].map((label) => ({ id: label.toLowerCase(), label }));
  }
  return [];
}

function deviceKind(value: unknown, label: string): ExternalDeviceKind {
  const explicit = text(value) as ExternalDeviceKind;
  if (DEVICE_KINDS.has(explicit)) return explicit;
  const name = label.toLowerCase();
  if (name.includes("arduino") || name.includes("uno")) return "arduino-uno";
  if (name.includes("servo")) return "micro-servo";
  if (name.includes("supply") || name.includes("battery")) return "power-supply";
  return "generic";
}

function portsOf(value: unknown, kind: ExternalDeviceKind): ExternalDevicePort[] {
  if (!Array.isArray(value)) return defaultPorts(kind);
  const ports = value.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const label = text(row.label, text(row.id));
    if (!label) return [];
    return [{
      id: text(row.id, `port-${index + 1}`),
      label,
      aliases: Array.isArray(row.aliases)
        ? row.aliases.map((alias) => text(alias)).filter(Boolean) : undefined,
    }];
  });
  return ports.length ? ports : defaultPorts(kind);
}

function inferredDevices(parts: Part[], requirements: Requirement[]): ExternalDevice[] {
  const refs = parts.flatMap((part) => part.pins)
    .filter((pin) => pin.trim().toUpperCase().startsWith("EXT:"))
    .map((pin) => pin.trim().slice(4).trim());
  const needed = requirements.map((item) => item.label);
  const out: ExternalDevice[] = [];
  const addKnown = (id: string, kind: ExternalDeviceKind, label: string, aliases: string[]) => {
    const mentioned = [...refs, ...needed]
      .some((ref) => aliases.some((alias) => ref.toLowerCase().includes(alias.toLowerCase())));
    if (!mentioned) return;
    out.push({
      id, kind, label, aliases,
      color: kind === "arduino-uno" ? "#0d7d8c" : "#2563eb",
      ports: defaultPorts(kind),
      visibleFromStep: 1,
      placement: { side: kind === "arduino-uno" ? "front" : "right", order: 0 },
    });
  };
  addKnown("arduino", "arduino-uno", "Arduino Uno", ["Arduino Uno", "Arduino", "Uno"]);
  addKnown("servo", "micro-servo", "Micro servo", ["Micro servo", "Servo"]);
  return out;
}

function devicesOf(value: unknown, parts: Part[], requirements: Requirement[]): ExternalDevice[] {
  if (!Array.isArray(value)) return inferredDevices(parts, requirements);
  const ids = new Set<string>();
  const devices = value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const id = text(row.id);
    const label = text(row.label);
    if (!id || ids.has(id) || !label) return [];
    ids.add(id);
    const kind = deviceKind(row.kind, label);
    const placementRow = row.placement && typeof row.placement === "object"
      ? row.placement as Record<string, unknown> : null;
    const sideText = text(placementRow?.side);
    const side = (["front", "left", "right"].includes(sideText)
      ? sideText : "front") as "front" | "left" | "right";
    return [{
      id, kind, label,
      color: text(row.color) || undefined,
      aliases: Array.isArray(row.aliases)
        ? row.aliases.map((alias) => text(alias)).filter(Boolean) : undefined,
      ports: portsOf(row.ports, kind),
      visibleFromStep: positiveInteger(row.visibleFromStep),
      placement: placementRow && ["front", "left", "right"].includes(sideText)
        ? { side, order: finiteInteger(placementRow.order) }
        : undefined,
    } satisfies ExternalDevice];
  });
  return devices.length ? devices : inferredDevices(parts, requirements);
}

function stepsOf(value: unknown, partIds: Set<string>): Step[] {
  if (!Array.isArray(value)) throw new Error("The plan has no assembly steps.");
  const stepIds = new Set<string>();
  return value.map((item, index) => {
    if (!item || typeof item !== "object") throw new Error(`Step ${index + 1} is invalid.`);
    const row = item as Record<string, unknown>;
    const adds = Array.isArray(row.adds) ? row.adds.map((id) => text(id)).filter(Boolean) : [];
    for (const id of adds) if (!partIds.has(id)) throw new Error(`Step ${index + 1} refers to unknown part ${id}.`);
    const renders = Array.isArray(row.renders)
      ? row.renders.map((id) => text(id)).filter(Boolean) : [];
    for (const id of renders) if (!partIds.has(id)) throw new Error(`Step ${index + 1} renders unknown part ${id}.`);
    const requestedKind = text(row.kind) as NonNullable<Step["kind"]>;
    const requestedCompletion = text(row.completion) as NonNullable<Step["completion"]>;
    const n = index + 1;
    const id = text(row.id, `step-${n}`);
    if (stepIds.has(id)) throw new Error(`Step ${n} has duplicate id ${id}.`);
    stepIds.add(id);
    return {
      id,
      n,
      title: text(row.title, `Step ${n}`),
      instruction: text(row.instruction),
      adds,
      renders: renders.length ? renders : undefined,
      warning: text(row.warning) || undefined,
      kind: STEP_KINDS.has(requestedKind)
        ? requestedKind : (adds.length ? "placement" : "configure"),
      completion: STEP_COMPLETIONS.has(requestedCompletion)
        ? requestedCompletion : (adds.length ? "workspace" : "manual"),
      artifactIds: Array.isArray(row.artifactIds)
        ? row.artifactIds.map((id) => text(id)).filter(Boolean) : undefined,
    };
  });
}

/** Validate and migrate model or stored JSON before it becomes an active plan. */
export function normalizePlan(raw: unknown, source?: PlanSource): Plan {
  if (!raw || typeof raw !== "object") throw new Error("The plan response was not an object.");
  const row = raw as Record<string, unknown>;
  const title = text(row.title);
  if (!title) throw new Error("The plan has no title.");
  const problem = text(row.problem);

  const detected = detectedOf(row.observedInventory ?? row.detected);
  let parts = partsOf(row.parts);
  const legacyServoGoal = text(row.id).startsWith("goal-servo-button-")
    && !parts.some((part) => part.id === "servo-signal");
  if (legacyServoGoal) {
    const externalWire = (id: string, label: string, pins: string[], color: string): Part => ({
      id, kind: "wire", label, pins, color, polarised: false,
      terminals: pins.map((pin, pinIndex) => ({
        terminalId: `terminal-${pinIndex + 1}`, target: legacyPinLocation(pin),
      })),
    });
    parts = [
      ...parts,
      externalWire("servo-signal", "Arduino D9 to servo signal",
        ["EXT:Arduino D9", "EXT:Servo signal"], "#f2a23a"),
      externalWire("servo-power", "Arduino 5V to servo power",
        ["EXT:Arduino 5V", "EXT:Servo 5V"], "#e24b43"),
      externalWire("servo-ground", "Arduino GND to servo ground",
        ["EXT:Arduino GND", "EXT:Servo GND"], "#24262b"),
    ];
  }
  // Projects created before external-device rendering used rail holes as visual
  // stand-ins for the Uno. Preserve their progress while upgrading the two
  // known jumpers to the real device sockets.
  if (text(row.id) === "builtin-led-blink" && Number(row.revision) < 2) {
    const upgradePins = (part: Part, pins: string[]): Part => ({
      ...part, pins,
      terminals: pins.map((pin, pinIndex) => ({
        terminalId: `terminal-${pinIndex + 1}`, target: legacyPinLocation(pin),
      })),
    });
    parts = parts.map((part) => part.id === "w1"
      ? upgradePins(part, ["A20", "EXT:Arduino D13"])
      : part.id === "w3" ? upgradePins(part, ["B-10", "EXT:Arduino GND"]) : part);
  }
  let steps = stepsOf(row.steps, new Set(parts.map((part) => part.id)));
  if (legacyServoGoal) {
    steps = steps.map((step) => step.id === "connect-servo"
      ? {
          ...step,
          renders: ["servo-signal", "servo-power", "servo-ground"],
          instruction: "Connect the servo signal lead to Arduino D9, ground to Arduino GND, "
            + "and the red lead to Arduino 5V for this small micro servo.",
        }
      : step);
  }
  if (!steps.length) throw new Error(problem || "The plan has no assembly steps.");
  const storedSource = row.source as PlanSource | undefined;
  const actualSource = source ?? storedSource ?? { kind: "photo", generatedAt: new Date().toISOString() };

  const requirements = Array.isArray(row.requirements)
    ? (row.requirements as Requirement[])
    : requirementsFrom(detected);
  let devices = devicesOf(row.devices, parts, requirements);
  if (legacyServoGoal) {
    devices = devices.map((device) => device.kind === "micro-servo"
      ? { ...device, visibleFromStep: 4, placement: { side: "right", order: 0 } }
      : device.kind === "arduino-uno"
        ? { ...device, visibleFromStep: 1, placement: { side: "front", order: 0 } }
        : device);
  }
  const storedWarnings = Array.isArray(row.warnings) ? row.warnings as Plan["warnings"] : [];

  return {
    schemaVersion: 1,
    id: text(row.id, uid("plan")),
    revision: text(row.id) === "builtin-led-blink"
      ? Math.max(2, Number(row.revision) || 1)
      : Math.max(1, Number(row.revision) || 1),
    title,
    summary: text(row.summary),
    workspace: { profileId: "breadboard-830", profileVersion: 1 },
    source: actualSource,
    requirements,
    detected,
    observedInventory: detected,
    devices,
    parts,
    steps,
    warnings: problem && !storedWarnings.some((warning) => warning.message === problem)
      ? [{ severity: "warn", message: problem, blocksPower: true }, ...storedWarnings]
      : storedWarnings,
    artifacts: Array.isArray(row.artifacts) ? row.artifacts as Plan["artifacts"] : [],
    problem: problem || undefined,
  };
}

export function createProject(plan: Plan, name = plan.title, goal?: string): Project {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: uid("project"),
    name,
    goal,
    plan,
    progress: {
      currentStep: plan.steps[0]?.n ?? 1,
      currentStepId: plan.steps[0]?.id,
      manuallyCompletedStepIds: [],
    },
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizeProject(raw: unknown): Project {
  if (!raw || typeof raw !== "object") throw new Error("Invalid saved project.");
  const row = raw as Record<string, unknown>;
  const plan = normalizePlan(row.plan);
  const progress = row.progress && typeof row.progress === "object"
    ? row.progress as Record<string, unknown> : {};
  const createdAt = text(row.createdAt, new Date().toISOString());
  const requestedStep = positiveInteger(progress.currentStep);
  const requestedStepId = text(progress.currentStepId);
  const stepById = requestedStepId
    ? plan.steps.find((step) => step.id === requestedStepId) : undefined;
  const activeStep = stepById
    ?? plan.steps.find((step) => step.n === requestedStep)
    ?? plan.steps[0];
  const validStepIds = new Set(plan.steps.map((step) => step.id).filter(Boolean));
  const completedStepIds = Array.isArray(progress.manuallyCompletedStepIds)
    ? [...new Set(progress.manuallyCompletedStepIds.map((id) => text(id)))]
      .filter((id) => id && validStepIds.has(id))
    : [];
  return {
    schemaVersion: 1,
    id: text(row.id, uid("project")),
    name: text(row.name, plan.title),
    goal: text(row.goal) || undefined,
    plan,
    progress: {
      currentStep: activeStep?.n ?? 1,
      currentStepId: activeStep?.id,
      manuallyCompletedStepIds: completedStepIds,
    },
    createdAt,
    updatedAt: text(row.updatedAt, createdAt),
    replay: normalizeReplay(row.replay),
  };
}

/** Reconstruct exported history from supported measurement fields only. */
function normalizeReplay(raw: unknown): BuildSnapshot[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > REPLAY_LIMIT) throw new Error("Invalid build replay.");
  return raw.map((value) => {
    const snapshot = value as BuildSnapshot;
    const world = snapshot?.world;
    if (!snapshot || typeof snapshot.id !== "string" || !Number.isFinite(snapshot.at)
      || !world?.board?.found || !Array.isArray(world.entities) || !Array.isArray(world.issues)
      || world.entities.length > 500) throw new Error("Invalid board snapshot.");
    const entities: Entity[] = world.entities.map((e) => {
      const strings = ["id", "label", "value", "footprint", "footprintBox", "colorHex", "colorName", "note", "describe"] as const;
      const arrays = ["pins", "holes", "nets"] as const;
      if (!e || strings.some((key) => typeof e[key] !== "string")
        || arrays.some((key) => !Array.isArray(e[key]) || e[key].some((entry) => typeof entry !== "string"))
        || !e.centreMm || !e.sizeMm || ![e.centreMm.x, e.centreMm.z, e.sizeMm.length, e.sizeMm.width, e.sizeMm.area, e.angleDeg].every(Number.isFinite)
        || (e.kind !== null && !PART_KINDS.has(e.kind))) throw new Error("Invalid replay component.");
      return {
        id: e.id, label: e.label, value: e.value, footprint: e.footprint, footprintBox: e.footprintBox,
        colorHex: /^#[0-9a-f]{6}$/i.test(e.colorHex) ? e.colorHex : "#888888", colorName: e.colorName,
        note: e.note, describe: e.describe, pins: e.pins, holes: e.holes, nets: e.nets,
        kind: e.kind, identified: Boolean(e.identified), unreadable: Boolean(e.unreadable), polarised: Boolean(e.polarised),
        confidence: ["high", "medium", "low"].includes(e.confidence) ? e.confidence : "low",
        shape: e.shape === "wire" ? "wire" : "body", straddlesChannel: Boolean(e.straddlesChannel),
        atEdge: Boolean(e.atEdge), present: Boolean(e.present), seenFrames: 0, ageS: 0,
        centreMm: { x: e.centreMm.x, z: e.centreMm.z },
        sizeMm: { length: e.sizeMm.length, width: e.sizeMm.width, area: e.sizeMm.area }, angleDeg: e.angleDeg,
        terminalEvidence: ["measured", "inferred", "unknown"].includes(e.terminalEvidence ?? "") ? e.terminalEvidence : "unknown",
      };
    });
    const cleanWorld: World = {
      at: snapshot.at, frame: Math.max(1, positiveInteger(world.frame)), board: { found: true }, entities,
      nets: Object.fromEntries([...new Set(entities.flatMap((e) => e.nets))].map((net) => [net, entities.filter((e) => e.nets.includes(net)).map((e) => e.id)])),
      issues: world.issues.map((issue) => {
        if (!issue || !["error", "warn", "info"].includes(issue.severity) || typeof issue.message !== "string"
          || !Array.isArray(issue.entities) || issue.entities.some((id) => typeof id !== "string")) throw new Error("Invalid replay issue.");
        return { severity: issue.severity, message: issue.message, entities: issue.entities };
      }),
      errors: [], summary: text(world.summary), orientation: { flipped: Boolean(world.orientation?.flipped), source: "replay" },
    };
    const plan = normalizePlan(snapshot.plan);
    return { id: snapshot.id, at: snapshot.at, summary: text(snapshot.summary),
      step: Math.min(plan.steps.length, positiveInteger(snapshot.step)), world: cleanWorld, plan };
  });
}
