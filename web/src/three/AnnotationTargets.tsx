import { useImperativeHandle, useMemo, type RefObject } from "react";
import { useThree } from "@react-three/fiber";
import { Vector3 } from "three";
import { holePosition } from "../lib/breadboard";
import type { Plan } from "../lib/types";
import type { AnnotationSceneBridge, AnnotationTarget } from "../lib/annotations";
import type { PlacedKitPart } from "../components/StarterKit";
import { externalAnchorMap } from "./ExternalDevices";

/** Exposes projected part anchors without putting camera updates in App state. */
export function AnnotationTargets({ bridge, plan, step, kitParts }: {
  bridge: RefObject<AnnotationSceneBridge | null>; plan: Plan; step: number; kitParts: PlacedKitPart[];
}) {
  const camera = useThree((state) => state.camera);
  const scene = useThree((state) => state.scene);
  const anchors = useMemo(() => {
    const external = externalAnchorMap(plan.devices ?? []);
    const visibleAt = new Map<string, number>();
    plan.steps.forEach((item) => [...item.adds, ...(item.renders ?? [])].forEach((id) => visibleAt.set(id, item.n)));
    const parts = plan.parts.filter((part) => (visibleAt.get(part.id) ?? 1) <= step).flatMap((part) => {
      const pins = part.pins.flatMap((pin) => { const at = holePosition(pin) ?? external.get(pin.trim().replace(/\s+/g, " ").toUpperCase()); return at ? [at] : []; });
      if (!pins.length) return [];
      const center = pins.reduce<Vector3>((sum, pin) => sum.add(new Vector3(pin.x, pin.y, pin.z)), new Vector3()).divideScalar(pins.length);
      center.y += part.kind === "led" ? 8 : 4;
      return [{ id: `part:${part.id}`, label: part.label, position: center, group: `part:${part.id}` }];
    });
    const devices = (plan.devices ?? []).filter((device) => (device.visibleFromStep ?? 1) <= step).flatMap((device) => {
      const ports = device.ports.flatMap((port) => { const at = external.get(`EXT:${device.id} ${port.label}`.toUpperCase()); return at ? [at] : []; });
      if (!ports.length) return [];
      const position = ports.reduce<Vector3>((sum, port) => sum.add(new Vector3(port.x, port.y, port.z)), new Vector3()).divideScalar(ports.length);
      return [{ id: `device:${device.id}`, label: device.label, position, group: "" }];
    });
    return [...parts, ...devices, ...kitParts.map((part) => ({ id: `kit:${part.instanceId}`, label: part.name, position: new Vector3(...part.position).add(new Vector3(0, 6, 0)), group: "" }))];
  }, [plan, step, kitParts]);
  useImperativeHandle(bridge, () => ({ targets: () => {
      const projected: AnnotationTarget[] = [];
      for (const anchor of anchors) {
        const point = anchor.position.clone();
        // Follow the animated lift used by the exploded view.
        if (anchor.group) point.y += scene.getObjectByName(anchor.group)?.children[0]?.position.y ?? 0;
        point.project(camera);
        if (point.z < -1 || point.z > 1 || Math.abs(point.x) > 1 || Math.abs(point.y) > 1) continue;
        projected.push({ id: anchor.id, label: anchor.label, x: (point.x + 1) / 2, y: (1 - point.y) / 2 });
      }
      return projected;
    } }), [anchors, camera, scene]);
  return null;
}
