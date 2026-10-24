// Camera modes: first-person walkthrough (pointer lock, WASD, collision, stairs, lift), seated view,
// follow-employee, orbit inspection, and building overview with floor cutaway.
import { OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { FLOOR_COUNT, FLOOR_H } from '../world/building';
import { SEAT_INDEX } from '../world/furniture';
import { EYE_HEIGHT, SPAWN, describeLocation, groundHeight, resolveMove, safeSpot, validPosition, type Circle } from '../world/movement';
import { getSim } from '../store/simInstance';
import { input, player, takeTeleport } from '../store/player';
import { inputBlocked, useUI } from '../store/ui';
import { CCTV_CAMERAS } from '../world/cctv';
import { computeVisibility } from './visibility';
import { playSound } from '../audio/sound';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';

const WALK = 1.7;
const RUN = 3.2;
const SEATED_EYE = 1.18;

export function CameraController() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const mode = useUI((s) => s.mode);
  const overviewFloor = useUI((s) => s.overviewFloor);
  const orbit = useRef<OrbitControlsImpl>(null);
  const vel = useRef(new THREE.Vector2());
  const fade = useRef<{ t: number; phase: 'out' | 'in'; target: ReturnType<typeof takeTeleport> } | null>(null);
  const placeTimer = useRef(0);
  const prevMode = useRef(mode);
  const transition = useRef<{ from: THREE.Vector3; to: THREE.Vector3; target: THREE.Vector3; fromTarget: THREE.Vector3; t: number } | null>(null);

  // pointer lock + mouse look
  useEffect(() => {
    const el = gl.domElement;
    const onLock = () => useUI.getState().setPointerLocked(document.pointerLockElement === el);
    const onMove = (e: MouseEvent) => {
      const s = useUI.getState();
      if (s.mode !== 'walk' && s.mode !== 'seated') return;
      if (inputBlocked()) return;
      const locked = document.pointerLockElement === el;
      if (!locked && !(e.buttons & 1) && !s.touch) return;
      const sens = 0.0022 * s.settings.mouseSensitivity;
      player.yaw -= e.movementX * sens;
      player.pitch -= e.movementY * sens * (s.settings.invertY ? -1 : 1);
      player.pitch = Math.max(-1.35, Math.min(1.35, player.pitch));
    };
    document.addEventListener('pointerlockchange', onLock);
    document.addEventListener('mousemove', onMove);
    return () => {
      document.removeEventListener('pointerlockchange', onLock);
      document.removeEventListener('mousemove', onMove);
    };
  }, [gl]);

  // keyboard state
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (inputBlocked()) return;
      input.keys.add(e.code);
    };
    const up = (e: KeyboardEvent) => input.keys.delete(e.code);
    const blur = () => input.keys.clear();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  // camera placement when switching into orbit-type modes
  useEffect(() => {
    const ui = useUI.getState();
    const from = camera.position.clone();
    let target = new THREE.Vector3(17, 2, 10);
    let to = new THREE.Vector3(-12, 34, 52);
    if (mode === 'overview') {
      const f = overviewFloor;
      target = new THREE.Vector3(17, f >= FLOOR_COUNT ? 5 : f * FLOOR_H + 1, 9.8);
      to = f >= FLOOR_COUNT ? new THREE.Vector3(-14, 30, 52) : new THREE.Vector3(17, f * FLOOR_H + 30, 34);
    } else if (mode === 'inspect' && ui.inspect) {
      target = new THREE.Vector3(ui.inspect.x, ui.inspect.y, ui.inspect.z);
      to = target.clone().add(new THREE.Vector3(ui.inspect.radius * 0.7, ui.inspect.radius * 0.9, ui.inspect.radius));
    } else if (mode === 'follow' && ui.followId) {
      const e = getSim().byId.get(ui.followId);
      if (e) {
        target = new THREE.Vector3(e.x, Math.floor((e.y + 0.3) / 4) * 4 + 1.2, e.z);
        to = target.clone().add(new THREE.Vector3(-Math.sin(e.heading) * 4, 3.4, -Math.cos(e.heading) * 4));
      }
    } else if (mode === 'intro') {
      target = new THREE.Vector3(17, 4, 10);
      to = new THREE.Vector3(-18, 26, 58);
    }
    if (mode === 'walk' || mode === 'seated') {
      transition.current = null;
      prevMode.current = mode;
      return;
    }
    const fromTarget = orbit.current ? orbit.current.target.clone() : target.clone();
    if (ui.reducedMotion || prevMode.current === 'walk' || prevMode.current === 'seated') {
      camera.position.copy(to);
      orbit.current?.target.copy(target);
      transition.current = null;
    } else {
      transition.current = { from, to, target, fromTarget, t: 0 };
    }
    prevMode.current = mode;
  }, [mode, overviewFloor, camera]);

  useFrame((state, dtRaw) => {
    const dt = Math.min(0.1, dtRaw); // collision is sub-stepped, so slow frames stay safe
    const ui = useUI.getState();
    const sim = getSim();
    // teleport with a short fade (instant with reduced motion)
    const tp = fade.current ? null : takeTeleport();
    if (tp) {
      if (ui.reducedMotion) applyTeleport(tp);
      else fade.current = { t: 0, phase: 'out', target: tp };
    }
    if (fade.current) {
      const f = fade.current;
      f.t += Math.min(dtRaw, 0.25) / 0.22; // real time, so fades finish even on slow frames
      if (f.phase === 'out') {
        ui.setFade(Math.min(1, f.t));
        if (f.t >= 1) { applyTeleport(f.target!); f.phase = 'in'; f.t = 0; }
      } else {
        ui.setFade(Math.max(0, 1 - f.t));
        if (f.t >= 1) { fade.current = null; ui.setFade(0); }
      }
    }

    if (ui.mode === 'walk') walk(dt, ui, sim);
    else if (ui.mode === 'seated') seated(ui);
    else orbitModes(dt, ui);

    // CCTV full view: the main camera looks through the chosen room camera (the player stays where they are)
    const cctv = ui.panel?.kind === 'cctv' && !ui.panelMin ? CCTV_CAMERAS[ui.panel.cam] : undefined;
    if (cctv) {
      camera.position.set(cctv.pos.x, cctv.pos.y, cctv.pos.z);
      camera.lookAt(cctv.target.x, cctv.target.y, cctv.target.z);
    }

    // shared outputs
    player.camX = camera.position.x;
    player.camY = camera.position.y;
    player.camZ = camera.position.z;
    const focus = ui.mode === 'follow' && ui.followId ? Math.floor(((sim.byId.get(ui.followId)?.y ?? 0) + 0.3) / 4)
      : ui.mode === 'inspect' && ui.inspect ? Math.floor((ui.inspect.y + 0.3) / 4) : player.floor;
    computeVisibility(cctv ? 'walk' : ui.mode, ui.overviewFloor, camera.position.x, camera.position.y, camera.position.z, Math.max(0, Math.min(2, focus)));
    sim.player = ui.mode === 'walk' || ui.mode === 'seated' ? { x: player.x, y: player.y, z: player.z, floor: player.floor } : null;
    placeTimer.current -= Math.min(dtRaw, 0.5);
    if (placeTimer.current <= 0) {
      placeTimer.current = 0.25;
      ui.setPlayerPlace(player.floor, describeLocation(player.floor, player.x, player.z));
    }
    void state;
  });

  function applyTeleport(t: NonNullable<ReturnType<typeof takeTeleport>>) {
    const sim = getSim();
    const p = safeSpot(sim.dyn, t.floor, t.x, t.z);
    player.x = p.x;
    player.y = p.y;
    player.z = p.z;
    player.floor = t.floor;
    player.teleportSeq++;
    if (t.yaw !== undefined) player.yaw = t.yaw;
    player.pitch = 0;
    vel.current.set(0, 0);
    const ui = useUI.getState();
    if (ui.seatedSeat) { sim.playerStand(); ui.setSeated(null); }
    if (ui.mode !== 'walk') ui.setMode('walk');
  }

  function walk(dt: number, ui: ReturnType<typeof useUI.getState>, sim: ReturnType<typeof getSim>) {
    const blocked = inputBlocked() || (!ui.pointerLocked && !ui.touch && !document.hasFocus());
    let fx = 0, fz = 0;
    if (!blocked) {
      const k = input.keys;
      if (k.has('KeyW') || k.has('ArrowUp')) fz += 1;
      if (k.has('KeyS') || k.has('ArrowDown')) fz -= 1;
      if (k.has('KeyA') || k.has('ArrowLeft')) fx -= 1;
      if (k.has('KeyD') || k.has('ArrowRight')) fx += 1;
      fx += input.touchMove.x;
      fz += input.touchMove.y;
      if (input.lookDX || input.lookDY) {
        player.yaw -= input.lookDX * 0.005;
        player.pitch = Math.max(-1.35, Math.min(1.35, player.pitch - input.lookDY * 0.005));
      }
    }
    input.lookDX = input.lookDY = 0;
    const len = Math.hypot(fx, fz);
    if (len > 1) { fx /= len; fz /= len; }
    const speed = input.keys.has('ShiftLeft') || input.keys.has('ShiftRight') ? RUN : WALK;
    // forward is -Z in camera space; yaw rotates about +Y
    const sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
    const tx = (-sy * fz + cy * fx) * speed;
    const tz = (-cy * fz - sy * fx) * speed;
    const a = 1 - Math.exp(-dt * 12);
    vel.current.x += (tx - vel.current.x) * a;
    vel.current.y += (tz - vel.current.y) * a;
    const people: Circle[] = sim.employees.filter((e) => e.phase === 'walking' || e.phase === 'standing' || e.phase === 'door-wait').map((e) => ({ x: e.x, z: e.z, y: e.y, r: 0.25 }));
    const next = resolveMove(sim.dyn, { x: player.x, y: player.y, z: player.z }, vel.current.x * dt, vel.current.y * dt, people);
    // if blocked, damp velocity so we don't keep pushing
    if (Math.hypot(next.x - player.x, next.z - player.z) < Math.hypot(vel.current.x, vel.current.y) * dt * 0.3) vel.current.multiplyScalar(0.5);
    player.x = next.x;
    player.y = next.y;
    player.z = next.z;
    player.floor = Math.max(0, Math.min(FLOOR_COUNT - 1, Math.floor((player.y + 0.6) / FLOOR_H)));
    // recovery from an invalid position (e.g. stuck in a closing door or after a bad teleport)
    if (!validPosition(sim.dyn, player) || player.y < -1) {
      player.invalidTime += dt;
      if (player.invalidTime > 0.6) {
        const h = groundHeight(sim.dyn, player.x, player.z, player.y);
        const p = h === null || player.y < -1 ? { x: SPAWN.x, y: 0, z: SPAWN.z } : safeSpot(sim.dyn, player.floor, player.x, player.z);
        Object.assign(player, { x: p.x, y: p.y, z: p.z, invalidTime: 0 });
        ui.showToast('Moved to the nearest free spot');
      }
    } else player.invalidTime = 0;
    camera.position.set(player.x, player.y + EYE_HEIGHT, player.z);
    camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
  }

  function seated(ui: ReturnType<typeof useUI.getState>) {
    const seat = ui.seatedSeat ? SEAT_INDEX.get(ui.seatedSeat) : undefined;
    if (!seat) { ui.setMode('walk'); return; }
    const floorY = seat.floor * FLOOR_H;
    // limit yaw around the chair's facing direction
    const base = seat.heading + Math.PI; // camera looks along -Z; seat heading faces +Z
    let d = player.yaw - base;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    d = Math.max(-1.9, Math.min(1.9, d));
    player.yaw = base + d;
    if (input.lookDX || input.lookDY) {
      player.yaw -= input.lookDX * 0.005;
      player.pitch = Math.max(-1.2, Math.min(1.2, player.pitch - input.lookDY * 0.005));
      input.lookDX = input.lookDY = 0;
    }
    camera.position.set(seat.x - Math.sin(seat.heading) * 0.05, floorY + SEATED_EYE, seat.z - Math.cos(seat.heading) * 0.05);
    camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
    player.x = seat.x; player.z = seat.z; player.y = floorY; player.floor = seat.floor;
  }

  function orbitModes(dt: number, ui: ReturnType<typeof useUI.getState>) {
    const o = orbit.current;
    if (!o) return;
    if (ui.mode === 'follow' && ui.followId) {
      const e = getSim().byId.get(ui.followId);
      if (e) {
        const t = new THREE.Vector3(e.x, e.y + (e.phase === 'seated' ? 0.7 : 1.2), e.z);
        const delta = t.clone().sub(o.target);
        o.target.add(delta.multiplyScalar(Math.min(1, dt * 4)));
        camera.position.add(delta);
      }
    }
    if (transition.current) {
      const tr = transition.current;
      tr.t = Math.min(1, tr.t + dt / 0.9);
      const k = tr.t * tr.t * (3 - 2 * tr.t);
      camera.position.lerpVectors(tr.from, tr.to, k);
      o.target.lerpVectors(tr.fromTarget, tr.target, k);
      if (tr.t >= 1) transition.current = null;
    }
    o.update();
  }

  const orbitEnabled = mode !== 'walk' && mode !== 'seated';
  return (
    <OrbitControls
      ref={orbit}
      enabled={orbitEnabled}
      enableDamping
      dampingFactor={0.08}
      maxPolarAngle={Math.PI * 0.49}
      minDistance={2}
      maxDistance={140}
      makeDefault={orbitEnabled}
    />
  );
}

export function enterWalk(gl: HTMLCanvasElement | null, spawnAtReception: boolean) {
  const ui = useUI.getState();
  if (spawnAtReception) {
    player.x = SPAWN.x; player.y = 0; player.z = SPAWN.z; player.yaw = SPAWN.yaw; player.pitch = 0; player.floor = 0;
  }
  ui.setMode('walk');
  ui.closePanel();
  playSound('ui');
  if (gl && !ui.touch) {
    try {
      const r = gl.requestPointerLock() as unknown as Promise<void> | undefined;
      if (r && typeof r.catch === 'function') r.catch(() => ui.showToast('Pointer lock unavailable: drag with the mouse to look around'));
    } catch {
      ui.showToast('Pointer lock unavailable: drag with the mouse to look around');
    }
  }
}
