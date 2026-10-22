// Player movement: collision against walls, furniture, closed doors and people; stays on walkable surfaces.
import { ELEVATOR, FLOOR_COUNT, FLOOR_H, roomAt } from './building';
import { type DynamicWorld } from './dynamic';
import { nearestWalkable } from './nav';
import { floorWalkable, queryStatic, stairHeights, type Box3 } from './physics';

export const PLAYER_RADIUS = 0.27;
export const EYE_HEIGHT = 1.62;
const STEP = 0.45;
const BODY_LOW = 0.32; // obstacles lower than this are stepped over (rugs, kerbs)
const BODY_HIGH = 1.85;

export const SPAWN = { x: 19.0, z: 17.6, floor: 0, yaw: 0 }; // lobby, facing the reception desk (north)

const CAR = { x0: ELEVATOR.car.x0, x1: ELEVATOR.car.x1, z0: ELEVATOR.car.z0, z1: 5.95 };

export function inCar(x: number, z: number): boolean {
  return x >= CAR.x0 && x <= CAR.x1 && z >= CAR.z0 && z <= CAR.z1;
}

const tmpH: number[] = [];
/** Height of the walkable surface under (x,z) closest to yRef (within a step), or null. */
export function groundHeight(dyn: DynamicWorld, x: number, z: number, yRef: number): number | null {
  tmpH.length = 0;
  for (let f = 0; f < FLOOR_COUNT; f++) if (floorWalkable(f, x, z)) tmpH.push(f * FLOOR_H);
  stairHeights(x, z, tmpH);
  if (inCar(x, z)) tmpH.push(dyn.lift.y);
  let best: number | null = null;
  let bestD = Infinity;
  for (const h of tmpH) {
    const d = Math.abs(h - yRef);
    if (d <= STEP && d < bestD) { bestD = d; best = h; }
  }
  return best;
}

export interface Pos { x: number; y: number; z: number }
export interface Circle { x: number; z: number; y: number; r: number }

const near: Box3[] = [];
const dynBoxes: Box3[] = [];

function blocked(dyn: DynamicWorld, x: number, z: number, y: number, people: Circle[]): boolean {
  const lo = y + BODY_LOW;
  const hi = y + BODY_HIGH;
  const r = PLAYER_RADIUS;
  queryStatic(x, z, r + 0.05, near);
  for (const b of near) {
    if (b.y1 <= lo || b.y0 >= hi) continue;
    const dx = Math.max(b.x0 - x, 0, x - b.x1);
    const dz = Math.max(b.z0 - z, 0, z - b.z1);
    if (dx * dx + dz * dz < r * r) return true;
  }
  dyn.dynamicBoxes(dynBoxes);
  for (const b of dynBoxes) {
    if (b.y1 <= lo || b.y0 >= hi) continue;
    const dx = Math.max(b.x0 - x, 0, x - b.x1);
    const dz = Math.max(b.z0 - z, 0, z - b.z1);
    if (dx * dx + dz * dz < r * r) return true;
  }
  for (const p of people) {
    if (Math.abs(p.y - y) > 1.2) continue;
    if (Math.hypot(p.x - x, p.z - z) < p.r + r) return true;
  }
  return false;
}

function tryStep(dyn: DynamicWorld, p: Pos, nx: number, nz: number, people: Circle[]): Pos | null {
  const h = groundHeight(dyn, nx, nz, p.y);
  if (h === null) return null;
  if (blocked(dyn, nx, nz, h, people)) return null;
  return { x: nx, y: h, z: nz };
}

/**
 * Move by (dx, dz) with wall sliding. Large moves are split into sub-steps so thin walls cannot be tunnelled.
 * People who currently overlap the player do not block (lets the player step away from a crowd).
 */
export function resolveMove(dyn: DynamicWorld, p: Pos, dx: number, dz: number, people: Circle[]): Pos {
  const free = people.filter((c) => Math.hypot(c.x - p.x, c.z - p.z) >= c.r + PLAYER_RADIUS);
  const len = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(len / 0.08));
  let cur = { ...p };
  // refresh height even when stationary (lift car moving under the player)
  const h0 = groundHeight(dyn, cur.x, cur.z, cur.y);
  if (h0 !== null) cur.y = h0;
  for (let i = 0; i < steps; i++) {
    const sx = dx / steps;
    const sz = dz / steps;
    const n = tryStep(dyn, cur, cur.x + sx, cur.z + sz, free) ?? tryStep(dyn, cur, cur.x + sx, cur.z, free) ?? tryStep(dyn, cur, cur.x, cur.z + sz, free);
    if (!n) break;
    cur = n;
  }
  return cur;
}

/** True when the position is valid for a standing player (on a surface, not inside an obstacle). */
export function validPosition(dyn: DynamicWorld, p: Pos): boolean {
  const h = groundHeight(dyn, p.x, p.z, p.y);
  if (h === null || Math.abs(h - p.y) > 0.05) return false;
  return !blocked(dyn, p.x, p.z, h, []);
}

/** Find a safe standing spot near (x,z) on `floor` (used for teleports and invalid-position recovery). */
export function safeSpot(dyn: DynamicWorld, floor: number, x: number, z: number): Pos {
  const w = nearestWalkable(floor, x, z, 3);
  if (w) {
    const p = { x: w.x, y: floor * FLOOR_H, z: w.z };
    if (validPosition(dyn, p)) return p;
    for (let r = 0.2; r < 3; r += 0.2) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        const q = { x: w.x + Math.cos(a) * r, y: floor * FLOOR_H, z: w.z + Math.sin(a) * r };
        if (validPosition(dyn, q)) return q;
      }
    }
  }
  return { x: SPAWN.x, y: 0, z: SPAWN.z };
}

export function describeLocation(floor: number, x: number, z: number): string {
  return roomAt(floor, x, z)?.name ?? (z > 19.6 ? 'Entrance Plaza' : 'Office');
}
