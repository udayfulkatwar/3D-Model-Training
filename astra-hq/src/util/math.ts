export interface Vec2 { x: number; z: number }
export interface Vec3 { x: number; y: number; z: number }

export interface Rect { x0: number; z0: number; x1: number; z1: number }

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function inRect(r: Rect, x: number, z: number, pad = 0): boolean {
  return x >= r.x0 - pad && x <= r.x1 + pad && z >= r.z0 - pad && z <= r.z1 + pad;
}

export function rectCenter(r: Rect): Vec2 {
  return { x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 };
}

export function dist2(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Shortest signed angle difference b - a in radians. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Heading (rotation about +Y) that makes a model facing +Z look along (dx, dz). */
export function headingOf(dx: number, dz: number): number {
  return Math.atan2(dx, dz);
}

export function fmtMoney(v: number, digits = 1): string {
  const s = v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(digits)}bn`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(digits)}m`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(digits)}k`;
  return `${s}$${a.toFixed(0)}`;
}

export function fmtPct(v: number, digits = 2): string {
  return `${v >= 0 ? '+' : ''}${(v * 100).toFixed(digits)}%`;
}

export function fmtNum(v: number, digits = 0): string {
  return v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtTime(simMinutes: number): string {
  const m = Math.floor(simMinutes) % (24 * 60);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
