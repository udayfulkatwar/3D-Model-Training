import { describe, expect, it } from 'vitest';
import { DOORS, FLOOR_H, ROOMS, WALLS, roomAt } from '../src/world/building';
import { FURNITURE, MONITORS, SEATS, WORKSTATIONS, footprint } from '../src/world/furniture';
import { findPath, findPathOnFloor, isWalkable, nearestWalkable } from '../src/world/nav';
import { STATIC_BOXES, floorWalkable } from '../src/world/physics';
import { SPAWN, groundHeight, resolveMove } from '../src/world/movement';
import { DynamicWorld } from '../src/world/dynamic';

const LOBBY = { floor: 0, x: 19.0, z: 17.2 };

describe('building layout', () => {
  it('has the required rooms on each floor', () => {
    const names = ROOMS.filter((r) => !r.hidden).map((r) => `${r.floor}:${r.name}`);
    for (const n of [
      '0:Reception & Lobby', '0:Visitor Lounge', '0:Café', '0:Interview Room', '0:Training Room', '0:Restroom A', '0:Restroom B', '0:Utility & Storage',
      '1:Trading Floor', '1:Research Area', '1:Risk Management', '1:Meeting Room 1A', '1:Meeting Room 1B', '1:Conference Room',
      '2:Founder / CEO Office', '2:Portfolio Management', '2:Technology', '2:Operations', '2:Boardroom', '2:Staff Lounge', '2:Server Room',
    ]) expect(names).toContain(n);
  });

  it('places every door inside a wall on the same line', () => {
    for (const d of DOORS) {
      const host = WALLS.find((w) => w.floor === d.floor && w.axis === d.axis && Math.abs(w.at - d.at) < 0.05 && d.center - d.width / 2 >= w.from - 0.01 && d.center + d.width / 2 <= w.to + 0.01);
      expect(host, `door ${d.id} has no host wall`).toBeTruthy();
    }
  });

  it('has the required workstation counts and monitors', () => {
    const count = (k: string) => WORKSTATIONS.filter((w) => w.kind === k).length;
    expect(count('trading')).toBe(10);
    expect(count('research')).toBe(5);
    expect(count('risk')).toBe(3);
    expect(count('pm')).toBe(3);
    expect(count('tech')).toBe(4);
    expect(count('ops')).toBe(2);
    expect(count('reception')).toBe(1);
    expect(count('ceo')).toBe(1);
    for (const w of WORKSTATIONS.filter((w) => w.kind === 'trading')) expect(w.monitors.length).toBe(3);
    for (const w of WORKSTATIONS.filter((w) => w.kind === 'research')) expect(w.monitors.length).toBe(2);
    expect(WORKSTATIONS.find((w) => w.kind === 'reception')!.monitors.length).toBe(2);
    const ids = MONITORS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps furniture inside the room it belongs to and off the walls', () => {
    for (const f of FURNITURE) {
      const fp = footprint(f);
      const room = roomAt(f.floor, f.x, f.z);
      expect(room, `furniture ${f.id} ${f.type} outside rooms`).toBeTruthy();
      for (const corner of [[fp.x0 + 0.01, fp.z0 + 0.01], [fp.x1 - 0.01, fp.z1 - 0.01]]) {
        expect(floorWalkable(f.floor, corner[0], corner[1]) || f.type === 'counter', `${f.id} ${f.type} corner off floor`).toBe(true);
      }
      // no overlap with walls in the body height band
      for (const b of STATIC_BOXES) {
        if (!b.tag.startsWith('wall:')) continue;
        if (b.y1 <= f.floor * FLOOR_H + 0.05 || b.y0 >= f.floor * FLOOR_H + Math.min(f.h, 1.8)) continue;
        const ox = Math.min(fp.x1, b.x1) - Math.max(fp.x0, b.x0);
        const oz = Math.min(fp.z1, b.z1) - Math.max(fp.z0, b.z0);
        expect(ox > 0.02 && oz > 0.02, `${f.id} ${f.type} at ${f.x},${f.z} overlaps ${b.tag}`).toBe(false);
      }
    }
  });

  it('gives every seat a walkable approach point reachable from reception', () => {
    for (const s of SEATS) {
      const a = nearestWalkable(s.floor, s.approach.x, s.approach.z, 0.6);
      expect(a, `seat ${s.id} approach not walkable`).toBeTruthy();
      const p = findPath(LOBBY, { floor: s.floor, x: a!.x, z: a!.z });
      expect(p, `seat ${s.id} unreachable`).toBeTruthy();
    }
  });

  it('can reach every room from reception (all floors)', () => {
    for (const r of ROOMS) {
      if (r.kind === 'elevator') continue;
      const e = nearestWalkable(r.floor, r.entry.x, r.entry.z, 0.6);
      expect(e, `room ${r.id} entry not walkable`).toBeTruthy();
      expect(findPath(LOBBY, { floor: r.floor, x: e!.x, z: e!.z }), `room ${r.id} unreachable`).toBeTruthy();
    }
  });

  it('routes avoid walls and use the stairs between floors', () => {
    const p = findPath(LOBBY, { floor: 2, x: 15.5, z: 12.0 })!;
    expect(p).toBeTruthy();
    expect(p.some((w) => w.stair)).toBe(true);
    expect(p[p.length - 1].floor).toBe(2);
    for (const w of p) if (!w.stair) expect(isWalkable(w.floor, w.x, w.z)).toBe(true);
  });

  it('prefers open doors over closed ones', () => {
    // Server room door is closed by default; a path still exists (employees open it).
    const p = findPathOnFloor(2, 13.0, 7.2, 26.2, 3.0, () => true);
    expect(p).toBeTruthy();
    expect(p!.some((w) => w.door === 's-d-server')).toBe(true);
  });
});

