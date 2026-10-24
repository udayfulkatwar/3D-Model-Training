// CCTV cameras for the chairman's wall TV: one ceiling camera per working room, mounted high on the door-side
// wall in the corner away from the door (so the door leaf never blocks the view), looking across the room.
// Restrooms are never covered.
import { CEIL_H, DOORS, FLOOR_H, FLOOR_NAMES, roomById } from './building';

export interface CctvCamera { id: string; roomId: string; label: string; floor: number; pos: { x: number; y: number; z: number }; target: { x: number; y: number; z: number } }

/** Two pages of nine for the 3 x 3 wall grid. */
const ROOM_IDS = [
  's-board', 's-ceo', 's-pm', 's-tech', 's-ops', 'f-trading', 'f-research', 'f-risk', 'f-conf',
  's-server', 's-lounge', 'f-m1a', 'f-m1b', 'g-lobby', 'g-cafe', 'g-lounge', 'g-training', 'g-interview',
];

export const CCTV_CAMERAS: CctvCamera[] = ROOM_IDS.map((roomId, i) => {
  const r = roomById(roomId)!;
  const { x0, x1, z0, z1 } = r.rect;
  const base = r.floor * FLOOR_H;
  // rooms south of the corridor open at z0, rooms north of it at z1: the camera sits above the door side
  const south = z0 >= 8;
  const doorZ = south ? z0 : z1;
  const door = DOORS.find((d) => d.floor === r.floor && d.axis === 'x' && Math.abs(d.at - doorZ) < 0.01 && d.center > x0 && d.center < x1);
  const left = door ? door.center - x0 > x1 - door.center : true;
  const inset = 0.5;
  const pos = { x: left ? x0 + inset : x1 - inset, y: base + CEIL_H - 0.35, z: south ? z0 + inset : z1 - inset };
  const target = { x: (x0 + x1) / 2 + (left ? 1 : -1) * (x1 - x0) * 0.1, y: base + 0.5, z: (z0 + z1) / 2 + (south ? 1 : -1) * (z1 - z0) * 0.12 };
  return { id: `cam-${String(i + 1).padStart(2, '0')}`, roomId, label: r.name, floor: r.floor, pos, target, };
}).map((c) => ({ ...c, label: `${c.label} · ${FLOOR_NAMES[c.floor]}` }));

export const CCTV_PAGE = 9;
