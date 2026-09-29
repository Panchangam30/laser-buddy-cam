/** The schema the vision model fills in, and the renderer consumes. */

import type { WorkspaceLocation } from "./workspace";

export type PartKind =
  | "resistor" | "led" | "capacitor" | "ic" | "transistor"
  | "button" | "potentiometer" | "module" | "wire";

export interface Part {
  id: string;
  kind: PartKind;
  label: string;
  /** Hole references, e.g. ["E12","E15"]. Order is meaningful for polarised parts. */
  pins: string[];
  /** Named terminals are the workspace-neutral successor to positional pins. */
  terminals?: { terminalId: string; target: WorkspaceLocation }[];
  /** CSS colour for the body or the wire. */
  color?: string;
  /** "220 ohm", "0.1uF" -- or empty when the model could not read the markings. */
  value?: string;
  /** True when the part only works one way round. */
  polarised?: boolean;
}

export type ExternalDeviceKind = "arduino-uno" | "micro-servo" | "power-supply" | "generic";

export interface ExternalDevicePort {
  /** Stable, machine-readable name such as "d2", "gnd", or "signal". */
  id: string;
  /** The marking a student sees on the device. */
  label: string;
  /** Extra spellings accepted in EXT: references. */
  aliases?: string[];
}

/** A real device that sits beside the breadboard rather than in its holes. */
export interface ExternalDevice {
  id: string;
  kind: ExternalDeviceKind;
  label: string;
  color?: string;
  aliases?: string[];
  ports: ExternalDevicePort[];
  /** The first assembly step where the device should be shown. */
  visibleFromStep?: number;
  /** Presentation-only placement. It is never treated as measured geometry. */
  placement?: { side: "front" | "left" | "right"; order?: number };
}

export interface Step {
  /** Stable across insertions and revisions; n remains the displayed order. */
  id?: string;
  n: number;
  kind?: "placement" | "configure" | "code" | "test" | "safety";
  completion?: "workspace" | "manual" | "test";
  title: string;
  instruction: string;
  /** Part ids that become visible at this step. */
  adds: string[];
  /** Diagram-only part ids, for off-board connections verified manually. */
  renders?: string[];
  warning?: string;
  artifactIds?: string[];
}

export interface DetectedPart {
  label: string;
  count: number;
  /** "high" | "medium" | "low" -- how sure the model is it identified this. */
  confidence: string;
  /** Set when markings could not be read. */
  unreadable?: boolean;
}

export interface Requirement {
  id: string;
  label: string;
  count: number;
  availability: "seen" | "confirmed" | "unknown" | "missing";
  note?: string;
}

export interface PlanWarning {
  severity: "error" | "warn" | "info";
  message: string;
  blocksPower?: boolean;
}

export interface PlanArtifact {
  id: string;
  kind: "code" | "diagram" | "note";
  title: string;
  language?: string;
  content: string;
}

export type PlanSource =
  | { kind: "builtin"; templateId: string }
  | { kind: "photo"; generatedAt: string }
  | { kind: "goal"; goal: string; generatedAt: string };

export interface Plan {
  schemaVersion: 1;
  id: string;
  revision: number;
  title: string;
  summary: string;
  workspace: { profileId: string; profileVersion: number };
  source: PlanSource;
  requirements: Requirement[];
  detected: DetectedPart[];
  observedInventory?: DetectedPart[];
  /** Equipment outside the breadboard, with named wire attachment points. */
  devices?: ExternalDevice[];
  parts: Part[];
  steps: Step[];
  warnings: PlanWarning[];
  artifacts?: PlanArtifact[];
  /** Populated when the model could not make a sensible circuit from the parts. */
  problem?: string;
}

export interface Project {
  schemaVersion: 1;
  id: string;
  name: string;
  goal?: string;
  plan: Plan;
  progress: {
    currentStep: number;
    currentStepId?: string;
    manuallyCompletedStepIds: string[];
  };
  createdAt: string;
  updatedAt: string;
}
