// Builds the static geometry for one floor: slab and finishes, walls (solid, glass, acoustic, curtain
// wall), stairs, ceilings, light fittings, static furniture, and instance transforms for repeated items.
import * as THREE from 'three';
import { BLD, CEIL_H, DOORS, ELEVATOR, FLOOR_COUNT, FLOOR_H, INNER, ROOMS, STAIR, WALLS, wallPieces, type RoomDef, type WallDef } from '../world/building';
import { FURNITURE, WORKSTATIONS, footprint, rotLocal } from '../world/furniture';
import { GeoBuilder } from './geo';
import type { MatKey } from './materials';
import { buildChairPrototype, buildStaticProp, CHAIR_TYPES } from './props';

export interface FloorGeometry {
  floor: number;
  base: Map<MatKey, THREE.BufferGeometry>;
  ceiling: Map<MatKey, THREE.BufferGeometry>;
  instances: Map<string, THREE.Matrix4[]>;
  shadows: THREE.Matrix4[];
  stats: { vertices: number };
}

const FINISH_MAT: Record<RoomDef['finish'], MatKey> = {
  carpet: 'carpet', carpetDark: 'carpetDark', stone: 'stone', wood: 'woodFloor', tile: 'tile', concrete: 'concrete', raised: 'raised',
};

const m4 = (x: number, y: number, z: number, rot = 0, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot), new THREE.Vector3(sx, sy, sz));

/** Horizontal soft shadow decal lying on the floor. */
const shadowM = (x: number, y: number, z: number, w: number, d: number, rot = 0) => {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, rot, 0, 'YXZ'));
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(w, d, 1));
};

function wallKindMat(w: WallDef): MatKey {
  switch (w.kind) {
    case 'wood': return 'walnut';
    case 'acoustic': return 'acoustic';
    case 'core': return 'coreWall';
    default: return 'paint';
  }
}

function addWallBox(b: GeoBuilder, w: WallDef, mat: MatKey, from: number, to: number, y0: number, y1: number, thick = w.thickness) {
  const len = to - from;
  if (len <= 0.001 || y1 <= y0) return;
  const c = (from + to) / 2;
  if (w.axis === 'x') b.box(mat, c, (y0 + y1) / 2, w.at, len, y1 - y0, thick);
  else b.box(mat, w.at, (y0 + y1) / 2, c, thick, y1 - y0, len);
}

function glassPartition(b: GeoBuilder, w: WallDef, from: number, to: number, y0: number, y1: number) {
  const len = to - from;
  if (len <= 0.01) return;
  addWallBox(b, w, 'glass', from, to, y0 + 0.05, y1 - 0.05, 0.02);
  addWallBox(b, w, 'blackMetal', from, to, y0, y0 + 0.05, 0.07);
  addWallBox(b, w, 'blackMetal', from, to, y1 - 0.05, y1, 0.07);
  // manifestation band for safety visibility
  if (y0 < 0.5) addWallBox(b, w, 'glassDark', from, to, 1.05, 1.2, 0.025);
  // vertical mullions
  const n = Math.max(1, Math.round(len / 1.25));
  for (let i = 0; i <= n; i++) {
    const p = from + (len * i) / n;
    addWallBox(b, w, 'blackMetal', Math.max(from, p - 0.025), Math.min(to, p + 0.025), y0, y1, 0.07);
  }
}

