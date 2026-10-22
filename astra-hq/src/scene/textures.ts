// Procedurally generated textures (canvas). No external image assets are needed, so there is
// nothing to license or download at runtime.
import * as THREE from 'three';
import { mulberry32 } from '../util/rng';

type Draw = (g: CanvasRenderingContext2D, s: number, r: () => number) => void;

const cache = new Map<string, THREE.CanvasTexture>();

function make(key: string, size: number, draw: Draw, opts: { repeat?: boolean; srgb?: boolean; aniso?: number } = {}): THREE.CanvasTexture {
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  draw(g, size, mulberry32(key.length * 7919 + size));
  const t = new THREE.CanvasTexture(c);
  if (opts.repeat !== false) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.anisotropy = opts.aniso ?? 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  cache.set(key, t);
  return t;
}

function noise(g: CanvasRenderingContext2D, s: number, r: () => number, n: number, alpha: number, light: boolean, size = 1) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = light ? `rgba(255,255,255,${alpha * r()})` : `rgba(0,0,0,${alpha * r()})`;
    g.fillRect(r() * s, r() * s, size, size);
  }
}

/** Carpet tiles: 0.5 m tiles with a subtle directional weave. One texture repeat = 2 m (4x4 tiles). */
export const carpet = (base: string, key: string) =>
  make(`carpet-${key}`, 512, (g, s, r) => {
    g.fillStyle = base;
    g.fillRect(0, 0, s, s);
    noise(g, s, r, 26000, 0.12, false);
    noise(g, s, r, 16000, 0.06, true);
    const t = s / 4;
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        g.fillStyle = (x + y) % 2 ? 'rgba(0,0,0,0.018)' : 'rgba(255,255,255,0.01)';
        g.fillRect(x * t, y * t, t, t);
        g.strokeStyle = 'rgba(0,0,0,0.07)';
        g.lineWidth = 1;
        g.strokeRect(x * t + 0.5, y * t + 0.5, t - 1, t - 1);
        for (let k = 0; k < 18; k++) {
          g.strokeStyle = 'rgba(255,255,255,0.012)';
          const yy = y * t + (k / 18) * t;
          g.beginPath();
          if ((x + y) % 2) { g.moveTo(x * t, yy); g.lineTo(x * t + t, yy); } else { g.moveTo(x * t + (k / 18) * t, y * t); g.lineTo(x * t + (k / 18) * t, y * t + t); }
          g.stroke();
        }
      }
    }
  });

/** Wood planks / veneer. One repeat = 2 m. */
export const wood = (base: string, key: string, planks = 8) =>
  make(`wood-${key}`, 512, (g, s, r) => {
    g.fillStyle = base;
    g.fillRect(0, 0, s, s);
    const pw = s / planks;
    for (let p = 0; p < planks; p++) {
      const shade = (r() - 0.5) * 0.14;
      g.fillStyle = shade > 0 ? `rgba(255,240,220,${shade})` : `rgba(30,15,5,${-shade})`;
      g.fillRect(p * pw, 0, pw, s);
      for (let k = 0; k < 26; k++) {
        const x = p * pw + r() * pw;
        g.strokeStyle = `rgba(40,20,8,${0.05 + r() * 0.1})`;
        g.lineWidth = 0.6 + r() * 1.4;
        g.beginPath();
        g.moveTo(x, 0);
        for (let y = 0; y <= s; y += 32) g.lineTo(x + Math.sin(y / (40 + r() * 30) + k) * 2.5, y);
        g.stroke();
      }
      g.fillStyle = 'rgba(20,10,4,0.35)';
      g.fillRect(p * pw, 0, 1.2, s);
      const cut = r() * s;
      g.fillRect(p * pw, cut, pw, 1);
    }
  });

