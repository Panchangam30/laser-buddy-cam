import type { Plan } from "./types";

export type RealtimeStatus = "idle" | "connecting" | "live" | "error";

export interface Utterance {
  who: "you" | "assistant";
  text: string;
  /** xAI resends the whole transcript as it corrects itself. */
  replace?: boolean;
}

/** Tools the model can call to drive the 3D view or look through the camera. */
export const TOOLS = [
  {
    type: "function",
    name: "goto_step",
    description: "Show a specific assembly step in the 3D view. Use this whenever "
      + "you talk about a step so the student sees what you mean.",
    parameters: {
      type: "object",
      properties: { n: { type: "integer", description: "Step number, 1-based" } },
      required: ["n"],
    },
  },
  {
    type: "function",
    name: "look_at_board",
    description: "Take a photo through the webcam and look at it. Use this when the "
      + "student asks about what is physically in front of them, says something is "
      + "not working, or asks you to check their wiring.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    type: "function",
    name: "rescan_bench",
    description: "Re-scan the parts on the bench and build a fresh assembly plan. "
      + "Only use this when the student says they have changed which parts are out.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    type: "function",
    name: "check_progress",
    description: "Compare what is physically on the breadboard right now against "
      + "the plan, and get back what is placed correctly, what is in the wrong "
      + "holes, what is missing, and any wiring fault. This reads a live map "
      + "measured from the board's own grid, so it is more reliable than looking "
      + "at a photo. Use it whenever the student asks how they are doing, whether "
      + "something is right, or why it is not working.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    type: "function",
    name: "describe_world",
    description: "List everything currently detected on the breadboard and the "
      + "exact holes each part sits in, without comparing it to the plan. Use "
      + "this when the student asks what you can see, or asks about a part that "
      + "is not part of the plan.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    type: "function",
    name: "where_is",
    description: "Find one part on the board by name and say which holes it is "
      + "in. Use this when the student asks 'where is my resistor' or 'is the "
      + "LED in the right place'.",
    parameters: {
      type: "object",
      properties: {
        part: { type: "string", description: "What to look for, e.g. 'the red LED'" },
      },
      required: ["part"],
    },
  },
] as const;

/** System prompt, rebuilt whenever the plan, the step or the board changes. */
export function buildInstructions(plan: Plan, step: number, live?: string): string {
  const parts = plan.parts
    .map((p) => `  ${p.id}: ${p.label} (${p.kind}) in ${p.pins.join(" and ")}`)
    .join("\n") || "  (none yet)";
  const steps = plan.steps
    .map((s) => `  ${s.n}. ${s.title} -- ${s.instruction}${s.warning ? ` WARNING: ${s.warning}` : ""}`)
    .join("\n") || "  (none yet)";

  return `You are a lab demonstrator sitting next to a first-year engineering student
who is building a circuit on a breadboard. You can see their 3D view and you can
look through their webcam.

SPEAK LIKE A PERSON AT A BENCH. Short answers, one or two sentences. No lists,
no preamble, no "great question". If they ask where something goes, just tell
them the hole.

THE BOARD. Holes are <row><column>: rows A-E are one node per column, F-J are a
separate node, and the centre channel separates them. So A5 through E5 are all
connected. Power rails are T+, T-, B+, B-. Anything written EXT: is off the
board, like an Arduino pin.

CURRENT BUILD: ${plan.title}
${plan.summary}
${plan.problem ? `UNRESOLVED PROBLEM: ${plan.problem}` : ""}

PARTS PLACED:
${parts}

STEPS:
${steps}

The student is looking at step ${step} right now.

${live ? `ON THE BOARD RIGHT NOW (measured from the board's own grid, updating live):
${live}` : `You have no live view of the board yet. Use check_progress to get one.`}

The live map is measured, not guessed: hole references in it come from the
board's grid, so trust them over your own reading of a photo. What it cannot do
is read markings -- a part it lists without a value is one whose markings were
not legible, and you must not fill the value in yourself.

Call goto_step whenever you discuss a different step, so the 3D view follows you.
If the student asks how they are doing, or says it is not working, call
check_progress first and answer from what it returns. Use look_at_board only for
things the map cannot show you -- a bent lead, a part held up to the camera, or
something off the board entirely.

Never guess a resistor value you cannot read. Say you cannot read it and ask
them to hold it closer. If a part's markings were unreadable, the parts list
above will say so.`;
}

export interface VoiceOpts {
  plan: Plan;
  step: number;
  /** Provider voice id (Grok only; OpenAI's voice is fixed at token time). */
  voice?: string;
  onTool: (name: string, args: Record<string, unknown>) => Promise<string>;
  onStatus: (s: RealtimeStatus, err?: string) => void;
  onUtterance: (u: Utterance) => void;
}

/** What the app needs from a voice provider, whoever it is. */
export interface VoiceSession {
  readonly live: boolean;
  connect(): Promise<void>;
  disconnect(): void;
  setMuted(muted: boolean): void;
  refreshContext(plan: Plan, step: number, live?: string): void;
  sendText(text: string): void;
  sendImage(dataUrl: string, note?: string): void;
}
