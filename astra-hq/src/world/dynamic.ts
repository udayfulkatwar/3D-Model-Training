// Door and elevator state shared by the player, the employees and the renderer.
import { DOORS, ELEVATOR, FLOOR_COUNT, FLOOR_H, type DoorDef } from './building';
import { doorBox, type Box3 } from './physics';

export interface DoorState {
  def: DoorDef;
  open: boolean;
  /** Animation progress, 0 = closed, 1 = fully open. */
  t: number;
  box: Box3;
  lastBy: string;
}

export type LiftPhase = 'idle' | 'closing' | 'moving' | 'opening';

export interface LiftState {
  y: number;
  floor: number; // floor the car is at or last passed
  target: number;
  phase: LiftPhase;
  doorT: number; // 0 closed .. 1 open
  holdTimer: number;
  queue: number[];
}

export interface Agent { x: number; y: number; z: number }

const AUTO_DOOR_RADIUS = 2.4;

export class DynamicWorld {
  doors = new Map<string, DoorState>();
  lift: LiftState = { y: 0, floor: 0, target: 0, phase: 'idle', doorT: 1, holdTimer: 6, queue: [] };
  /** Called whenever a door changes state (for logging / sound). */
  onDoor?: (d: DoorState, by: string) => void;
  onLift?: (event: 'arrive' | 'depart', floor: number) => void;

  constructor() {
    this.reset();
  }

  reset() {
    this.doors.clear();
    for (const d of DOORS) {
      if (d.kind === 'elevator') continue;
      this.doors.set(d.id, { def: d, open: d.defaultOpen, t: d.defaultOpen ? 1 : 0, box: doorBox(d), lastBy: 'default' });
    }
    this.lift = { y: 0, floor: 0, target: 0, phase: 'idle', doorT: 1, holdTimer: 6, queue: [] };
  }

  setDoor(id: string, open: boolean, by: string): boolean {
    const d = this.doors.get(id);
    if (!d || d.def.kind === 'auto') return false;
    if (d.open === open) return true;
    d.open = open;
    d.lastBy = by;
    this.onDoor?.(d, by);
    return true;
  }

  toggleDoor(id: string, by: string): boolean {
    const d = this.doors.get(id);
    if (!d) return false;
    return this.setDoor(id, !d.open, by);
  }

  /** A door blocks movement unless it is (almost) fully open. */
  doorBlocks(d: DoorState): boolean {
    return d.t < 0.85;
  }

  /** Hoistway door at `floor` is passable only when the car is there with its doors open. */
  liftDoorOpenAt(floor: number): boolean {
    return this.lift.phase !== 'moving' && Math.abs(this.lift.y - floor * FLOOR_H) < 0.02 && this.lift.doorT > 0.85;
  }

  liftDoorTAt(floor: number): number {
    return Math.abs(this.lift.y - floor * FLOOR_H) < 0.02 ? this.lift.doorT : 0;
  }

  callLift(floor: number) {
    if (floor < 0 || floor >= FLOOR_COUNT) return;
    const l = this.lift;
    if (l.phase === 'idle' && l.floor === floor) {
      l.phase = 'opening';
      l.holdTimer = 6;
      return;
    }
    if (l.target === floor && l.phase !== 'idle') return;
    if (!l.queue.includes(floor)) l.queue.push(floor);
  }

  /** Dynamic blockers for the given floor band (closed doors, closed lift doors). */
  dynamicBoxes(out: Box3[]): Box3[] {
    out.length = 0;
    for (const d of this.doors.values()) if (this.doorBlocks(d)) out.push(d.box);
    for (let f = 0; f < FLOOR_COUNT; f++) {
      if (!this.liftDoorOpenAt(f)) {
        const base = f * FLOOR_H;
        out.push({ x0: ELEVATOR.doorCenter - ELEVATOR.doorWidth / 2, x1: ELEVATOR.doorCenter + ELEVATOR.doorWidth / 2, z0: 5.9, z1: 6.1, y0: base, y1: base + 2.2, tag: `lift-door:${f}` });
      }
    }
    return out;
  }

