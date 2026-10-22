// Shared PBR materials. Every mesh in the building references one of these instances, so the whole
// office uses a few dozen materials regardless of how many objects exist.
import * as THREE from 'three';
import * as T from './textures';

export type MatKey =
  | 'carpet' | 'carpetDark' | 'woodFloor' | 'stone' | 'tile' | 'concrete' | 'raised' | 'paver' | 'asphalt' | 'grass'
  | 'paint' | 'paintWarm' | 'walnut' | 'oak' | 'acoustic' | 'coreWall' | 'ceiling' | 'lightPanel' | 'lightStrip'
  | 'glass' | 'glassDark' | 'frame' | 'aluminium' | 'gold' | 'steel' | 'blackMetal'
  | 'deskTop' | 'deskTopDark' | 'laminateWhite' | 'chairFabric' | 'chairMesh' | 'leather' | 'sofa' | 'sofaAlt' | 'cushionGold'
  | 'quartz' | 'counterFront' | 'leaf' | 'pot' | 'soil' | 'screenOff' | 'plasticDark' | 'plasticLight' | 'whiteboard'
  | 'rack' | 'ledGreen' | 'ledBlue' | 'ledAmber' | 'paper' | 'bookA' | 'bookB' | 'bookC' | 'bookD' | 'spandrel' | 'roof'
  | 'rubber' | 'ceramic' | 'mirror' | 'rug' | 'rugAlt' | 'water' | 'fridge' | 'stairTread' | 'signDark';

/** World-space metres per texture repeat for materials with maps. */
export const UV_SCALE: Partial<Record<MatKey, number>> = {
  carpet: 2, carpetDark: 2, woodFloor: 2.4, stone: 2.4, tile: 1.6, concrete: 3, raised: 1.2, paver: 4, ceiling: 1.2,
  walnut: 1.6, oak: 1.6, acoustic: 1.2, coreWall: 3, chairFabric: 0.5, sofa: 0.8, sofaAlt: 0.8, leaf: 0.6, deskTopDark: 1.6,
  rug: 1.2, rugAlt: 1.2, stairTread: 2.4, quartz: 2.4, counterFront: 1.6,
};

let mats: Record<MatKey, THREE.Material> | null = null;

function std(p: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial(p);
}

