// CCTV wall in the chairman's office: a 3 x 3 grid of live room cameras rendered into one texture (one tile
// per frame, so each camera refreshes several times a second), two pages of nine that alternate, with name
// strips, time and REC drawn on a transparent overlay. Opening it (or a tile) switches the main view to that
// camera full screen (see CameraController / CctvPanel).
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { FLOOR_H, roomAt } from '../world/building';
import { CCTV_CAMERAS, CCTV_PAGE } from '../world/cctv';
import { getSim } from '../store/simInstance';
import { player } from '../store/player';
import { useUI } from '../store/ui';
import { vis } from './visibility';

/** On the chairman's office east wall (to the boardroom), facing the sofa. */
export const CCTV_TV = { x: 9.91, y: 1.62, z: 11.4, w: 2.7, h: 1.52, floor: 2, heading: -Math.PI / 2, roomId: 's-chair' };
const COLS = 3;
const TILE_W = 448, TILE_H = 252;
const PAGE_SECONDS = 15;

export function cctvPage(): number {
  return Math.floor(Date.now() / 1000 / PAGE_SECONDS) % Math.ceil(CCTV_CAMERAS.length / CCTV_PAGE);
}

export function CctvWall() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const rt = useMemo(() => {
    const t = new THREE.WebGLRenderTarget(TILE_W * COLS, TILE_H * COLS, { depthBuffer: true });
    t.texture.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  const overlay = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = TILE_W * COLS;
    c.height = TILE_H * COLS;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return { c, tex };
  }, []);
  const cams = useMemo(() => CCTV_CAMERAS.map((c) => {
    const cam = new THREE.PerspectiveCamera(62, TILE_W / TILE_H, 0.05, 60);
    cam.position.set(c.pos.x, c.pos.y, c.pos.z);
    cam.lookAt(c.target.x, c.target.y, c.target.z);
    cam.updateMatrixWorld();
    return cam;
  }), []);
  const frame = useMemo(() => {
    const g = new THREE.Group();
    g.position.set(CCTV_TV.x, CCTV_TV.floor * FLOOR_H + CCTV_TV.y, CCTV_TV.z);
    g.rotation.y = CCTV_TV.heading;
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(CCTV_TV.w + 0.06, CCTV_TV.h + 0.06, 0.04), new THREE.MeshStandardMaterial({ color: '#111214', roughness: 0.4, metalness: 0.5 }));
    bezel.position.z = -0.012;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(CCTV_TV.w, CCTV_TV.h), new THREE.MeshBasicMaterial({ map: rt.texture, toneMapped: false }));
    screen.position.z = 0.0105;
    const over = new THREE.Mesh(new THREE.PlaneGeometry(CCTV_TV.w, CCTV_TV.h), new THREE.MeshBasicMaterial({ map: overlay.tex, transparent: true, toneMapped: false }));
    over.position.z = 0.0125;
    for (const m of [bezel, screen, over]) { m.userData = { interact: 'cctv', floor: CCTV_TV.floor }; g.add(m); }
    return g;
  }, [rt, overlay]);
  const st = useRef({ floor: -1, settle: 0, order: [] as number[], next: 0, page: -1, lastOverlay: 0 });

  useEffect(() => () => {
    rt.dispose();
    overlay.tex.dispose();
    frame.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } });
    vis.extraFloor = -1;
  }, [rt, overlay, frame]);

  useFrame(() => {
    const ui = useUI.getState();
    frame.visible = vis.floors[CCTV_TV.floor];
    const near = (ui.mode === 'walk' || ui.mode === 'seated') && player.floor === CCTV_TV.floor && roomAt(player.floor, player.x, player.z)?.id === CCTV_TV.roomId;
    const s = st.current;
    const page = cctvPage();
    if (!near || ui.panel?.kind === 'cctv') { vis.extraFloor = -1; s.floor = -1; return; }
    if (page !== s.page) { s.page = page; s.order = []; }
    const now = performance.now();
    if (now - s.lastOverlay > 1000) { s.lastOverlay = now; drawOverlay(overlay.c, page); overlay.tex.needsUpdate = true; }
    // render tiles grouped by floor: ask for that floor to be drawn, give the per-floor visibility two frames
    // to apply, then render its tiles one per frame
    if (!s.order.length) {
      const ids = CCTV_CAMERAS.map((_, i) => i).slice(page * CCTV_PAGE, page * CCTV_PAGE + CCTV_PAGE);
      s.order = ids.sort((a, b) => CCTV_CAMERAS[a].floor - CCTV_CAMERAS[b].floor);
      s.next = 0;
    }
    const idx = s.order[s.next];
    const camDef = CCTV_CAMERAS[idx];
    if (camDef.floor !== s.floor) { s.floor = camDef.floor; s.settle = 2; vis.extraFloor = camDef.floor === CCTV_TV.floor ? -1 : camDef.floor; return; }
    if (s.settle > 0) { s.settle--; return; }
    const slot = idx - page * CCTV_PAGE;
    const col = slot % COLS, row = Math.floor(slot / COLS);
    const y = (COLS - 1 - row) * TILE_H;
    const prevTarget = gl.getRenderTarget();
    const shadowAuto = gl.shadowMap.autoUpdate;
    gl.shadowMap.autoUpdate = false;
    rt.viewport.set(col * TILE_W, y, TILE_W, TILE_H);
    rt.scissor.set(col * TILE_W, y, TILE_W, TILE_H);
    rt.scissorTest = true;
    frame.visible = false;
    gl.setRenderTarget(rt);
    gl.render(scene, cams[idx]);
    gl.setRenderTarget(prevTarget);
    frame.visible = true;
    gl.shadowMap.autoUpdate = shadowAuto;
    s.next = (s.next + 1) % s.order.length;
  });

  return <primitive object={frame} />;
}

