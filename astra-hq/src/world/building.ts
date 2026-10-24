// ASTRA HQ building definition: an original three-floor office layout.
// Units are metres. +X east, +Z south, +Y up. Floor k's finished floor is at y = k * FLOOR_H.
// All geometry, collision, navigation and room lookup derive from this one description.
import type { Rect } from '../util/math';

export const FLOOR_H = 4.0; // floor-to-floor height
export const CEIL_H = 3.2; // clear ceiling height above the finished floor
export const FLOOR_COUNT = 3;
export const DOOR_H = 2.25;
export const PASSAGE_H = 2.5;

/** Building outer wall centre lines. Exterior walls are 0.3 m thick, so the interior is 0.15..33.85 x 0.15..19.45. */
export const BLD = { x0: 0, z0: 0, x1: 34, z1: 19.6, ext: 0.3 } as const;
export const INNER: Rect = { x0: 0.15, z0: 0.15, x1: 33.85, z1: 19.45 };

export const FLOOR_NAMES = ['Ground Floor', 'First Floor', 'Second Floor'] as const;
export const FLOOR_SHORT = ['G', '1', '2'] as const;

export type RoomKind =
  | 'lobby' | 'reception' | 'lounge' | 'cafe' | 'meeting' | 'conference' | 'boardroom' | 'office'
  | 'trading' | 'research' | 'risk' | 'pm' | 'tech' | 'ops' | 'server' | 'restroom' | 'utility'
  | 'training' | 'interview' | 'corridor' | 'stair' | 'elevator' | 'staff-lounge';

export type Finish = 'carpet' | 'carpetDark' | 'stone' | 'wood' | 'tile' | 'concrete' | 'raised';

export interface RoomDef {
  id: string;
  floor: number;
  name: string;
  kind: RoomKind;
  rect: Rect;
  finish: Finish;
  /** A free point inside the room used for teleport / navigation targets. */
  entry: { x: number; z: number };
  /** Rooms that can be booked for meetings show a booking display. */
  bookable?: boolean;
  /** Purely technical spaces (stairs, lift, corridor) are not listed in room navigation. */
  hidden?: boolean;
}

export type WallKind = 'ext' | 'solid' | 'glass' | 'core' | 'wood' | 'acoustic';

/** Axis-aligned wall. axis 'x' runs along X at z = at; axis 'z' runs along Z at x = at. */
export interface WallDef {
  id: string;
  floor: number;
  axis: 'x' | 'z';
  at: number;
  from: number;
  to: number;
  thickness: number;
  kind: WallKind;
}

export type DoorKind = 'single' | 'double' | 'auto' | 'elevator';

export interface DoorDef {
  id: string;
  floor: number;
  axis: 'x' | 'z';
  at: number;
  center: number;
  width: number;
  kind: DoorKind;
  glass: boolean;
  /** Side of the wall the leaf swings into: +1 = towards +z (axis x) / +x (axis z). */
  swing: 1 | -1;
  defaultOpen: boolean;
  label: string;
  /** Name plate mounted on the corridor face of the door leaf (instead of a sign above the door). */
  plate?: { title: string; sub: string };
}

/** Opening without a door leaf (wide passage). */
export interface OpeningDef {
  floor: number;
  axis: 'x' | 'z';
  at: number;
  center: number;
  width: number;
  height: number;
}

const W_INT = 0.15;
const W_CORE = 0.2;

// ---------------------------------------------------------------- rooms
const R = (x0: number, z0: number, x1: number, z1: number): Rect => ({ x0, z0, x1, z1 });

