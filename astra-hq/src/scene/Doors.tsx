// Door leaves (hinged, double and automatic sliding) animated from the shared door state, plus the
// elevator car, hoistway doors and call buttons.
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { DOORS, ELEVATOR, FLOOR_COUNT, FLOOR_H, type DoorDef } from '../world/building';
import { getSim } from '../store/simInstance';
import { GeoBuilder } from './geo';
import { materials, type MatKey } from './materials';
import { vis } from './visibility';

const LEAF_H = 2.2;

function leafGeometry(w: number, glass: boolean, handleSide: 1 | -1, vision = true): Map<MatKey, THREE.BufferGeometry> {
  // leaf extends along +X from the hinge (local origin)
  const b = new GeoBuilder();
  if (glass) {
    b.box('glass', w / 2, LEAF_H / 2, 0, w - 0.02, LEAF_H - 0.02, 0.015);
    b.box('blackMetal', w / 2, 0.04, 0, w, 0.08, 0.045);
    b.box('blackMetal', w / 2, LEAF_H - 0.03, 0, w, 0.06, 0.045);
    b.box('blackMetal', 0.02, LEAF_H / 2, 0, 0.04, LEAF_H, 0.045);
    b.box('blackMetal', w - 0.02, LEAF_H / 2, 0, 0.04, LEAF_H, 0.045);
    b.box('steel', w - 0.12, 1.05, 0.05 * handleSide, 0.03, 0.9, 0.03);
    b.box('steel', w - 0.12, 1.05, -0.05 * handleSide, 0.03, 0.9, 0.03);
  } else {
    b.box('walnut', w / 2, LEAF_H / 2, 0, w - 0.01, LEAF_H, 0.045);
    if (vision) b.box('glass', w / 2, 1.55, 0.0, 0.14, 0.9, 0.05);
    for (const s of [1, -1]) {
      b.box('steel', w - 0.1, 1.05, s * 0.045, 0.14, 0.02, 0.02);
      b.box('steel', w - 0.04, 1.05, s * 0.035, 0.02, 0.02, 0.03);
    }
  }
  return b.build();
}

interface LeafInst { door: DoorDef; group: THREE.Group; hingeSide: 1 | -1; slide: boolean }

export function Doors() {
  const mats = materials();
  const geos = useMemo(() => {
    const cache = new Map<string, Map<MatKey, THREE.BufferGeometry>>();
    const get = (w: number, glass: boolean, vision = true) => {
      const k = `${w.toFixed(2)}-${glass}-${vision}`;
      if (!cache.has(k)) cache.set(k, leafGeometry(w, glass, 1, vision));
      return cache.get(k)!;
    };
    return { get, cache };
  }, []);
  const leaves = useMemo(() => {
    const out: LeafInst[] = [];
    for (const d of DOORS) {
      if (d.kind === 'elevator') continue;
      const base = d.floor * FLOOR_H;
      const mk = (hingeX: number, w: number, hingeSide: 1 | -1, slide: boolean) => {
        const g = new THREE.Group();
        const geo = geos.get(w, d.glass, !d.plate);
        for (const [k, gg] of geo) {
          const m = new THREE.Mesh(gg, mats[k]);
          m.userData = { interact: 'door', id: d.id };
          if (k === 'glass') m.renderOrder = 2;
          m.castShadow = k !== 'glass';
          g.add(m);
        }
        // hinge side -1 mirrors the leaf so it extends towards -X from its hinge
        if (hingeSide === -1) g.scale.x = -1;
        if (d.plate) g.add(namePlate(d.plate.title, d.plate.sub, w, d.at > 7 ? -1 : 1));
        g.position.set(hingeX, base, d.at);
        out.push({ door: d, group: g, hingeSide, slide });
        return g;
      };
      const x0 = d.center - d.width / 2;
      const x1 = d.center + d.width / 2;
      if (d.kind === 'single') mk(x0 + 0.005, d.width - 0.01, 1, false);
      else if (d.kind === 'double') { mk(x0 + 0.005, d.width / 2 - 0.01, 1, false); mk(x1 - 0.005, d.width / 2 - 0.01, -1, false); }
      else if (d.kind === 'auto') { mk(x0, d.width / 2, 1, true); mk(x1, d.width / 2, -1, true); }
    }
    return out;
  }, [geos, mats]);

  useEffect(() => () => { for (const g of geos.cache.values()) for (const x of g.values()) x.dispose(); }, [geos]);

  useFrame(() => {
    const dyn = getSim().dyn;
    for (const l of leaves) {
      l.group.visible = vis.floors[l.door.floor];
      if (!l.group.visible) continue;
      const st = dyn.doors.get(l.door.id);
      const t = st ? easeInOut(st.t) : 0;
      if (l.slide) {
        const x0 = l.door.center - l.door.width / 2;
        const x1 = l.door.center + l.door.width / 2;
        // sliding panels move outwards behind the fixed glazing
        l.group.position.x = l.hingeSide === 1 ? x0 - t * (l.door.width / 2 - 0.05) : x1 + t * (l.door.width / 2 - 0.05);
        l.group.position.z = l.door.at - 0.06;
      } else {
        // rotate about the hinge into the swing side
        const ang = (Math.PI / 2) * 0.96 * t * l.door.swing;
        l.group.rotation.y = l.hingeSide === 1 ? -ang : ang;
      }
    }
  });

  return <group name="doors">{leaves.map((l, i) => <primitive key={i} object={l.group} />)}</group>;
}

