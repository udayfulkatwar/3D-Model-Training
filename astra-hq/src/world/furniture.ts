// Furnishing plan for every room: furniture footprints (used for rendering AND collision),
// workstations with monitor IDs, reservable seats, standing spots and wall panels.
import { FLOOR_H, roomAt } from './building';

export type FurnType =
  | 'desk' | 'deskExec' | 'receptionDesk' | 'chairTask' | 'chairExec' | 'chairMeeting' | 'chairCafe' | 'stool'
  | 'armchair' | 'sofa' | 'coffeeTable' | 'tableRound' | 'tableRect' | 'tableHigh' | 'counter' | 'cabinet'
  | 'shelf' | 'bookshelf' | 'plant' | 'plantTall' | 'printer' | 'copier' | 'fridge' | 'waterCooler' | 'rack' | 'crac'
  | 'stall' | 'vanity' | 'lectern' | 'credenza' | 'filing' | 'logoWall' | 'kiosk' | 'whiteboardStand'
  | 'screenStand' | 'rug' | 'cart' | 'coatStand' | 'boiler' | 'bench';

export interface FurnItem {
  id: string;
  type: FurnType;
  floor: number;
  x: number;
  z: number;
  /** Rotation about +Y; multiples of PI/2 keep footprints axis-aligned. Local +Z is the item's front. */
  rot: number;
  w: number; // local X size
  d: number; // local Z size
  h: number;
  /** Visual variant (colour, contents) chosen deterministically. */
  variant?: number;
  /** Excluded from collision (rugs, flat items). */
  noCollide?: boolean;
}

export type WorkstationKind =
  | 'trading' | 'research' | 'risk' | 'pm' | 'tech' | 'ops' | 'reception' | 'ceo' | 'cafe' | 'flex';

export interface MonitorDef {
  id: string;
  workstationId: string;
  index: number;
  floor: number;
  x: number; // screen centre
  y: number;
  z: number;
  heading: number; // direction the screen faces
  w: number;
  h: number;
}

export interface Workstation {
  id: string;
  kind: WorkstationKind;
  label: string;
  floor: number;
  roomId: string;
  x: number; // desk centre
  z: number;
  rot: number;
  deskW: number;
  deskD: number;
  seatId: string;
  monitors: MonitorDef[];
  /** Spot where a colleague stands to discuss work with the occupant. */
  discussSpot: { x: number; z: number; heading: number };
}

export type SeatKind = 'desk' | 'meeting' | 'cafe' | 'lounge' | 'stool' | 'stand';

export interface Seat {
  id: string;
  floor: number;
  x: number;
  z: number;
  /** Absolute height of the seat surface (or floor for standing spots). */
  y: number;
  heading: number;
  kind: SeatKind;
  roomId: string;
  /** Walkable point next to the seat where a person stands before sitting. */
  approach: { x: number; z: number };
  chairId?: string;
  workstationId?: string;
}

export type PanelKind =
  | 'roomDisplay' | 'whiteboard' | 'marketWall' | 'serverDisplay' | 'directory' | 'menuBoard'
  | 'riskWall' | 'pmWall' | 'ceoTv' | 'floorSign' | 'logo' | 'trainingScreen' | 'worldMarkets';

export interface WallPanel {
  id: string;
  kind: PanelKind;
  floor: number;
  roomId: string;
  x: number;
  y: number; // centre height above the floor of `floor`
  z: number;
  heading: number;
  w: number;
  h: number;
  label: string;
}

export const FURNITURE: FurnItem[] = [];
export const WORKSTATIONS: Workstation[] = [];
export const SEATS: Seat[] = [];
export const PANELS: WallPanel[] = [];

const PI = Math.PI;
const HALF = PI / 2;
let furnSeq = 0;

/** Rotate a local offset by heading `rot` (three.js Y rotation convention). */
export function rotLocal(lx: number, lz: number, rot: number): { x: number; z: number } {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return { x: lx * c + lz * s, z: -lx * s + lz * c };
}

export function footprint(f: Pick<FurnItem, 'x' | 'z' | 'w' | 'd' | 'rot'>): { x0: number; z0: number; x1: number; z1: number } {
  const q = Math.round(f.rot / HALF) & 1;
  const hw = (q ? f.d : f.w) / 2;
  const hd = (q ? f.w : f.d) / 2;
  return { x0: f.x - hw, z0: f.z - hd, x1: f.x + hw, z1: f.z + hd };
}

const DIMS: Partial<Record<FurnType, [number, number, number]>> = {
  chairTask: [0.62, 0.62, 1.12],
  chairExec: [0.7, 0.7, 1.25],
  chairMeeting: [0.56, 0.56, 0.92],
  chairCafe: [0.46, 0.48, 0.84],
  stool: [0.42, 0.42, 0.76],
  armchair: [0.82, 0.82, 0.8],
  plant: [0.5, 0.5, 1.1],
  plantTall: [0.65, 0.65, 1.9],
  printer: [0.6, 0.55, 1.0],
  copier: [1.1, 0.7, 1.15],
  fridge: [0.75, 0.7, 1.95],
  waterCooler: [0.35, 0.35, 1.2],
  rack: [0.6, 1.1, 2.1],
  crac: [0.9, 0.8, 2.0],
  lectern: [0.6, 0.45, 1.15],
  kiosk: [0.6, 0.35, 1.75],
  whiteboardStand: [1.6, 0.55, 1.95],
  screenStand: [1.1, 0.55, 1.8],
  cart: [0.5, 0.9, 1.0],
  coatStand: [0.45, 0.45, 1.8],
  boiler: [0.6, 0.6, 1.8],
};