function curtainWall(b: GeoBuilder, w: WallDef, floor: number) {
  const { pieces } = wallPieces(w, FLOOR_H);
  const out = w.axis === 'x' ? (w.at < 1 ? -1 : 1) : (w.at < 1 ? -1 : 1); // outward direction sign
  const offOut = (d: number) => w.at + out * d;
  const along = (from: number, to: number, y0: number, y1: number, depthOff: number, thick: number, mat: MatKey) => {
    const c = (from + to) / 2;
    const len = to - from;
    if (len <= 0 || y1 <= y0) return;
    if (w.axis === 'x') b.box(mat, c, (y0 + y1) / 2, offOut(depthOff), len, y1 - y0, thick);
    else b.box(mat, offOut(depthOff), (y0 + y1) / 2, c, thick, y1 - y0, len);
  };
  for (const p of pieces) {
    const gTop = Math.min(CEIL_H + 0.05, p.top);
    if (p.bottom === 0) {
      along(p.from, p.to, 0.0, 0.1, 0.0, 0.16, 'blackMetal'); // sill
      along(p.from, p.to, 0.1, gTop, 0.0, 0.024, 'glass');
    } else {
      along(p.from, p.to, p.bottom, p.bottom + 0.1, 0.0, 0.16, 'blackMetal'); // transom over door
      along(p.from, p.to, p.bottom + 0.1, gTop, 0.0, 0.024, 'glass');
    }
    along(p.from, p.to, gTop, gTop + 0.08, 0.0, 0.16, 'blackMetal');
    along(p.from, p.to, gTop + 0.08, FLOOR_H, 0.03, 0.12, 'spandrel'); // spandrel panel hides the plenum and slab
    along(p.from, p.to, gTop + 0.08, FLOOR_H, -0.08, 0.03, 'paint'); // interior bulkhead face
  }
  // mullions on an absolute 1.5 m grid so they align across floors; exterior fins every 3 m
  const g0 = Math.ceil(w.from / 1.5) * 1.5;
  for (let p = g0; p <= w.to + 0.001; p += 1.5) {
    const inOpening = DOORS.some((d) => d.floor === floor && d.axis === w.axis && Math.abs(d.at - w.at) < 0.05 && p > d.center - d.width / 2 - 0.05 && p < d.center + d.width / 2 + 0.05);
    const y0 = inOpening ? 2.6 : 0;
    along(p - 0.035, p + 0.035, y0, FLOOR_H, 0.02, 0.2, 'blackMetal');
    if (Math.abs((p / 3) - Math.round(p / 3)) < 0.01 && !inOpening) along(p - 0.03, p + 0.03, 0, FLOOR_H, 0.2, 0.25, 'spandrel');
  }
}

function skirting(b: GeoBuilder, w: WallDef, from: number, to: number) {
  addWallBox(b, w, 'plasticDark', from, to, 0, 0.08, w.thickness + 0.02);
}

function doorFrame(b: GeoBuilder, d: typeof DOORS[number]) {
  const h = d.kind === 'auto' ? 2.6 : d.kind === 'elevator' ? 2.2 : 2.25;
  const mat: MatKey = d.kind === 'elevator' ? 'steel' : d.glass ? 'blackMetal' : 'walnut';
  const t = d.kind === 'auto' ? 0.32 : 0.2;
  const half = d.width / 2;
  const jamb = (pos: number) => {
    if (d.axis === 'x') b.box(mat, pos, h / 2, d.at, 0.05, h, t);
    else b.box(mat, d.at, h / 2, pos, t, h, 0.05);
  };
  jamb(d.center - half - 0.025);
  jamb(d.center + half + 0.025);
  if (d.axis === 'x') b.box(mat, d.center, h + 0.025, d.at, d.width + 0.1, 0.05, t);
  else b.box(mat, d.at, h + 0.025, d.center, t, 0.05, d.width + 0.1);
  if (d.kind === 'elevator') {
    // call panel and floor indicator on the corridor face
    b.box('steel', d.center + half + 0.35, 1.15, d.at + 0.1, 0.12, 0.28, 0.02);
    b.box('signDark', d.center, h + 0.25, d.at + 0.1, 0.5, 0.14, 0.02);
  }
}

