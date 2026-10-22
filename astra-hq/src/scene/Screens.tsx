// In-world screens. Each monitor/wall display is a plane with its own small canvas texture, redrawn
// from the shared simulation through the same AppView builder used by the HTML panels. A per-frame
// budget refreshes nearby screens often, distant screens rarely, and hidden floors never.
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { drawAppView, drawLogo } from '../apps/canvasRender';
import { buildAppView, buildPanelView } from '../apps/views';
import { FLOOR_H } from '../world/building';
import { MONITORS, PANELS, type MonitorDef, type WallPanel } from '../world/furniture';
import { getSim } from '../store/simInstance';
import { useUI } from '../store/ui';
import type { Quality } from './quality';
import { vis } from './visibility';

interface ScreenEntry {
  kind: 'monitor' | 'panel';
  id: string;
  floor: number;
  pos: THREE.Vector3;
  mesh: THREE.Mesh;
  canvas: HTMLCanvasElement;
  tex: THREE.CanvasTexture;
  lastDraw: number;
  lastMinute: number;
  lastKey: string;
  w: number;
  h: number;
}

/** Registry so the HTML panel can force a redraw and read what was last drawn (sync checks). */
export const screenRegistry = new Map<string, ScreenEntry>();
export const lastDrawn = new Map<string, { minute: number; tab: number; title: string; version: number }>();
let forceIds = new Set<string>();
export function forceRedraw(id: string) {
  forceIds.add(id);
}

function panelSize(p: WallPanel, q: Quality): [number, number] {
  const scale = q.monitorRes[0] / 512;
  if (p.kind === 'marketWall') return [Math.round(2048 * Math.max(0.6, scale)), Math.round(348 * Math.max(0.6, scale))];
  if (p.kind === 'logo') return [1024, Math.round(1024 * (p.h / p.w))];
  const aspect = p.w / p.h;
  const w = Math.round(Math.min(1024, Math.max(384, p.w * 340)) * Math.max(0.6, scale));
  return [w, Math.round(w / aspect)];
}

export function Screens({ quality, companyName }: { quality: Quality; companyName: string }) {
  const camera = useThree((s) => s.camera);
  const entries = useMemo(() => {
    const list: ScreenEntry[] = [];
    const mk = (kind: 'monitor' | 'panel', id: string, floor: number, x: number, y: number, z: number, heading: number, w: number, h: number, cw: number, ch: number, emissive: boolean) => {
      const canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      const g = canvas.getContext('2d')!;
      g.fillStyle = '#0b0c0e';
      g.fillRect(0, 0, cw, ch);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      tex.generateMipmaps = false;
      tex.minFilter = THREE.LinearFilter;
      const mat = emissive
        ? new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })
        : new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35 });
      if (emissive) (mat as THREE.MeshBasicMaterial).color.setScalar(0.92);
      const geo = new THREE.PlaneGeometry(w, h);
      const mesh = new THREE.Mesh(geo, mat);
      const off = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading)).multiplyScalar(kind === 'monitor' ? 0.013 : 0.012);
      mesh.position.set(x + off.x, floor * FLOOR_H + y, z + off.z);
      mesh.rotation.y = heading;
      mesh.userData = kind === 'monitor' ? { interact: 'monitor', id } : { interact: 'wall', id };
      list.push({ kind, id, floor, pos: mesh.position.clone(), mesh, canvas, tex, lastDraw: -1, lastMinute: -1, lastKey: '', w: cw, h: ch });
    };
    for (const m of MONITORS as MonitorDef[]) mk('monitor', m.id, m.floor, m.x, m.y, m.z, m.heading, m.w, m.h, quality.monitorRes[0], Math.round(quality.monitorRes[0] * (m.h / m.w)), true);
    for (const p of PANELS) {
      const [cw, ch] = panelSize(p, quality);
      mk('panel', p.id, p.floor, p.x, p.y, p.z, p.heading, p.w, p.h, cw, ch, p.kind !== 'whiteboard' && p.kind !== 'logo');
    }
    return list;
  }, [quality]);

  useEffect(() => {
    screenRegistry.clear();
    for (const e of entries) screenRegistry.set(e.id, e);
    return () => {
      for (const e of entries) {
        e.tex.dispose();
        e.mesh.geometry.dispose();
        (e.mesh.material as THREE.Material).dispose();
      }
      screenRegistry.clear();
    };
  }, [entries]);

  // logos are static: redraw only when the company name changes
  useEffect(() => {
    for (const e of entries) {
      const p = PANELS.find((x) => x.id === e.id);
      if (p?.kind === 'logo') {
        const g = e.canvas.getContext('2d')!;
        drawLogo(g, e.w, e.h, companyName, { bg: p.id === 'p-logo-reception' ? '#1d1f23' : undefined, color: '#d6b46e', sub: p.id === 'p-logo-reception' ? 'HEADQUARTERS · OFFICE SIMULATION' : undefined });
        e.tex.needsUpdate = true;
        e.lastKey = 'logo';
      }
    }
  }, [entries, companyName]);

  useFrame((state) => {
    const sim = getSim();
    const now = state.clock.elapsedTime;
    const ui = useUI.getState();
    const focusId = ui.panel?.kind === 'monitor' ? ui.panel.monitorId : ui.panel?.kind === 'wall' ? ui.panel.panelId : null;
    for (const e of entries) e.mesh.visible = vis.floors[e.floor];
    // candidates sorted by need
    let budget = quality.monitorUpdatesPerFrame;
    const due: { e: ScreenEntry; score: number }[] = [];
    for (const e of entries) {
      if (e.lastKey === 'logo') continue;
      const forced = forceIds.has(e.id);
      if (!vis.floors[e.floor] && !forced && e.id !== focusId) continue;
      const d = camera.position.distanceTo(e.pos);
      if (d > quality.monitorMax && !forced && e.id !== focusId && e.lastDraw >= 0) continue;
      const interval = e.id === focusId ? 0.5 : d < quality.monitorNear ? quality.monitorNearInterval : quality.monitorFarInterval;
      const age = now - e.lastDraw;
      if (!forced && age < interval) continue;
      // never-drawn screens first (nearest first), then the most overdue relative to their interval
      const score = forced ? 1e9 : e.lastDraw < 0 ? 1e6 - d * 100 : age / interval - d * 0.01;
      due.push({ e, score });
    }
    due.sort((a, b) => b.score - a.score);
    for (const { e } of due) {
      if (budget <= 0 && !forceIds.has(e.id)) break;
      draw(e, sim.version);
      e.lastDraw = now;
      budget--;
    }
    forceIds = new Set();
  });

  function draw(e: ScreenEntry, version: number) {
    const sim = getSim();
    const g = e.canvas.getContext('2d')!;
    const view = e.kind === 'monitor' ? buildAppView(sim, e.id) : buildPanelView(sim, e.id, companyName);
    drawAppView(g, view, e.w, e.h);
    e.tex.needsUpdate = true;
    e.lastMinute = view.minute;
    lastDrawn.set(e.id, { minute: view.minute, tab: view.tab, title: view.title, version });
  }

  return <group name="screens">{entries.map((e) => <primitive key={e.id} object={e.mesh} />)}</group>;
}
