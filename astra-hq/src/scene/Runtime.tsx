// Per-frame runtime glue: advances the one simulation clock, publishes a throttled version number to
// React, collects render statistics, drives ambient audio, and projects employee labels.
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { getSim } from '../store/simInstance';
import { useUI } from '../store/ui';
import { ACTIVITY_COLOR, ACTIVITY_LABEL } from '../sim/simulation';
import { playSound, setAmbienceLevel } from '../audio/sound';
import { vis } from './visibility';
import { roomAt } from '../world/building';
import { CCTV_CAMERAS } from '../world/cctv';

export function SimDriver() {
  const last = useRef(-1);
  const acc = useRef(0);
  const audioT = useRef(0);
  const lastLift = useRef('');
  useFrame((_, dt) => {
    const sim = getSim();
    sim.realtime = useUI.getState().settings.realtimeClock;
    sim.tick(dt);
    acc.current += dt;
    if (acc.current > 0.25 && sim.version !== last.current) {
      acc.current = 0;
      last.current = sim.version;
      useUI.getState().bumpSim(sim.version);
    }
    // lift chime when the car arrives at the player's floor
    const l = sim.dyn.lift;
    const key = `${l.phase}-${l.floor}`;
    if (key !== lastLift.current) {
      if (l.phase === 'opening' && lastLift.current.startsWith('moving')) playSound('ding', 0.8);
      lastLift.current = key;
    }
    // ambience + keyboard clicks from nearby typists
    audioT.current -= dt;
    if (audioT.current <= 0) {
      audioT.current = 0.12;
      const p = sim.player;
      if (p) {
        let near = 0;
        let typing = 0;
        for (const e of sim.employees) {
          if (e.phase === 'away' || Math.abs(e.y - p.y) > 2) continue;
          const d = Math.hypot(e.x - p.x, e.z - p.z);
          if (d < 10) near++;
          if (d < 5 && e.pose === 'sitType') typing += 1 - d / 5;
        }
        setAmbienceLevel(Math.min(1, near / 12));
        if (!sim.paused && typing > 0 && Math.random() < Math.min(0.9, typing * 0.5)) playSound('key', Math.min(1, typing) * 0.6);
      }
    }
  });
  return null;
}

export function StatsProbe() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const frames = useRef(0);
  const t = useRef(0);
  const last = useRef({ calls: 0, triangles: 0 });
  useEffect(() => {
    // accumulate across all passes of a frame (shadow maps, post-processing), reset once per frame below
    gl.info.autoReset = false;
    return () => { gl.info.autoReset = true; };
  }, [gl]);
  // runs before everything else in the frame: capture the previous frame's totals, then reset
  useFrame(() => {
    last.current = { calls: gl.info.render.calls, triangles: gl.info.render.triangles };
    gl.info.reset();
  }, -100);
  useFrame((_, dt) => {
    frames.current++;
    t.current += dt;
    if (t.current >= 1) {
      const ui = useUI.getState();
      ui.setFps(Math.round(frames.current / t.current));
      const info = gl.info;
      ui.setRenderStats({ calls: last.current.calls, triangles: last.current.triangles, textures: info.memory.textures, geometries: info.memory.geometries });
      frames.current = 0;
      t.current = 0;
    }
  });
  useEffect(() => {
    const w = window as unknown as { __astra?: Record<string, unknown> };
    w.__astra = { ...(w.__astra ?? {}), gl, scene };
  }, [gl, scene]);
  return null;
}

/** Name/activity labels as an HTML overlay positioned each frame (no React re-render). */
export function Labels({ container }: { container: HTMLDivElement | null }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const els = useRef<HTMLDivElement[]>([]);
  const lastText = useRef<string[]>([]);
  useEffect(() => {
    if (!container) return;
    container.innerHTML = '';
    els.current = getSim().employees.map(() => {
      const d = document.createElement('div');
      d.className = 'emp-label';
      container.appendChild(d);
      return d;
    });
    lastText.current = [];
    return () => { container.innerHTML = ''; els.current = []; };
  }, [container, getSim().employees.length]);
  const v = new THREE.Vector3();
  useFrame(() => {
    const ui = useUI.getState();
    const sim = getSim();
    const show = ui.settings.labels && ui.mode !== 'intro';
    const radius = ui.mode === 'walk' || ui.mode === 'seated' ? 16 : ui.mode === 'overview' ? 26 : 30;
    const selected = ui.panel?.kind === 'employee' ? ui.panel.id : ui.followId;
    // a CCTV camera only labels the people in the room it watches (labels would otherwise show through walls)
    const cctvRoom = ui.panel?.kind === 'cctv' && !ui.panelMin ? CCTV_CAMERAS[ui.panel.cam]?.roomId : undefined;
    sim.employees.forEach((e, i) => {
      const el = els.current[i];
      if (!el) return;
      const f = Math.max(0, Math.min(2, Math.floor((e.y + 0.3) / 4)));
      const head = e.phase === 'seated' ? e.y + 0.95 : e.y + 2.05;
      v.set(e.x, head, e.z);
      const d = camera.position.distanceTo(v);
      v.project(camera);
      const onFocus = vis.interior || ui.mode !== 'overview' ? f === vis.focusFloor : ui.overviewFloor < 3 && f === ui.overviewFloor;
      const visible = show && e.phase !== 'away' && vis.floors[f] && (d < radius || e.cfg.id === selected) && v.z < 1 && v.z > -1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 && (onFocus || e.cfg.id === selected) && (!cctvRoom || roomAt(e.floor, e.x, e.z)?.id === cctvRoom);
      if (!visible) { if (el.style.display !== 'none') el.style.display = 'none'; return; }
      el.style.display = '';
      const x = (v.x * 0.5 + 0.5) * size.width;
      const y = (-v.y * 0.5 + 0.5) * size.height;
      el.style.transform = `translate(-50%, -100%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      el.style.opacity = String(Math.max(0.35, 1 - d / radius));
      const text = `${e.cfg.name}|${ACTIVITY_LABEL[e.activity]}`;
      if (lastText.current[i] !== text) {
        lastText.current[i] = text;
        el.innerHTML = `<b>${escapeHtml(e.cfg.name)}</b><span style="color:${ACTIVITY_COLOR[e.activity]}">● ${ACTIVITY_LABEL[e.activity]}</span>`;
      }
    });
  });
  return null;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