/** Polished stone with soft veining. One repeat = 2.4 m. */
export const stone = (base: string, key: string, veins = true) =>
  make(`stone-${key}`, 512, (g, s, r) => {
    g.fillStyle = base;
    g.fillRect(0, 0, s, s);
    noise(g, s, r, 20000, 0.05, false, 2);
    noise(g, s, r, 20000, 0.05, true, 2);
    if (veins) {
      for (let v = 0; v < 7; v++) {
        g.strokeStyle = `rgba(90,85,80,${0.07 + r() * 0.08})`;
        g.lineWidth = 0.5 + r() * 1.5;
        g.beginPath();
        let x = r() * s;
        let y = 0;
        g.moveTo(x, y);
        while (y < s) { x += (r() - 0.5) * 30; y += 10 + r() * 20; g.lineTo(x, y); }
        g.stroke();
      }
    }
    const t = s / 2;
    g.strokeStyle = 'rgba(0,0,0,0.10)';
    for (let i = 0; i <= 2; i++) { g.beginPath(); g.moveTo(i * t, 0); g.lineTo(i * t, s); g.stroke(); g.beginPath(); g.moveTo(0, i * t); g.lineTo(s, i * t); g.stroke(); }
  });

export const tile = (base: string, key: string, n = 8) =>
  make(`tile-${key}`, 512, (g, s, r) => {
    g.fillStyle = '#c9c6c0';
    g.fillRect(0, 0, s, s);
    const t = s / n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const v = (r() - 0.5) * 10;
      g.fillStyle = base;
      g.fillRect(x * t + 1.5, y * t + 1.5, t - 3, t - 3);
      g.fillStyle = v > 0 ? `rgba(255,255,255,${v / 60})` : `rgba(0,0,0,${-v / 60})`;
      g.fillRect(x * t + 1.5, y * t + 1.5, t - 3, t - 3);
    }
  });

export const concrete = (base: string, key: string) =>
  make(`concrete-${key}`, 512, (g, s, r) => {
    g.fillStyle = base;
    g.fillRect(0, 0, s, s);
    noise(g, s, r, 30000, 0.08, false, 2);
    noise(g, s, r, 20000, 0.06, true, 2);
    for (let i = 0; i < 30; i++) {
      g.fillStyle = `rgba(0,0,0,${r() * 0.04})`;
      g.beginPath();
      g.arc(r() * s, r() * s, 10 + r() * 50, 0, Math.PI * 2);
      g.fill();
    }
  });

export const raisedFloor = () =>
  make('raised', 256, (g, s, r) => {
    g.fillStyle = '#9da2a6';
    g.fillRect(0, 0, s, s);
    noise(g, s, r, 6000, 0.08, false);
    const t = s / 2;
    g.strokeStyle = '#5d6165';
    g.lineWidth = 3;
    for (let i = 0; i <= 2; i++) { g.beginPath(); g.moveTo(i * t, 0); g.lineTo(i * t, s); g.stroke(); g.beginPath(); g.moveTo(0, i * t); g.lineTo(s, i * t); g.stroke(); }
    g.fillStyle = 'rgba(0,0,0,0.25)';
    for (let i = 0; i < 4; i++) for (let k = 0; k < 6; k++) g.fillRect(t * 0.2 + k * 8, t * 0.3 + i * 10 + (i > 1 ? t : 0), 4, 4);
  });

/** 0.6 m ceiling tile grid (one repeat = 1.2 m). */
export const ceilingTile = () =>
  make('ceiling', 256, (g, s, r) => {
    g.fillStyle = '#f1efea';
    g.fillRect(0, 0, s, s);
    noise(g, s, r, 9000, 0.05, false);
    g.strokeStyle = '#c9c6bf';
    g.lineWidth = 2.5;
    const t = s / 2;
    for (let i = 0; i <= 2; i++) { g.beginPath(); g.moveTo(i * t, 0); g.lineTo(i * t, s); g.stroke(); g.beginPath(); g.moveTo(0, i * t); g.lineTo(s, i * t); g.stroke(); }
  });

