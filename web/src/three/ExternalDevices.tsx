import { RoundedBox, Text } from "@react-three/drei";
import { BOARD, SURFACE_Y, type Vec3 } from "../lib/breadboard";
import type { ExternalDevice } from "../lib/types";
import { ServoModel, UnoModel, servoPort, unoPin } from "./kitModels";

interface DeviceLayout {
  position: Vec3;
  rotation: number;
}

const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toUpperCase();

function layoutFor(device: ExternalDevice, index: number): DeviceLayout {
  const order = device.placement?.order ?? index;
  const side = device.placement?.side
    ?? (device.kind === "arduino-uno" ? "front" : "right");

  // Both stand on the bench, not at the board's mid-height: the Uno on its pin
  // tails (drawn 0.9 below its origin), the servo on the bottom of its case.
  const y = device.kind === "arduino-uno" ? -BOARD.height / 2 + 0.9
    : device.kind === "micro-servo" ? -BOARD.height / 2 : 0;
  if (side === "left") {
    return { position: { x: -BOARD.width / 2 - 30, y, z: -12 + order * 34 }, rotation: 0 };
  }
  if (side === "right") {
    return { position: { x: BOARD.width / 2 + 29, y, z: -14 + order * 34 }, rotation: 0 };
  }
  // The Uno is wide, so offset it to leave a clear path from the board to its
  // headers and room for another front-mounted device beside it.
  return {
    position: {
      x: device.kind === "arduino-uno" ? -36 + order * 76 : 34 + order * 52,
      y,
      z: -BOARD.depth / 2 - 43,
    },
    rotation: 0,
  };
}

function portLocal(device: ExternalDevice, portId: string, portIndex: number): Vec3 {
  const id = normalize(portId).replace(/[^A-Z0-9]/g, "");
  if (device.kind === "arduino-uno") {
    // Real socket positions, from Arduino's board file. A bare digital pin
    // number ("13") is how people often write it.
    return unoPin(/^\d+$/.test(id) ? `D${id}` : id)
      ?? unoPin(`D${Math.min(13, 2 + portIndex)}`)!;
  }
  if (device.kind === "micro-servo") {
    // The sockets of the servo's 3-pin plug.
    return servoPort(id) ?? servoPort("GND")!;
  }
  if (device.kind === "power-supply") {
    return { x: portIndex % 2 === 0 ? -6 : 6, y: 8, z: -10 };
  }
  return { x: -8 + portIndex * 8, y: 5, z: -8 };
}

function worldPoint(local: Vec3, layout: DeviceLayout): Vec3 {
  const c = Math.cos(layout.rotation);
  const s = Math.sin(layout.rotation);
  return {
    x: layout.position.x + local.x * c + local.z * s,
    y: layout.position.y + local.y,
    z: layout.position.z - local.x * s + local.z * c,
  };
}

/** Resolve strings such as EXT:Arduino D2 to actual sockets on rendered devices. */
export function externalAnchorMap(devices: ExternalDevice[]): Map<string, Vec3> {
  const anchors = new Map<string, Vec3>();
  const barePorts = new Map<string, Vec3[]>();

  devices.forEach((device, index) => {
    const layout = layoutFor(device, index);
    const deviceAliases = new Set([device.id, device.label, ...(device.aliases ?? [])]);
    device.ports.forEach((port, portIndex) => {
      const at = worldPoint(portLocal(device, port.id || port.label, portIndex), layout);
      const portAliases = new Set([port.id, port.label, ...(port.aliases ?? [])]);
      for (const deviceAlias of deviceAliases) {
        for (const portAlias of portAliases) {
          anchors.set(normalize(`EXT:${deviceAlias} ${portAlias}`), at);
        }
      }
      for (const alias of portAliases) {
        const key = normalize(`EXT:${alias}`);
        barePorts.set(key, [...(barePorts.get(key) ?? []), at]);
      }
    });
  });

  // A short form such as EXT:GND is safe only when exactly one displayed
  // device exposes that name. Ambiguous labels remain unresolved deliberately.
  for (const [key, points] of barePorts) if (points.length === 1) anchors.set(key, points[0]);
  return anchors;
}

function PortMarkers({ device }: { device: ExternalDevice }) {
  return <>{device.ports.map((port, index) => {
    const at = portLocal(device, port.id || port.label, index);
    const color = normalize(port.id).includes("GND") ? "#202126"
      : normalize(port.id).includes("5V") ? "#e24b43" : "#f2c84b";
    return (
      <mesh key={port.id} name={`device-port:${device.id}:${port.id}`}
            position={[at.x, at.y, at.z]} castShadow>
        <sphereGeometry args={[1.15, 14, 10]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.28} />
      </mesh>
    );
  })}</>;
}

function GenericDevice({ device }: { device: ExternalDevice }) {
  return (
    <group>
      <RoundedBox args={[32, 8, 22]} radius={1.2} smoothness={3}
                  position={[0, 4, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={device.color ?? "#3f8a63"} roughness={0.52} />
      </RoundedBox>
      <Text position={[0, 8.1, 0]} rotation={[-Math.PI / 2, 0, 0]}
            fontSize={3} color="#f3f5f7" anchorX="center">
        {device.label}
      </Text>
    </group>
  );
}

export function ExternalDevices({ devices, step, dimmed }: {
  devices: ExternalDevice[];
  step: number;
  dimmed?: boolean;
}) {
  return <group name="external-devices">{devices.map((device, index) => {
    const visibleAt = device.visibleFromStep ?? 1;
    if (visibleAt > step) return null;
    const layout = layoutFor(device, index);
    const model = device.kind === "arduino-uno"
      ? <UnoModel id={device.id} color={device.color ?? "#0d7d8c"} selected={visibleAt === step} />
      : device.kind === "micro-servo"
        ? <ServoModel id={device.id} color={device.color ?? "#2563eb"} selected={visibleAt === step} />
        : <GenericDevice device={device} />;
    return (
      <group key={device.id} name={`device:${device.id}`}
             position={[layout.position.x, layout.position.y, layout.position.z]}
             rotation={[0, layout.rotation, 0]}>
        <group scale={dimmed ? 0.995 : 1}>
          {model}
          <PortMarkers device={device} />
        </group>
        <Text position={[0, SURFACE_Y + 0.15, device.kind === "arduino-uno" ? 29 : 15]}
              rotation={[-Math.PI / 2, 0, 0]} fontSize={3.4}
              color={dimmed ? "#777b84" : "#eef1f5"} anchorX="center">
          {device.label}
        </Text>
      </group>
    );
  })}</group>;
}