export const ROOMS: RoomDef[] = [
  // Ground floor -----------------------------------------------------------
  { id: 'g-utility', floor: 0, name: 'Utility & Storage', kind: 'utility', rect: R(0.15, 0.15, 4.3, 6.0), finish: 'concrete', entry: { x: 2.2, z: 4.6 } },
  { id: 'g-interview', floor: 0, name: 'Interview Room', kind: 'interview', rect: R(4.3, 0.15, 9.0, 6.0), finish: 'carpet', entry: { x: 6.65, z: 4.7 }, bookable: true },
  { id: 'g-wc-a', floor: 0, name: 'Restroom A', kind: 'restroom', rect: R(9.0, 0.15, 13.45, 6.0), finish: 'tile', entry: { x: 11.2, z: 4.9 } },
  { id: 'g-wc-b', floor: 0, name: 'Restroom B', kind: 'restroom', rect: R(13.45, 0.15, 17.9, 6.0), finish: 'tile', entry: { x: 15.7, z: 4.9 } },
  { id: 'g-training', floor: 0, name: 'Training Room', kind: 'training', rect: R(23.5, 0.15, 33.85, 6.0), finish: 'carpet', entry: { x: 28.7, z: 5.0 }, bookable: true },
  { id: 'g-corridor', floor: 0, name: 'Ground Floor Corridor', kind: 'corridor', rect: R(0.15, 6.0, 33.85, 8.4), finish: 'stone', entry: { x: 19.3, z: 7.2 }, hidden: true },
  { id: 'g-cafe', floor: 0, name: 'Café', kind: 'cafe', rect: R(0.15, 8.4, 11.5, 19.45), finish: 'wood', entry: { x: 9.5, z: 12.0 } },
  { id: 'g-lobby', floor: 0, name: 'Reception & Lobby', kind: 'reception', rect: R(11.5, 8.4, 26.5, 19.45), finish: 'stone', entry: { x: 19.0, z: 17.2 } },
  { id: 'g-lounge', floor: 0, name: 'Visitor Lounge', kind: 'lounge', rect: R(26.5, 8.4, 33.85, 19.45), finish: 'carpetDark', entry: { x: 28.0, z: 14.0 } },
  // First floor ------------------------------------------------------------
  { id: 'f-m1a', floor: 1, name: 'Meeting Room 1A', kind: 'meeting', rect: R(0.15, 0.15, 4.6, 6.0), finish: 'carpet', entry: { x: 2.4, z: 5.0 }, bookable: true },
  { id: 'f-m1b', floor: 1, name: 'Meeting Room 1B', kind: 'meeting', rect: R(4.6, 0.15, 9.05, 6.0), finish: 'carpet', entry: { x: 6.8, z: 5.0 }, bookable: true },
  { id: 'f-risk', floor: 1, name: 'Risk Management', kind: 'risk', rect: R(9.05, 0.15, 17.9, 6.0), finish: 'carpet', entry: { x: 13.5, z: 4.6 } },
  { id: 'f-conf', floor: 1, name: 'Conference Room', kind: 'conference', rect: R(23.5, 0.15, 33.85, 6.0), finish: 'carpet', entry: { x: 25.6, z: 5.1 }, bookable: true },
  { id: 'f-corridor', floor: 1, name: 'First Floor Corridor', kind: 'corridor', rect: R(0.15, 6.0, 33.85, 8.4), finish: 'carpetDark', entry: { x: 19.3, z: 7.2 }, hidden: true },
  { id: 'f-trading', floor: 1, name: 'Trading Floor', kind: 'trading', rect: R(0.15, 8.4, 21.0, 19.45), finish: 'carpetDark', entry: { x: 19.0, z: 10.0 } },
  { id: 'f-research', floor: 1, name: 'Research Area', kind: 'research', rect: R(21.0, 8.4, 33.85, 19.45), finish: 'carpet', entry: { x: 23.0, z: 9.8 } },
  // Second floor -----------------------------------------------------------
  { id: 's-ops', floor: 2, name: 'Operations', kind: 'ops', rect: R(0.15, 0.15, 8.0, 6.0), finish: 'carpet', entry: { x: 4.0, z: 4.6 } },
  { id: 's-tech', floor: 2, name: 'Technology', kind: 'tech', rect: R(8.0, 0.15, 17.9, 6.0), finish: 'carpetDark', entry: { x: 13.0, z: 4.6 } },
  { id: 's-server', floor: 2, name: 'Server Room', kind: 'server', rect: R(23.5, 0.15, 29.0, 6.0), finish: 'raised', entry: { x: 26.2, z: 5.1 } },
  { id: 's-lounge', floor: 2, name: 'Staff Lounge', kind: 'staff-lounge', rect: R(29.0, 0.15, 33.85, 6.0), finish: 'wood', entry: { x: 31.4, z: 4.9 } },
  { id: 's-corridor', floor: 2, name: 'Second Floor Corridor', kind: 'corridor', rect: R(0.15, 6.0, 33.85, 8.4), finish: 'carpetDark', entry: { x: 19.3, z: 7.2 }, hidden: true },
  { id: 's-ceo', floor: 2, name: 'Founder / CEO Office', kind: 'office', rect: R(0.15, 8.4, 10.0, 19.45), finish: 'wood', entry: { x: 8.0, z: 10.0 } },
  { id: 's-board', floor: 2, name: 'Boardroom', kind: 'boardroom', rect: R(10.0, 8.4, 21.0, 19.45), finish: 'carpetDark', entry: { x: 15.5, z: 9.8 }, bookable: true },
  { id: 's-pm', floor: 2, name: 'Portfolio Management', kind: 'pm', rect: R(21.0, 8.4, 28.4, 19.45), finish: 'carpet', entry: { x: 25.9, z: 9.8 } },
  { id: 's-chair', floor: 2, name: "Chairman's Office", kind: 'office', rect: R(28.4, 8.4, 33.85, 19.45), finish: 'wood', entry: { x: 29.4, z: 10.0 } },
];