export const fabric = (base: string, key: string) =>
  make(`fabric-${key}`, 256, (g, s, r) => {
    g.fillStyle = base;
    g.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 2) { g.fillStyle = `rgba(0,0,0,${0.04 + r() * 0.05})`; g.fillRect(0, y, s, 1); }
    for (let x = 0; x < s; x += 2) { g.fillStyle = `rgba(255,255,255,${r() * 0.04})`; g.fillRect(x, 0, 1, s); }
    noise(g, s, r, 4000, 0.1, false);
  });

export const acoustic = () =>
  make('acoustic', 256, (g, s, r) => {
    g.fillStyle = '#3a3c40';
    g.fillRect(0, 0, s, s);
    noise(g, s, r, 12000, 0.18, false);
    noise(g, s, r, 6000, 0.06, true);
    const w = s / 4;
    g.fillStyle = 'rgba(0,0,0,0.35)';
    for (let i = 1; i < 4; i++) g.fillRect(i * w - 1, 0, 2, s);
  });

export const brushed = () =>
  make('brushed', 256, (g, s, r) => {
    g.fillStyle = '#8c9096';
    g.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y++) { g.fillStyle = `rgba(${r() > 0.5 ? '255,255,255' : '0,0,0'},${r() * 0.08})`; g.fillRect(0, y, s, 1); }
  }, { srgb: true });

export const pavers = () =>
  make('pavers', 512, (g, s, r) => {
    g.fillStyle = '#8a8682';
    g.fillRect(0, 0, s, s);
    const h = s / 8;
    for (let y = 0; y < 8; y++) {
      const off = (y % 2) * h;
      for (let x = -1; x < 5; x++) {
        const v = (r() - 0.5) * 18;
        g.fillStyle = `rgb(${150 + v},${146 + v},${140 + v})`;
        g.fillRect(x * 2 * h + off + 2, y * h + 2, 2 * h - 4, h - 4);
      }
    }
    noise(g, s, r, 15000, 0.08, false, 2);
  });

/** City facade with window grid; the emissive variant lights a random subset of windows. */
export const facade = (lit: boolean, variant: number) =>
  make(`facade-${lit ? 'lit' : 'day'}-${variant}`, 256, (g, s, r) => {
    const bases = ['#6d7279', '#8a8478', '#575c63', '#7c8288'];
    g.fillStyle = lit ? '#000000' : bases[variant % bases.length];
    g.fillRect(0, 0, s, s);
    const cols = 8;
    const rows = 8;
    const cw = s / cols;
    const rh = s / rows;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      if (lit) {
        const on = r() < 0.38;
        g.fillStyle = on ? (r() < 0.7 ? '#ffd9a0' : '#cfe4ff') : '#000000';
      } else {
        const v = 40 + r() * 30;
        g.fillStyle = `rgb(${v},${v + 8},${v + 16})`;
      }
      g.fillRect(x * cw + cw * 0.15, y * rh + rh * 0.18, cw * 0.7, rh * 0.62);
    }
  }, { aniso: 4 });

export const leaves = () =>
  make('leaves', 256, (g, s, r) => {
    g.fillStyle = '#3c5e34';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 500; i++) {
      g.fillStyle = `rgba(${40 + r() * 50},${80 + r() * 60},${35 + r() * 30},0.8)`;
      g.beginPath();
      g.ellipse(r() * s, r() * s, 4 + r() * 8, 2 + r() * 4, r() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
  });

/** Radial blob used for contact shadows under furniture and people. */
export const blob = () =>
  make('blob', 128, (g, s) => {
    const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grd.addColorStop(0, 'rgba(0,0,0,0.55)');
    grd.addColorStop(0.55, 'rgba(0,0,0,0.25)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, s, s);
  }, { repeat: false });

/** Rectangular soft shadow used under desks, tables and counters. */
export const softRect = () =>
  make('softrect', 128, (g, s) => {
    g.fillStyle = 'rgba(0,0,0,0)';
    g.fillRect(0, 0, s, s);
    g.filter = 'blur(10px)';
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fillRect(s * 0.18, s * 0.18, s * 0.64, s * 0.64);
    g.filter = 'none';
  }, { repeat: false });

export function disposeTextures() {
  for (const t of cache.values()) t.dispose();
  cache.clear();
}
