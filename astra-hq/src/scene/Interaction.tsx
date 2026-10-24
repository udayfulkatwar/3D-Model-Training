// Interaction: hit volumes for chairs, coffee machines and the CEO desk; centre-of-view (walkthrough)
// or pointer (other modes) raycasting with wall occlusion; highlight and prompt; click/E actions.
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { FLOOR_H, roomById } from '../world/building';
import { PANELS, SEATS, WS_INDEX, MONITOR_INDEX } from '../world/furniture';
import { queryStatic, DOOR_INDEX, type Box3 } from '../world/physics';
import { getSim } from '../store/simInstance';
import { player } from '../store/player';
import { inputBlocked, useUI } from '../store/ui';
import { APPS } from '../sim/apps';
import { playSound } from '../audio/sound';
import { GeoBuilder } from './geo';
import { materials } from './materials';
import { peopleIndex, peopleMeshes } from './People';
import { screenRegistry } from './Screens';
import { vis } from './visibility';

export interface Hit { kind: string; id?: string; floor?: number; obj: THREE.Object3D; point: THREE.Vector3; distance: number; empIndex?: number }

const COFFEE = [
  { id: 'cafe', floor: 0, x: 3.2, z: 8.82, rot: 0, label: 'Café coffee machine' },
  { id: 'lounge', floor: 2, x: 33.42, z: 1.4, rot: -Math.PI / 2, label: 'Staff lounge coffee machine' },
];

function coffeeMachineGeometry() {
  const b = new GeoBuilder();
  b.box('steel', 0, 0.2, 0, 0.55, 0.4, 0.42);
  b.box('blackMetal', 0, 0.44, -0.05, 0.55, 0.08, 0.32);
  b.box('plasticDark', 0, 0.02, 0.14, 0.45, 0.03, 0.16);
  for (const x of [-0.13, 0.13]) {
    b.cyl('steel', x, 0.25, 0.18, 0.03, 0.03, 0.06, 10);
    b.hcyl('blackMetal', x, 0.25, 0.25, 0.012, 0.12, Math.PI / 2, 6);
  }
  b.cyl('ceramic', -0.13, 0.08, 0.16, 0.035, 0.03, 0.08, 10);
  b.box('screenOff', 0.2, 0.33, 0.211, 0.1, 0.06, 0.004);
  b.box('ledGreen', 0.2, 0.33, 0.214, 0.06, 0.02, 0.002);
  b.cyl('blackMetal', 0.2, 0.55, -0.1, 0.07, 0.06, 0.18, 12); // grinder hopper
  return b.build();
}

/** Monitor bodies, stands, keyboard and mouse of the Chairman's PC (the screens themselves are wall panels). */
function chairmanPcGeometry() {
  const b = new GeoBuilder();
  const base = 2 * FLOOR_H + 0.76;
  for (const p of PANELS.filter((x) => x.kind === 'chairmanPc')) {
    const y = 2 * FLOOR_H + p.y;
    const bx = p.x - Math.sin(p.heading) * 0.025, bz = p.z - Math.cos(p.heading) * 0.025;
    b.box('blackMetal', bx, y, bz, p.w + 0.03, p.h + 0.03, 0.035, p.heading);
    b.box('blackMetal', p.x - Math.sin(p.heading) * 0.08, base + 0.13, p.z - Math.cos(p.heading) * 0.08, 0.05, 0.26, 0.03, p.heading);
    b.box('blackMetal', p.x - Math.sin(p.heading) * 0.06, base + 0.008, p.z - Math.cos(p.heading) * 0.06, 0.24, 0.016, 0.18, p.heading);
  }
  b.box('plasticDark', 31.1, base + 0.012, 15.62, 0.44, 0.02, 0.14);
  b.box('plasticDark', 31.5, base + 0.014, 15.64, 0.06, 0.025, 0.1);
  return b.build();
}

