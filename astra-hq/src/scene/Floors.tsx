import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { FLOOR_COUNT } from '../world/building';
import { buildFloorGeometry, buildPrototypes } from './buildFloor';
import { materials, type MatKey } from './materials';
import * as T from './textures';
import { vis } from './visibility';

function Instanced({ geometry, material, matrices, castShadow }: { geometry: THREE.BufferGeometry; material: THREE.Material; matrices: THREE.Matrix4[]; castShadow?: boolean }) {
  const mesh = useMemo(() => {
    const m = new THREE.InstancedMesh(geometry, material, matrices.length);
    matrices.forEach((mx, i) => m.setMatrixAt(i, mx));
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
    m.castShadow = !!castShadow;
    m.receiveShadow = true;
    return m;
  }, [geometry, material, matrices, castShadow]);
  useEffect(() => () => mesh.dispose(), [mesh]);
  return <primitive object={mesh} />;
}

export function Floors({ shadows }: { shadows: boolean }) {
  const mats = materials();
  const protos = useMemo(buildPrototypes, []);
  const floors = useMemo(() => Array.from({ length: FLOOR_COUNT }, (_, f) => buildFloorGeometry(f)), []);
  const groups = useRef<(THREE.Group | null)[]>([]);
  const ceilings = useRef<(THREE.Group | null)[]>([]);
  const shadowMat = useMemo(() => new THREE.MeshBasicMaterial({ map: T.softRect(), transparent: true, depthWrite: false, opacity: 0.55, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), []);
  const shadowGeo = useMemo(() => new THREE.PlaneGeometry(1, 1), []);

  useEffect(() => () => {
    for (const f of floors) {
      for (const g of f.base.values()) g.dispose();
      for (const g of f.ceiling.values()) g.dispose();
    }
    for (const p of protos.values()) for (const g of p.values()) g.dispose();
    shadowMat.dispose();
    shadowGeo.dispose();
  }, [floors, protos, shadowMat, shadowGeo]);

  useFrame(() => {
    for (let f = 0; f < FLOOR_COUNT; f++) {
      const g = groups.current[f];
      if (g) g.visible = vis.floors[f];
      const c = ceilings.current[f];
      if (c) c.visible = vis.ceilings[f];
    }
  });

  return (
    <>
      {floors.map((fg) => (
        <group key={fg.floor} ref={(el) => { groups.current[fg.floor] = el; }} name={`floor-${fg.floor}`}>
          {[...fg.base.entries()].map(([k, g]) => (
            <mesh key={k} geometry={g} material={mats[k]} castShadow={shadows && k !== 'glass' && k !== 'glassDark'} receiveShadow renderOrder={k === 'glass' || k === 'glassDark' ? 2 : 0} />
          ))}
          <group ref={(el) => { ceilings.current[fg.floor] = el; }}>
            {[...fg.ceiling.entries()].map(([k, g]) => (
              <mesh key={k} geometry={g} material={mats[k]} castShadow={shadows} receiveShadow />
            ))}
            {[...fg.instances.entries()].filter(([key]) => key.startsWith('light:')).flatMap(([key, mx]) =>
              [...(protos.get(key)?.entries() ?? [])].map(([mk, geo]) => <Instanced key={`${key}-${mk}`} geometry={geo} material={mats[mk as MatKey]} matrices={mx} />),
            )}
          </group>
          {[...fg.instances.entries()].filter(([key]) => !key.startsWith('light:')).flatMap(([key, mx]) =>
            [...(protos.get(key)?.entries() ?? [])].map(([mk, geo]) => <Instanced key={`${key}-${mk}`} geometry={geo} material={mats[mk as MatKey]} matrices={mx} castShadow={shadows} />),
          )}
          <Instanced geometry={shadowGeo} material={shadowMat} matrices={fg.shadows} />
        </group>
      ))}
    </>
  );
}
