// Building exterior and surroundings: roof, entrance canopy and signage, plaza, streets and a light-
// weight instanced city with lit windows at night.
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { drawLogo } from '../apps/canvasRender';
import { BLD, FLOOR_COUNT, FLOOR_H } from '../world/building';
import { PLAZA } from '../world/physics';
import { mulberry32 } from '../util/rng';
import { GeoBuilder } from './geo';
import { materials, type MatKey } from './materials';
import * as T from './textures';
import { vis } from './visibility';

const TOP = FLOOR_COUNT * FLOOR_H;

function useLogoTexture(name: string, w: number, h: number, opts: Parameters<typeof drawLogo>[4]) {
  const tex = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }, [w, h]);
  useEffect(() => {
    const c = tex.image as HTMLCanvasElement;
    drawLogo(c.getContext('2d')!, w, h, name, opts);
    tex.needsUpdate = true;
  }, [tex, name, w, h, opts]);
  useEffect(() => () => tex.dispose(), [tex]);
  return tex;
}

function buildRoof(): Map<MatKey, THREE.BufferGeometry> {
  const b = new GeoBuilder();
  // roof slab, parapet with gold coping, rooftop plant and stair/lift overrun (hidden in cutaway views)
  b.boxMinMax('roof', BLD.x0 - 0.15, TOP - 0.36, BLD.z0 - 0.15, BLD.x1 + 0.15, TOP + 0.15, BLD.z1 + 0.15);
  for (const [x0, z0, x1, z1] of [[BLD.x0 - 0.15, BLD.z0 - 0.15, BLD.x1 + 0.15, BLD.z0 + 0.15], [BLD.x0 - 0.15, BLD.z1 - 0.15, BLD.x1 + 0.15, BLD.z1 + 0.15], [BLD.x0 - 0.15, BLD.z0, BLD.x0 + 0.15, BLD.z1], [BLD.x1 - 0.15, BLD.z0, BLD.x1 + 0.15, BLD.z1]]) {
    b.boxMinMax('spandrel', x0, TOP + 0.15, z0, x1, TOP + 1.1, z1);
  }
  b.boxMinMax('gold', BLD.x0 - 0.16, TOP + 1.05, BLD.z1 + 0.14, BLD.x1 + 0.16, TOP + 1.1, BLD.z1 + 0.17);
  b.boxMinMax('coreWall', 17.8, TOP, 0.2, 23.6, TOP + 2.6, 6.0);
  b.boxMinMax('plasticLight', 5, TOP + 0.15, 3, 9, TOP + 1.6, 6);
  b.boxMinMax('plasticLight', 26, TOP + 0.15, 3, 30.5, TOP + 1.8, 7);
  for (let i = 0; i < 4; i++) b.cyl('blackMetal', 6 + i * 0.9, TOP + 1.75, 4.5, 0.35, 0.35, 0.3, 16);
  return b.build();
}

