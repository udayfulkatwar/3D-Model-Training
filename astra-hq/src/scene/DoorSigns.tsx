// Name plates above every room door on the corridor side: room name plus the department that works there.
// The department is taken from the people whose desks are in the room, so editor changes show up here.
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { DOORS, FLOOR_H, FLOOR_NAMES, ROOMS, type DoorDef, type RoomDef } from '../world/building';
import type { Simulation } from '../sim/simulation';
import { vis } from './visibility';

const FALLBACK: Partial<Record<RoomDef['kind'], string>> = {
  reception: 'Front Office', lobby: 'Front Office', cafe: 'Workplace', 'staff-lounge': 'Workplace', server: 'Technology',
  boardroom: 'Executive', office: 'Executive', conference: 'Shared meeting space', meeting: 'Shared meeting space',
  training: 'Learning & Development', interview: 'People & Hiring', restroom: 'Facilities', utility: 'Facilities',
  trading: 'Trading', research: 'Research', risk: 'Risk', pm: 'Portfolio Management', tech: 'Technology', ops: 'Operations',
};

/** Room each door leads into (the side away from the corridor). */
function roomBehind(d: DoorDef): RoomDef | undefined {
  const z = d.at < 7 ? d.at - 0.5 : d.at + 0.5;
  return ROOMS.find((r) => r.floor === d.floor && !r.hidden && d.center >= r.rect.x0 && d.center <= r.rect.x1 && z >= r.rect.z0 && z <= r.rect.z1);
}

export function departmentForRoom(sim: Simulation, room: RoomDef): string {
  const counts = new Map<string, number>();
  for (const e of sim.employees) if (e.ws.roomId === room.id) counts.set(e.cfg.department, (counts.get(e.cfg.department) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return top ? top[0] : FALLBACK[room.kind] ?? '';
}

interface Sign { door: DoorDef; room: RoomDef | null; label: string; mesh: THREE.Mesh; canvas: HTMLCanvasElement; tex: THREE.CanvasTexture }

function draw(c: HTMLCanvasElement, title: string, sub: string) {
  const g = c.getContext('2d')!;
  const W = c.width, H = c.height;
  g.fillStyle = '#1b1d21';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#d0ab62';
  g.fillRect(0, 0, 8, H);
  g.fillRect(0, H - 4, W, 4);
  g.textBaseline = 'middle';
  g.fillStyle = '#f2ede4';
  let fs = 46;
  g.font = `600 ${fs}px "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
  while (g.measureText(title.toUpperCase()).width > W - 44 && fs > 22) { fs -= 2; g.font = `600 ${fs}px "Segoe UI", "Helvetica Neue", Arial, sans-serif`; }
  g.fillText(title.toUpperCase(), 28, sub ? H * 0.38 : H / 2);
  if (sub) {
    g.fillStyle = '#c9b48a';
    g.font = `500 26px "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
    g.fillText(sub, 28, H * 0.74);
  }
}

export function DoorSigns({ sim, version }: { sim: Simulation; version: string }) {
  const signs = useMemo(() => {
    const list: Sign[] = [];
    for (const d of DOORS) {
      if (d.kind === 'auto' || d.kind === 'elevator' || d.axis !== 'x') continue;
      const stair = d.id.endsWith('-stair');
      const room = stair ? null : roomBehind(d) ?? null;
      if (!stair && !room) continue;
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 128;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4, metalness: 0.2, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.25 });
      const w = Math.max(0.9, Math.min(1.5, d.width + 0.4));
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), mat);
      // corridor side: +z for rooms north of the corridor (wall at z 6.0), -z for rooms south of it (z 8.4)
      const corridorPlus = d.at < 7;
      const half = d.id.endsWith('-stair') ? 0.11 : 0.085;
      mesh.position.set(d.center, d.floor * FLOOR_H + 2.62, d.at + (corridorPlus ? half : -half));
      mesh.rotation.y = corridorPlus ? 0 : Math.PI;
      mesh.userData = { doorSign: d.id };
      list.push({ door: d, room, label: room?.name ?? 'Stairs', mesh, canvas, tex });
    }
    return list;
  }, []);

  useEffect(() => {
    for (const s of signs) {
      if (!s.room) draw(s.canvas, 'Stairs', `${FLOOR_NAMES[s.door.floor]} · all floors`);
      else {
        const dept = departmentForRoom(sim, s.room);
        const sub = [dept && dept.toLowerCase() !== s.room.name.toLowerCase() ? dept : '', FLOOR_NAMES[s.room.floor]].filter(Boolean).join(' · ');
        draw(s.canvas, s.room.name.replace('Founder / CEO Office', 'CEO Office'), sub);
      }
      s.tex.needsUpdate = true;
    }
  }, [signs, sim, version]);

  useEffect(() => () => {
    for (const s of signs) { s.tex.dispose(); s.mesh.geometry.dispose(); (s.mesh.material as THREE.Material).dispose(); }
  }, [signs]);

  useFrame(() => {
    for (const s of signs) s.mesh.visible = vis.floors[s.door.floor];
  });
  return <group name="door-signs">{signs.map((s) => <primitive key={s.door.id} object={s.mesh} />)}</group>;
}
