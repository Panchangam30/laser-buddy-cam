/**
 * Reconcile the plan with the board, and say what to do next.
 *
 * The plan (types.ts) is what the board should look like. The world (world.ts)
 * is what it does look like. This is the comparison, and it is the thing that
 * lets the assistant say "the resistor is in the wrong column" instead of
 * "check your wiring".
 *
 * Everything here compares NETS, not hole names. A20 and E20 are the same
 * electrical node -- the board's own springs join them -- so a resistor the plan
 * puts in E20 is correctly placed if the student put it in A20. Comparing hole
 * strings would mark a working circuit wrong, which is worse than saying nothing.
 */

import type { Part, Plan } from "./types";
import type { Entity, Issue, World } from "./world";
import {
  anchorLocation, intrinsicNode, legacyPinLocation, type WorkspaceLocation,
} from "./workspace";

export type PartStatus =
  /** Present, and on the right nodes. */
  | "placed"
  /** Something of the right kind is on the board, but not wired where the plan says. */
  | "misplaced"
  /** Present, but this workspace cannot prove its electrical attachment. */
  | "unverified"
  /** The step that adds it has been reached, and it is not there. */
  | "missing"
  /** The student has not got to this step yet. */
  | "not-yet";

export interface PartCheck {
  part: Part;
  step: number;
  status: PartStatus;
  entity?: Entity;
  evidence: "measured" | "inferred" | "unknown";
  /** A sentence that can be read out as is. */
  detail: string;
}

export interface Guidance {
  checks: PartCheck[];
  /** On the board but not in the plan. Often fine -- parts left lying on it. */
  extras: Entity[];
  /** Wiring faults from the world, worst first. */
  issues: Issue[];
  /** First step that is not fully placed; the plan's length when all are. */
  currentStep: number;
  completeSteps: number[];
  progress: { placed: number; expected: number };
  /** One sentence: the single most useful thing to do next. */
  nextAction: string;
  /**
   * The holes the student should be looking at, for the laser to point out.
   * Same subject as nextAction, so the dot and the sentence always agree.
   */
  focus: { targets: WorkspaceLocation[]; holes: string[]; why: string };
  /** True when there is no live map to compare against. */
  blind: boolean;
}

/** The set of electrical nodes a list of holes touches. */
function netsOf(pins: string[]): Set<string> {
  const out = new Set<string>();
  for (const p of pins) {
    const n = intrinsicNode(legacyPinLocation(p));
    // A pin that resolves to nothing is off-board (EXT:) -- it has no node on
    // the board, so it cannot be checked here and is deliberately skipped.
    if (n) out.add(n);
  }
  return out;
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n;
}

/**
 * How well an observed thing matches a planned part. Higher is better;
 * null means they cannot be the same part at all.
 */
function score(part: Part, entity: Entity): number | null {
  const want = netsOf(part.pins);
  const have = new Set(entity.nets);
  const shared = overlap(want, have);

  // A match needs actual evidence, and there are only two kinds of it: the thing
  // is wired into one of the nodes this part belongs in, or it has been
  // identified as the same kind of part. With neither, all that connects them is
  // that both exist, which is how an unidentified blob at the far end of the
  // board gets declared a misplaced LED.
  const sameKind = entity.identified && entity.kind === part.kind;
  if (shared === 0 && !sameKind) return null;

  let s = 0;
  if (sameKind) s += 10;
  // An unidentified thing wired into the right node is far more likely to be
  // this part than a coincidence, so it still matches -- just less strongly.
  if (!entity.identified) s += 2;
  s += shared * 8;
  // Every planned node covered is what "correctly placed" means.
  if (want.size > 0 && shared === want.size) s += 20;
  if (part.kind === "wire" && entity.shape === "wire") s += 3;
  return s;
}

function placedCorrectly(part: Part, entity: Entity): boolean {
  const want = netsOf(part.pins);
  if (want.size === 0) return false;
  const have = new Set(entity.nets);
  return overlap(want, have) === want.size;
}

function whereItShouldBe(part: Part): string {
  return part.pins.join(" and ");
}