describe('player movement', () => {
  it('spawns on a free walkable spot at reception', () => {
    const dyn = new DynamicWorld();
    expect(groundHeight(dyn, SPAWN.x, SPAWN.z, 0)).toBe(0);
    const r = resolveMove(dyn, { x: SPAWN.x, y: 0, z: SPAWN.z }, 0, 0, []);
    expect(r.x).toBeCloseTo(SPAWN.x, 5);
    expect(r.z).toBeCloseTo(SPAWN.z, 5);
  });

  it('stops at walls', () => {
    const dyn = new DynamicWorld();
    // walk north from the café into the café/corridor wall (z=8.4, no door at x=4)
    let p = { x: 4.0, y: 0, z: 12.5 };
    for (let i = 0; i < 200; i++) p = resolveMove(dyn, p, 0, -0.05, []);
    expect(p.z).toBeGreaterThan(8.4);
  });

  it('closed doors block and open doors pass', () => {
    const dyn = new DynamicWorld();
    dyn.setDoor('g-d-utility', false, 'test');
    for (let i = 0; i < 60; i++) dyn.update(0.05, [], false);
    let p = { x: 2.2, y: 0, z: 7.0 };
    for (let i = 0; i < 100; i++) p = resolveMove(dyn, p, 0, -0.05, []);
    expect(p.z).toBeGreaterThan(6.0);
    dyn.setDoor('g-d-utility', true, 'test');
    for (let i = 0; i < 60; i++) dyn.update(0.05, [], false);
    for (let i = 0; i < 100; i++) p = resolveMove(dyn, p, 0, -0.05, []);
    expect(p.z).toBeLessThan(5.5);
  });

  it('climbs the stairs from the ground floor to the first floor', () => {
    const dyn = new DynamicWorld();
    let p = { x: 18.5, y: 0, z: 5.1 };
    for (let i = 0; i < 200; i++) p = resolveMove(dyn, p, 0, -0.03, []); // up flight A
    expect(p.y).toBeCloseTo(2.0, 1);
    for (let i = 0; i < 60; i++) p = resolveMove(dyn, p, 0.03, 0, []); // across mid landing
    for (let i = 0; i < 200; i++) p = resolveMove(dyn, p, 0, 0.03, []); // up flight B
    expect(p.y).toBeCloseTo(4.0, 1);
  });

  it('never leaves the floor into a void', () => {
    const dyn = new DynamicWorld();
    // second-floor landing, walk north on the west half: guard rail blocks
    let p = { x: 18.6, y: 8, z: 5.1 };
    for (let i = 0; i < 100; i++) p = resolveMove(dyn, p, 0, -0.05, []);
    expect(p.y).toBe(8);
    expect(p.z).toBeGreaterThan(4.3);
  });
});

describe("chairman's office", () => {
  it('has its own room and door with the name plate on the door leaf', () => {
    const room = ROOMS.find((r) => r.id === 's-chair')!;
    expect(room.name).toBe("Chairman's Office");
    expect(roomAt(2, room.entry.x, room.entry.z)?.id).toBe('s-chair');
    const d = DOORS.find((x) => x.id === 's-d-chair')!;
    expect(d.plate).toEqual({ title: 'Astra Chairman', sub: 'Uday Fulkatwar' });
    expect(d.center).toBeGreaterThan(room.rect.x0);
    expect(d.center).toBeLessThan(room.rect.x1);
    expect(FURNITURE.some((f) => f.type === 'deskExec' && roomAt(2, f.x, f.z)?.id === 's-chair')).toBe(true);
  });
  it('can be walked to from the lobby', () => {
    const room = ROOMS.find((r) => r.id === 's-chair')!;
    expect(findPath(LOBBY, { floor: 2, ...room.entry })).not.toBeNull();
  });
});

describe("chairman's PC", () => {
  it('stands on the desk in the chairman office', async () => {
    const { PANELS } = await import('../src/world/furniture');
    const pcs = PANELS.filter((p) => p.kind === 'chairmanPc');
    expect(pcs.length).toBe(2);
    for (const p of pcs) expect(p.roomId).toBe('s-chair');
  });
});

describe('CCTV', () => {
  it('covers the working rooms from inside each room, never restrooms', async () => {
    const { CCTV_CAMERAS } = await import('../src/world/cctv');
    expect(CCTV_CAMERAS.length).toBe(18);
    for (const c of CCTV_CAMERAS) {
      const room = ROOMS.find((r) => r.id === c.roomId)!;
      expect(room.kind).not.toBe('restroom');
      expect(roomAt(c.floor, c.pos.x, c.pos.z)?.id).toBe(c.roomId);
      expect(c.pos.y).toBeGreaterThan(c.floor * FLOOR_H + 2.4);
      expect(c.pos.y).toBeLessThan((c.floor + 1) * FLOOR_H - 0.6);
    }
  });
});