export function addFurn(type: FurnType, floor: number, x: number, z: number, rot = 0, w?: number, d?: number, h?: number, extra: Partial<FurnItem> = {}): FurnItem {
  const dim = DIMS[type] ?? [1, 1, 1];
  const item: FurnItem = { id: `fu-${furnSeq++}`, type, floor, x, z, rot, w: w ?? dim[0], d: d ?? dim[1], h: h ?? dim[2], ...extra };
  FURNITURE.push(item);
  return item;
}

function seatHeight(kind: FurnType): number {
  switch (kind) {
    case 'stool': return 0.76;
    case 'armchair': case 'sofa': return 0.43;
    case 'chairCafe': return 0.46;
    default: return 0.48;
  }
}

/** Add a chair plus a reservable seat. `heading` is the direction the seated person faces. */
function chairSeat(id: string, chairType: FurnType, floor: number, x: number, z: number, heading: number, kind: SeatKind, extra: Partial<Seat> = {}): Seat {
  // Chair model front faces local +Z, so its rotation equals the occupant heading.
  const chair = addFurn(chairType, floor, x, z, heading);
  const back = rotLocal(0, -0.62, heading);
  const room = roomAt(floor, x, z);
  const seat: Seat = {
    id, floor, x, z, y: floor * FLOOR_H + seatHeight(chairType), heading, kind,
    roomId: room?.id ?? 'unknown', approach: { x: x + back.x, z: z + back.z }, chairId: chair.id, ...extra,
  };
  SEATS.push(seat);
  return seat;
}

/** Seat on an existing sofa (no extra chair item). */
function sofaSeat(id: string, floor: number, x: number, z: number, heading: number) {
  const front = rotLocal(0, 0.75, heading);
  const room = roomAt(floor, x, z);
  SEATS.push({ id, floor, x, z, y: floor * FLOOR_H + 0.43, heading, kind: 'lounge', roomId: room?.id ?? 'unknown', approach: { x: x + front.x, z: z + front.z } });
}

function standSpot(id: string, floor: number, x: number, z: number, heading: number) {
  const room = roomAt(floor, x, z);
  SEATS.push({ id, floor, x, z, y: floor * FLOOR_H, heading, kind: 'stand', roomId: room?.id ?? 'unknown', approach: { x, z } });
}

function panel(p: Omit<WallPanel, 'roomId'> & { roomId?: string }) {
  PANELS.push({ roomId: p.roomId ?? roomAt(p.floor, p.x, p.z)?.id ?? 'unknown', ...p });
}

interface WsSpec {
  id: string;
  kind: WorkstationKind;
  label: string;
  floor: number;
  x: number;
  z: number;
  rot: number;
  w?: number;
  d?: number;
  monitors: number;
  deskType?: FurnType;
  chair?: FurnType;
  noDesk?: boolean;
  seatOffset?: number;
}

/** Desk + chair + monitors. Desk front (user side) is local +Z; monitors sit near local -Z facing the user. */
function workstation(s: WsSpec): Workstation {
  const w = s.w ?? 1.6;
  const d = s.d ?? 0.8;
  if (!s.noDesk) addFurn(s.deskType ?? 'desk', s.floor, s.x, s.z, s.rot, w, d, s.deskType === 'receptionDesk' ? 1.08 : 0.74, { variant: s.kind === 'trading' ? 1 : 0 });
  const seatLocal = s.seatOffset ?? d / 2 + 0.36;
  const sp = rotLocal(0, seatLocal, s.rot);
  const heading = s.rot + PI;
  const seatId = `${s.id}-seat`;
  chairSeat(seatId, s.chair ?? 'chairTask', s.floor, s.x + sp.x, s.z + sp.z, heading, s.chair === 'stool' ? 'stool' : 'desk', { workstationId: s.id });
  const monitors: MonitorDef[] = [];
  const deskTop = s.deskType === 'receptionDesk' ? 0.78 : s.kind === 'cafe' ? 1.05 : 0.74;
  const mw = s.monitors === 1 && s.kind === 'cafe' ? 0.36 : 0.56;
  const mh = s.monitors === 1 && s.kind === 'cafe' ? 0.26 : 0.33;
  const n = s.monitors;
  for (let i = 0; i < n; i++) {
    let lx = 0;
    let lz = -d / 2 + 0.22;
    let ang = 0;
    if (n === 2) {
      lx = (i === 0 ? -1 : 1) * 0.295;
      ang = (i === 0 ? 1 : -1) * 0.12;
      lz += 0.02;
    } else if (n === 3) {
      lx = (i - 1) * 0.575;
      ang = (1 - i) * 0.32;
      lz += i === 1 ? 0 : 0.09;
    }
    if (s.kind === 'cafe') lz = 0;
    const p = rotLocal(lx, lz, s.rot);
    monitors.push({
      id: `${s.id}-m${i + 1}`, workstationId: s.id, index: i, floor: s.floor,
      x: s.x + p.x, y: deskTop + 0.12 + mh / 2 + (s.kind === 'cafe' ? 0.05 : 0.06), z: s.z + p.z,
      heading: s.rot + ang, w: mw, h: mh,
    });
  }
  // Discussion spot: beside and slightly behind the seated colleague, turned towards them.
  const side = rotLocal(0.62, seatLocal + 0.5, s.rot);
  const ws: Workstation = {
    id: s.id, kind: s.kind, label: s.label, floor: s.floor, roomId: roomAt(s.floor, s.x, s.z)?.id ?? 'unknown',
    x: s.x, z: s.z, rot: s.rot, deskW: w, deskD: d, seatId, monitors,
    discussSpot: { x: s.x + side.x, z: s.z + side.z, heading: s.rot + PI + 2.2 },
  };
  WORKSTATIONS.push(ws);
  return ws;
}

