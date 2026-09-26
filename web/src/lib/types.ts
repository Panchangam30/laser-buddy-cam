/** The schema the vision model fills in, and the renderer consumes. */

export type PartKind =
  | "resistor" | "led" | "capacitor" | "ic" | "transistor"
  | "button" | "potentiometer" | "module" | "wire";

export interface Part {
  id: string;
  kind: PartKind;
  label: string;
  /** Hole references, e.g. ["E12","E15"]. Order is meaningful for polarised parts. */
  pins: string[];
  /** CSS colour for the body or the wire. */
  color?: string;
  /** "220 ohm", "0.1uF" -- or empty when the model could not read the markings. */
  value?: string;
  /** True when the part only works one way round. */
  polarised?: boolean;
}

export interface Step {
  n: number;
  title: string;
  instruction: string;
  /** Part ids that become visible at this step. */
  adds: string[];
  warning?: string;
}

export interface DetectedPart {
  label: string;
  count: number;
  /** "high" | "medium" | "low" -- how sure the model is it identified this. */
  confidence: string;
  /** Set when markings could not be read. */
  unreadable?: boolean;
}

export interface Plan {
  title: string;
  summary: string;
  detected: DetectedPart[];
  parts: Part[];
  steps: Step[];
  /** Populated when the model could not make a sensible circuit from the parts. */
  problem?: string;
}