/** Brass name plate screwed to the corridor face of a door leaf, at eye height (moves with the door). */
function namePlate(title: string, sub: string, leafW: number, face: 1 | -1): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 400;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 1024, 400);
  grad.addColorStop(0, '#e2c37e');
  grad.addColorStop(0.5, '#f7e3ae');
  grad.addColorStop(1, '#c9a35a');
  g.fillStyle = grad;
  g.fillRect(0, 0, 1024, 400);
  g.strokeStyle = '#6e4f1c';
  g.lineWidth = 10;
  g.strokeRect(22, 22, 980, 356);
  g.fillStyle = '#5a4018';
  for (const [x, y] of [[54, 54], [970, 54], [54, 346], [970, 346]]) { g.beginPath(); g.arc(x, y, 11, 0, Math.PI * 2); g.fill(); }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#16100a';
  let fs = 118;
  g.font = `700 ${fs}px Georgia, "Times New Roman", serif`;
  while (g.measureText(title.toUpperCase()).width > 880 && fs > 50) { fs -= 2; g.font = `700 ${fs}px Georgia, "Times New Roman", serif`; }
  g.fillText(title.toUpperCase(), 512, 160);
  g.fillRect(332, 238, 360, 5);
  g.font = '600 58px Georgia, "Times New Roman", serif';
  g.fillText(sub, 512, 300);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const pw = Math.min(0.72, leafW - 0.16);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(pw, pw * (400 / 1024)), new THREE.MeshStandardMaterial({ map: tex, metalness: 0.35, roughness: 0.4, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.35 }));
  // centred on the leaf at eye height, clear of the handle, just proud of the leaf surface on the corridor side
  m.position.set(leafW / 2, 1.52, face * 0.026);
  if (face === -1) m.rotation.y = Math.PI;
  m.userData = { doorPlate: `${title} · ${sub}` };
  return m;
}

function easeInOut(t: number) {
  return t * t * (3 - 2 * t);
}