/** Rectangular table with chairs along both long sides plus optional ends. */
function meetingTable(prefix: string, floor: number, cx: number, cz: number, len: number, wid: number, alongX: boolean, perSide: number, ends: boolean, chair: FurnType = 'chairMeeting', kind: SeatKind = 'meeting') {
  addFurn('tableRect', floor, cx, cz, alongX ? 0 : HALF, len, wid, 0.74, { variant: chair === 'chairCafe' ? 2 : 1 });
  let n = 0;
  const off = wid / 2 + 0.38;
  const pitch = Math.min(0.9, (len - 0.4) / perSide);
  for (let i = 0; i < perSide; i++) {
    const t = (i - (perSide - 1) / 2) * pitch;
    if (alongX) {
      chairSeat(`${prefix}-s${++n}`, chair, floor, cx + t, cz - off, 0, kind);
      chairSeat(`${prefix}-s${++n}`, chair, floor, cx + t, cz + off, PI, kind);
    } else {
      chairSeat(`${prefix}-s${++n}`, chair, floor, cx - off, cz + t, HALF, kind);
      chairSeat(`${prefix}-s${++n}`, chair, floor, cx + off, cz + t, -HALF, kind);
    }
  }
  if (ends) {
    const e = len / 2 + 0.42;
    if (alongX) {
      chairSeat(`${prefix}-s${++n}`, chair, floor, cx - e, cz, HALF, kind);
      chairSeat(`${prefix}-s${++n}`, chair, floor, cx + e, cz, -HALF, kind);
    } else {
      chairSeat(`${prefix}-s${++n}`, chair, floor, cx, cz - e, 0, kind);
      chairSeat(`${prefix}-s${++n}`, chair, floor, cx, cz + e, PI, kind);
    }
  }
}

function roundTable(prefix: string, floor: number, cx: number, cz: number, dia: number, seats: number, startAngle: number, chair: FurnType = 'chairMeeting', kind: SeatKind = 'meeting') {
  addFurn('tableRound', floor, cx, cz, 0, dia, dia, chair === 'chairCafe' ? 0.74 : 0.74);
  const r = dia / 2 + 0.36;
  for (let i = 0; i < seats; i++) {
    const a = startAngle + (i / seats) * PI * 2;
    const x = cx + Math.sin(a) * r;
    const z = cz + Math.cos(a) * r;
    chairSeat(`${prefix}-s${i + 1}`, chair, floor, x, z, a + PI, kind);
  }
}

function squareCafeTable(prefix: string, cx: number, cz: number) {
  addFurn('tableRect', 0, cx, cz, 0, 0.8, 0.8, 0.74, { variant: 2 });
  const o = 0.6;
  chairSeat(`${prefix}-s1`, 'chairCafe', 0, cx, cz - o, 0, 'cafe');
  chairSeat(`${prefix}-s2`, 'chairCafe', 0, cx, cz + o, PI, 'cafe');
  chairSeat(`${prefix}-s3`, 'chairCafe', 0, cx - o, cz, HALF, 'cafe');
  chairSeat(`${prefix}-s4`, 'chairCafe', 0, cx + o, cz, -HALF, 'cafe');
}

function ceilingFreeBookshelf(floor: number, x: number, z: number, rot: number, w = 1.8) {
  addFurn('bookshelf', floor, x, z, rot, w, 0.4, 2.1, { variant: Math.round(x * 7 + z * 3) % 5 });
}

// =====================================================================
// GROUND FLOOR
// =====================================================================
// Reception & lobby ---------------------------------------------------
addFurn('logoWall', 0, 19.0, 11.6, 0, 5.0, 0.3, 3.2);
workstation({ id: 'ws-reception', kind: 'reception', label: 'Reception Desk', floor: 0, x: 19.0, z: 14.0, rot: PI, w: 3.6, d: 0.9, monitors: 2, deskType: 'receptionDesk', seatOffset: 0.78 });
addFurn('kiosk', 0, 14.6, 16.4, 0);
addFurn('plantTall', 0, 16.4, 18.85);
addFurn('plantTall', 0, 21.6, 18.85);
addFurn('plantTall', 0, 12.1, 9.1);
addFurn('plantTall', 0, 25.9, 9.1);
addFurn('armchair', 0, 23.4, 15.4, -HALF + PI);
addFurn('armchair', 0, 23.4, 17.0, -HALF + PI);
addFurn('coffeeTable', 0, 24.5, 16.2, HALF, 1.0, 0.6, 0.4);
addFurn('bench', 0, 13.6, 18.85, 0, 2.0, 0.5, 0.45);
addFurn('rug', 0, 19.0, 17.6, 0, 3.6, 2.2, 0.01, { noCollide: true, variant: 1 });
// all-hands standing area in front of reception (faces the logo wall)
for (let r = 0; r < 4; r++) for (let c = 0; c < 8; c++) standSpot(`allhands-${r * 8 + c + 1}`, 0, 15.5 + c * 1.0, 15.4 + r * 0.9, PI);
panel({ id: 'p-directory', kind: 'directory', floor: 0, x: 14.6, y: 1.25, z: 16.6, heading: 0, w: 0.5, h: 0.85, label: 'Office Directory' });
panel({ id: 'p-logo-reception', kind: 'logo', floor: 0, x: 19.0, y: 2.2, z: 11.77, heading: 0, w: 3.2, h: 0.9, label: 'Reception logo' });