  /** `liftBoarding`: someone is in the car doorway, so the doors must not close (safety edge). */
  update(dt: number, agents: Agent[], liftOccupied: boolean, liftBoarding = false) {
    // swing animation + automatic entrance doors
    for (const d of this.doors.values()) {
      if (d.def.kind === 'auto') {
        const base = d.def.floor * FLOOR_H;
        let near = false;
        for (const a of agents) {
          if (Math.abs(a.y - base) > 1.5) continue;
          if (Math.hypot(a.x - d.def.center, a.z - d.def.at) < AUTO_DOOR_RADIUS) { near = true; break; }
        }
        d.open = near;
      }
      const speed = d.def.kind === 'auto' ? 1.6 : 2.2;
      const target = d.open ? 1 : 0;
      if (d.t !== target) d.t = d.t < target ? Math.min(target, d.t + dt * speed) : Math.max(target, d.t - dt * speed);
    }
    this.updateLift(dt, liftOccupied, liftBoarding);
  }

  private updateLift(dt: number, occupied: boolean, boarding: boolean) {
    const l = this.lift;
    switch (l.phase) {
      case 'idle': {
        if (boarding && l.doorT > 0.85) {
          l.holdTimer = Math.max(l.holdTimer, 1.5);
          break;
        }
        l.holdTimer -= dt;
        if (l.queue.length) {
          const next = l.queue[0];
          if (next === l.floor) {
            l.queue.shift();
            l.phase = 'opening';
            l.holdTimer = 6;
          } else if (l.holdTimer <= 0 || occupied) {
            l.phase = 'closing';
          }
        } else if (l.holdTimer <= 0 && l.doorT > 0 && !occupied) {
          // keep doors open while someone is inside; otherwise close after a while
          l.doorT = Math.max(0, l.doorT - dt * 1.2);
        }
        break;
      }
      case 'closing':
        if (boarding && l.doorT > 0) {
          l.phase = 'opening'; // door edge sensor: re-open for the person stepping through
          break;
        }
        l.doorT = Math.max(0, l.doorT - dt * 1.2);
        if (l.doorT === 0) {
          const next = l.queue.shift();
          if (next === undefined) { l.phase = 'idle'; break; }
          l.target = next;
          l.phase = 'moving';
          this.onLift?.('depart', l.floor);
        }
        break;
      case 'moving': {
        const ty = l.target * FLOOR_H;
        const step = ELEVATOR.speed * dt;
        if (Math.abs(ty - l.y) <= step) {
          l.y = ty;
          l.floor = l.target;
          l.phase = 'opening';
          this.onLift?.('arrive', l.floor);
        } else {
          l.y += Math.sign(ty - l.y) * step;
          l.floor = Math.round(l.y / FLOOR_H);
        }
        break;
      }
      case 'opening':
        l.doorT = Math.min(1, l.doorT + dt * 1.2);
        if (l.doorT === 1) {
          l.phase = 'idle';
          l.holdTimer = 5;
        }
        break;
    }
  }

  /** Request to travel to a floor from inside the car: doors close immediately. */
  selectFloor(floor: number) {
    const l = this.lift;
    if (floor === l.floor && l.phase === 'idle') {
      l.phase = 'opening';
      return;
    }
    if (!l.queue.includes(floor)) l.queue.push(floor);
    if (l.phase === 'idle') {
      l.holdTimer = 0;
      l.phase = 'closing';
    }
  }

  snapshotDoors(): Record<string, boolean> {
    const o: Record<string, boolean> = {};
    for (const [id, d] of this.doors) o[id] = d.open;
    return o;
  }
}

export function inLiftCar(x: number, z: number): boolean {
  const c = ELEVATOR.car;
  return x >= c.x0 && x <= c.x1 && z >= c.z0 && z <= c.z1;
}