/** Elevator car riding in the shaft, car doors, hoistway doors on each floor and call buttons. */
export function Elevator() {
  const mats = materials();
  const car = useRef<THREE.Group>(null);
  const carDoorL = useRef<THREE.Mesh>(null);
  const carDoorR = useRef<THREE.Mesh>(null);
  const hoist = useRef<(THREE.Group | null)[]>([]);
  const indicatorTex = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 48;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  const lastIndicator = useRef('');
  const carGeo = useMemo(() => {
    const b = new GeoBuilder();
    const c = ELEVATOR.car;
    const cx = (c.x0 + c.x1) / 2;
    const cz = (c.z0 + c.z1) / 2;
    const w = c.x1 - c.x0;
    const d = c.z1 - c.z0;
    b.box('stone', cx, -0.03, cz, w, 0.06, d);
    b.box('steel', cx, 1.2, c.z0 - 0.02, w, 2.4, 0.03);
    b.box('steel', c.x0 - 0.02, 1.2, cz, 0.03, 2.4, d);
    b.box('steel', c.x1 + 0.02, 1.2, cz, 0.03, 2.4, d);
    b.box('mirror', cx, 1.35, c.z0 + 0.005, w - 0.4, 1.3, 0.01);
    b.box('steel', cx, 2.42, cz, w, 0.04, d);
    b.box('lightPanel', cx, 2.39, cz, w - 0.5, 0.01, d - 0.5);
    for (const x of [c.x0 + 0.03, c.x1 - 0.03]) b.box('steel', x, 0.95, cz, 0.04, 0.04, d - 0.3);
    // front returns either side of the door opening
    const half = ELEVATOR.doorWidth / 2;
    b.box('steel', (c.x0 + ELEVATOR.doorCenter - half) / 2, 1.2, c.z1 + 0.02, ELEVATOR.doorCenter - half - c.x0, 2.4, 0.04);
    b.box('steel', (c.x1 + ELEVATOR.doorCenter + half) / 2, 1.2, c.z1 + 0.02, c.x1 - ELEVATOR.doorCenter - half, 2.4, 0.04);
    b.box('signDark', ELEVATOR.doorCenter + half + 0.2, 1.2, c.z1 - 0.01, 0.16, 0.42, 0.02);
    return b.build();
  }, []);
  const doorGeo = useMemo(() => new THREE.BoxGeometry(ELEVATOR.doorWidth / 2 + 0.02, 2.2, 0.03), []);
  useEffect(() => () => { for (const g of carGeo.values()) g.dispose(); doorGeo.dispose(); indicatorTex.dispose(); }, [carGeo, doorGeo, indicatorTex]);

  useFrame(() => {
    const dyn = getSim().dyn;
    const l = dyn.lift;
    if (car.current) car.current.position.y = l.y;
    const half = ELEVATOR.doorWidth / 4;
    const open = easeInOut(l.doorT) * (ELEVATOR.doorWidth / 2 - 0.03);
    if (carDoorL.current) carDoorL.current.position.x = ELEVATOR.doorCenter - half - open;
    if (carDoorR.current) carDoorR.current.position.x = ELEVATOR.doorCenter + half + open;
    for (let f = 0; f < FLOOR_COUNT; f++) {
      const g = hoist.current[f];
      if (!g) continue;
      g.visible = vis.floors[f];
      const t = easeInOut(dyn.liftDoorTAt(f)) * (ELEVATOR.doorWidth / 2 - 0.03);
      g.children[0].position.x = ELEVATOR.doorCenter - half - t;
      g.children[1].position.x = ELEVATOR.doorCenter + half + t;
    }
    const key = `${l.floor}${l.phase === 'moving' ? (l.target > l.floor ? 'u' : 'd') : ''}`;
    if (key !== lastIndicator.current) {
      lastIndicator.current = key;
      const c = indicatorTex.image as HTMLCanvasElement;
      const g = c.getContext('2d')!;
      g.fillStyle = '#0b0c0e';
      g.fillRect(0, 0, 128, 48);
      g.fillStyle = '#ffb648';
      g.font = '600 32px monospace';
      g.textBaseline = 'middle';
      g.fillText(`${['G', '1', '2'][l.floor]} ${l.phase === 'moving' ? (l.target > l.floor ? '▲' : '▼') : ''}`, 18, 26);
      indicatorTex.needsUpdate = true;
    }
  });

  return (
    <group name="elevator">
      <group ref={car}>
        {[...carGeo.entries()].map(([k, g]) => <mesh key={k} geometry={g} material={mats[k]} />)}
        <mesh ref={carDoorL} geometry={doorGeo} material={mats.steel} position={[0, 1.1, ELEVATOR.car.z1 + 0.05]} />
        <mesh ref={carDoorR} geometry={doorGeo} material={mats.steel} position={[0, 1.1, ELEVATOR.car.z1 + 0.05]} />
        {/* car operating panel (interactive) */}
        <mesh position={[ELEVATOR.doorCenter + ELEVATOR.doorWidth / 2 + 0.2, 1.2, ELEVATOR.car.z1 - 0.025]} rotation-y={Math.PI} userData={{ interact: 'liftPanel' }}>
          <planeGeometry args={[0.16, 0.42]} />
          <meshStandardMaterial color="#2a2d31" metalness={0.6} roughness={0.35} emissive="#d0ab62" emissiveIntensity={0.15} />
        </mesh>
      </group>
      {Array.from({ length: FLOOR_COUNT }, (_, f) => (
        <group key={f} ref={(el) => { hoist.current[f] = el; }}>
          <mesh geometry={doorGeo} material={mats.steel} position={[0, f * FLOOR_H + 1.1, 6.03]} />
          <mesh geometry={doorGeo} material={mats.steel} position={[0, f * FLOOR_H + 1.1, 6.03]} />
          <mesh position={[ELEVATOR.doorCenter + ELEVATOR.doorWidth / 2 + 0.35, f * FLOOR_H + 1.15, 6.12]} userData={{ interact: 'liftCall', floor: f }}>
            <planeGeometry args={[0.12, 0.28]} />
            <meshStandardMaterial color="#c9a45c" metalness={0.8} roughness={0.3} emissive="#ffcf80" emissiveIntensity={0.25} />
          </mesh>
          <mesh position={[ELEVATOR.doorCenter, f * FLOOR_H + 2.45, 6.115]}>
            <planeGeometry args={[0.46, 0.13]} />
            <meshBasicMaterial map={indicatorTex} toneMapped={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