// Café --------------------------------------------------------------------------
addFurn('fridge', 0, 0.65, 8.92, 0);
addFurn('counter', 0, 4.55, 8.88, 0, 6.9, 0.66, 0.92, { variant: 1 });
addFurn('counter', 0, 4.5, 10.8, PI, 5.8, 0.62, 1.05, { variant: 2 });
workstation({ id: 'ws-cafe', kind: 'cafe', label: 'Café Counter', floor: 0, x: 6.6, z: 10.8, rot: PI, w: 5.8, d: 0.62, monitors: 1, noDesk: true, chair: 'stool', seatOffset: 0.78 });
squareCafeTable('cafe-t1', 2.6, 13.6);
squareCafeTable('cafe-t2', 5.8, 13.6);
squareCafeTable('cafe-t3', 2.6, 16.6);
squareCafeTable('cafe-t4', 5.8, 16.6);
addFurn('counter', 0, 4.3, 19.08, 0, 6.6, 0.45, 1.05, { variant: 3 });
for (let i = 0; i < 4; i++) chairSeat(`cafe-bar-s${i + 1}`, 'stool', 0, 1.9 + i * 1.6, 18.5, 0, 'cafe');
chairSeat('cafe-arm-s1', 'armchair', 0, 9.9, 15.6, -HALF, 'cafe');
chairSeat('cafe-arm-s2', 'armchair', 0, 9.9, 17.6, -HALF, 'cafe');
addFurn('coffeeTable', 0, 9.0, 16.6, HALF, 0.8, 0.6, 0.45);
addFurn('plant', 0, 10.9, 9.0);
addFurn('plant', 0, 0.55, 12.0);
addFurn('plant', 0, 8.3, 18.9);
standSpot('cafe-q1', 0, 2.6, 11.55, PI);
standSpot('cafe-q2', 0, 3.7, 11.55, PI);
standSpot('cafe-q3', 0, 4.8, 11.55, PI);
panel({ id: 'p-cafe-menu', kind: 'menuBoard', floor: 0, x: 4.55, y: 2.25, z: 8.6, heading: 0, w: 2.4, h: 0.8, label: 'Café menu board' });

// Visitor lounge ----------------------------------------------------------------
addFurn('sofa', 0, 30.4, 18.75, PI, 2.2, 0.9, 0.8);
sofaSeat('lounge-a-s1', 0, 29.75, 18.7, PI);
sofaSeat('lounge-a-s2', 0, 31.05, 18.7, PI);
addFurn('coffeeTable', 0, 30.4, 17.4, 0, 1.2, 0.6, 0.4);
chairSeat('lounge-a-s3', 'armchair', 0, 28.6, 17.3, HALF, 'lounge');
chairSeat('lounge-a-s4', 'armchair', 0, 32.2, 17.3, -HALF, 'lounge');
addFurn('sofa', 0, 30.4, 9.1, 0, 2.2, 0.9, 0.8);
sofaSeat('lounge-b-s1', 0, 29.75, 9.15, 0);
sofaSeat('lounge-b-s2', 0, 31.05, 9.15, 0);
addFurn('coffeeTable', 0, 30.4, 10.45, 0, 1.2, 0.6, 0.4);
chairSeat('lounge-b-s3', 'armchair', 0, 28.6, 10.6, HALF, 'lounge');
chairSeat('lounge-b-s4', 'armchair', 0, 32.2, 10.6, -HALF, 'lounge');
ceilingFreeBookshelf(0, 33.6, 13.9, -HALF, 2.4);
addFurn('rug', 0, 30.4, 17.6, 0, 3.4, 2.4, 0.01, { noCollide: true });
addFurn('rug', 0, 30.4, 10.2, 0, 3.4, 2.4, 0.01, { noCollide: true });
addFurn('plantTall', 0, 33.4, 18.95);
addFurn('plantTall', 0, 27.0, 18.95);
addFurn('plant', 0, 33.4, 9.0);

// Interview room ----------------------------------------------------------------
roundTable('interview', 0, 6.65, 2.7, 1.1, 3, PI);
addFurn('credenza', 0, 4.75, 2.7, HALF, 1.6, 0.45, 0.72);
addFurn('plant', 0, 8.55, 0.6);
panel({ id: 'p-disp-g-interview', kind: 'roomDisplay', floor: 0, x: 6.65, y: 1.55, z: 0.2, heading: 0, w: 1.2, h: 0.68, label: 'Interview Room display', roomId: 'g-interview' });

