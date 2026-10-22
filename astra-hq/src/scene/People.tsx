// Stylised procedural people. Every body part type is one InstancedMesh holding that part for all
// employees, so the whole staff renders in ~20 draw calls. Poses (stand, walk, sit, type, talk) are
// computed per frame from the simulation state; distant people animate at a reduced rate.
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Employee } from '../sim/simulation';
import { getSim } from '../store/simInstance';
import { useUI } from '../store/ui';
import * as T from './textures';
import { vis } from './visibility';
import { HAIR_STYLES } from '../config/types';

type PartKey = 'pelvis' | 'torso' | 'collar' | 'neck' | 'head' | 'eyes' | 'glasses' | 'uarm' | 'farm' | 'hand' | 'thigh' | 'shin' | 'shoe' | `hair:${string}`;

function capsule(r: number, len: number): THREE.BufferGeometry {
  const g = new THREE.CapsuleGeometry(r, len, 4, 10);
  g.translate(0, -(len / 2 + r) + r * 0.6, 0); // pivot near the top cap
  return g;
}

function partGeometries(): Map<PartKey, { geo: THREE.BufferGeometry; perPerson: number }> {
  const m = new Map<PartKey, { geo: THREE.BufferGeometry; perPerson: number }>();
  const pelvis = new THREE.BoxGeometry(0.3, 0.16, 0.2);
  m.set('pelvis', { geo: pelvis, perPerson: 1 });
  const torso = new THREE.CapsuleGeometry(0.15, 0.28, 4, 12);
  torso.scale(1.18, 1, 0.72);
  torso.translate(0, 0.29, 0);
  m.set('torso', { geo: torso, perPerson: 1 });
  const collar = new THREE.BoxGeometry(0.11, 0.12, 0.02);
  collar.translate(0, 0.44, 0.105);
  m.set('collar', { geo: collar, perPerson: 1 });
  const neck = new THREE.CylinderGeometry(0.048, 0.055, 0.1, 10);
  neck.translate(0, 0.05, 0);
  m.set('neck', { geo: neck, perPerson: 1 });
  const head = new THREE.SphereGeometry(0.105, 18, 14);
  head.scale(0.9, 1.1, 1.0);
  head.translate(0, 0.11, 0.0);
  m.set('head', { geo: head, perPerson: 1 });
  const eyes = new THREE.BufferGeometry();
  {
    const a = new THREE.SphereGeometry(0.012, 6, 4);
    const b = a.clone();
    a.translate(-0.034, 0.125, 0.093);
    b.translate(0.034, 0.125, 0.093);
    const merged = mergeSimple([a, b]);
    eyes.copy(merged);
  }
  m.set('eyes', { geo: eyes, perPerson: 1 });
  const glasses = new THREE.BoxGeometry(0.15, 0.03, 0.01);
  glasses.translate(0, 0.125, 0.1);
  m.set('glasses', { geo: glasses, perPerson: 1 });
  m.set('uarm', { geo: capsule(0.048, 0.2), perPerson: 2 });
  m.set('farm', { geo: capsule(0.042, 0.19), perPerson: 2 });
  const hand = new THREE.SphereGeometry(0.045, 10, 8);
  hand.scale(0.75, 1.15, 0.55);
  hand.translate(0, -0.045, 0);
  m.set('hand', { geo: hand, perPerson: 2 });
  m.set('thigh', { geo: capsule(0.072, 0.3), perPerson: 2 });
  m.set('shin', { geo: capsule(0.056, 0.32), perPerson: 2 });
  const shoe = new THREE.BoxGeometry(0.1, 0.07, 0.25);
  shoe.translate(0, -0.035, 0.05);
  m.set('shoe', { geo: shoe, perPerson: 2 });
  // hair styles: offset from the neck pivot like the head
  const cap = (r: number, sy: number) => {
    const g = new THREE.SphereGeometry(r, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55);
    g.scale(0.95, sy, 1.02);
    g.translate(0, 0.125, -0.01);
    return g;
  };
  for (const s of HAIR_STYLES) {
    let g: THREE.BufferGeometry;
    switch (s) {
      case 'short': g = cap(0.112, 1.0); break;
      case 'buzz': g = cap(0.108, 0.9); break;
      case 'bald': g = new THREE.SphereGeometry(0.001, 3, 2); break;
      case 'long': {
        const back = new THREE.BoxGeometry(0.2, 0.26, 0.07);
        back.translate(0, 0.02, -0.075);
        g = mergeSimple([cap(0.115, 1.05), back]);
        break;
      }
      case 'bun': {
        const bun = new THREE.SphereGeometry(0.05, 10, 8);
        bun.translate(0, 0.2, -0.09);
        g = mergeSimple([cap(0.113, 1.0), bun]);
        break;
      }
      case 'bob': {
        const sides = new THREE.CylinderGeometry(0.118, 0.125, 0.14, 16, 1, true, Math.PI * 0.75, Math.PI * 1.5);
        sides.translate(0, 0.08, -0.005);
        g = mergeSimple([cap(0.116, 1.02), sides]);
        break;
      }
      case 'curly': {
        const parts: THREE.BufferGeometry[] = [];
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * Math.PI * 2;
          const p = new THREE.SphereGeometry(0.05, 8, 6);
          p.translate(Math.cos(a) * 0.08, 0.16 + (i % 2) * 0.03, Math.sin(a) * 0.075 - 0.01);
          parts.push(p);
        }
        parts.push(cap(0.117, 1.08));
        g = mergeSimple(parts);
        break;
      }
    }
    m.set(`hair:${s}`, { geo: g, perPerson: 1 });
  }
  return m;
}

