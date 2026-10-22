import { FLOOR_NAMES, roomById } from '../world/building';
import { SEAT_INDEX, rotLocal } from '../world/furniture';
import { nearestWalkable } from '../world/nav';
import { SPAWN } from '../world/movement';
import { getSim } from '../store/simInstance';
import { requestTeleport } from '../store/player';
import { useUI } from '../store/ui';

/** Walk up to an employee: stand ~1.4 m in front of them, facing them. */
export function goToEmployee(id: string) {
  const sim = getSim();
  const e = sim.byId.get(id);
  if (!e) return;
  const floor = Math.max(0, Math.min(2, Math.floor((e.y + 0.3) / 4)));
  const front = rotLocal(0, 1.4, e.heading);
  let spot = nearestWalkable(floor, e.x + front.x, e.z + front.z, 2.5);
  if (!spot) spot = nearestWalkable(floor, e.x, e.z, 3) ?? { x: e.x, z: e.z };
  const yaw = Math.atan2(-(e.x - spot.x), -(e.z - spot.z));
  useUI.getState().closePanel();
  requestTeleport({ floor, x: spot.x, z: spot.z, yaw, label: e.cfg.name });
  useUI.getState().showToast(`Near ${e.cfg.name} · ${FLOOR_NAMES[floor]} · ${sim.roomName(e)}`);
}

/** Stand behind an employee's chair looking at their monitors. */
export function goToDesk(id: string) {
  const sim = getSim();
  const e = sim.byId.get(id);
  if (!e) return;
  const seat = SEAT_INDEX.get(e.ws.seatId)!;
  const back = rotLocal(0.45, -1.1, seat.heading);
  const spot = nearestWalkable(seat.floor, seat.x + back.x, seat.z + back.z, 2) ?? seat.approach;
  const yaw = Math.atan2(-(e.ws.x - spot.x), -(e.ws.z - spot.z));
  useUI.getState().closePanel();
  requestTeleport({ floor: seat.floor, x: spot.x, z: spot.z, yaw, label: e.ws.label });
  useUI.getState().showToast(`${e.ws.label} · ${roomById(e.ws.roomId)?.name ?? ''}`);
}

export function inspectMonitors(id: string) {
  const e = getSim().byId.get(id);
  if (!e || !e.ws.monitors.length) return;
  useUI.getState().openPanel({ kind: 'monitor', monitorId: e.ws.monitors[0].id });
}

export function followEmployee(id: string) {
  const ui = useUI.getState();
  ui.closePanel();
  if (document.pointerLockElement) document.exitPointerLock();
  ui.follow(id);
}

export function goToRoom(roomId: string) {
  const r = roomById(roomId);
  if (!r) return;
  useUI.getState().closePanel();
  requestTeleport({ floor: r.floor, x: r.entry.x, z: r.entry.z, label: r.name });
  useUI.getState().showToast(`${r.name} · ${FLOOR_NAMES[r.floor]}`);
}

export function returnToReception() {
  useUI.getState().closePanel();
  requestTeleport({ floor: 0, x: SPAWN.x, z: SPAWN.z, yaw: SPAWN.yaw, label: 'Reception' });
}

export function showOverview(floor = 3) {
  const ui = useUI.getState();
  if (document.pointerLockElement) document.exitPointerLock();
  if (ui.seatedSeat) { getSim().playerStand(); ui.setSeated(null); }
  ui.setOverviewFloor(floor);
  ui.setMode('overview');
}

export function inspectWorkstation(wsId: string) {
  const sim = getSim();
  const ws = sim.workstations().find((w) => w.id === wsId);
  if (!ws) return;
  if (document.pointerLockElement) document.exitPointerLock();
  useUI.getState().setInspect({ x: ws.x, y: ws.floor * 4 + 1, z: ws.z, radius: 4, label: ws.label });
}