// Training room -----------------------------------------------------------------
for (const tx of [25.6, 28.0, 30.4]) {
  for (const tz of [1.5, 3.4]) {
    addFurn('tableRect', 0, tx, tz, HALF, 1.6, 0.6, 0.74);
    chairSeat(`training-${tx}-${tz}-a`, 'chairMeeting', 0, tx - 0.62, tz - 0.4, HALF, 'meeting');
    chairSeat(`training-${tx}-${tz}-b`, 'chairMeeting', 0, tx - 0.62, tz + 0.4, HALF, 'meeting');
  }
}
addFurn('lectern', 0, 32.6, 1.3, -HALF);
addFurn('plant', 0, 33.4, 5.5);
panel({ id: 'p-disp-g-training', kind: 'roomDisplay', floor: 0, x: 33.78, y: 1.7, z: 3.0, heading: -HALF, w: 2.2, h: 1.24, label: 'Training Room screen', roomId: 'g-training' });

// Utility & storage -------------------------------------------------------------
addFurn('shelf', 0, 1.3, 0.45, 0, 1.8, 0.5, 2.0, { variant: 1 });
addFurn('shelf', 0, 3.2, 0.45, 0, 1.6, 0.5, 2.0, { variant: 2 });
addFurn('shelf', 0, 0.45, 2.8, HALF, 1.6, 0.5, 2.0, { variant: 3 });
addFurn('copier', 0, 3.55, 3.0, -HALF);
addFurn('boiler', 0, 0.5, 4.6, HALF);
addFurn('cart', 0, 3.7, 4.6, 0);

// Restrooms ---------------------------------------------------------------------
for (const [x0, mirror] of [[9.08, false], [13.53, true]] as const) {
  for (let i = 0; i < 3; i++) addFurn('stall', 0, x0 + 0.72 + i * 1.42, 0.95, 0, 1.4, 1.6, 2.1);
  addFurn('vanity', 0, mirror ? x0 + 0.32 : x0 + 3.98, 3.6, mirror ? HALF : -HALF, 2.2, 0.55, 0.85);
  addFurn('plant', 0, mirror ? x0 + 3.95 : x0 + 0.35, 5.5);
  // occupancy spots for short breaks: in front of the cubicles and at the basins
  const room = mirror ? 'b' : 'a';
  for (let i = 0; i < 3; i++) standSpot(`wc-${room}-${i + 1}`, 0, Math.min(x0 + 0.72 + i * 1.42, mirror ? 99 : x0 + 3.35), 2.25, PI);
  for (let i = 0; i < 2; i++) standSpot(`wc-${room}-v${i + 1}`, 0, mirror ? x0 + 1.05 : x0 + 3.25, 3.1 + i * 1.0, mirror ? -HALF : HALF);
}

// =====================================================================
// FIRST FLOOR
// =====================================================================
// Trading floor: 10 workstations, 3 monitors each ---------------------
for (let row = 0; row < 2; row++) {
  for (let i = 0; i < 5; i++) {
    const n = row * 5 + i + 1;
    workstation({ id: `ws-trade-${String(n).padStart(2, '0')}`, kind: 'trading', label: `Trading Desk ${n}`, floor: 1, x: 6.6 + i * 2.0, z: row === 0 ? 11.8 : 15.4, rot: 0, w: 1.9, d: 0.8, monitors: 3 });
  }
}
panel({ id: 'p-market-wall', kind: 'marketWall', floor: 1, x: 10.6, y: 1.95, z: 8.53, heading: 0, w: 11.2, h: 1.9, label: 'Market Display Wall' });
addFurn('cabinet', 1, 0.5, 13.0, HALF, 2.4, 0.5, 1.1);
addFurn('cabinet', 1, 0.5, 16.2, HALF, 2.4, 0.5, 1.1);
addFurn('printer', 1, 1.6, 18.9, PI);
addFurn('tableHigh', 1, 18.8, 13.6, 0, 0.8, 0.8, 1.05);
addFurn('waterCooler', 1, 20.55, 10.2, -HALF);
addFurn('plantTall', 1, 0.7, 9.0);
addFurn('plantTall', 1, 20.4, 19.0);
addFurn('plantTall', 1, 0.7, 19.0);
addFurn('plant', 1, 17.2, 9.0);
standSpot('trade-huddle-1', 1, 18.2, 13.0, HALF);
standSpot('trade-huddle-2', 1, 19.4, 13.0, -HALF);