// Core spaces exist on every floor.
for (let f = 0; f < FLOOR_COUNT; f++) {
  ROOMS.push({ id: `${f}-stair`, floor: f, name: 'Stairwell', kind: 'stair', rect: R(17.9, 0.15, 20.7, 6.0), finish: 'concrete', entry: { x: 19.3, z: 5.2 }, hidden: true });
  ROOMS.push({ id: `${f}-lift`, floor: f, name: 'Elevator', kind: 'elevator', rect: R(20.7, 3.3, 23.5, 6.0), finish: 'stone', entry: { x: 22.1, z: 4.7 }, hidden: true });
}

// ---------------------------------------------------------------- stairs & lift
/** Dog-leg stair inside x 18.0..20.6, z 0.15..5.925. Flight A rises north on the west half, flight B rises south on the east half. */
export const STAIR = {
  x0: 18.0,
  x1: 20.6,
  aX0: 18.0,
  aX1: 19.25,
  bX0: 19.35,
  bX1: 20.6,
  landingZ0: 4.4, // floor landing z 4.4..5.925 (part of each floor)
  landingZ1: 5.925,
  flightZ0: 1.6,
  flightZ1: 4.4,
  midZ0: 0.15, // mid landing z 0.15..1.6
  midZ1: 1.6,
  risers: 11,
  halfRise: FLOOR_H / 2,
} as const;

export const ELEVATOR = {
  shaft: R(20.8, 3.4, 23.4, 5.925),
  car: R(20.9, 3.5, 23.3, 5.85),
  riser: R(20.7, 0.15, 23.5, 3.4),
  doorCenter: 22.1,
  doorWidth: 1.1,
  speed: 1.6, // m/s
} as const;

// ---------------------------------------------------------------- walls
export const WALLS: WallDef[] = [];
export const DOORS: DoorDef[] = [];
export const OPENINGS: OpeningDef[] = [];

let wallSeq = 0;
function wall(floor: number, axis: 'x' | 'z', at: number, from: number, to: number, kind: WallKind, thickness = W_INT) {
  WALLS.push({ id: `w${floor}-${wallSeq++}`, floor, axis, at, from, to, kind, thickness });
}
function door(d: Omit<DoorDef, 'glass' | 'swing' | 'defaultOpen' | 'kind'> & Partial<DoorDef>) {
  DOORS.push({ kind: 'single', glass: false, swing: -1, defaultOpen: true, ...d } as DoorDef);
}

for (let f = 0; f < FLOOR_COUNT; f++) {
  // exterior envelope (curtain wall)
  wall(f, 'x', 0, 0, 34, 'ext', BLD.ext);
  wall(f, 'x', 19.6, 0, 34, 'ext', BLD.ext);
  wall(f, 'z', 0, 0, 19.6, 'ext', BLD.ext);
  wall(f, 'z', 34, 0, 19.6, 'ext', BLD.ext);
  // core: stair + lift
  wall(f, 'z', 17.9, 0.15, 6.0, 'core', W_CORE);
  wall(f, 'z', 20.7, 0.15, 6.0, 'core', W_CORE);
  wall(f, 'z', 23.5, 0.15, 6.0, 'core', W_CORE);
  wall(f, 'x', 6.0, 17.9, 23.5, 'core', W_CORE);
  wall(f, 'x', 3.35, 20.7, 23.5, 'core', W_CORE); // lift shaft back wall (riser block behind)
  door({ id: `d${f}-stair`, floor: f, axis: 'x', at: 6.0, center: 19.3, width: 1.0, label: 'Stair door', swing: -1, glass: false });
  door({ id: `d${f}-lift`, floor: f, axis: 'x', at: 6.0, center: ELEVATOR.doorCenter, width: ELEVATOR.doorWidth, kind: 'elevator', label: 'Elevator', defaultOpen: f === 0 });
}