function drawOverlay(c: HTMLCanvasElement, page: number) {
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, c.width, c.height);
  const sim = getSim();
  const t = new Date();
  const stamp = `${t.toLocaleDateString()} ${t.toLocaleTimeString()}`;
  for (let slot = 0; slot < CCTV_PAGE; slot++) {
    const cam = CCTV_CAMERAS[page * CCTV_PAGE + slot];
    const x = (slot % COLS) * TILE_W, y = Math.floor(slot / COLS) * TILE_H;
    g.strokeStyle = '#000';
    g.lineWidth = 4;
    g.strokeRect(x, y, TILE_W, TILE_H);
    if (!cam) continue;
    const inRoom = sim.employees.filter((e) => e.phase !== 'away' && roomAt(e.floor, e.x, e.z)?.id === cam.roomId).length;
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillRect(x + 6, y + TILE_H - 40, TILE_W - 12, 34);
    g.fillStyle = '#fff';
    g.font = '600 20px "Segoe UI", Arial, sans-serif';
    g.textBaseline = 'middle';
    const name = cam.label.split(' · ')[0];
    const right = `${['G', '1F', '2F'][cam.floor]} · ${inRoom} ${inRoom === 1 ? 'person' : 'people'}`;
    g.font = '600 18px "Segoe UI", Arial, sans-serif';
    const rw = g.measureText(right).width;
    let fs = 21;
    g.font = `700 ${fs}px "Segoe UI", Arial, sans-serif`;
    const left = `${cam.id.toUpperCase()} ${name}`;
    while (g.measureText(left).width > TILE_W - rw - 44 && fs > 13) { fs--; g.font = `700 ${fs}px "Segoe UI", Arial, sans-serif`; }
    g.fillText(left, x + 14, y + TILE_H - 23);
    g.textAlign = 'right';
    g.font = '600 18px "Segoe UI", Arial, sans-serif';
    g.fillText(right, x + TILE_W - 14, y + TILE_H - 23);
    g.textAlign = 'left';
    g.fillStyle = '#ff3b30';
    g.beginPath(); g.arc(x + 20, y + 20, 7, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff';
    g.font = '600 16px "Segoe UI", Arial, sans-serif';
    g.fillText('REC', x + 32, y + 21);
  }
  g.fillStyle = 'rgba(0,0,0,0.6)';
  g.fillRect(c.width - 330, 6, 324, 30);
  g.fillStyle = '#fff';
  g.font = '600 18px "Segoe UI", Arial, sans-serif';
  g.textAlign = 'right';
  g.fillText(`${stamp} · page ${page + 1}/2`, c.width - 14, 22);
  g.textAlign = 'left';
}