// Research area ------------------------------------------------------------------
for (let i = 0; i < 5; i++) {
  workstation({ id: `ws-res-${String(i + 1).padStart(2, '0')}`, kind: 'research', label: `Research Desk ${i + 1}`, floor: 1, x: 23.6 + i * 2.0, z: 11.6, rot: 0, monitors: 2 });
}
meetingTable('research-collab', 1, 27.6, 16.0, 2.4, 1.1, true, 3, false);
workstation({ id: 'ws-flex-01', kind: 'flex', label: 'Flex Desk 1', floor: 1, x: 30.4, z: 18.7, rot: PI, w: 1.4, d: 0.7, monitors: 1 });
workstation({ id: 'ws-flex-02', kind: 'flex', label: 'Flex Desk 2', floor: 1, x: 32.3, z: 18.7, rot: PI, w: 1.4, d: 0.7, monitors: 1 });
ceilingFreeBookshelf(1, 33.6, 10.4, -HALF, 2.0);
ceilingFreeBookshelf(1, 33.6, 13.6, -HALF, 2.0);
addFurn('whiteboardStand', 1, 22.0, 15.4, HALF);
addFurn('plantTall', 1, 21.6, 9.0);
addFurn('plantTall', 1, 22.0, 19.0);
panel({ id: 'p-wb-research', kind: 'whiteboard', floor: 1, x: 22.31, y: 1.3, z: 15.4, heading: HALF, w: 1.5, h: 0.95, label: 'Research whiteboard', roomId: 'f-research' });

// Risk management ----------------------------------------------------------------
for (let i = 0; i < 3; i++) {
  workstation({ id: `ws-risk-${String(i + 1).padStart(2, '0')}`, kind: 'risk', label: `Risk Desk ${i + 1}`, floor: 1, x: 10.9 + i * 2.4, z: 0.95, rot: 0, monitors: 2 });
}
roundTable('risk-table', 1, 16.4, 4.3, 0.9, 2, PI / 2 + 0.3);
addFurn('cabinet', 1, 9.4, 4.4, HALF, 1.6, 0.45, 1.1);
addFurn('plant', 1, 17.4, 0.6);
panel({ id: 'p-risk-wall', kind: 'riskWall', floor: 1, x: 9.2, y: 1.7, z: 2.4, heading: HALF, w: 1.6, h: 0.9, label: 'Risk wall display', roomId: 'f-risk' });

// Meeting rooms 1A / 1B ------------------------------------------------------------
meetingTable('f-m1a', 1, 2.4, 2.75, 2.4, 0.9, false, 3, false);
meetingTable('f-m1b', 1, 6.825, 2.75, 2.4, 0.9, false, 3, false);
panel({ id: 'p-disp-f-m1a', kind: 'roomDisplay', floor: 1, x: 2.4, y: 1.55, z: 0.2, heading: 0, w: 1.3, h: 0.73, label: 'Meeting Room 1A display', roomId: 'f-m1a' });
panel({ id: 'p-disp-f-m1b', kind: 'roomDisplay', floor: 1, x: 6.825, y: 1.55, z: 0.2, heading: 0, w: 1.3, h: 0.73, label: 'Meeting Room 1B display', roomId: 'f-m1b' });
panel({ id: 'p-wb-f-m1a', kind: 'whiteboard', floor: 1, x: 4.5, y: 1.45, z: 2.75, heading: -HALF, w: 1.6, h: 1.0, label: 'Meeting Room 1A whiteboard', roomId: 'f-m1a' });
panel({ id: 'p-wb-f-m1b', kind: 'whiteboard', floor: 1, x: 8.95, y: 1.45, z: 2.75, heading: -HALF, w: 1.6, h: 1.0, label: 'Meeting Room 1B whiteboard', roomId: 'f-m1b' });

// Conference room -----------------------------------------------------------------
meetingTable('f-conf', 1, 28.7, 2.9, 7.0, 1.4, true, 8, true);
addFurn('credenza', 1, 33.55, 2.9, -HALF, 2.4, 0.45, 0.72);
addFurn('plant', 1, 23.95, 0.55);
addFurn('plant', 1, 33.45, 5.5);
// standing room along the walls so the whole company (30) fits for an owner's meeting
for (let i = 0; i < 10; i++) standSpot(`conf-stand-n${i + 1}`, 1, 24.9 + i * 0.9, 0.72, 0);
for (let i = 0; i < 7; i++) standSpot(`conf-stand-s${i + 1}`, 1, 27.0 + i * 0.9, 5.2, PI);
panel({ id: 'p-disp-f-conf', kind: 'roomDisplay', floor: 1, x: 33.78, y: 1.75, z: 2.9, heading: -HALF, w: 2.4, h: 1.35, label: 'Conference Room display', roomId: 'f-conf' });
panel({ id: 'p-wb-f-conf', kind: 'whiteboard', floor: 1, x: 23.62, y: 1.45, z: 2.9, heading: HALF, w: 2.0, h: 1.1, label: 'Conference Room whiteboard', roomId: 'f-conf' });

// =====================================================================
// SECOND FLOOR
// =====================================================================
// Operations ---------------------------------------------------------------------
for (let i = 0; i < 2; i++) {
  workstation({ id: `ws-ops-${String(i + 1).padStart(2, '0')}`, kind: 'ops', label: `Operations Desk ${i + 1}`, floor: 2, x: 2.6 + i * 2.8, z: 0.95, rot: 0, monitors: 2 });
}
addFurn('filing', 2, 7.65, 2.4, -HALF, 1.6, 0.5, 1.3);
addFurn('printer', 2, 0.55, 4.9, HALF);
addFurn('plant', 2, 7.5, 5.5);
panel({ id: 'p-wb-ops', kind: 'whiteboard', floor: 2, x: 7.88, y: 1.75, z: 4.3, heading: -HALF, w: 1.2, h: 0.8, label: 'Operations schedule board', roomId: 's-ops' });