// Ground floor ----------------------------------------------------------------
wall(0, 'x', 6.0, 0.15, 4.3, 'solid');
wall(0, 'x', 6.0, 4.3, 9.0, 'glass');
wall(0, 'x', 6.0, 9.0, 17.9, 'solid');
wall(0, 'x', 6.0, 23.5, 33.85, 'acoustic');
wall(0, 'z', 4.3, 0.15, 6.0, 'solid');
wall(0, 'z', 9.0, 0.15, 6.0, 'solid');
wall(0, 'z', 13.45, 0.15, 6.0, 'solid');
wall(0, 'x', 8.4, 0.15, 11.5, 'wood');
wall(0, 'x', 8.4, 26.5, 33.85, 'solid');
wall(0, 'z', 11.5, 8.4, 19.45, 'glass');
wall(0, 'z', 26.5, 8.4, 19.45, 'glass');
OPENINGS.push({ floor: 0, axis: 'z', at: 11.5, center: 13.6, width: 4.0, height: PASSAGE_H });
OPENINGS.push({ floor: 0, axis: 'z', at: 26.5, center: 13.6, width: 3.2, height: PASSAGE_H });
door({ id: 'g-d-utility', floor: 0, axis: 'x', at: 6.0, center: 2.2, width: 0.9, label: 'Utility & Storage', swing: -1, defaultOpen: false });
door({ id: 'g-d-interview', floor: 0, axis: 'x', at: 6.0, center: 6.65, width: 0.9, label: 'Interview Room', glass: true, swing: -1 });
door({ id: 'g-d-wca', floor: 0, axis: 'x', at: 6.0, center: 11.2, width: 0.9, label: 'Restroom A', swing: -1, defaultOpen: false });
door({ id: 'g-d-wcb', floor: 0, axis: 'x', at: 6.0, center: 15.7, width: 0.9, label: 'Restroom B', swing: -1, defaultOpen: false });
door({ id: 'g-d-training', floor: 0, axis: 'x', at: 6.0, center: 28.7, width: 1.6, kind: 'double', label: 'Training Room', swing: -1 });
door({ id: 'g-d-cafe', floor: 0, axis: 'x', at: 8.4, center: 9.5, width: 1.6, kind: 'double', glass: true, label: 'Café', swing: 1 });
door({ id: 'g-d-entrance', floor: 0, axis: 'x', at: 19.6, center: 19.0, width: 3.0, kind: 'auto', glass: true, label: 'Main entrance', swing: 1, defaultOpen: false });

// First floor -------------------------------------------------------------------
wall(1, 'x', 6.0, 0.15, 9.05, 'glass');
wall(1, 'x', 6.0, 9.05, 17.9, 'glass');
wall(1, 'x', 6.0, 23.5, 33.85, 'glass');
wall(1, 'z', 4.6, 0.15, 6.0, 'acoustic');
wall(1, 'z', 9.05, 0.15, 6.0, 'acoustic');
wall(1, 'x', 8.4, 0.15, 21.0, 'solid');
wall(1, 'x', 8.4, 21.0, 33.85, 'glass');
wall(1, 'z', 21.0, 8.4, 19.45, 'glass');
OPENINGS.push({ floor: 1, axis: 'z', at: 21.0, center: 17.6, width: 2.2, height: PASSAGE_H });
door({ id: 'f-d-m1a', floor: 1, axis: 'x', at: 6.0, center: 2.4, width: 0.9, glass: true, label: 'Meeting Room 1A', swing: -1 });
door({ id: 'f-d-m1b', floor: 1, axis: 'x', at: 6.0, center: 6.8, width: 0.9, glass: true, label: 'Meeting Room 1B', swing: -1 });
door({ id: 'f-d-risk', floor: 1, axis: 'x', at: 6.0, center: 13.5, width: 0.9, glass: true, label: 'Risk Management', swing: -1 });
door({ id: 'f-d-conf', floor: 1, axis: 'x', at: 6.0, center: 25.6, width: 1.6, kind: 'double', glass: true, label: 'Conference Room', swing: -1 });
door({ id: 'f-d-trade-w', floor: 1, axis: 'x', at: 8.4, center: 2.2, width: 0.9, glass: true, label: 'Trading Floor (west)', swing: 1 });
door({ id: 'f-d-trade-e', floor: 1, axis: 'x', at: 8.4, center: 18.9, width: 1.6, kind: 'double', glass: true, label: 'Trading Floor', swing: 1 });
door({ id: 'f-d-research', floor: 1, axis: 'x', at: 8.4, center: 23.0, width: 0.9, glass: true, label: 'Research Area', swing: 1 });