function buildShell(): Map<MatKey, THREE.BufferGeometry> {
  const b = new GeoBuilder();
  // wide ground plane under the city
  b.boxMinMax('asphalt', -500, -0.2, -500, 540, -0.1, 540);
  // ground floor plinth
  b.boxMinMax('stone', BLD.x0 - 0.2, -0.4, BLD.z0 - 0.2, BLD.x1 + 0.2, -0.01, BLD.z1 + 0.2);
  // entrance canopy
  b.boxMinMax('spandrel', 15.8, 3.0, 19.75, 22.2, 3.3, 22.0);
  b.boxMinMax('gold', 15.8, 2.98, 21.98, 22.2, 3.32, 22.02);
  b.boxMinMax('lightStrip', 16.2, 2.97, 20.2, 21.8, 2.99, 21.7);
  for (const x of [16.0, 22.0]) b.boxMinMax('blackMetal', x - 0.07, 0, 21.8, x + 0.07, 3.0, 21.94);
  // plaza, kerbs, planters
  b.boxMinMax('paver', PLAZA.x0, -0.05, PLAZA.z0, PLAZA.x1, 0, PLAZA.z1);
  for (const [x0, z0, x1, z1] of [[PLAZA.x0 - 0.3, PLAZA.z0, PLAZA.x0, PLAZA.z1], [PLAZA.x1, PLAZA.z0, PLAZA.x1 + 0.3, PLAZA.z1], [PLAZA.x0, PLAZA.z1, 16.5, PLAZA.z1 + 0.3], [21.5, PLAZA.z1, PLAZA.x1, PLAZA.z1 + 0.3]]) {
    b.boxMinMax('concrete', x0, 0, z0, x1, 0.55, z1);
  }
  // the south kerb has a gap for the walkway; a low glass balustrade keeps the plaza closed
  b.boxMinMax('glass', 16.5, 0, PLAZA.z1 + 0.1, 21.5, 1.1, PLAZA.z1 + 0.14);
  b.boxMinMax('steel', 16.5, 1.08, PLAZA.z1 + 0.08, 21.5, 1.12, PLAZA.z1 + 0.16);
  for (const [x, z] of [[10, 22], [10, 26], [28, 22], [28, 26], [13, 27], [25, 27]]) {
    b.boxMinMax('concrete', x - 0.6, 0, z - 0.6, x + 0.6, 0.5, z + 0.6);
    b.boxMinMax('soil', x - 0.55, 0.49, z - 0.55, x + 0.55, 0.51, z + 0.55);
    b.sphere('leaf', x, 1.3, z, 0.75, 1, 1.1, 1, 1);
    b.cyl('walnut', x, 0.75, z, 0.06, 0.08, 0.6, 6);
  }
  // monument sign plinth
  b.boxMinMax('signDark', 11.6, 0, 24.2, 14.4, 1.0, 24.6);
  // streets & sidewalks
  b.boxMinMax('concrete', -40, -0.06, 27.8, 74, -0.02, 31);
  b.boxMinMax('asphalt', -40, -0.08, 31, 74, -0.04, 40);
  b.boxMinMax('concrete', -40, -0.06, -8, 74, -0.02, -5);
  b.boxMinMax('asphalt', -40, -0.08, -16, 74, -0.04, -8);
  b.boxMinMax('grass', -6, -0.07, -5, BLD.x0 - 0.2, -0.03, 27.8);
  b.boxMinMax('grass', BLD.x1 + 0.2, -0.07, -5, 40, -0.03, 27.8);
  b.boxMinMax('grass', BLD.x0 - 0.2, -0.07, -5, BLD.x1 + 0.2, -0.03, BLD.z0 - 0.2);
  b.boxMinMax('grass', BLD.x0 - 0.2, -0.07, BLD.z1 + 0.2, PLAZA.x0 - 0.3, -0.03, 27.8);
  b.boxMinMax('grass', PLAZA.x1 + 0.3, -0.07, BLD.z1 + 0.2, BLD.x1 + 0.2, -0.03, 27.8);
  for (let x = -36; x < 72; x += 6) b.boxMinMax('lightPanel', x, -0.039, 35.4, x + 3, -0.035, 35.6);
  // street trees
  for (let x = -30; x < 70; x += 9) {
    for (const z of [29.5, -6.5]) {
      b.cyl('walnut', x, 1.2, z, 0.1, 0.13, 2.4, 6);
      b.sphere('leaf', x, 3.0, z, 1.3, 1, 1.15, 1, 1);
    }
  }
  return b.build();
}