// Technology ---------------------------------------------------------------------
for (let i = 0; i < 4; i++) {
  workstation({ id: `ws-tech-${String(i + 1).padStart(2, '0')}`, kind: 'tech', label: `Technology Desk ${i + 1}`, floor: 2, x: 9.6 + i * 2.0, z: 0.95, rot: 0, monitors: 2 });
}
addFurn('sofa', 2, 8.6, 3.9, HALF, 1.6, 0.85, 0.8);
sofaSeat('tech-sofa-s1', 2, 8.62, 3.5, HALF);
sofaSeat('tech-sofa-s2', 2, 8.62, 4.3, HALF);
addFurn('tableHigh', 2, 15.2, 4.2, 0, 0.8, 0.8, 1.05);
standSpot('tech-huddle-1', 2, 14.5, 4.2, HALF);
standSpot('tech-huddle-2', 2, 15.9, 4.2, -HALF);
standSpot('tech-huddle-3', 2, 15.2, 3.5, 0);
standSpot('tech-huddle-4', 2, 15.2, 4.9, PI);
panel({ id: 'p-wb-tech', kind: 'whiteboard', floor: 2, x: 17.78, y: 1.5, z: 3.4, heading: -HALF, w: 2.0, h: 1.1, label: 'Technology kanban board', roomId: 's-tech' });

// Server room (glass enclosed) -------------------------------------------------
for (let i = 0; i < 5; i++) {
  addFurn('rack', 2, 24.45 + i * 0.62, 1.25, 0, 0.6, 1.1, 2.1, { variant: i });
  addFurn('rack', 2, 24.45 + i * 0.62, 3.65, PI, 0.6, 1.1, 2.1, { variant: i + 5 });
}
addFurn('crac', 2, 28.4, 0.75, -HALF);
addFurn('screenStand', 2, 28.45, 3.4, -HALF);
panel({ id: 'p-server-display', kind: 'serverDisplay', floor: 2, x: 28.2, y: 1.45, z: 3.4, heading: -HALF, w: 1.0, h: 0.58, label: 'Infrastructure monitor', roomId: 's-server' });
standSpot('server-g1', 2, 24.6, 2.45, 0);
standSpot('server-g2', 2, 25.8, 2.45, PI);
standSpot('server-g3', 2, 27.5, 4.6, -HALF);
standSpot('server-g4', 2, 27.6, 2.45, -HALF);

// Staff lounge -------------------------------------------------------------------
addFurn('counter', 2, 33.5, 2.2, -HALF, 3.2, 0.62, 0.92, { variant: 1 });
addFurn('fridge', 2, 33.45, 4.35, -HALF);
addFurn('sofa', 2, 30.4, 0.65, 0, 1.6, 0.85, 0.8);
sofaSeat('slounge-s1', 2, 30.0, 0.7, 0);
sofaSeat('slounge-s2', 2, 30.8, 0.7, 0);
addFurn('coffeeTable', 2, 30.4, 1.8, 0, 1.0, 0.55, 0.4);
roundTable('slounge-t', 2, 30.6, 4.0, 0.8, 3, PI / 2);
standSpot('slounge-q1', 2, 32.6, 1.7, -HALF);
standSpot('slounge-q2', 2, 32.6, 2.8, -HALF);
addFurn('plant', 2, 29.45, 5.5);

// CEO office ---------------------------------------------------------------------
workstation({ id: 'ws-ceo', kind: 'ceo', label: 'CEO Desk', floor: 2, x: 5.0, z: 15.0, rot: 0, w: 2.2, d: 1.0, monitors: 2, deskType: 'deskExec', chair: 'chairExec', seatOffset: 0.88 });
addFurn('credenza', 2, 5.0, 19.1, PI, 2.4, 0.5, 0.7);
chairSeat('ceo-guest-s1', 'chairMeeting', 2, 4.4, 13.85, 0, 'meeting');
chairSeat('ceo-guest-s2', 'chairMeeting', 2, 5.6, 13.85, 0, 'meeting');
addFurn('sofa', 2, 0.65, 11.2, HALF, 2.2, 0.9, 0.8);
sofaSeat('ceo-sofa-s1', 2, 0.7, 10.6, HALF);
sofaSeat('ceo-sofa-s2', 2, 0.7, 11.8, HALF);
addFurn('coffeeTable', 2, 1.95, 11.2, HALF, 1.2, 0.6, 0.4);
chairSeat('ceo-arm-s1', 'armchair', 2, 3.2, 10.6, -HALF, 'lounge');
chairSeat('ceo-arm-s2', 'armchair', 2, 3.2, 11.8, -HALF, 'lounge');
addFurn('rug', 2, 1.9, 11.2, 0, 3.0, 3.2, 0.01, { noCollide: true, variant: 1 });
roundTable('ceo-table', 2, 8.1, 12.7, 1.0, 3, 0);
ceilingFreeBookshelf(2, 9.68, 15.2, -HALF, 2.4);
addFurn('plantTall', 2, 0.65, 18.9);
addFurn('plantTall', 2, 9.5, 18.9);
addFurn('coatStand', 2, 9.55, 9.0);
panel({ id: 'p-ceo-tv', kind: 'ceoTv', floor: 2, x: 0.3, y: 1.75, z: 15.0, heading: HALF, w: 1.6, h: 0.9, label: 'Company overview screen', roomId: 's-ceo' });