/** Minimal merge for non-indexed or indexed geometries with position/normal. */
function mergeSimple(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  for (const g0 of list) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nrm.push(n.getX(i), n.getY(i), n.getZ(i)); }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return out;
}

interface PoseState {
  lean: number; hipL: number; hipR: number; kneeL: number; kneeR: number;
  shL: number; shR: number; rollL: number; rollR: number; elL: number; elR: number;
  headYaw: number; headPitch: number; phase: number; lastUpdate: number; hipY: number;
}

const tmpM = new THREE.Matrix4();
const tmpR = new THREE.Matrix4();
const tmpS = new THREE.Matrix4();
const tmpK = new THREE.Matrix4();
// matrix pool reused for every person each frame (no per-frame allocations)
const pool: THREE.Matrix4[] = Array.from({ length: 48 }, () => new THREE.Matrix4());
let poolIndex = 0;
const M = () => pool[poolIndex++];
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/** Clickable test: maps instanced part hits back to employees. */
export const peopleMeshes: THREE.InstancedMesh[] = [];
export const peopleIndex = new Map<THREE.InstancedMesh, number>(); // perPerson

export function People({ farHz }: { farHz: number }) {
  const sim = getSim();
  const camera = useThree((s) => s.camera);
  const parts = useMemo(partGeometries, []);
  const count = sim.employees.length;
  const material = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 0.72, metalness: 0.02 }), []);
  const glassesMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.3, metalness: 0.6 }), []);
  const shadowMat = useMemo(() => new THREE.MeshBasicMaterial({ map: T.blob(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }), []);
  const ringMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#d0ab62', transparent: true, opacity: 0.9, depthWrite: false }), []);
  const meshes = useMemo(() => {
    const out = new Map<PartKey, THREE.InstancedMesh>();
    for (const [k, { geo, perPerson }] of parts) {
      const im = new THREE.InstancedMesh(geo, k === 'glasses' || k === 'eyes' ? glassesMat : material, count * perPerson);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false;
      im.castShadow = true;
      for (let i = 0; i < count * perPerson; i++) im.setMatrixAt(i, ZERO);
      out.set(k, im);
    }
    return out;
  }, [parts, count, material, glassesMat]);
  const shadowMesh = useMemo(() => {
    const g = new THREE.PlaneGeometry(0.75, 0.75);
    g.rotateX(-Math.PI / 2);
    const im = new THREE.InstancedMesh(g, shadowMat, count);
    im.frustumCulled = false;
    return im;
  }, [count, shadowMat]);
  const ring = useRef<THREE.Mesh>(null);
  const poses = useRef<PoseState[]>([]);
  const colorsVersion = useRef(-1);

  // instance colours from appearance (refreshed when the roster changes)
  useEffect(() => {
    peopleMeshes.length = 0;
    peopleIndex.clear();
    for (const [k, im] of meshes) {
      if (['torso', 'pelvis', 'head', 'thigh', 'shin', 'uarm'].includes(k)) {
        peopleMeshes.push(im);
        peopleIndex.set(im, parts.get(k)!.perPerson);
      }
    }
    return () => { peopleMeshes.length = 0; peopleIndex.clear(); };
  }, [meshes, parts]);

  useEffect(() => () => {
    for (const im of meshes.values()) im.dispose();
    for (const p of parts.values()) p.geo.dispose();
    material.dispose();
    glassesMat.dispose();
    shadowMesh.geometry.dispose();
    shadowMesh.dispose();
    shadowMat.dispose();
    ringMat.dispose();
  }, [meshes, parts, material, glassesMat, shadowMesh, shadowMat, ringMat]);

  const applyColors = (emps: Employee[]) => {
    const c = new THREE.Color();
    const set = (k: PartKey, i: number, color: string) => { const im = meshes.get(k); if (im) im.setColorAt(i, c.set(color)); };
    emps.forEach((e, i) => {
      const a = e.cfg.appearance;
      const shirt = a.topStyle === 'blazer' ? '#f2f2f0' : a.topStyle === 'sweater' ? new THREE.Color(a.top).offsetHSL(0, 0, 0.12).getStyle() : new THREE.Color(a.top).offsetHSL(0, 0, -0.08).getStyle();
      set('pelvis', i, a.bottom);
      set('torso', i, a.top);
      set('collar', i, shirt);
      set('neck', i, a.skin);
      set('head', i, a.skin);
      set('eyes', i, '#1a1412');
      set('glasses', i, '#141414');
      for (const s of HAIR_STYLES) set(`hair:${s}`, i, a.hair);
      for (let j = 0; j < 2; j++) {
        set('uarm', i * 2 + j, a.top);
        set('farm', i * 2 + j, a.topStyle === 'blouse' ? a.skin : a.top);
        set('hand', i * 2 + j, a.skin);
        set('thigh', i * 2 + j, a.bottom);
        set('shin', i * 2 + j, a.bottom);
        set('shoe', i * 2 + j, a.shoes);
      }
    });
    for (const im of meshes.values()) if (im.instanceColor) im.instanceColor.needsUpdate = true;
  };

  useFrame((state, dt) => {
    const s = getSim();
    const ui = useUI.getState();
    const emps = s.employees;
    if (colorsVersion.current !== s.employees.length + s.config.employees.reduce((h, e) => h + e.appearance.top.length + e.name.length, 0)) {
      applyColors(emps);
      colorsVersion.current = s.employees.length + s.config.employees.reduce((h, e) => h + e.appearance.top.length + e.name.length, 0);
    }
    const t = state.clock.elapsedTime;
    const speedMul = s.paused ? 0 : s.speed;
    const camPos = camera.position;
    const reduced = ui.reducedMotion;
    while (poses.current.length < emps.length) poses.current.push({ lean: 0, hipL: 0, hipR: 0, kneeL: 0, kneeR: 0, shL: 0, shR: 0, rollL: 0.08, rollR: 0.08, elL: -0.1, elR: -0.1, headYaw: 0, headPitch: 0, phase: Math.random() * 6, lastUpdate: -1, hipY: 0 });
    let selected: Employee | undefined;
    const sel = ui.panel?.kind === 'employee' ? ui.panel.id : ui.followId;
    emps.forEach((e, i) => {
      const visible = vis.floors[Math.max(0, Math.min(2, e.floor))] || vis.floors[Math.max(0, Math.min(2, Math.floor((e.y + 0.3) / 4)))];
      if (e.cfg.id === sel) selected = e;
      if (!visible) {
        for (const [k, im] of meshes) {
          const per = parts.get(k)!.perPerson;
          for (let j = 0; j < per; j++) im.setMatrixAt(i * per + j, ZERO);
        }
        shadowMesh.setMatrixAt(i, ZERO);
        return;
      }
      const p = poses.current[i];
      const dist = Math.hypot(camPos.x - e.x, camPos.y - e.y, camPos.z - e.z);
      const interval = dist > 25 ? 1 / farHz : 0;
      if (t - p.lastUpdate < interval) return;
      const step = Math.min(0.1, p.lastUpdate < 0 ? 1 : t - p.lastUpdate);
      p.lastUpdate = t;
      updatePose(p, e, step, speedMul, t, i, reduced);
      writeMatrices(e, p, i);
      tmpM.makeTranslation(e.x, e.phase === 'seated' || e.phase === 'sitting-down' || e.phase === 'standing-up' ? Math.floor((e.y + 0.3) / 4) * 4 + 0.005 : e.y + 0.005, e.z);
      shadowMesh.setMatrixAt(i, tmpM);
    });
    for (const im of meshes.values()) im.instanceMatrix.needsUpdate = true;
    shadowMesh.instanceMatrix.needsUpdate = true;
    if (ring.current) {
      ring.current.visible = !!selected && vis.floors[Math.max(0, Math.min(2, selected.floor))];
      if (selected) {
        const fy = Math.floor((selected.y + 0.3) / 4) * 4;
        ring.current.position.set(selected.x, fy + 0.02, selected.z);
        ring.current.rotation.z = t * 0.6;
      }
    }
    void dt;
  });

  function updatePose(p: PoseState, e: Employee, dt: number, speedMul: number, t: number, i: number, reduced: boolean) {
    const k = Math.min(1, dt * 7);
    const L = (cur: number, target: number) => cur + (target - cur) * k;
    let tgt: Omit<PoseState, 'phase' | 'lastUpdate' | 'hipY'>;
    const anim = reduced ? 0.3 : 1;
    const breathe = Math.sin(t * 1.7 + i) * 0.015 * anim;
    switch (e.pose) {
      case 'walk': {
        p.phase += dt * speedMul * e.speed * 5.4;
        const sp = Math.sin(p.phase);
        const cp = Math.cos(p.phase);
        tgt = { lean: 0.06, hipL: -0.42 * sp, hipR: 0.42 * sp, kneeL: 0.15 + 0.55 * Math.max(0, cp), kneeR: 0.15 + 0.55 * Math.max(0, -cp), shL: 0.35 * sp, shR: -0.35 * sp, rollL: 0.08, rollR: 0.08, elL: -0.35, elR: -0.35, headYaw: 0, headPitch: 0.05 };
        break;
      }
      case 'sit':
        tgt = { lean: -0.06 + breathe, hipL: -1.45, hipR: -1.5, kneeL: 1.4, kneeR: 1.5, shL: -0.35, shR: -0.55, rollL: 0.12, rollR: 0.1, elL: -0.9, elR: -0.7, headYaw: Math.sin(t * 0.21 + i) * 0.25 * anim, headPitch: 0.05 };
        break;
      case 'sitType': {
        const tap = Math.sin(t * 13 + i) * 0.05 * anim * (speedMul > 0 ? 1 : 0.2);
        tgt = { lean: 0.12 + breathe, hipL: -1.48, hipR: -1.45, kneeL: 1.45, kneeR: 1.4, shL: -0.5 + tap, shR: -0.5 - tap, rollL: 0.18, rollR: 0.18, elL: -0.8, elR: -0.8, headYaw: Math.sin(t * 0.17 + i * 2) * 0.12 * anim, headPitch: 0.12 };
        break;
      }
      case 'sitTalk': {
        const g = Math.sin(t * 2.1 + i) * 0.25 * anim;
        tgt = { lean: -0.02 + breathe, hipL: -1.45, hipR: -1.45, kneeL: 1.4, kneeR: 1.45, shL: -0.4, shR: -0.7 + g, rollL: 0.15, rollR: 0.2, elL: -1.0, elR: -1.2 + g * 0.6, headYaw: Math.sin(t * 0.5 + i) * 0.35 * anim, headPitch: -0.05 + Math.sin(t * 3 + i) * 0.04 * anim };
        break;
      }
      case 'standTalk': {
        const g = Math.sin(t * 1.8 + i) * 0.3 * anim;
        tgt = { lean: 0.02, hipL: 0.03, hipR: -0.03, kneeL: 0.04, kneeR: 0.06, shL: 0.05, shR: -0.5 + g, rollL: 0.1, rollR: 0.15, elL: -0.15, elR: -1.2 + g, headYaw: Math.sin(t * 0.6 + i) * 0.3 * anim, headPitch: Math.sin(t * 2.6 + i) * 0.05 * anim };
        break;
      }
      default:
        tgt = { lean: 0.01 + breathe, hipL: 0, hipR: 0, kneeL: 0.03, kneeR: 0.03, shL: 0.04, shR: 0.04, rollL: 0.09, rollR: 0.09, elL: -0.15, elR: -0.15, headYaw: Math.sin(t * 0.3 + i) * 0.3 * anim, headPitch: 0 };
    }
    for (const key of Object.keys(tgt) as (keyof typeof tgt)[]) p[key] = e.pose === 'walk' ? tgt[key] : L(p[key], tgt[key]);
  }

  function setPart(k: PartKey, idx: number, parent: THREE.Matrix4, x: number, y: number, z: number, rx: number, rz = 0, sx = 1, sy = 1, sz = 1): THREE.Matrix4 {
    const m = M().makeTranslation(x, y, z);
    if (rx) m.multiply(tmpR.makeRotationX(rx));
    if (rz) m.multiply(tmpR.makeRotationZ(rz));
    const world = M().copy(parent).multiply(m);
    const im = meshes.get(k);
    if (im) im.setMatrixAt(idx, sx !== 1 || sy !== 1 || sz !== 1 ? tmpS.copy(world).multiply(tmpK.makeScale(sx, sy, sz)) : world);
    return world;
  }

  function writeMatrices(e: Employee, p: PoseState, i: number) {
    const a = e.cfg.appearance;
    const s = a.height;
    const bw = a.build;
    const seatedish = e.phase === 'seated' || e.phase === 'sitting-down' || e.phase === 'standing-up' || e.pose === 'sit' || e.pose === 'sitType' || e.pose === 'sitTalk';
    const sitBlend = e.phase === 'sitting-down' ? e.blend : e.phase === 'standing-up' ? 1 - e.blend : seatedish ? 1 : 0;
    const standHip = 0.93 * s;
    const floorY = Math.floor((e.y + 0.3) / 4) * 4;
    // seated: hips on the seat surface (e.y is the seat height); standing: hips above the floor
    const hipY = seatedish ? (e.phase === 'seated' ? e.y + 0.08 : floorY + standHip + (e.y + 0.08 - floorY - standHip) * sitBlend) : e.y + standHip + (e.pose === 'walk' ? Math.abs(Math.cos(p.phase)) * 0.015 : 0);
    poolIndex = 0;
    const root = M().makeTranslation(e.x, hipY, e.z).multiply(tmpR.makeRotationY(e.heading)).multiply(tmpK.makeScale(s, s, s));
    setPart('pelvis', i, root, 0, 0, 0, 0, 0, bw, 1, 1);
    const spine = setPart('torso', i, root, 0, 0.05, 0, p.lean, 0, bw, 1, 1);
    setPart('collar', i, spine, 0, 0, 0, 0, 0, bw, 1, 1);
    const neck = setPart('neck', i, spine, 0, 0.55, 0, 0);
    const head = M().copy(neck).multiply(tmpK.makeTranslation(0, 0.08, 0)).multiply(tmpR.makeRotationY(p.headYaw)).multiply(tmpK.makeRotationX(p.headPitch));
    meshes.get('head')!.setMatrixAt(i, head);
    meshes.get('eyes')!.setMatrixAt(i, head);
    meshes.get('glasses')!.setMatrixAt(i, a.glasses ? head : ZERO);
    for (const hs of HAIR_STYLES) meshes.get(`hair:${hs}`)!.setMatrixAt(i, hs === a.hairStyle ? head : ZERO);
    // arms
    const arm = (side: -1 | 1, j: number, sh: number, roll: number, el: number) => {
      const up = setPart('uarm', i * 2 + j, spine, side * 0.2 * bw, 0.45, 0, sh, side * roll);
      const fore = setPart('farm', i * 2 + j, up, 0, -0.26, 0, el);
      setPart('hand', i * 2 + j, fore, 0, -0.24, 0, 0);
    };
    arm(-1, 0, p.shL, p.rollL, p.elL);
    arm(1, 1, p.shR, p.rollR, p.elR);
    // legs
    const leg = (side: -1 | 1, j: number, hip: number, knee: number) => {
      const th = setPart('thigh', i * 2 + j, root, side * 0.09 * bw, -0.02, 0, hip);
      const sh = setPart('shin', i * 2 + j, th, 0, -0.43, 0, knee);
      // keep feet flat: counter-rotate the shoe by the accumulated leg angle
      setPart('shoe', i * 2 + j, sh, 0, -0.41, 0, -(hip + knee));
    };
    leg(-1, 0, p.hipL, p.kneeL);
    leg(1, 1, p.hipR, p.kneeR);
  }

  return (
    <group name="people">
      {[...meshes.values()].map((im, k) => <primitive key={k} object={im} />)}
      <primitive object={shadowMesh} />
      <mesh ref={ring} rotation-x={-Math.PI / 2} material={ringMat} visible={false}>
        <ringGeometry args={[0.38, 0.45, 40, 1, 0, Math.PI * 1.7]} />
      </mesh>
    </group>
  );
}
