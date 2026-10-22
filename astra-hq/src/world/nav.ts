// Navigation grid (0.2 m cells per floor) with A* search, line-of-sight smoothing and stair transfers.
import { BLD, DOORS, FLOOR_COUNT, FLOOR_H, STAIR } from './building';
import { STATIC_BOXES, floorWalkable } from './physics';

export const NAV_CELL = 0.2;
export const NAV_RADIUS = 0.24;
const NW = Math.ceil((BLD.x1 + 0.01) / NAV_CELL);
const ND = Math.ceil((BLD.z1 + 0.01) / NAV_CELL);

export interface Waypoint {
  x: number;
  y: number;
  z: number;
  floor: number;
  /** Door that must be passed on the segment leading to this waypoint. */
  door?: string;
  stair?: boolean;
}

interface FloorGrid {
  walk: Uint8Array; // 1 = walkable
  door: Int16Array; // door index or -1
}

const grids: FloorGrid[] = [];
const DOOR_IDS = DOORS.map((d) => d.id);

function buildGrid(floor: number): FloorGrid {
  const walk = new Uint8Array(NW * ND);
  const door = new Int16Array(NW * ND).fill(-1);
  const base = floor * FLOOR_H;
  for (let iz = 0; iz < ND; iz++) {
    for (let ix = 0; ix < NW; ix++) {
      const x = (ix + 0.5) * NAV_CELL;
      const z = (iz + 0.5) * NAV_CELL;
      walk[iz * NW + ix] = floorWalkable(floor, x, z) && z < BLD.z1 - 0.2 ? 1 : 0;
    }
  }
  // Block cells covered by obstacles (inflated by the walker radius) in the body height band.
  for (const b of STATIC_BOXES) {
    if (b.y1 <= base + 0.15 || b.y0 >= base + 1.8) continue;
    const x0 = Math.max(0, Math.floor((b.x0 - NAV_RADIUS) / NAV_CELL));
    const x1 = Math.min(NW - 1, Math.floor((b.x1 + NAV_RADIUS) / NAV_CELL));
    const z0 = Math.max(0, Math.floor((b.z0 - NAV_RADIUS) / NAV_CELL));
    const z1 = Math.min(ND - 1, Math.floor((b.z1 + NAV_RADIUS) / NAV_CELL));
    for (let iz = z0; iz <= z1; iz++) {
      for (let ix = x0; ix <= x1; ix++) {
        const cx = (ix + 0.5) * NAV_CELL;
        const cz = (iz + 0.5) * NAV_CELL;
        const dx = Math.max(b.x0 - cx, 0, cx - b.x1);
        const dz = Math.max(b.z0 - cz, 0, cz - b.z1);
        if (dx * dx + dz * dz < NAV_RADIUS * NAV_RADIUS) walk[iz * NW + ix] = 0;
      }
    }
  }
  // The lift is player-only; employees use the stairs. Mark door openings.
  DOORS.forEach((d, i) => {
    if (d.floor !== floor || d.kind === 'elevator') return;
    const along0 = d.center - d.width / 2 + 0.1;
    const along1 = d.center + d.width / 2 - 0.1;
    const across0 = d.at - 0.36;
    const across1 = d.at + 0.36;
    const [x0, x1, z0, z1] = d.axis === 'x' ? [along0, along1, across0, across1] : [across0, across1, along0, along1];
    for (let iz = Math.floor(z0 / NAV_CELL); iz <= Math.floor(z1 / NAV_CELL); iz++) {
      for (let ix = Math.floor(x0 / NAV_CELL); ix <= Math.floor(x1 / NAV_CELL); ix++) {
        if (ix < 0 || iz < 0 || ix >= NW || iz >= ND) continue;
        if (d.kind === 'auto') continue; // employees never use the entrance
        // Open the wall cells in the doorway (the wall box was rasterised above).
        const cx = (ix + 0.5) * NAV_CELL;
        const cz = (iz + 0.5) * NAV_CELL;
        const a = d.axis === 'x' ? cx : cz;
        if (a > d.center - d.width / 2 + NAV_RADIUS - 0.05 && a < d.center + d.width / 2 - NAV_RADIUS + 0.05) {
          walk[iz * NW + ix] = 1;
          door[iz * NW + ix] = i;
        }
      }
    }
  });
  return { walk, door };
}

export function navGrid(floor: number): FloorGrid {
  if (!grids[floor]) grids[floor] = buildGrid(floor);
  return grids[floor];
}

export const NAV_DIMS = { w: NW, d: ND };

export function cellOf(x: number, z: number): [number, number] {
  return [Math.floor(x / NAV_CELL), Math.floor(z / NAV_CELL)];
}

export function isWalkableCell(floor: number, ix: number, iz: number): boolean {
  if (ix < 0 || iz < 0 || ix >= NW || iz >= ND) return false;
  return navGrid(floor).walk[iz * NW + ix] === 1;
}

export function isWalkable(floor: number, x: number, z: number): boolean {
  const [ix, iz] = cellOf(x, z);
  return isWalkableCell(floor, ix, iz);
}