// Boardroom -----------------------------------------------------------------------
meetingTable('s-board', 2, 15.5, 14.0, 6.0, 1.6, true, 7, true, 'chairExec');
addFurn('credenza', 2, 10.35, 14.0, HALF, 2.6, 0.45, 0.72);
addFurn('plantTall', 2, 10.6, 18.9);
addFurn('plantTall', 2, 20.4, 18.9);
addFurn('plant', 2, 20.4, 9.0);
panel({ id: 'p-disp-s-board', kind: 'roomDisplay', floor: 2, x: 10.1, y: 1.85, z: 14.0, heading: HALF, w: 2.6, h: 1.46, label: 'Boardroom display', roomId: 's-board' });
panel({ id: 'p-wb-s-board', kind: 'whiteboard', floor: 2, x: 20.9, y: 1.45, z: 11.4, heading: -HALF, w: 1.8, h: 1.05, label: 'Boardroom whiteboard', roomId: 's-board' });
panel({ id: 'p-logo-board', kind: 'logo', floor: 2, x: 20.9, y: 2.2, z: 16.2, heading: -HALF, w: 1.8, h: 0.5, label: 'Boardroom logo' });

// Portfolio management ---------------------------------------------------------
for (let i = 0; i < 3; i++) {
  workstation({ id: `ws-pm-${String(i + 1).padStart(2, '0')}`, kind: 'pm', label: `PM Desk ${i + 1}`, floor: 2, x: 23.6 + i * 2.4, z: 11.4, rot: 0, w: 1.8, monitors: 2 });
}
meetingTable('s-pm-table', 2, 27.0, 16.3, 2.0, 1.0, true, 2, false);
ceilingFreeBookshelf(2, 33.6, 16.0, -HALF, 2.0);
addFurn('plantTall', 2, 21.6, 18.9);
addFurn('plant', 2, 33.4, 9.0);
panel({ id: 'p-pm-wall', kind: 'pmWall', floor: 2, x: 33.78, y: 1.75, z: 12.2, heading: -HALF, w: 2.0, h: 1.12, label: 'Portfolio summary display', roomId: 's-pm' });

// =====================================================================
// CORRIDORS & CORE (every floor)
// =====================================================================
for (let f = 0; f < 3; f++) {
  addFurn('plant', f, 0.55, 7.2);
  addFurn('plant', f, 33.45, 7.2);
  panel({ id: `p-floorsign-${f}`, kind: 'floorSign', floor: f, x: 20.7, y: 1.65, z: 6.12, heading: 0, w: 1.3, h: 0.8, label: 'Floor directory sign', roomId: `${['g', 'f', 's'][f]}-corridor` });
}
// World markets screens: exchange clocks and sessions, key prices and headlines, in the rooms where people follow markets
for (const [id, floor, x, y, z, heading, w, label] of [
  ['p-world-lobby', 0, 24.2, 2.35, 19.43, PI, 2.6, 'World markets screen (reception)'],
  ['p-world-cafe', 0, 2.0, 2.5, 8.53, 0, 1.8, 'World markets screen (café)'],
  ['p-world-trading', 1, 0.28, 1.95, 14.0, HALF, 2.8, 'World markets screen (trading floor)'],
  ['p-world-research', 1, 33.72, 1.85, 16.4, -HALF, 2.4, 'World markets screen (research)'],
  ['p-world-risk', 1, 17.78, 1.85, 3.0, -HALF, 2.2, 'World markets screen (risk)'],
  ['p-world-conf', 1, 28.7, 1.95, 0.28, 0, 2.6, 'World markets screen (conference room)'],
  ['p-world-board', 2, 10.12, 1.95, 17.4, HALF, 2.0, 'World markets screen (boardroom)'],
  ['p-world-ceo', 2, 3.2, 1.9, 8.53, 0, 2.4, 'World markets screen (CEO office)'],
  ['p-world-pm', 2, 21.12, 1.9, 14.0, HALF, 2.4, 'World markets screen (portfolio management)'],
  ['p-world-lounge', 2, 33.72, 1.85, 2.6, -HALF, 1.8, 'World markets screen (staff lounge)'],
] as const) panel({ id, kind: 'worldMarkets', floor, x, y, z, heading, w, h: w * 0.5625, label });

panel({ id: 'p-logo-f1', kind: 'logo', floor: 1, x: 14.0, y: 2.25, z: 6.09, heading: 0, w: 2.4, h: 0.6, label: 'First floor logo' });

// ---------------------------------------------------------------------
export function seatById(id: string): Seat | undefined {
  return SEAT_INDEX.get(id);
}
export function workstationById(id: string): Workstation | undefined {
  return WS_INDEX.get(id);
}
export const SEAT_INDEX = new Map(SEATS.map((s) => [s.id, s]));
export const WS_INDEX = new Map(WORKSTATIONS.map((w) => [w.id, w]));
export const MONITORS: MonitorDef[] = WORKSTATIONS.flatMap((w) => w.monitors);
export const MONITOR_INDEX = new Map(MONITORS.map((m) => [m.id, m]));

export function seatsInRoom(roomId: string, kind?: SeatKind): Seat[] {
  return SEATS.filter((s) => s.roomId === roomId && (!kind || s.kind === kind));
}