/** Greedily pair planned parts with observed things, best match first. */
function assign(parts: Part[], entities: Entity[]): Map<string, Entity> {
  const pairs: { s: number; partId: string; entity: Entity }[] = [];
  for (const part of parts) {
    for (const entity of entities) {
      const s = score(part, entity);
      if (s !== null) pairs.push({ s, partId: part.id, entity });
    }
  }
  pairs.sort((a, b) => b.s - a.s);

  const out = new Map<string, Entity>();
  const usedEntities = new Set<string>();
  for (const { partId, entity } of pairs) {
    if (out.has(partId) || usedEntities.has(entity.id)) continue;
    out.set(partId, entity);
    usedEntities.add(entity.id);
  }
  return out;
}

export function reconcile(plan: Plan, world: World, step: number): Guidance {
  const blind = !world.board.found || world.frame === 0;
  const connectivity = world.workspace?.capabilities.connectivity ?? "static-complete";
  const canVerifyConnections = connectivity === "static-complete"
    || connectivity === "static-partial";
  const stepOf = new Map<string, number>();
  plan.steps.forEach((s) => s.adds.forEach((id) => stepOf.set(id, s.n)));

  const matched = blind ? new Map<string, Entity>() : assign(plan.parts, world.entities);

  const checks: PartCheck[] = plan.parts.map((part) => {
    const at = stepOf.get(part.id) ?? 1;
    const entity = matched.get(part.id);

    if (blind) {
      return { part, step: at, status: "not-yet" as PartStatus,
               evidence: "unknown",
               detail: "Nothing to compare against yet." };
    }
    if (entity && !canVerifyConnections) {
      return {
        part, step: at, status: "unverified", entity,
        evidence: entity.terminalEvidence ?? "unknown",
        detail: `${part.label} is present at ${entity.footprint}, but this workspace `
          + "does not expose enough connectivity to verify its wiring.",
      };
    }
    if (entity && placedCorrectly(part, entity)) {
      const evidence = entity.terminalEvidence ?? "unknown";
      return { part, step: at, status: "placed", entity, evidence,
               detail: evidence === "measured"
                 ? `${part.label} is in ${entity.footprint}, which is right.`
                 : `${part.label} is positioned at ${entity.footprint}, matching the plan; `
                   + "its bare leads are not directly visible, so the electrical connection is not fully verified." };
    }
    if (entity) {
      return {
        part, step: at, status: "misplaced", entity,
        evidence: entity.terminalEvidence ?? "unknown",
        detail: `${part.label} looks like it is in ${entity.footprint}, but the plan `
          + `puts it in ${whereItShouldBe(part)}.`,
      };
    }
    if (at > step) {
      return { part, step: at, status: "not-yet",
               evidence: "unknown",
               detail: `${part.label} goes in at step ${at}.` };
    }
    return {
      part, step: at, status: "missing",
      evidence: "unknown",
      detail: `${part.label} should be in ${whereItShouldBe(part)}, and I cannot see it.`,
    };
  });

  const matchedIds = new Set([...matched.values()].map((e) => e.id));
  const extras = world.entities.filter((e) => !matchedIds.has(e.id));

  const placedIds = new Set(
    checks.filter((c) => c.status === "placed").map((c) => c.part.id));
  const completeSteps = plan.steps
    .filter((s) => s.adds.length > 0 && s.adds.every((id) => placedIds.has(id)))
    .map((s) => s.n);

  const firstIncomplete = plan.steps.find((s) => !completeSteps.includes(s.n));
  const currentStep = firstIncomplete?.n ?? plan.steps.length;

  const expected = checks.filter((c) => c.status !== "not-yet").length;
  const order = { error: 0, warn: 1, info: 2 };
  const issues = [...world.issues].sort((a, b) => order[a.severity] - order[b.severity]);

  return {
    checks, extras, issues, currentStep, completeSteps,
    progress: { placed: placedIds.size, expected },
    nextAction: nextAction(plan, world, checks, issues, blind, currentStep),
    focus: focusOf(plan, checks, issues, currentStep),
    blind,
  };
}

/**
 * Which holes the advice is about.
 *
 * Kept in the same order of priority as nextAction, so the laser points at
 * whatever the sentence is talking about. A dot on one hole and a sentence about
 * another is worse than no dot at all.
 */