/** Nearest walkable cell centre to (x,z) within maxR metres. */
export function nearestWalkable(floor: number, x: number, z: number, maxR = 2): { x: number; z: number } | null {
  const [cx, cz] = cellOf(x, z);
  if (isWalkableCell(floor, cx, cz)) return { x, z };
  const maxC = Math.ceil(maxR / NAV_CELL);
  let best: { x: number; z: number } | null = null;
  let bestD = Infinity;
  for (let r = 1; r <= maxC; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        if (!isWalkableCell(floor, cx + dx, cz + dz)) continue;
        const px = (cx + dx + 0.5) * NAV_CELL;
        const pz = (cz + dz + 0.5) * NAV_CELL;
        const dd = Math.hypot(px - x, pz - z);
        if (dd < bestD) { bestD = dd; best = { x: px, z: pz }; }
      }
    }
    if (best) return best;
  }
  return null;
}

// ------------------------------------------------------------------ A*
class Heap {
  ids: number[] = [];
  keys: number[] = [];
  get size() { return this.ids.length; }
  push(id: number, key: number) {
    this.ids.push(id); this.keys.push(key);
    let i = this.ids.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= this.keys[i]) break;
      this.swap(i, p); i = p;
    }
  }
  pop(): number {
    const top = this.ids[0];
    const lastId = this.ids.pop()!;
    const lastKey = this.keys.pop()!;
    if (this.ids.length) {
      this.ids[0] = lastId; this.keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < this.ids.length && this.keys[l] < this.keys[m]) m = l;
        if (r < this.ids.length && this.keys[r] < this.keys[m]) m = r;
        if (m === i) break;
        this.swap(i, m); i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number) {
    [this.ids[a], this.ids[b]] = [this.ids[b], this.ids[a]];
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
  }
}

const gScore = new Float32Array(NW * ND);
const came = new Int32Array(NW * ND);
const closedStamp = new Uint32Array(NW * ND);
const openStamp = new Uint32Array(NW * ND);
let searchStamp = 0;

export type DoorClosedFn = (doorId: string) => boolean;

const DIRS: [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

/** A* on one floor. Closed doors are passable at a high cost (employees open them when there is no alternative). */
export function findPathOnFloor(floor: number, sx: number, sz: number, tx: number, tz: number, doorClosed?: DoorClosedFn): { x: number; z: number; door?: string }[] | null {
  const g = navGrid(floor);
  const s0 = nearestWalkable(floor, sx, sz, 1.5);
  const t0 = nearestWalkable(floor, tx, tz, 1.5);
  if (!s0 || !t0) return null;
  const [six, siz] = cellOf(s0.x, s0.z);
  const [tix, tiz] = cellOf(t0.x, t0.z);
  const start = siz * NW + six;
  const goal = tiz * NW + tix;
  searchStamp++;
  const heap = new Heap();
  gScore[start] = 0;
  openStamp[start] = searchStamp;
  came[start] = -1;
  heap.push(start, 0);
  let found = false;
  let iterations = 0;
  while (heap.size) {
    const cur = heap.pop();
    if (closedStamp[cur] === searchStamp) continue;
    closedStamp[cur] = searchStamp;
    if (cur === goal) { found = true; break; }
    if (++iterations > 60000) break;
    const cx = cur % NW;
    const cz = (cur - cx) / NW;
    for (const [dx, dz, cost] of DIRS) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= NW || nz >= ND) continue;
      const ni = nz * NW + nx;
      if (!g.walk[ni] || closedStamp[ni] === searchStamp) continue;
      if (dx && dz && (!g.walk[cz * NW + nx] || !g.walk[nz * NW + cx])) continue; // no corner cutting
      let c = cost;
      const di = g.door[ni];
      if (di >= 0 && doorClosed?.(DOOR_IDS[di])) c += 60;
      const ng = gScore[cur] + c;
      if (openStamp[ni] === searchStamp && ng >= gScore[ni]) continue;
      openStamp[ni] = searchStamp;
      gScore[ni] = ng;
      came[ni] = cur;
      const hx = Math.abs(nx - tix);
      const hz = Math.abs(nz - tiz);
      heap.push(ni, ng + (hx + hz) + (Math.SQRT2 - 2) * Math.min(hx, hz));
    }
  }
  if (!found) return null;
  const cells: number[] = [];
  for (let c = goal; c !== -1; c = came[c]) cells.push(c);
  cells.reverse();
  const pts = cells.map((c) => ({ x: ((c % NW) + 0.5) * NAV_CELL, z: (Math.floor(c / NW) + 0.5) * NAV_CELL, door: g.door[c] >= 0 ? DOOR_IDS[g.door[c]] : undefined }));
  pts[0] = { ...pts[0], x: s0.x, z: s0.z };
  pts[pts.length - 1] = { ...pts[pts.length - 1], x: t0.x, z: t0.z };
  return smooth(floor, pts);
}