// Second floor ------------------------------------------------------------------
wall(2, 'x', 6.0, 0.15, 8.0, 'glass');
wall(2, 'x', 6.0, 8.0, 17.9, 'glass');
wall(2, 'x', 6.0, 23.5, 29.0, 'glass');
wall(2, 'x', 6.0, 29.0, 33.85, 'solid');
wall(2, 'z', 8.0, 0.15, 6.0, 'acoustic');
wall(2, 'z', 29.0, 0.15, 6.0, 'glass');
wall(2, 'x', 8.4, 0.15, 10.0, 'wood');
wall(2, 'x', 8.4, 10.0, 21.0, 'glass');
wall(2, 'x', 8.4, 21.0, 28.4, 'glass');
wall(2, 'x', 8.4, 28.4, 33.85, 'wood');
wall(2, 'z', 28.4, 8.4, 19.45, 'wood');
wall(2, 'z', 10.0, 8.4, 19.45, 'wood');
wall(2, 'z', 21.0, 8.4, 19.45, 'acoustic');
door({ id: 's-d-ops', floor: 2, axis: 'x', at: 6.0, center: 4.0, width: 0.9, glass: true, label: 'Operations', swing: -1 });
door({ id: 's-d-tech', floor: 2, axis: 'x', at: 6.0, center: 13.0, width: 0.9, glass: true, label: 'Technology', swing: -1 });
door({ id: 's-d-server', floor: 2, axis: 'x', at: 6.0, center: 26.2, width: 0.9, glass: true, label: 'Server Room', swing: -1, defaultOpen: false });
door({ id: 's-d-lounge', floor: 2, axis: 'x', at: 6.0, center: 31.4, width: 0.9, label: 'Staff Lounge', swing: -1 });
door({ id: 's-d-ceo', floor: 2, axis: 'x', at: 8.4, center: 8.0, width: 0.9, label: 'CEO Office', swing: 1 });
door({ id: 's-d-board', floor: 2, axis: 'x', at: 8.4, center: 15.5, width: 1.6, kind: 'double', glass: true, label: 'Boardroom', swing: 1 });
door({ id: 's-d-pm', floor: 2, axis: 'x', at: 8.4, center: 25.9, width: 0.9, glass: true, label: 'Portfolio Management', swing: 1 });
door({ id: 's-d-chair', floor: 2, axis: 'x', at: 8.4, center: 29.4, width: 1.0, label: "Chairman's Office", swing: 1, defaultOpen: false, plate: { title: 'Uday Fulkatwar', sub: 'Chairman · ASTRA' } });

// ---------------------------------------------------------------- lookups
export function roomAt(floor: number, x: number, z: number): RoomDef | undefined {
  // Prefer specific rooms over the corridor when rects touch.
  let best: RoomDef | undefined;
  for (const r of ROOMS) {
    if (r.floor !== floor) continue;
    if (x >= r.rect.x0 && x <= r.rect.x1 && z >= r.rect.z0 && z <= r.rect.z1) {
      if (!best || best.kind === 'corridor') best = r;
    }
  }
  return best;
}

export function roomById(id: string): RoomDef | undefined {
  return ROOMS.find((r) => r.id === id);
}

export function floorOfY(y: number): number {
  return Math.max(0, Math.min(FLOOR_COUNT - 1, Math.floor((y + 0.6) / FLOOR_H)));
}

/** Segments of a wall left after cutting door/passage openings, plus the openings themselves. */
export interface WallPiece { from: number; to: number; bottom: number; top: number }

export function wallPieces(w: WallDef, ceiling = CEIL_H): { pieces: WallPiece[]; openings: { from: number; to: number; height: number; doorId?: string }[] } {
  const ops: { from: number; to: number; height: number; doorId?: string }[] = [];
  for (const d of DOORS) {
    if (d.floor !== w.floor || d.axis !== w.axis || Math.abs(d.at - w.at) > 0.05) continue;
    if (d.center < w.from || d.center > w.to) continue;
    const h = d.kind === 'auto' ? 2.6 : d.kind === 'elevator' ? 2.2 : DOOR_H;
    ops.push({ from: d.center - d.width / 2, to: d.center + d.width / 2, height: h, doorId: d.id });
  }
  for (const o of OPENINGS) {
    if (o.floor !== w.floor || o.axis !== w.axis || Math.abs(o.at - w.at) > 0.05) continue;
    if (o.center < w.from || o.center > w.to) continue;
    ops.push({ from: o.center - o.width / 2, to: o.center + o.width / 2, height: o.height });
  }
  ops.sort((a, b) => a.from - b.from);
  const pieces: WallPiece[] = [];
  let cur = w.from;
  for (const o of ops) {
    if (o.from > cur) pieces.push({ from: cur, to: o.from, bottom: 0, top: ceiling });
    pieces.push({ from: o.from, to: o.to, bottom: o.height, top: ceiling });
    cur = o.to;
  }
  if (cur < w.to) pieces.push({ from: cur, to: w.to, bottom: 0, top: ceiling });
  return { pieces, openings: ops };
}
