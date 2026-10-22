// Walkable surfaces and static collision volumes, derived from the building and furniture plans.
import { BLD, CEIL_H, DOORS, ELEVATOR, FLOOR_COUNT, FLOOR_H, INNER, STAIR, WALLS, wallPieces, type DoorDef } from './building';
import { FURNITURE, footprint } from './furniture';

export interface Box3 {
  x0: number; x1: number;
  y0: number; y1: number;
  z0: number; z1: number;
  tag: string;
}

export const PLAZA = { x0: 8, z0: 19.75, x1: 30, z1: 27.5 };
const THRESHOLD = { x0: 17.5, z0: 19.3, x1: 20.5, z1: 19.9 };

/** Is (x,z) covered by level `floor`'s floor slab (excluding the stair and lift voids)? */
export function floorWalkable(floor: number, x: number, z: number): boolean {
  if (floor === 0) {
    if (x >= PLAZA.x0 && x <= PLAZA.x1 && z >= PLAZA.z0 && z <= PLAZA.z1) return true;
    if (x >= THRESHOLD.x0 && x <= THRESHOLD.x1 && z >= THRESHOLD.z0 && z <= THRESHOLD.z1) return true;
  }
  if (x < INNER.x0 || x > INNER.x1 || z < INNER.z0 || z > INNER.z1) return false;
  if (x >= STAIR.x0 && x <= STAIR.x1 && z < STAIR.landingZ0) return false; // stair void
  const s = ELEVATOR.shaft;
  if (x >= s.x0 - 0.02 && x <= s.x1 + 0.02 && z >= s.z0 && z <= s.z1) return false; // lift shaft
  const r = ELEVATOR.riser;
  if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return false;
  return true;
}

/** Heights of stair surfaces under (x,z) for every flight. */
export function stairHeights(x: number, z: number, out: number[]): void {
  if (x < STAIR.x0 || x > STAIR.x1 || z < STAIR.midZ0 || z > STAIR.flightZ1) return;
  const run = STAIR.flightZ1 - STAIR.flightZ0;
  for (let k = 0; k < FLOOR_COUNT - 1; k++) {
    const base = k * FLOOR_H;
    if (z <= STAIR.midZ1) {
      out.push(base + STAIR.halfRise);
    } else if (x <= STAIR.aX1) {
      out.push(base + STAIR.halfRise * (STAIR.flightZ1 - z) / run);
    } else if (x >= STAIR.bX0) {
      out.push(base + STAIR.halfRise + STAIR.halfRise * (z - STAIR.flightZ0) / run);
    }
  }
}

export function inStairwell(x: number, z: number): boolean {
  return x >= STAIR.x0 && x <= STAIR.x1 && z >= STAIR.midZ0 && z <= STAIR.landingZ1;
}

// ------------------------------------------------------------------ static colliders
function wallBox(axis: 'x' | 'z', at: number, from: number, to: number, t: number, y0: number, y1: number, tag: string): Box3 {
  return axis === 'x'
    ? { x0: from, x1: to, z0: at - t / 2, z1: at + t / 2, y0, y1, tag }
    : { x0: at - t / 2, x1: at + t / 2, z0: from, z1: to, y0, y1, tag };
}

export const STATIC_BOXES: Box3[] = [];