/** Walkable straight segment (sampled every 2 cm, checking the cell under each sample). */
export function lineWalkable(floor: number, ax: number, az: number, bx: number, bz: number): boolean {
  const len = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.ceil(len / 0.02));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (!isWalkable(floor, ax + (bx - ax) * t, az + (bz - az) * t)) return false;
  }
  return true;
}

function doorOnSegment(floor: number, ax: number, az: number, bx: number, bz: number): string | undefined {
  const g = navGrid(floor);
  const len = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.ceil(len / 0.1));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const [ix, iz] = cellOf(ax + (bx - ax) * t, az + (bz - az) * t);
    const di = g.door[iz * NW + ix];
    if (di >= 0) return DOOR_IDS[di];
  }
  return undefined;
}

function smooth(floor: number, pts: { x: number; z: number; door?: string }[]): { x: number; z: number; door?: string }[] {
  if (pts.length <= 2) return pts.map((p, i) => (i === 0 ? p : { ...p, door: doorOnSegment(floor, pts[0].x, pts[0].z, p.x, p.z) }));
  const out = [pts[0]];
  let anchor = 0;
  while (anchor < pts.length - 1) {
    let next = anchor + 1;
    for (let j = pts.length - 1; j > anchor + 1; j--) {
      if (lineWalkable(floor, pts[anchor].x, pts[anchor].z, pts[j].x, pts[j].z)) { next = j; break; }
    }
    const a = pts[anchor];
    const b = pts[next];
    out.push({ x: b.x, z: b.z, door: doorOnSegment(floor, a.x, a.z, b.x, b.z) });
    anchor = next;
  }
  return out;
}

// ------------------------------------------------------------------ stairs
const LANE = 0.2;
const aMid = (STAIR.aX0 + STAIR.aX1) / 2;
const bMid = (STAIR.bX0 + STAIR.bX1) / 2;
const midZ = (STAIR.midZ0 + STAIR.midZ1) / 2 + 0.1;
const landZ = (STAIR.landingZ0 + STAIR.landingZ1) / 2 - 0.15;

/** Waypoints climbing from floor k to k+1 (up = true) or descending from k+1 to k. */
function stairLeg(k: number, up: boolean): Waypoint[] {
  const b = k * FLOOR_H;
  const ax = up ? aMid - LANE : aMid + LANE;
  const bx = up ? bMid + LANE : bMid - LANE;
  const pts: Waypoint[] = [
    { x: ax, z: landZ, y: b, floor: k },
    { x: ax, z: STAIR.flightZ1, y: b, floor: k },
    { x: ax, z: STAIR.flightZ0, y: b + STAIR.halfRise, floor: k },
    { x: ax, z: midZ, y: b + STAIR.halfRise, floor: k },
    { x: bx, z: midZ, y: b + STAIR.halfRise, floor: k },
    { x: bx, z: STAIR.flightZ0, y: b + STAIR.halfRise, floor: k },
    { x: bx, z: STAIR.flightZ1, y: b + FLOOR_H, floor: k + 1 },
    { x: bx, z: landZ, y: b + FLOOR_H, floor: k + 1 },
  ].map((p) => ({ ...p, stair: true }));
  return up ? pts : pts.reverse();
}

export function stairEntry(up: boolean): { x: number; z: number } {
  return up ? { x: aMid - LANE, z: landZ } : { x: bMid - LANE, z: landZ };
}

/** Full route between two points on any floors, via the stairs if needed. */
export function findPath(from: { floor: number; x: number; z: number }, to: { floor: number; x: number; z: number }, doorClosed?: DoorClosedFn): Waypoint[] | null {
  const out: Waypoint[] = [];
  let cur = { ...from };
  while (cur.floor !== to.floor) {
    const up = to.floor > cur.floor;
    const entry = stairEntry(up);
    const seg = findPathOnFloor(cur.floor, cur.x, cur.z, entry.x, entry.z, doorClosed);
    if (!seg) return null;
    for (const p of seg.slice(1)) out.push({ x: p.x, z: p.z, y: cur.floor * FLOOR_H, floor: cur.floor, door: p.door });
    const k = up ? cur.floor : cur.floor - 1;
    const leg = stairLeg(k, up);
    out.push(...leg.slice(1));
    const last = leg[leg.length - 1];
    cur = { floor: last.floor, x: last.x, z: last.z };
    if (cur.floor < 0 || cur.floor >= FLOOR_COUNT) return null;
  }
  const seg = findPathOnFloor(cur.floor, cur.x, cur.z, to.x, to.z, doorClosed);
  if (!seg) return null;
  for (const p of seg.slice(1)) out.push({ x: p.x, z: p.z, y: cur.floor * FLOOR_H, floor: cur.floor, door: p.door });
  return out;
}

export function pathLength(from: { x: number; z: number }, path: Waypoint[]): number {
  let len = 0;
  let px = from.x;
  let pz = from.z;
  for (const p of path) {
    len += Math.hypot(p.x - px, p.z - pz);
    px = p.x;
    pz = p.z;
  }
  return len;
}