/** Built inside the floor's transform, so heights are relative to this floor. */
function stairs(b: GeoBuilder, floor: number) {
  const base = 0;
  const rise = STAIR.halfRise / STAIR.risers;
  const tread = (STAIR.flightZ1 - STAIR.flightZ0) / (STAIR.risers - 1);
  if (floor < FLOOR_COUNT - 1) {
    for (let i = 0; i < STAIR.risers - 1; i++) {
      const top = base + (i + 1) * rise;
      // flight A rises north (towards -z)
      const za1 = STAIR.flightZ1 - i * tread;
      b.box('stairTread', (STAIR.aX0 + STAIR.aX1) / 2, top - 0.17, za1 - tread / 2, STAIR.aX1 - STAIR.aX0, 0.34, tread);
      b.box('aluminium', (STAIR.aX0 + STAIR.aX1) / 2, top - 0.005, za1 - 0.02, STAIR.aX1 - STAIR.aX0 - 0.02, 0.012, 0.04);
      // flight B rises south (towards +z) starting at the mid landing
      const topB = base + STAIR.halfRise + (i + 1) * rise;
      const zb0 = STAIR.flightZ0 + i * tread;
      b.box('stairTread', (STAIR.bX0 + STAIR.bX1) / 2, topB - 0.17, zb0 + tread / 2, STAIR.bX1 - STAIR.bX0, 0.34, tread);
      b.box('aluminium', (STAIR.bX0 + STAIR.bX1) / 2, topB - 0.005, zb0 + 0.02, STAIR.bX1 - STAIR.bX0 - 0.02, 0.012, 0.04);
    }
    // mid landing slab
    b.box('stairTread', (STAIR.x0 + STAIR.x1) / 2, base + STAIR.halfRise - 0.12, (STAIR.midZ0 + STAIR.midZ1) / 2, STAIR.x1 - STAIR.x0, 0.24, STAIR.midZ1 - STAIR.midZ0);
    // handrails along the outer walls (steel tubes on brackets), following the pitch
    const pitch = Math.atan2(STAIR.halfRise, STAIR.flightZ1 - STAIR.flightZ0);
    const len = Math.hypot(STAIR.halfRise, STAIR.flightZ1 - STAIR.flightZ0);
    for (const [x, y0] of [[STAIR.aX0 + 0.06, base], [STAIR.bX1 - 0.06, base + STAIR.halfRise]] as const) {
      const g = new THREE.CylinderGeometry(0.022, 0.022, len, 8);
      g.rotateX(x < 19 ? pitch - Math.PI / 2 : Math.PI / 2 - pitch);
      g.translate(x, y0 + STAIR.halfRise / 2 + 0.9, (STAIR.flightZ0 + STAIR.flightZ1) / 2);
      b.geom('steel', g);
      g.dispose();
    }
  }
  // divider wall between the flights (full storey height) with handrails on both faces
  b.box('paintWarm', (STAIR.aX1 + STAIR.bX0) / 2, base + FLOOR_H / 2, (STAIR.flightZ0 + STAIR.flightZ1) / 2, STAIR.bX0 - STAIR.aX1, FLOOR_H, STAIR.flightZ1 - STAIR.flightZ0);
  if (floor === 0) {
    // closed panel under flight B, facing the ground-floor landing
    b.box('paintWarm', (STAIR.bX0 + STAIR.bX1) / 2, 0.95, STAIR.landingZ0 - 0.02, STAIR.bX1 - STAIR.bX0, 1.9, 0.04);
  }
  if (floor === FLOOR_COUNT - 1) {
    // top-floor guard: glass balustrade across the void above flight A
    b.box('glass', (STAIR.aX0 + STAIR.aX1) / 2, base + 0.55, STAIR.landingZ0 - 0.02, STAIR.aX1 - STAIR.aX0, 1.0, 0.02);
    b.box('steel', (STAIR.aX0 + STAIR.aX1) / 2, base + 1.08, STAIR.landingZ0 - 0.02, STAIR.aX1 - STAIR.aX0, 0.05, 0.05);
  }
  // landing floor finish
  b.box('stairTread', (STAIR.x0 + STAIR.x1) / 2, base - 0.01, (STAIR.landingZ0 + STAIR.landingZ1) / 2, STAIR.x1 - STAIR.x0, 0.02, STAIR.landingZ1 - STAIR.landingZ0);
  // wall-mounted light on the stair core wall
  b.box('lightStrip', STAIR.x0 + 0.02, base + 2.4, 2.8, 0.03, 0.08, 1.2);
  b.box('lightStrip', STAIR.x1 - 0.02, base + 2.4 + STAIR.halfRise, 2.8, 0.03, 0.08, 1.2);
}

function slab(b: GeoBuilder, floor: number) {
  const y0 = -0.36;
  const y1 = -0.02;
  const s = ELEVATOR.shaft;
  const rects: [number, number, number, number][] = [
    [INNER.x0, INNER.z0, STAIR.x0, INNER.z1],
    [STAIR.x1, s.z1, INNER.x1, INNER.z1],
    [s.x1, INNER.z0, INNER.x1, s.z1],
    [STAIR.x1, INNER.z0, s.x1, s.z0],
    [STAIR.x0, STAIR.landingZ0, STAIR.x1, INNER.z1],
    [STAIR.x1, s.z0, s.x0, s.z1],
  ];
  for (const [x0, z0, x1, z1] of rects) b.boxMinMax(floor === 0 ? 'concrete' : 'coreWall', x0, y0, z0, x1, y1, z1);
}