export function HitVolumes() {
  const mats = materials();
  const coffee = useMemo(coffeeMachineGeometry, []);
  const seatBoxes = useMemo(() => SEATS.filter((s) => s.chairId), []);
  const boxGeo = useMemo(() => new THREE.BoxGeometry(0.55, 1.0, 0.55), []);
  const invisible = useMemo(() => new THREE.MeshBasicMaterial({ visible: false }), []);
  useEffect(() => () => { for (const g of coffee.values()) g.dispose(); boxGeo.dispose(); invisible.dispose(); }, [coffee, boxGeo, invisible]);
  const ceo = WS_INDEX.get('ws-ceo')!;
  const pc = useMemo(chairmanPcGeometry, []);
  useEffect(() => () => { for (const g of pc.values()) g.dispose(); }, [pc]);
  return (
    <group name="hit-volumes">
      {seatBoxes.map((s) => (
        <mesh key={s.id} geometry={boxGeo} material={invisible} position={[s.x, s.y - 0.1, s.z]} userData={{ interact: 'seat', id: s.id, floor: s.floor }} />
      ))}
      {COFFEE.map((c) => (
        <group key={c.id} position={[c.x, c.floor * FLOOR_H + 0.92, c.z]} rotation-y={c.rot}>
          {[...coffee.entries()].map(([k, g]) => <mesh key={k} geometry={g} material={mats[k]} castShadow userData={{ interact: 'coffee', id: c.id, floor: c.floor }} />)}
        </group>
      ))}
      <mesh position={[ceo.x, 2 * FLOOR_H + 0.8, ceo.z]} material={invisible} userData={{ interact: 'ceoDesk', floor: 2 }}>
        <boxGeometry args={[ceo.deskW, 0.15, ceo.deskD]} />
      </mesh>
      {[...pc.entries()].map(([k, g]) => <mesh key={k} geometry={g} material={mats[k]} castShadow userData={{ interact: 'wall', id: 'p-chair-pc-1', floor: 2 }} />)}
    </group>
  );
}

const tmpBoxes: Box3[] = [];
const dynBoxes: Box3[] = [];
/** True if a wall, closed door or the floor slab blocks the straight line between two points. */
function occluded(a: THREE.Vector3, b: THREE.Vector3): boolean {
  const len = a.distanceTo(b);
  const n = Math.ceil(len / 0.1);
  getSim().dyn.dynamicBoxes(dynBoxes);
  for (let i = 1; i < n - 1; i++) {
    const t = i / n;
    const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t, z = a.z + (b.z - a.z) * t;
    queryStatic(x, z, 0.01, tmpBoxes);
    for (const bx of tmpBoxes) {
      if (!bx.tag.startsWith('wall:')) continue;
      if (x > bx.x0 && x < bx.x1 && z > bx.z0 && z < bx.z1 && y > bx.y0 && y < bx.y1) return true;
    }
    for (const bx of dynBoxes) if (x > bx.x0 && x < bx.x1 && z > bx.z0 && z < bx.z1 && y > bx.y0 && y < bx.y1) return true;
  }
  return false;
}

export function describeHit(h: Hit): string | null {
  const sim = getSim();
  switch (h.kind) {
    case 'monitor': {
      const m = MONITOR_INDEX.get(h.id!)!;
      const owner = sim.ownerOfWorkstation(m.workstationId);
      const st = sim.monitorState(h.id!);
      return `Inspect monitor · ${owner?.cfg.name ?? 'Flex desk'} · ${st ? APPS[st.appId].title : ''}`;
    }
    case 'wall': {
      const p = PANELS.find((x) => x.id === h.id);
      if (!p || p.kind === 'logo') return null;
      if (p.kind === 'directory') return 'Open office directory & navigation';
      if (p.kind === 'chairmanPc') return "Use Chairman's PC · access to every screen, person and control";
      return `View ${p.label}`;
    }
    case 'door': {
      const d = sim.dyn.doors.get(h.id!);
      if (!d) return null;
      if (d.def.kind === 'auto') return null;
      return `${d.open ? 'Close' : 'Open'} ${d.def.label} door`;
    }
    case 'seat': {
      const occupied = sim.reservations.get(h.id!);
      const s = SEATS.find((x) => x.id === h.id);
      if (occupied && occupied !== 'player') return null;
      return `Sit down${s ? ` (${roomById(s.roomId)?.name ?? ''})` : ''}`;
    }
    case 'coffee': return 'Make a coffee';
    case 'ceoDesk': return 'Open company overview';
    case 'liftCall': return `Call elevator to this floor`;
    case 'liftPanel': return 'Elevator: choose a floor';
    case 'person': {
      const e = sim.employees[h.empIndex!];
      return e ? `Talk to ${e.cfg.name} · ${e.cfg.title} · ${e.task}` : null;
    }
  }
  return null;
}

