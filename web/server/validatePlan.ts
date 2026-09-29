const HOLE = /^(?:[A-J]\d{1,2}|[TB][+-]\d{1,2})$/i;

/** Boundary validation for untrusted model JSON before it reaches the browser. */
export function validatePlanShape(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return "plan is not an object";
  const plan = raw as Record<string, unknown>;
  if (typeof plan.title !== "string" || !plan.title.trim()) return "plan has no title";
  if (!Array.isArray(plan.parts) || !Array.isArray(plan.steps)) return "plan needs parts and steps arrays";
  if (!plan.steps.length) {
    const explained = typeof plan.problem === "string" && plan.problem.trim()
      && plan.parts.length === 0;
    return explained ? null : "plan has no assembly steps";
  }
  const ids = new Set<string>();
  for (const item of plan.parts) {
    if (!item || typeof item !== "object") return "invalid part";
    const part = item as Record<string, unknown>;
    if (typeof part.id !== "string" || !part.id || ids.has(part.id)) return "missing or duplicate part id";
    ids.add(part.id);
    if (!Array.isArray(part.pins) || !part.pins.length) return `${part.id} has no locations`;
    for (const pin of part.pins) {
      if (typeof pin !== "string" || (!HOLE.test(pin.replace(/\s/g, "")) && !pin.toUpperCase().startsWith("EXT:"))) {
        return `${part.id} uses invalid location ${String(pin)}`;
      }
    }
  }
  if (plan.devices !== undefined) {
    if (!Array.isArray(plan.devices)) return "devices must be an array";
    const deviceIds = new Set<string>();
    const kinds = new Set(["arduino-uno", "micro-servo", "power-supply", "generic"]);
    for (const item of plan.devices) {
      if (!item || typeof item !== "object") return "invalid external device";
      const device = item as Record<string, unknown>;
      if (typeof device.id !== "string" || !device.id || deviceIds.has(device.id)) {
        return "missing or duplicate external device id";
      }
      deviceIds.add(device.id);
      if (typeof device.label !== "string" || !device.label.trim()) return `${device.id} has no label`;
      if (typeof device.kind !== "string" || !kinds.has(device.kind)) return `${device.id} has invalid kind`;
      if (!Array.isArray(device.ports) || !device.ports.length) return `${device.id} has no ports`;
      for (const item of device.ports) {
        if (!item || typeof item !== "object") return `${device.id} has an invalid port`;
        const port = item as Record<string, unknown>;
        if (typeof port.id !== "string" || !port.id
          || typeof port.label !== "string" || !port.label) return `${device.id} has an invalid port`;
      }
    }
  }
  for (const item of plan.steps) {
    if (!item || typeof item !== "object") return "invalid step";
    const step = item as Record<string, unknown>;
    if (!Array.isArray(step.adds)) return "step has no adds array";
    for (const id of step.adds) if (typeof id !== "string" || !ids.has(id)) return `step refers to unknown part ${String(id)}`;
    if (step.renders !== undefined && !Array.isArray(step.renders)) return "step renders must be an array";
    for (const id of (step.renders as unknown[] | undefined) ?? []) {
      if (typeof id !== "string" || !ids.has(id)) return `step renders unknown part ${String(id)}`;
    }
  }
  return null;
}
