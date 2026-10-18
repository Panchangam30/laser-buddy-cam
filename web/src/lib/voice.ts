import type { Plan } from "./types";
import type { TrackMode } from "./objects";

export type RealtimeStatus = "idle" | "connecting" | "live" | "error";

export interface Utterance {
  who: "you" | "assistant";
  text: string;
  /** xAI resends the whole transcript as it corrects itself. */
  replace?: boolean;
}

export interface ChallengeVoiceContext {
  title: string;
  prompt: string;
  hintLevel: number;
  hints: string[];
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
    description: "Take a photo through the webcam and look at it closely yourself. "
      + "Use it to read text or markings, judge colour or condition, see what is on "
      + "a screen, or check wiring by eye -- anything the live object list cannot tell you.",
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
    name: "point_at",
    description: "Shine the laser pointer on a hole on the student's actual "
      + "breadboard, so they can see exactly which one you mean. Use this "
      + "instead of describing a location whenever you are telling them where "
      + "to put something. Call it with no hole to point at whatever you have "
      + "just told them to do.",
    parameters: {
      type: "object",
      properties: {
        hole: {
          type: "string",
          description: "A hole such as 'E20' or 'T+12'. Leave out to point at "
            + "the hole the current advice is about.",
        },
      },
      required: [],
    },
  },
  {
    type: "function",
    name: "move_laser",
    description: "Move the laser head by voice. Use `direction` for relative "
      + "moves, which is what most spoken instructions are -- 'left a bit', "
      + "'up', 'further right'. Use `pan` and `tilt` only when the student names "
      + "exact angles. To turn the beam on or off use laser_power instead.",
    parameters: {
      type: "object",
      properties: {
        direction: {
          type: "string",
          enum: ["left", "right", "up", "down"],
          description: "Which way to move, from the student's point of view.",
        },
        amount: {
          type: "string",
          enum: ["fine", "tiny", "small", "medium", "large"],
          description: "How far. 'fine' is one degree, 'tiny' two, 'small' five, "
            + "'large' crosses most of the working area. Default small. Map "
            + "'a hair'/'just a touch' to fine, 'a bit'/'slightly' to tiny, and "
            + "'a lot'/'way over' to large.",
        },
        pan: { type: "number", description: "Absolute pan angle, 10 to 170." },
        tilt: { type: "number", description: "Absolute tilt angle, 0 to 180." },
      },
      required: [],
    },
  },
  {
    type: "function",
    name: "laser_power",
    description: "Switch the laser beam on or off. The head can be moved with "
      + "the beam off; turn it on when the student wants to see where it is "
      + "pointing.",
    parameters: {
      type: "object",
      properties: { on: { type: "boolean", description: "True for on." } },
      required: ["on"],
    },
  },
  {
    type: "function",
    name: "centre_laser",
    description: "Return the head to the middle of its travel and switch the "
      + "beam off. Use this when the student says centre it, reset it, or stop.",
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

/** Laser tools shared by both modes. */
const LASER_TOOLS = TOOLS.filter((t) =>
  ["move_laser", "laser_power", "centre_laser"].includes(t.name));

/** Tools for object mode: anything on the desk, no breadboard. */
export const OBJECT_TOOLS = [
  {
    type: "function",
    name: "describe_scene",
    description: "Look through the camera right now and list every object on the "
      + "desk, with where each one is. Use this whenever the user asks what you "
      + "can see, asks about something you have not seen yet, or says they have "
      + "put something new down. It takes a fresh look, so trust it over the "
      + "list in your instructions.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    type: "function",
    name: "point_at_object",
    description: "Shine the laser on one object on the desk. Name it the way the "
      + "user did ('the phone', 'yellow pencil') or by its id ('obj3'). The laser "
      + "checks itself through the camera and corrects its aim, so this takes a "
      + "couple of seconds.",
    parameters: {
      type: "object",
      properties: { object: { type: "string", description: "e.g. 'phone' or 'obj2'" } },
      required: ["object"],
    },
  },
  {
    type: "function",
    name: "follow_object",
    description: "Keep the laser on an object while it moves -- for 'follow my "
      + "phone' or 'track the pencil'. Stays on until stop_following or laser off.",
    parameters: {
      type: "object",
      properties: { object: { type: "string", description: "e.g. 'phone' or 'obj2'" } },
      required: ["object"],
    },
  },
  {
    type: "function",
    name: "stop_following",
    description: "Stop following an object. The beam stays where it is.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    type: "function",
    name: "look_closely",
    description: "Take a full photo through the webcam and look at it yourself. "
      + "Use this for questions describe_scene cannot answer: reading text on "
      + "something, its colour or condition, what is on a screen.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  ...LASER_TOOLS,
];

/** Everything the assistant can do: desk objects, the build, and the laser. */
export const ALL_TOOLS = [
  ...OBJECT_TOOLS.filter((t) => !["look_closely", "move_laser", "laser_power", "centre_laser"].includes(t.name)),
  ...TOOLS,
];

export function toolsFor(mode: TrackMode | "all" = "all") {
  return mode === "board" ? TOOLS : mode === "objects" ? OBJECT_TOOLS : ALL_TOOLS;
}

/**
 * The one assistant: sees the whole desk through the camera at all times, and
 * also knows the breadboard project when there is one. Not breadboard-only --
 * a phone, a mug or a pencil is as much in scope as a resistor.
 */
export function buildAssistantInstructions(plan: Plan, step: number, live?: string,
  challenge?: ChallengeVoiceContext): string {
  const steps = plan.steps
    .map((s) => `  ${s.n}. ${s.title} -- ${s.instruction}${s.warning ? ` WARNING: ${s.warning}` : ""}`)
    .join("\n") || "  (none)";
  return `You are a friendly lab assistant sitting next to the user. You can see their
desk through a webcam at all times, and you have a laser pointer on a pan/tilt
head that can point at anything on the desk. You help with whatever is in front
of them: everyday objects (a phone, a pencil, a mug, tools) and, when they are
building one, an Arduino breadboard circuit.

SPEAK LIKE A PERSON AT A DESK. One or two short sentences. No lists, no
preamble, no "great question".

WHAT YOU CAN SEE. The desk list below updates live: an object tracker follows
everything in view every frame, and a vision model names things every few
seconds. Each object has an id like obj3 and a position in words ("near left"
= close to the camera, on the left). Trust it -- you are always looking. If the
user mentions something not in the list, or asks what you see, call
describe_scene for a fresh look. Use look_at_board to read text or markings or
to inspect something closely. Never claim to see what is not in the list or a
photo, and never guess text you cannot read.

THE LASER. To show where something is, point at it rather than describing it:
point_at_object for an object, point_at for a breadboard hole. "Follow" or
"track" an object is follow_object. "Left a bit", "up", "centre it" are
move_laser. Move first, then speak, so beam and words arrive together. If a tool
says the laser is not calibrated, tell them to press Calibrate in the Laser
panel. Never aim at a person's face; refuse if asked.

THE BREADBOARD PROJECT, if they are building it. Holes are <row><column>:
rows A-E share a node per column, F-J are a separate node, the centre channel
splits them; rails are T+, T-, B+, B-; EXT: means off the board (an Arduino
pin). Use goto_step when you discuss a step, check_progress when they ask how
the build is going, and never guess a resistor value you cannot read.
Project: ${plan.title} -- ${plan.summary}
${plan.problem ? `Unresolved problem: ${plan.problem}\n` : ""}Steps:
${steps}
They are on step ${step}.
${challenge ? `
TROUBLESHOOTING CHALLENGE: ${challenge.title}. ${challenge.prompt}
Hint level ${challenge.hintLevel} of 3 unlocked: ${challenge.hints.slice(0, challenge.hintLevel).join(" | ")}
Do not reveal later hints or the faulty hole before level 3; ask a guiding question instead.` : ""}

${live || "Nothing has been seen yet; call describe_scene."}`;
}

/** System prompt for object mode. */
export function buildObjectInstructions(live?: string): string {
  return `You are a friendly desk assistant with a webcam and a laser pointer on a
pan/tilt head. You can see the user's desk and point the laser at anything on
it: a phone, a pencil, a mug, a tool, a cable.

SPEAK LIKE A PERSON SITTING NEXT TO THEM. Short answers, one or two sentences.
No lists, no preamble, no "great question".

WHAT YOU CAN SEE. The list below is kept up to date by an object tracker: the
vision model names each object and OpenCV follows it between looks. Each has an
id like obj3 and a position in words ("near left" means close to the camera,
on the left of the picture). It is your memory of the desk, and it can be a
few seconds stale. When the user asks what you see, or mentions something not
in the list, call describe_scene to take a fresh look before answering. Never
claim to see an object that is not in the list or in a photo you were given,
and never guess text you cannot read -- use look_closely for that.

THE LASER. When the user asks where something is, or asks you to show, point
at, or highlight something, call point_at_object -- pointing is better than
describing. For "follow" or "track" it, call follow_object. "Left a bit", "up",
"further right", "centre it" are move_laser with a direction and an amount.
Move first and speak after, so the beam and your words arrive together. If a
tool says the laser is not calibrated, tell them to press Calibrate in the
Laser panel and keep the desk in view; it takes a couple of minutes. If it says
an object is out of reach, say so plainly. Never shine the beam at a person's
face; if the object is a person or a face, refuse to point at it.

${live ? `ON THE DESK RIGHT NOW:
${live}` : "You have not looked at the desk yet. Call describe_scene."}`;
}

/** System prompt, rebuilt whenever the plan, the step or the board changes. */
export function buildInstructions(plan: Plan, step: number, live?: string,
  challenge?: ChallengeVoiceContext): string {
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

${challenge ? `TROUBLESHOOTING CHALLENGE: ${challenge.title}
${challenge.prompt}
The learner has unlocked hint level ${challenge.hintLevel} of 3.
You may use only these unlocked hints: ${challenge.hints.slice(0, challenge.hintLevel).join(" | ")}
Do not reveal a later hint or the exact faulty hole before hint level 3. Ask a
short guiding question instead. At hint level 3 you may name and point to the
exact connection.` : ""}

${live ? `ON THE BOARD RIGHT NOW (measured from the board's own grid, updating live):
${live}` : `You have no live view of the board yet. Use check_progress to get one.`}

The live map is measured, not guessed: hole references in it come from the
board's grid, so trust them over your own reading of a photo. What it cannot do
is read markings -- a part it lists without a value is one whose markings were
not legible, and you must not fill the value in yourself.

You have a laser pointer aimed at their real board, and you can drive it.

When you tell them where something goes, call point_at so they can see the hole
rather than counting columns. Saying "column 26" and lighting up column 26
together is the whole point of the rig.

They can also just tell you where to move it. "Left a bit", "up", "further
right", "centre it" -- call move_laser for those, with a direction and an
amount. Move first and speak after, so the beam and your words arrive together;
do not narrate what you are about to do. If a move comes back at a limit, say so
plainly rather than nudging again in the same direction.

The head can be moved with the beam off. Turn it on with laser_power when they
want to see where it is pointing, and off when they are done.

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
  /** Which prompt and tools. "all" (the default) is the one unified assistant. */
  mode?: TrackMode | "all";
  plan: Plan;
  step: number;
  challenge?: ChallengeVoiceContext;
  /** Provider voice id (Grok only; OpenAI's voice is fixed at token time). */
  voice?: string;
  onTool: (name: string, args: Record<string, unknown>) => Promise<string>;
  onStatus: (s: RealtimeStatus, err?: string) => void;
  onUtterance: (u: Utterance) => void;
}

/** The system prompt for whichever mode the session is in. */
export function instructionsFor(opts: VoiceOpts, live?: string): string {
  if (opts.mode === "board") return buildInstructions(opts.plan, opts.step, live, opts.challenge);
  if (opts.mode === "objects") return buildObjectInstructions(live);
  return buildAssistantInstructions(opts.plan, opts.step, live, opts.challenge);
}

/** What the app needs from a voice provider, whoever it is. */
export interface VoiceSession {
  readonly live: boolean;
  connect(): Promise<void>;
  disconnect(): void;
  setMuted(muted: boolean): void;
  refreshContext(plan: Plan, step: number, live?: string, challenge?: ChallengeVoiceContext): void;
  sendText(text: string): void;
  sendImage(dataUrl: string, note?: string): void;
}