export function activateHit(h: Hit) {
  const sim = getSim();
  const ui = useUI.getState();
  switch (h.kind) {
    case 'monitor':
      ui.openPanel({ kind: 'monitor', monitorId: h.id! });
      playSound('click');
      break;
    case 'wall': {
      const p = PANELS.find((x) => x.id === h.id);
      if (!p || p.kind === 'logo') return;
      if (p.kind === 'directory') ui.openPanel({ kind: 'navigation' });
      else if (p.kind === 'chairmanPc') ui.openPanel({ kind: 'owner', tab: 'office', pc: true });
      else ui.openPanel({ kind: 'wall', panelId: p.id });
      playSound('click');
      break;
    }
    case 'door': {
      const d = sim.dyn.doors.get(h.id!);
      if (!d || d.def.kind === 'auto') return;
      if (d.open) {
        // don't close a door on the player standing in the doorway
        const b = d.box;
        if (player.x > b.x0 - 0.35 && player.x < b.x1 + 0.35 && player.z > b.z0 - 0.35 && player.z < b.z1 + 0.35 && Math.abs(player.y - d.def.floor * FLOOR_H) < 1) {
          ui.showToast('Step out of the doorway to close the door');
          return;
        }
      }
      sim.dyn.toggleDoor(h.id!, 'player');
      playSound('door');
      break;
    }
    case 'seat': {
      if (!sim.playerSit(h.id!)) { ui.showToast('That seat is taken'); return; }
      ui.setSeated(h.id!);
      const s = SEATS.find((x) => x.id === h.id)!;
      player.yaw = s.heading + Math.PI;
      player.pitch = -0.08;
      ui.setMode('seated');
      ui.showToast('Seated view · press E or Space to stand up');
      playSound('click');
      break;
    }
    case 'coffee': {
      const where = h.id === 'lounge' ? 'lounge' : 'cafe';
      const drink = sim.playerCoffee(where);
      ui.openPanel({ kind: 'coffee', where, drink });
      playSound('coffee');
      break;
    }
    case 'ceoDesk':
      ui.openPanel({ kind: 'wall', panelId: 'p-ceo-tv' });
      playSound('click');
      break;
    case 'liftCall':
      sim.dyn.callLift(h.floor ?? 0);
      ui.showToast('Elevator called');
      playSound('click');
      break;
    case 'liftPanel':
      ui.openPanel({ kind: 'elevator' });
      playSound('click');
      break;
    case 'person': {
      const e = sim.employees[h.empIndex!];
      if (e) ui.openPanel({ kind: 'talk', id: e.cfg.id });
      playSound('click');
      break;
    }
  }
}