for (const w of WALLS) {
  const base = w.floor * FLOOR_H;
  const top = w.kind === 'ext' || w.kind === 'core' ? FLOOR_H : CEIL_H;
  const { pieces } = wallPieces(w, top);
  for (const p of pieces) STATIC_BOXES.push(wallBox(w.axis, w.at, p.from, p.to, w.thickness, base + p.bottom, base + p.top, `wall:${w.id}`));
}
for (const f of FURNITURE) {
  if (f.noCollide || f.type === 'rug') continue;
  const fp = footprint(f);
  const base = f.floor * FLOOR_H;
  // stalls are open at the front (the occupant side); collide on the partition only
  STATIC_BOXES.push({ ...fp, y0: base, y1: base + f.h, tag: `furn:${f.id}` });
}
// Stair: well divider (full height) and guard rail at the top floor; panel under the first flight.
STATIC_BOXES.push({ x0: STAIR.aX1, x1: STAIR.bX0, z0: STAIR.flightZ0, z1: STAIR.flightZ1, y0: -1, y1: FLOOR_COUNT * FLOOR_H, tag: 'stair:divider' });
STATIC_BOXES.push({ x0: STAIR.aX0, x1: STAIR.aX1 + 0.05, z0: STAIR.landingZ0 - 0.06, z1: STAIR.landingZ0 + 0.02, y0: (FLOOR_COUNT - 1) * FLOOR_H, y1: (FLOOR_COUNT - 1) * FLOOR_H + 1.1, tag: 'stair:toprail' });
STATIC_BOXES.push({ x0: STAIR.bX0 - 0.05, x1: STAIR.bX1, z0: STAIR.landingZ0 - 0.06, z1: STAIR.landingZ0 + 0.02, y0: 0, y1: 1.9, tag: 'stair:underpanel' });
// Elevator shaft side walls inside the core (between the hoistway and the car) are covered by core walls.
// Building envelope above the plaza: planter edges and kerb around the plaza so the player stays near the entrance.
STATIC_BOXES.push({ x0: PLAZA.x0 - 0.3, x1: PLAZA.x0, z0: PLAZA.z0, z1: PLAZA.z1, y0: 0, y1: 1.2, tag: 'plaza:w' });
STATIC_BOXES.push({ x0: PLAZA.x1, x1: PLAZA.x1 + 0.3, z0: PLAZA.z0, z1: PLAZA.z1, y0: 0, y1: 1.2, tag: 'plaza:e' });
STATIC_BOXES.push({ x0: PLAZA.x0, x1: PLAZA.x1, z0: PLAZA.z1, z1: PLAZA.z1 + 0.3, y0: 0, y1: 1.2, tag: 'plaza:s' });

/** Uniform-grid spatial index over static boxes for fast queries. */
const CELL = 1.0;
const GW = Math.ceil((BLD.x1 + 4) / CELL);
const GD = Math.ceil((PLAZA.z1 + 4) / CELL);
const grid: number[][] = Array.from({ length: GW * GD }, () => []);
STATIC_BOXES.forEach((b, i) => {
  const cx0 = Math.max(0, Math.floor(b.x0 / CELL));
  const cx1 = Math.min(GW - 1, Math.floor(b.x1 / CELL));
  const cz0 = Math.max(0, Math.floor(b.z0 / CELL));
  const cz1 = Math.min(GD - 1, Math.floor(b.z1 / CELL));
  for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) grid[cz * GW + cx].push(i);
});

const seen = new Uint32Array(STATIC_BOXES.length);
let stamp = 1;
/** Static boxes whose XZ bounds come within `r` of (x,z). */
export function queryStatic(x: number, z: number, r: number, out: Box3[]): Box3[] {
  out.length = 0;
  stamp++;
  const cx0 = Math.max(0, Math.floor((x - r) / CELL));
  const cx1 = Math.min(GW - 1, Math.floor((x + r) / CELL));
  const cz0 = Math.max(0, Math.floor((z - r) / CELL));
  const cz1 = Math.min(GD - 1, Math.floor((z + r) / CELL));
  for (let cz = cz0; cz <= cz1; cz++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      for (const i of grid[cz * GW + cx]) {
        if (seen[i] === stamp) continue;
        seen[i] = stamp;
        out.push(STATIC_BOXES[i]);
      }
    }
  }
  return out;
}

/** Collision box for a closed door leaf filling its opening. */
export function doorBox(d: DoorDef): Box3 {
  const base = d.floor * FLOOR_H;
  const h = d.kind === 'auto' ? 2.6 : 2.25;
  return wallBox(d.axis, d.at, d.center - d.width / 2, d.center + d.width / 2, 0.12, base, base + h, `door:${d.id}`);
}

export const DOOR_INDEX = new Map(DOORS.map((d) => [d.id, d]));
