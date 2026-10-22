// Mutable per-frame player/camera state shared between the 3D controller, minimap and HUD
// without triggering React renders.
import { SPAWN } from '../world/movement';

export const player = {
  x: SPAWN.x,
  y: 0,
  z: SPAWN.z,
  yaw: SPAWN.yaw,
  pitch: 0,
  floor: 0,
  /** Camera world position/orientation for whatever camera mode is active. */
  camX: SPAWN.x,
  camY: 1.6,
  camZ: SPAWN.z,
  camYaw: 0,
  invalidTime: 0,
  /** Incremented every time a teleport is applied (used by tests and UI sync). */
  teleportSeq: 0,
};

export interface TeleportRequest { floor: number; x: number; z: number; yaw?: number; label?: string }

let pending: TeleportRequest | null = null;
export function requestTeleport(t: TeleportRequest) {
  pending = t;
}
export function takeTeleport(): TeleportRequest | null {
  const t = pending;
  pending = null;
  return t;
}

/** Keyboard + touch movement input (written by input handlers, read by the controller). */
export const input = {
  keys: new Set<string>(),
  touchMove: { x: 0, y: 0 },
  lookDX: 0,
  lookDY: 0,
};