export function buildFloorGeometry(floor: number): FloorGeometry {
  const b = new GeoBuilder();
  const ceil = new GeoBuilder();
  const instances = new Map<string, THREE.Matrix4[]>();
  const shadows: THREE.Matrix4[] = [];
  const inst = (k: string, m: THREE.Matrix4) => {
    let l = instances.get(k);
    if (!l) { l = []; instances.set(k, l); }
    l.push(m);
  };
  const base = floor * FLOOR_H;

  b.push(0, base, 0, 0);
  slab(b, floor);
  // floor finishes per room
  for (const r of ROOMS) {
    if (r.floor !== floor || r.kind === 'stair' || r.kind === 'elevator') continue;
    const { x0, z0, x1, z1 } = r.rect;
    b.boxMinMax(FINISH_MAT[r.finish], x0, -0.02, z0, x1, 0.0, z1);
  }
  // walls
  for (const w of WALLS) {
    if (w.floor !== floor) continue;
    if (w.kind === 'ext') { curtainWall(b, w, floor); continue; }
    const top = w.kind === 'core' ? FLOOR_H : CEIL_H;
    const { pieces } = wallPieces(w, top);
    for (const p of pieces) {
      if (w.kind === 'glass') glassPartition(b, w, p.from, p.to, p.bottom, p.top);
      else {
        addWallBox(b, w, wallKindMat(w), p.from, p.to, p.bottom, p.top);
        if (p.bottom === 0 && w.kind !== 'wood') skirting(b, w, p.from, p.to);
      }
    }
  }
  for (const d of DOORS) if (d.floor === floor) doorFrame(b, d);
  stairs(b, floor);
  // lift shaft pit / cap and back wall lining
  const s = ELEVATOR.shaft;
  if (floor === 0) b.boxMinMax('concrete', s.x0, -0.3, s.z0, s.x1, -0.05, s.z1);
  if (floor === FLOOR_COUNT - 1) b.boxMinMax('coreWall', s.x0, CEIL_H + 0.5, s.z0, s.x1, CEIL_H + 0.7, s.z1);
  b.boxMinMax('steel', s.x0 + 0.05, 0, s.z0 + 0.05, s.x0 + 0.1, FLOOR_H, s.z0 + 0.1);
  b.boxMinMax('steel', s.x1 - 0.1, 0, s.z0 + 0.05, s.x1 - 0.05, FLOOR_H, s.z0 + 0.1);

  // static furniture
  for (const f of FURNITURE) {
    if (f.floor !== floor) continue;
    if ((CHAIR_TYPES as readonly string[]).includes(f.type)) {
      inst(`chair:${f.type}`, m4(f.x, base, f.z, f.rot));
      shadows.push(shadowM(f.x, base + 0.004, f.z, 0.75, 0.75, f.rot));
      continue;
    }
    b.push(f.x, 0, f.z, f.rot);
    buildStaticProp(b, f);
    b.pop();
    if (f.type !== 'rug' && f.type !== 'stall') {
      const fp = footprint(f);
      shadows.push(shadowM(f.x, base + 0.003, f.z, (fp.x1 - fp.x0) * 1.25 + 0.2, (fp.z1 - fp.z0) * 1.25 + 0.2));
    }
  }
  // workstation equipment: monitor housings + desk accessories (instanced)
  for (const ws of WORKSTATIONS) {
    if (ws.floor !== floor) continue;
    for (const m of ws.monitors) {
      const sc = m.w / 0.56;
      inst(ws.kind === 'cafe' ? 'monitor:pos' : 'monitor', m4(m.x, base + m.y, m.z, m.heading, sc, m.h / 0.33, 1));
    }
    if (ws.kind === 'cafe') continue;
    const top = ws.kind === 'reception' ? 0.78 : 0.74;
    const p = (lx: number, lz: number) => rotLocal(lx, lz, ws.rot);
    const kb = p(0, ws.deskD / 2 - 0.2);
    inst('keyboard', m4(ws.x + kb.x, base + top, ws.z + kb.z, ws.rot));
    const ms = p(0.33, ws.deskD / 2 - 0.2);
    inst('mouse', m4(ws.x + ms.x, base + top, ws.z + ms.z, ws.rot));
    const ph = p(-ws.deskW / 2 + 0.22, -0.05);
    inst(ws.kind === 'trading' ? 'turret' : 'phone', m4(ws.x + ph.x, base + top, ws.z + ph.z, ws.rot + 0.2));
    const hash = (ws.x * 13.1 + ws.z * 7.7) % 1;
    if (hash > 0.35) {
      const mg = p(ws.deskW / 2 - 0.18, 0.05);
      inst('mug', m4(ws.x + mg.x, base + top, ws.z + mg.z, hash * 6));
    }
    if (ws.kind === 'research' || ws.kind === 'ceo' || ws.kind === 'pm' || hash < 0.3) {
      const nb = p(ws.deskW / 2 - 0.45, 0.15);
      inst('notebook', m4(ws.x + nb.x, base + top, ws.z + nb.z, ws.rot + 0.15));
    }
    if (ws.kind === 'ceo' || ws.kind === 'tech') {
      const lp = p(-ws.deskW / 2 + 0.55, 0.12);
      inst('laptop', m4(ws.x + lp.x, base + top, ws.z + lp.z, ws.rot - 0.3));
    }
    if (ws.kind === 'risk' || ws.kind === 'pm' || ws.kind === 'research') {
      const lm = p(ws.deskW / 2 - 0.12, -0.25);
      inst('lamp', m4(ws.x + lm.x, base + top, ws.z + lm.z, ws.rot + 0.6));
    }
  }
  b.pop();

  // ceilings + light fittings
  ceil.push(0, base, 0, 0);
  for (const r of ROOMS) {
    if (r.floor !== floor || r.kind === 'elevator') continue;
    if (r.kind === 'stair' && floor !== FLOOR_COUNT - 1) {
      // only the floor-landing part has a ceiling on lower floors... the stairwell is open above
      continue;
    }
    const { x0, z0, x1, z1 } = r.rect;
    ceil.boxMinMax('ceiling', x0, CEIL_H, z0, x1, CEIL_H + 0.03, z1);
    if (r.kind === 'stair') continue;
    if (r.kind === 'corridor') {
      for (let x = x0 + 1.5; x < x1 - 1; x += 3) inst('light:linear', m4(x, base + CEIL_H - 0.005, (z0 + z1) / 2, 0));
      continue;
    }
    const nx = Math.max(1, Math.round((x1 - x0) / 2.4));
    const nz = Math.max(1, Math.round((z1 - z0) / 2.4));
    for (let i = 0; i < nx; i++) {
      for (let k = 0; k < nz; k++) {
        const x = x0 + ((i + 0.5) * (x1 - x0)) / nx;
        const z = z0 + ((k + 0.5) * (z1 - z0)) / nz;
        if (x > STAIR.x0 - 0.3 && x < 23.6 && z < 6.2 && z > 0) continue;
        inst(r.kind === 'reception' || r.kind === 'boardroom' || r.kind === 'office' || r.kind === 'cafe' ? 'light:down' : 'light:panel', m4(x, base + CEIL_H - 0.005, z, 0));
      }
    }
    // suspended acoustic rafts over the trading desks; timber slat baffles in the café
    if (r.kind === 'trading') {
      for (const zc of [12.4, 16.0]) {
        for (let x = 5.6; x < 16; x += 2.6) {
          ceil.box('acoustic', x + 1.2, CEIL_H - 0.28, zc, 2.3, 0.04, 1.6);
          for (const sx of [-1, 1]) ceil.box('blackMetal', x + 1.2 + sx * 1.0, CEIL_H - 0.13, zc, 0.006, 0.26, 0.006);
        }
      }
    }
    if (r.kind === 'cafe') {
      for (let x = x0 + 1.0; x < x1 - 0.8; x += 0.35) ceil.box('oak', x, CEIL_H - 0.12, (z0 + z1) / 2 + 1.5, 0.05, 0.22, (z1 - z0) * 0.55);
    }
  }
  // stairwell ceiling at the top floor only
  if (floor === FLOOR_COUNT - 1) ceil.boxMinMax('ceiling', STAIR.x0, CEIL_H + 0.6, INNER.z0, STAIR.x1, CEIL_H + 0.63, STAIR.landingZ0);
  ceil.pop();

  const baseGeo = b.build();
  const ceilGeo = ceil.build();
  return { floor, base: baseGeo, ceiling: ceilGeo, instances, shadows, stats: { vertices: b.vertexCount() + ceil.vertexCount() } };
}