export function Exterior({ companyName, night, cityCount }: { companyName: string; night: number; cityCount: number }) {
  const mats = materials();
  const shell = useMemo(buildShell, []);
  const roof = useMemo(buildRoof, []);
  const roofRef = useRef<THREE.Group>(null);
  const canopyOpts = useMemo(() => ({ color: '#d6b46e' }), []);
  const monumentOpts = useMemo(() => ({ bg: '#1d1f23', color: '#d6b46e', sub: 'HEADQUARTERS' }), []);
  const canopyTex = useLogoTexture(companyName, 1024, 256, canopyOpts);
  const roofTex = useLogoTexture(companyName, 1024, 256, canopyOpts);
  const monumentTex = useLogoTexture(companyName, 512, 192, monumentOpts);
  const signMat = useMemo(() => new THREE.MeshStandardMaterial({ map: canopyTex, transparent: true, metalness: 0.8, roughness: 0.3, emissive: '#d6b46e', emissiveMap: canopyTex, emissiveIntensity: 0.2 }), [canopyTex]);
  const roofSignMat = useMemo(() => new THREE.MeshStandardMaterial({ map: roofTex, transparent: true, metalness: 0.8, roughness: 0.3, emissive: '#ffe2a8', emissiveMap: roofTex, emissiveIntensity: 0.2 }), [roofTex]);
  const monumentMat = useMemo(() => new THREE.MeshStandardMaterial({ map: monumentTex, roughness: 0.4 }), [monumentTex]);
  useEffect(() => () => { for (const g of shell.values()) g.dispose(); for (const g of roof.values()) g.dispose(); signMat.dispose(); roofSignMat.dispose(); monumentMat.dispose(); }, [shell, signMat, roofSignMat, monumentMat]);
  useEffect(() => {
    signMat.emissiveIntensity = 0.15 + night * 1.6;
    roofSignMat.emissiveIntensity = 0.15 + night * 2.2;
  }, [night, signMat, roofSignMat]);
  useFrame(() => {
    if (roofRef.current) roofRef.current.visible = vis.roof;
  });
  return (
    <group name="exterior">
      {[...shell.entries()].map(([k, g]) => <mesh key={k} geometry={g} material={mats[k]} receiveShadow castShadow={k !== 'glass' && k !== 'paver' && k !== 'asphalt'} />)}
      <group ref={roofRef}>
        {[...roof.entries()].map(([k, g]) => <mesh key={k} geometry={g} material={mats[k]} receiveShadow castShadow />)}
        <mesh position={[19, TOP + 1.9, BLD.z1 + 0.2]} material={roofSignMat}>
          <planeGeometry args={[8, 2]} />
        </mesh>
      </group>
      <mesh position={[19, 3.15, 22.04]} material={signMat}>
        <planeGeometry args={[4.4, 1.1]} />
      </mesh>
      <mesh position={[13, 0.55, 24.62]} material={monumentMat}>
        <planeGeometry args={[2.6, 0.95]} />
      </mesh>
      <City count={cityCount} night={night} />
    </group>
  );
}

function City({ count, night }: { count: number; night: number }) {
  const data = useMemo(() => {
    const r = mulberry32(42);
    const byVariant: THREE.Matrix4[][] = [[], [], [], []];
    let placed = 0;
    for (let tries = 0; placed < count && tries < count * 20; tries++) {
      const a = r() * Math.PI * 2;
      const d = 70 + r() * 220;
      const x = 17 + Math.cos(a) * d;
      const z = 10 + Math.sin(a) * d;
      if (z > 20 && z < 60 && x > -30 && x < 70) continue; // keep the street in front open
      const w = 14 + r() * 22;
      const dd = 14 + r() * 22;
      const h = 18 + Math.pow(r(), 1.6) * 110;
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, h / 2 - 0.1, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.round(r() * 4) * (Math.PI / 2) + (r() - 0.5) * 0.2), new THREE.Vector3(w, h, dd));
      byVariant[placed % 4].push(m);
      placed++;
    }
    return byVariant;
  }, [count]);
  const mats = useMemo(() => [0, 1, 2, 3].map((v) => {
    const day = T.facade(false, v).clone();
    const lit = T.facade(true, v).clone();
    day.repeat.set(3, 6);
    lit.repeat.set(3, 6);
    day.needsUpdate = lit.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ map: day, emissiveMap: lit, emissive: '#ffffff', emissiveIntensity: 0, roughness: 0.6, metalness: 0.2 });
  }), []);
  const geo = useMemo(() => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    // world-ish UVs: one repeat per box face is stretched by the material repeat
    return g;
  }, []);
  useEffect(() => {
    for (const m of mats) m.emissiveIntensity = night * 1.4;
  }, [night, mats]);
  useEffect(() => () => { geo.dispose(); for (const m of mats) { m.map?.dispose(); m.emissiveMap?.dispose(); m.dispose(); } }, [geo, mats]);
  const meshes = useMemo(() => data.map((list, i) => {
    const im = new THREE.InstancedMesh(geo, mats[i], list.length);
    list.forEach((mx, k) => im.setMatrixAt(k, mx));
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    return im;
  }), [data, geo, mats]);
  useEffect(() => () => { for (const m of meshes) m.dispose(); }, [meshes]);
  return <>{meshes.map((m, i) => <primitive key={i} object={m} />)}</>;
}
