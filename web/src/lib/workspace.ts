import definition from "../workspaces/breadboard-830.v1.json";
import { holePosition, netOf, parseHole, type Vec3 } from "./breadboard";

export type WorkspaceKind = "breadboard" | "perfboard" | "pcb" | "work-mat";
export type LocationResolution = "anchor" | "region" | "metric" | "image-only" | "none";
export type ConnectivityCapability =
  | "static-complete"
  | "static-partial"
  | "observed-partial"
  | "none";

export type LocationRef =
  | { kind: "anchor"; anchorId: string }
  | { kind: "region"; regionId: string }
  | { kind: "metric"; xMm: number; zMm: number; radiusMm: number }
  | { kind: "external-port"; deviceId: string; portId: string };

export interface WorkspaceLocation {
  workspaceInstanceId: string;
  ref: LocationRef;
}

export interface WorkspaceCapabilities {
  locationResolution: LocationResolution;
  connectivity: ConnectivityCapability;
  absoluteLaserTargeting: boolean;
}

export interface WorkspaceDescriptor {
  profileId: string;
  profileVersion: number;
  instanceId: string;
  kind: WorkspaceKind;
  label: string;
  capabilities: WorkspaceCapabilities;
}

export interface WorkspaceAdapter {
  descriptor: WorkspaceDescriptor;
  resolve(location: WorkspaceLocation): Vec3 | null;
  intrinsicNode(location: WorkspaceLocation): string | null;
  isTargetable(location: WorkspaceLocation): boolean;
}

export const BREADBOARD_WORKSPACE: WorkspaceDescriptor = {
  profileId: definition.id,
  profileVersion: definition.version,
  instanceId: `${definition.id}:camera`,
  kind: definition.kind as WorkspaceKind,
  label: definition.label,
  capabilities: definition.capabilities as WorkspaceCapabilities,
};

export const BREADBOARD_ADAPTER: WorkspaceAdapter = {
  descriptor: BREADBOARD_WORKSPACE,
  resolve(location) {
    if (location.workspaceInstanceId !== BREADBOARD_WORKSPACE.instanceId) return null;
    if (location.ref.kind === "anchor") return holePosition(location.ref.anchorId);
    if (location.ref.kind === "metric") {
      return { x: location.ref.xMm, y: definition.dimensions.height / 2, z: location.ref.zMm };
    }
    return null;
  },
  intrinsicNode(location) {
    if (location.workspaceInstanceId !== BREADBOARD_WORKSPACE.instanceId) return null;
    return location.ref.kind === "anchor" ? netOf(location.ref.anchorId) : null;
  },
  isTargetable(location) {
    if (location.workspaceInstanceId !== BREADBOARD_WORKSPACE.instanceId
        || !BREADBOARD_WORKSPACE.capabilities.absoluteLaserTargeting) return false;
    return location.ref.kind === "anchor" || location.ref.kind === "metric";
  },
};

const adapters = new Map<string, WorkspaceAdapter>([
  [BREADBOARD_WORKSPACE.instanceId, BREADBOARD_ADAPTER],
]);

export function workspaceAdapter(instanceId: string): WorkspaceAdapter | null {
  return adapters.get(instanceId) ?? null;
}

export function anchorLocation(anchorId: string): WorkspaceLocation {
  return {
    workspaceInstanceId: BREADBOARD_WORKSPACE.instanceId,
    ref: { kind: "anchor", anchorId: anchorId.trim().toUpperCase() },
  };
}

export function externalPort(label: string): WorkspaceLocation {
  const cleaned = label.trim().replace(/^EXT:/i, "");
  const split = cleaned.match(/^([^:]+):(.+)$/);
  return {
    workspaceInstanceId: BREADBOARD_WORKSPACE.instanceId,
    ref: {
      kind: "external-port",
      deviceId: split?.[1].trim() || "external",
      portId: split?.[2].trim() || cleaned || "unknown",
    },
  };
}

/** Compatibility conversion for existing Part.pins values. */
export function legacyPinLocation(pin: string): WorkspaceLocation {
  return parseHole(pin) ? anchorLocation(pin) : externalPort(pin);
}

export function resolveLocation(location: WorkspaceLocation): Vec3 | null {
  return workspaceAdapter(location.workspaceInstanceId)?.resolve(location) ?? null;
}

export function intrinsicNode(location: WorkspaceLocation): string | null {
  return workspaceAdapter(location.workspaceInstanceId)?.intrinsicNode(location) ?? null;
}

export function locationLabel(location: WorkspaceLocation): string {
  switch (location.ref.kind) {
    case "anchor": return location.ref.anchorId;
    case "region": return location.ref.regionId;
    case "metric": return `${location.ref.xMm.toFixed(1)}, ${location.ref.zMm.toFixed(1)} mm`;
    case "external-port": return `${location.ref.deviceId} ${location.ref.portId}`.trim();
  }
}

export function isTargetable(location: WorkspaceLocation): boolean {
  return workspaceAdapter(location.workspaceInstanceId)?.isTargetable(location) ?? false;
}
