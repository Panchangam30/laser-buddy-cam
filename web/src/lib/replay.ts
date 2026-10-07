import type { BuildSnapshot, Plan } from "./types";
import type { World } from "./world";

export const REPLAY_LIMIT = 300;

/** Ignore camera pose jitter, counters, confidence, and sub-hole body motion. */
export function boardSignature(world: World): string {
  return JSON.stringify({
    orientation: world.orientation?.flipped ?? false,
    entities: world.entities.filter((e) => e.present).map((e) => ({
      id: e.id, kind: e.kind, label: e.label, value: e.value,
      pins: [...e.pins].sort(), nets: [...e.nets].sort(),
    })).sort((a, b) => a.id.localeCompare(b.id)),
    issues: world.issues.map((i) => `${i.severity}:${i.message}`).sort(),
  });
}

export class StableBoardRecorder {
  private signature = "";
  private count = 0;
  private lastRecorded = "";
  private lastFrame = -1;

  observe(world: World, plan: Plan, step: number, previous: BuildSnapshot[]): BuildSnapshot | null {
    if (!world.board.found || world.frame === 0) { this.count = 0; return null; }
    if (world.frame === this.lastFrame) return null;
    this.lastFrame = world.frame;
    const signature = boardSignature(world);
    this.count = signature === this.signature ? this.count + 1 : 1;
    this.signature = signature;
    if (this.count < 3 || signature === this.lastRecorded
      || (previous.length && signature === boardSignature(previous[previous.length - 1].world))) return null;
    this.lastRecorded = signature;
    const last = previous[previous.length - 1];
    const before = new Map(last?.world.entities.filter((e) => e.present).map((e) => [e.id, e]) ?? []);
    const after = new Map(world.entities.filter((e) => e.present).map((e) => [e.id, e]));
    const changes: string[] = [];
    for (const [id, entity] of after) {
      const old = before.get(id);
      if (!old) changes.push(`Added ${entity.label || "part"}`);
      else if (old.pins.join() !== entity.pins.join()) changes.push(`Moved ${entity.label || "part"} to ${entity.footprint}`);
    }
    for (const [id, entity] of before) if (!after.has(id)) changes.push(`Removed ${entity.label || "part"}`);
    if (world.issues.length !== (last?.world.issues.length ?? 0)) changes.push(`${world.issues.length} wiring issues`);
    return structuredClone({ id: crypto.randomUUID(), at: Date.now(), step, world, plan,
      summary: !last ? "Build recording started" : changes.join(" · ") || "Part identification or wiring checks changed" });
  }
}