export function Interaction() {
  const { camera, gl, scene } = useThree();
  const ray = useMemo(() => new THREE.Raycaster(), []);
  const hover = useRef<Hit | null>(null);
  const pointer = useRef(new THREE.Vector2(0, 0));
  const pointerActive = useRef(false);
  const timer = useRef(0);
  const highlight = useRef<THREE.LineSegments>(null);
  const targets = useRef<THREE.Object3D[]>([]);

  useEffect(() => {
    // gather interactable meshes once the scene is mounted (and refresh periodically)
    const collect = () => {
      const list: THREE.Object3D[] = [];
      scene.traverse((o) => { if (o.userData?.interact) list.push(o); });
      targets.current = list;
    };
    collect();
    const id = window.setInterval(collect, 2000);
    return () => window.clearInterval(id);
  }, [scene]);

  useEffect(() => {
    const el = gl.domElement;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      pointer.current.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      pointerActive.current = true;
    };
    let downAt = { x: 0, y: 0, t: 0 };
    const down = (e: PointerEvent) => { downAt = { x: e.clientX, y: e.clientY, t: performance.now() }; };
    const click = (e: PointerEvent) => {
      const ui = useUI.getState();
      if (inputBlocked()) return;
      if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6 || performance.now() - downAt.t > 600) return; // drag, not a click
      if (ui.mode === 'walk' && !ui.pointerLocked && !ui.touch) {
        // clicking the 3D view recaptures the mouse; if pointer lock is unavailable, drag-to-look keeps working
        try {
          const r = el.requestPointerLock() as unknown as Promise<void> | undefined;
          if (r && typeof r.catch === 'function') r.catch(() => {});
        } catch { /* pointer lock unavailable */ }
        return;
      }
      move(e);
      const h = pick(ui.mode === 'walk' || ui.mode === 'seated' ? 'center' : 'pointer');
      if (h) activateHit(h);
    };
    const key = (e: KeyboardEvent) => {
      if (inputBlocked()) return;
      const ui = useUI.getState();
      if (e.code === 'KeyE' || (e.code === 'Space' && ui.mode === 'seated')) {
        if (ui.mode === 'seated') {
          getSim().playerStand();
          ui.setSeated(null);
          ui.setMode('walk');
          return;
        }
        if (ui.mode === 'walk' && hover.current) activateHit(hover.current);
      }
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', click);
    window.addEventListener('keydown', key);
    return () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointerup', click);
      window.removeEventListener('keydown', key);
    };
  }, [gl]);

  function pick(source: 'center' | 'pointer'): Hit | null {
    const ui = useUI.getState();
    ray.setFromCamera(source === 'center' ? new THREE.Vector2(0, 0) : pointer.current, camera);
    const walkish = ui.mode === 'walk' || ui.mode === 'seated';
    ray.far = walkish ? 6 : 200;
    const objs = targets.current.filter((o) => {
      const f = o.userData.floor ?? floorOf(o);
      return f === undefined || vis.floors[f];
    });
    for (const m of peopleMeshes) m.computeBoundingSphere();
    const hits = ray.intersectObjects([...objs, ...peopleMeshes], false);
    for (const h of hits) {
      let hit: Hit;
      if (peopleIndex.has(h.object as THREE.InstancedMesh)) {
        const per = peopleIndex.get(h.object as THREE.InstancedMesh)!;
        const idx = Math.floor((h.instanceId ?? 0) / per);
        const e = getSim().employees[idx];
        if (!e || !vis.floors[Math.max(0, Math.min(2, Math.floor((e.y + 0.3) / 4)))]) continue;
        hit = { kind: 'person', obj: h.object, point: h.point, distance: h.distance, empIndex: idx };
      } else {
        const u = h.object.userData;
        hit = { kind: u.interact, id: u.id, floor: u.floor, obj: h.object, point: h.point, distance: h.distance };
      }
      const maxD = !walkish ? 200 : hit.kind === 'monitor' || hit.kind === 'wall' || hit.kind === 'person' ? 5 : 3.2;
      if (hit.distance > maxD) return null;
      if (walkish && occluded(camera.position, hit.point)) return null;
      if (!describeHit(hit)) continue;
      return hit;
    }
    return null;
  }

  useFrame((_, dt) => {
    const ui = useUI.getState();
    timer.current -= dt;
    if (timer.current > 0) return;
    timer.current = 0.08;
    const walkish = ui.mode === 'walk' || ui.mode === 'seated';
    if (inputBlocked() || ui.mode === 'intro' || (!walkish && !pointerActive.current)) {
      hover.current = null;
      ui.setPrompt(null);
      if (highlight.current) highlight.current.visible = false;
      gl.domElement.style.cursor = '';
      return;
    }
    const h = pick(walkish ? 'center' : 'pointer');
    hover.current = h;
    const text = h ? describeHit(h) : null;
    ui.setPrompt(text ? (walkish ? `[E] ${text}` : text) : null);
    gl.domElement.style.cursor = !walkish && h ? 'pointer' : '';
    const hl = highlight.current;
    if (hl) {
      if (h && h.kind !== 'person' && h.kind !== 'seat') {
        const box = new THREE.Box3().setFromObject(h.kind === 'door' || h.kind === 'coffee' ? h.obj.parent ?? h.obj : h.obj);
        const size = box.getSize(new THREE.Vector3()).addScalar(0.03);
        hl.position.copy(box.getCenter(new THREE.Vector3()));
        hl.scale.copy(size);
        hl.visible = true;
      } else if (h?.kind === 'seat') {
        hl.position.copy(h.obj.position);
        hl.scale.set(0.6, 1.0, 0.6);
        hl.visible = true;
      } else hl.visible = false;
    }
  });

  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), []);
  useEffect(() => () => edges.dispose(), [edges]);
  return (
    <lineSegments ref={highlight} geometry={edges} visible={false} renderOrder={5}>
      <lineBasicMaterial color="#e2bf74" transparent opacity={0.85} depthTest={false} />
    </lineSegments>
  );
}

function floorOf(o: THREE.Object3D): number | undefined {
  const id = o.userData.id as string | undefined;
  if (o.userData.interact === 'monitor' || o.userData.interact === 'wall') return id ? screenRegistry.get(id)?.floor : undefined;
  if (o.userData.interact === 'door') return id ? DOOR_INDEX.get(id)?.floor : undefined;
  return undefined;
}