function focusOf(plan: Plan, checks: PartCheck[], issues: Issue[],
                 currentStep: number): { targets: WorkspaceLocation[]; holes: string[]; why: string } {
  const onBoard = (pins: string[]) => pins.filter(
    (p) => intrinsicNode(legacyPinLocation(p)) !== null);
  const result = (holes: string[], why: string) => ({
    holes,
    targets: holes.map(anchorLocation),
    why,
  });

  const fault = issues.find((i) => i.severity === "error");
  if (fault?.entities.length) {
    const c = checks.find((x) => x.entity && fault.entities.includes(x.entity.id));
    if (c?.entity) return result(onBoard(c.entity.pins), fault.message);
  }

  const misplaced = checks.find((c) => c.status === "misplaced");
  // Point at where it SHOULD go, not where it is: the student can already see
  // where they put it.
  if (misplaced) {
    return result(onBoard(misplaced.part.pins), `where ${misplaced.part.label} belongs`);
  }

  const missing = checks.find((c) => c.status === "missing");
  if (missing) {
    return result(onBoard(missing.part.pins), `where ${missing.part.label} goes`);
  }

  const step = plan.steps.find((s) => s.n === currentStep);
  const stepParts = step?.adds
    .map((id) => plan.parts.find((p) => p.id === id))
    .filter((p): p is Part => !!p) ?? [];
  const adds = stepParts.flatMap((p) => onBoard(p.pins));
  if (adds.length) {
    const names = stepParts.map((p) => p.label).join(" and ");
    return result(adds, `where the ${names} goes`);
  }

  return result([], "");
}

function nextAction(plan: Plan, world: World, checks: PartCheck[], issues: Issue[],
                    blind: boolean, currentStep: number): string {
  if (!world.board.found) {
    return world.board.hint
      || "Point the camera at the breadboard so I can see what you have built.";
  }
  if (blind) return "Waiting for the first clear look at the board.";

  // A short comes before anything else: everything after it is beside the point
  // if the board is about to be powered up wrong.
  const fault = issues.find((i) => i.severity === "error");
  if (fault) return fault.message;

  const misplaced = checks.find((c) => c.status === "misplaced");
  if (misplaced) return misplaced.detail;

  const unverified = checks.find((c) => c.status === "unverified");
  if (unverified) return unverified.detail;

  const missing = checks.filter((c) => c.status === "missing");
  if (missing.length) {
    const s = plan.steps.find((x) => x.n === missing[0].step);
    return s ? `${s.instruction}` : missing[0].detail;
  }

  const warn = issues.find((i) => i.severity === "warn");
  if (warn) return warn.message;

  if (currentStep >= plan.steps.length && plan.steps.length > 0) {
    return "Everything in the plan is on the board. Check it over, then power it up.";
  }
  const s = plan.steps.find((x) => x.n === currentStep);
  return s ? s.instruction : "Carry on with the next step.";
}

/**
 * The guidance as prose, for the voice model's context.
 *
 * Kept short on purpose: the model reads this on every turn, and a wall of text
 * makes it answer from the summary instead of listening to the student.
 */
export function guidanceText(plan: Plan, world: World, g: Guidance): string {
  if (!world.board.found) {
    return `I cannot see the breadboard. ${world.board.hint ?? ""}`.trim();
  }
  const lines: string[] = [world.summary, ""];

  const misplaced = g.checks.filter((c) => c.status === "misplaced");
  const missing = g.checks.filter((c) => c.status === "missing");
  const unverified = g.checks.filter((c) => c.status === "unverified");

  lines.push(`Against the plan "${plan.title}": ${g.progress.placed} of `
    + `${g.progress.expected} parts due so far are correctly placed.`);
  for (const c of misplaced) lines.push(`  wrong place: ${c.detail}`);
  for (const c of missing) lines.push(`  not on the board: ${c.detail}`);
  for (const c of unverified) lines.push(`  present but not electrically verified: ${c.detail}`);
  if (g.extras.length) {
    lines.push(`  also on the board, not in the plan: `
      + g.extras.map((e) => `${e.label} at ${e.footprint}`).join("; "));
  }
  lines.push(`Next: ${g.nextAction}`);
  if (g.focus.holes.length) {
    lines.push(`The holes that matter for that: ${g.focus.holes.join(", ")}.`);
  }
  return lines.join("\n");
}