/** Prototype geometries for instanced items (built once, shared by all floors). */
export function buildPrototypes(): Map<string, Map<MatKey, THREE.BufferGeometry>> {
  const out = new Map<string, Map<MatKey, THREE.BufferGeometry>>();
  for (const t of CHAIR_TYPES) {
    const b = new GeoBuilder();
    buildChairPrototype(b, t);
    out.set(`chair:${t}`, b.build());
  }
  const mk = (key: string, fn: (b: GeoBuilder) => void) => {
    const b = new GeoBuilder();
    fn(b);
    out.set(key, b.build());
  };
  // monitor housing: screen sits in front of the bezel at local z = +0.016 (rendered separately)
  const housing = (b: GeoBuilder) => {
    b.box('plasticDark', 0, 0, -0.004, 0.58, 0.35, 0.03);
    b.box('plasticDark', 0, -0.02, -0.05, 0.3, 0.2, 0.06);
    b.box('aluminium', 0, -0.215, -0.07, 0.05, 0.12, 0.03);
  };
  mk('monitor', (b) => {
    housing(b);
    b.box('aluminium', 0, -0.28, -0.04, 0.24, 0.012, 0.18);
  });
  mk('monitor:pos', (b) => {
    housing(b);
    b.box('aluminium', 0, -0.28, -0.04, 0.18, 0.012, 0.14);
  });
  mk('keyboard', (b) => {
    b.box('plasticDark', 0, 0.01, 0, 0.44, 0.02, 0.14);
    b.box('plasticLight', 0, 0.022, 0.0, 0.41, 0.005, 0.11);
  });
  mk('mouse', (b) => b.sphere('plasticDark', 0, 0.015, 0, 0.035, 0.8, 0.45, 1.3, 1));
  mk('phone', (b) => {
    b.box('plasticDark', 0, 0.03, 0, 0.2, 0.06, 0.18, 0);
    b.box('plasticDark', -0.05, 0.075, 0, 0.06, 0.03, 0.18);
    b.box('screenOff', 0.04, 0.062, 0.02, 0.08, 0.005, 0.05);
  });
  mk('turret', (b) => {
    b.box('plasticDark', 0, 0.06, 0, 0.32, 0.12, 0.22);
    b.box('screenOff', 0, 0.125, 0.02, 0.26, 0.01, 0.14);
    for (let i = 0; i < 8; i++) b.box(i % 3 ? 'ledGreen' : 'ledAmber', -0.12 + i * 0.034, 0.13, -0.08, 0.02, 0.006, 0.015);
  });
  mk('mug', (b) => {
    b.cyl('ceramic', 0, 0.05, 0, 0.04, 0.036, 0.1, 12);
    b.hcyl('ceramic', 0.05, 0.05, 0, 0.012, 0.03, 0, 6);
  });
  mk('notebook', (b) => {
    b.box('bookB', 0, 0.008, 0, 0.21, 0.016, 0.29);
    b.box('paper', 0.01, 0.017, 0, 0.19, 0.002, 0.27);
  });
  mk('laptop', (b) => {
    b.box('aluminium', 0, 0.008, 0, 0.32, 0.016, 0.22);
    const g = new THREE.BoxGeometry(0.32, 0.22, 0.008);
    g.translate(0, 0.11, 0);
    g.rotateX(-0.3);
    g.translate(0, 0.016, -0.11);
    b.geom('aluminium', g);
    g.dispose();
  });
  mk('lamp', (b) => {
    b.cyl('blackMetal', 0, 0.01, 0, 0.08, 0.08, 0.02, 12);
    b.cyl('blackMetal', 0, 0.22, 0, 0.01, 0.01, 0.42, 6);
    b.hcyl('blackMetal', 0, 0.43, 0.08, 0.01, 0.18, Math.PI / 2, 6);
    b.cyl('gold', 0, 0.4, 0.17, 0.05, 0.07, 0.07, 12);
    b.cyl('lightStrip', 0, 0.366, 0.17, 0.05, 0.05, 0.002, 12);
  });
  mk('light:panel', (b) => {
    b.box('aluminium', 0, -0.012, 0, 0.64, 0.025, 1.24);
    b.box('lightPanel', 0, -0.026, 0, 0.58, 0.004, 1.18);
  });
  mk('light:linear', (b) => {
    b.box('blackMetal', 0, -0.03, 0, 2.0, 0.05, 0.09);
    b.box('lightStrip', 0, -0.057, 0, 1.96, 0.004, 0.06);
  });
  mk('light:down', (b) => {
    b.cyl('blackMetal', 0, -0.01, 0, 0.12, 0.12, 0.02, 16);
    b.cyl('lightPanel', 0, -0.021, 0, 0.09, 0.09, 0.002, 16);
  });
  return out;
}

export const BUILDING_BOUNDS = BLD;