export function materials(): Record<MatKey, THREE.Material> {
  if (mats) return mats;
  const glass = new THREE.MeshPhysicalMaterial({
    color: '#dfeef2', metalness: 0, roughness: 0.04, transparent: true, opacity: 0.16, envMapIntensity: 1.4,
    side: THREE.DoubleSide, depthWrite: false, clearcoat: 1, clearcoatRoughness: 0.05,
  });
  const glassDark = new THREE.MeshPhysicalMaterial({
    color: '#9fb3bd', metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.32, envMapIntensity: 1.6,
    side: THREE.DoubleSide, depthWrite: false,
  });
  mats = {
    carpet: std({ map: T.carpet('#6f6c68', 'warm'), roughness: 0.97 }),
    carpetDark: std({ map: T.carpet('#3f4146', 'dark'), roughness: 0.97 }),
    woodFloor: std({ map: T.wood('#8a6446', 'floor', 10), roughness: 0.48 }),
    stone: std({ map: T.stone('#b3aa9c', 'lobby'), roughness: 0.32, metalness: 0.0, envMapIntensity: 0.4 }),
    tile: std({ map: T.tile('#d9d6d0', 'wc'), roughness: 0.35 }),
    concrete: std({ map: T.concrete('#a5a29d', 'floor'), roughness: 0.85 }),
    raised: std({ map: T.raisedFloor(), roughness: 0.6, metalness: 0.2 }),
    paver: std({ map: T.pavers(), roughness: 0.85 }),
    asphalt: std({ color: '#2f3033', roughness: 0.92 }),
    grass: std({ color: '#4b6a3e', roughness: 1 }),
    paint: std({ color: '#e3ded5', roughness: 0.9 }),
    paintWarm: std({ color: '#e2dbcf', roughness: 0.9 }),
    walnut: std({ map: T.wood('#5a3b28', 'walnut', 6), roughness: 0.42 }),
    oak: std({ map: T.wood('#b69772', 'oak', 6), roughness: 0.5 }),
    acoustic: std({ map: T.acoustic(), roughness: 1 }),
    coreWall: std({ map: T.concrete('#c9c5bd', 'core'), roughness: 0.8 }),
    ceiling: std({ map: T.ceilingTile(), color: '#e8e5df', roughness: 0.95 }),
    lightPanel: std({ color: '#ffffff', emissive: '#fff7ea', emissiveIntensity: 1.6, roughness: 0.4 }),
    lightStrip: std({ color: '#ffffff', emissive: '#ffe9c4', emissiveIntensity: 2.2, roughness: 0.4 }),
    glass,
    glassDark,
    frame: std({ color: '#2a2c2f', metalness: 0.8, roughness: 0.35 }),
    aluminium: std({ map: T.brushed(), color: '#c4c7cb', metalness: 0.9, roughness: 0.32 }),
    gold: std({ color: '#c9a45c', metalness: 1, roughness: 0.28 }),
    steel: std({ map: T.brushed(), color: '#b8bcc2', metalness: 1, roughness: 0.25 }),
    blackMetal: std({ color: '#1c1d20', metalness: 0.7, roughness: 0.45 }),
    deskTop: std({ color: '#e7e1d6', roughness: 0.45 }),
    deskTopDark: std({ map: T.wood('#4b3222', 'desk', 4), roughness: 0.38 }),
    laminateWhite: std({ color: '#f2f0ec', roughness: 0.5 }),
    chairFabric: std({ map: T.fabric('#2d2f34', 'chair'), roughness: 0.95 }),
    chairMesh: std({ color: '#18191c', roughness: 0.7, metalness: 0.1 }),
    leather: std({ color: '#2a201b', roughness: 0.55 }),
    sofa: std({ map: T.fabric('#7b7f86', 'sofa'), roughness: 0.95 }),
    sofaAlt: std({ map: T.fabric('#8a6f5a', 'sofa2'), roughness: 0.95 }),
    cushionGold: std({ map: T.fabric('#b9924f', 'cushion'), roughness: 0.9 }),
    quartz: std({ map: T.stone('#efece6', 'quartz', false), roughness: 0.22 }),
    counterFront: std({ map: T.wood('#3d2a1e', 'front', 12), roughness: 0.5 }),
    leaf: std({ map: T.leaves(), color: '#ffffff', roughness: 0.8, side: THREE.DoubleSide }),
    pot: std({ color: '#2b2b2d', roughness: 0.55, metalness: 0.2 }),
    soil: std({ color: '#3a2c22', roughness: 1 }),
    screenOff: std({ color: '#0b0c0e', roughness: 0.15, metalness: 0.3 }),
    plasticDark: std({ color: '#1e1f22', roughness: 0.55 }),
    plasticLight: std({ color: '#d9d9d6', roughness: 0.5 }),
    whiteboard: std({ color: '#f6f6f3', roughness: 0.25 }),
    rack: std({ color: '#1b1d21', metalness: 0.6, roughness: 0.45 }),
    ledGreen: std({ color: '#2aff7a', emissive: '#2aff7a', emissiveIntensity: 2.4 }),
    ledBlue: std({ color: '#4aa8ff', emissive: '#4aa8ff', emissiveIntensity: 2.4 }),
    ledAmber: std({ color: '#ffb02a', emissive: '#ffb02a', emissiveIntensity: 2.4 }),
    paper: std({ color: '#f4f2ec', roughness: 0.9 }),
    bookA: std({ color: '#7a2f2a', roughness: 0.8 }),
    bookB: std({ color: '#263a52', roughness: 0.8 }),
    bookC: std({ color: '#c8b48a', roughness: 0.8 }),
    bookD: std({ color: '#2e4a3a', roughness: 0.8 }),
    spandrel: std({ color: '#2b2d31', metalness: 0.55, roughness: 0.38 }),
    roof: std({ map: T.concrete('#5d5f63', 'roof'), roughness: 0.9 }),
    rubber: std({ color: '#141414', roughness: 0.9 }),
    ceramic: std({ color: '#f7f7f5', roughness: 0.15 }),
    mirror: std({ color: '#d8e2e6', metalness: 1, roughness: 0.04 }),
    rug: std({ map: T.carpet('#5a4f45', 'rug'), roughness: 1 }),
    rugAlt: std({ map: T.carpet('#2f3a46', 'rug2'), roughness: 1 }),
    water: std({ color: '#9cc8e8', roughness: 0.1, transparent: true, opacity: 0.6 }),
    fridge: std({ color: '#c9ccd0', metalness: 0.8, roughness: 0.3 }),
    stairTread: std({ map: T.stone('#d8d3ca', 'tread', false), roughness: 0.35 }),
    signDark: std({ color: '#1d1f23', roughness: 0.4, metalness: 0.4 }),
  };
  return mats;
}

/** Apply lighting mood to emissive materials (night makes interior lights brighter relative to sky). */
export function setLightMood(night: number) {
  const m = materials();
  (m.lightPanel as THREE.MeshStandardMaterial).emissiveIntensity = 1.3 + night * 1.2;
  (m.lightStrip as THREE.MeshStandardMaterial).emissiveIntensity = 1.8 + night * 1.6;
}

export function disposeMaterials() {
  if (!mats) return;
  for (const m of Object.values(mats)) m.dispose();
  mats = null;
}
