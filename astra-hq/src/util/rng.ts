// Deterministic pseudo-random helpers. Every simulated number in the office
// comes from these seeded generators so a given seed always replays the same day.

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash of a string (FNV-1a). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic value in [0,1) for a (seed, key...) tuple, independent of call order. */
export function hashRand(seed: number, ...keys: (string | number)[]): number {
  let h = seed >>> 0;
  for (const k of keys) {
    h = hashString(`${h}:${k}`);
  }
  return mulberry32(h)();
}

/** Standard normal sample from two uniforms (Box-Muller). */
export function gaussian(u1: number, u2: number): number {
  const a = Math.max(u1, 1e-9);
  return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * u2);
}

export function pick<T>(r: number, arr: readonly T[]): T {
  return arr[Math.min(arr.length - 1, Math.floor(r * arr.length))];
}
