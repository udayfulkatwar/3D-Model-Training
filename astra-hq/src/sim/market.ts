// Seeded simulated market of FICTIONAL instruments. Prices advance once per simulated minute from a
// hash of (seed, day, minute), so the same seed always produces the same tape regardless of frame rate.
import { gaussian, hashRand } from '../util/rng';
import type { BookId } from '../config/types';

export type InstrumentKind = 'equity' | 'future' | 'fx' | 'bond' | 'index';

export interface Instrument {
  sym: string;
  name: string;
  kind: InstrumentKind;
  sector: string;
  book: BookId;
  px0: number;
  /** Daily volatility (fraction). */
  vol: number;
  /** Contract multiplier: notional = qty * price * mult. */
  mult: number;
  decimals: number;
}

export const INSTRUMENTS: Instrument[] = [
  { sym: 'AURX', name: 'Aurex Systems', kind: 'equity', sector: 'Technology', book: 'eq', px0: 184.2, vol: 0.019, mult: 1, decimals: 2 },
  { sym: 'ORBL', name: 'Orbital Semiconductors', kind: 'equity', sector: 'Technology', book: 'eq', px0: 96.75, vol: 0.024, mult: 1, decimals: 2 },
  { sym: 'MRDN', name: 'Meridian Health', kind: 'equity', sector: 'Healthcare', book: 'eq', px0: 63.1, vol: 0.013, mult: 1, decimals: 2 },
  { sym: 'KSTL', name: 'Kestrel Logistics', kind: 'equity', sector: 'Industrials', book: 'eq', px0: 41.85, vol: 0.016, mult: 1, decimals: 2 },
  { sym: 'VNTA', name: 'Vanta Retail', kind: 'equity', sector: 'Consumer', book: 'eq', px0: 28.4, vol: 0.021, mult: 1, decimals: 2 },
  { sym: 'HLNE', name: 'Helion Energy', kind: 'equity', sector: 'Energy', book: 'eq', px0: 52.6, vol: 0.02, mult: 1, decimals: 2 },
  { sym: 'SX5F', name: 'SIM Equity Index Future', kind: 'index', sector: 'Index', book: 'macro', px0: 5120, vol: 0.011, mult: 50, decimals: 1 },
  { sym: 'TY10', name: 'SIM 10Y Bond Future', kind: 'future', sector: 'Rates', book: 'macro', px0: 110.5, vol: 0.004, mult: 1000, decimals: 3 },
  { sym: 'EURS', name: 'SIM EUR/USD', kind: 'fx', sector: 'FX', book: 'macro', px0: 1.0842, vol: 0.005, mult: 100000, decimals: 4 },
  { sym: 'CRDX', name: 'SIM Crude Oil Future', kind: 'future', sector: 'Energy', book: 'macro', px0: 78.3, vol: 0.017, mult: 1000, decimals: 2 },
  { sym: 'HLN31', name: 'Helion Energy 2031 Bond', kind: 'bond', sector: 'Energy', book: 'credit', px0: 98.6, vol: 0.0035, mult: 10000, decimals: 3 },
  { sym: 'KST29', name: 'Kestrel Logistics 2029 Bond', kind: 'bond', sector: 'Industrials', book: 'credit', px0: 101.2, vol: 0.003, mult: 10000, decimals: 3 },
];

export const INSTRUMENT_INDEX = new Map(INSTRUMENTS.map((i, k) => [i.sym, k]));
const SECTORS = [...new Set(INSTRUMENTS.map((i) => i.sector))];
const MINUTES_PER_DAY = 510; // 08:30-17:00 trading session
/**
 * Mild intraday persistence of each fictional instrument's own moves (positive = trends, negative = mean
 * reverts). Real markets show weak effects like this; they are what the traders' training can find.
 */
export const PERSISTENCE: Record<string, number> = {
  AURX: 0.12, ORBL: 0.14, MRDN: -0.12, KSTL: -0.1, VNTA: 0.08, HLNE: 0.1,
  SX5F: 0.06, TY10: -0.1, EURS: -0.08, CRDX: 0.12, HLN31: -0.12, KST29: -0.12,
};

export interface Shock {
  minute: number; // sim minute of day when it starts
  duration: number;
  moves: Record<string, number>; // total fractional move per symbol
  label: string;
}

export class Market {
  prices: number[];
  open: number[];
  prevClose: number[];
  /** Per-instrument minute closes for the session so far (plus pre-session history). */
  history: number[][];
  historyStart: number; // sim minute of history[0]
  /** Previous 20 sessions' closes (fictional history for longer charts). */
  daily: number[][];
  lastMinute: number;
  day = 0;
  shocks: Shock[] = [];
  feedDelayed = false;
  /** Previous minute's idiosyncratic shock per instrument (for the persistence term). */
  private lastIdio: number[] = INSTRUMENTS.map(() => 0);

  constructor(private seed: number, startMinute: number) {
    this.prices = INSTRUMENTS.map((i) => i.px0);
    this.daily = INSTRUMENTS.map((inst, k) => {
      const out: number[] = [];
      let p = inst.px0;
      for (let d = 20; d >= 1; d--) {
        p = p / Math.exp(gaussian(hashRand(seed, 'daily', k, d, 'a'), hashRand(seed, 'daily', k, d, 'b')) * inst.vol);
        out.unshift(p);
      }
      return out;
    });
    this.prices = this.daily.map((d) => d[d.length - 1]);
    this.prevClose = [...this.prices];
    this.open = [...this.prices];
    this.history = this.prices.map((p) => [p]);
    this.historyStart = startMinute;
    this.lastMinute = startMinute;
  }

  /** Begin a new session day: yesterday's close becomes prev close; history restarts. */
  newDay(day: number, startMinute: number) {
    if (day > 0) {
      this.daily.forEach((d, k) => { d.push(this.prices[k]); if (d.length > 20) d.shift(); });
    }
    this.day = day;
    this.prevClose = [...this.prices];
    this.open = [...this.prices];
    this.history = this.prices.map((p) => [p]);
    this.historyStart = startMinute;
    this.lastMinute = startMinute;
  }

  /** Advance whole simulated minutes up to `minute` (inclusive). */
  advanceTo(minute: number, onMinute?: (m: number) => void) {
    while (this.lastMinute < Math.floor(minute)) {
      this.lastMinute++;
      this.stepMinute(this.lastMinute);
      onMinute?.(this.lastMinute);
    }
  }

  private stepMinute(m: number) {
    // Quieter outside the session; a common market factor plus a sector factor plus noise.
    const session = m >= 8 * 60 + 30 && m <= 17 * 60 ? 1 : 0.25;
    const g = (key: string | number, k: number) => gaussian(hashRand(this.seed, this.day, m, key, k, 'u'), hashRand(this.seed, this.day, m, key, k, 'v'));
    const mkt = g('mkt', 0);
    const sector = SECTORS.map((_, s) => g('sec', s));
    INSTRUMENTS.forEach((inst, k) => {
      const sigma = (inst.vol / Math.sqrt(MINUTES_PER_DAY)) * session;
      const beta = inst.kind === 'bond' || (inst.kind === 'future' && inst.sector === 'Rates') ? -0.2 : inst.kind === 'fx' ? 0.1 : 0.55;
      const idio = g('idio', k) + (PERSISTENCE[inst.sym] ?? 0) * this.lastIdio[k];
      this.lastIdio[k] = idio;
      const z = beta * mkt + 0.45 * sector[SECTORS.indexOf(inst.sector)] + 0.7 * idio;
      let r = sigma * z;
      for (const s of this.shocks) {
        if (m >= s.minute && m < s.minute + s.duration && s.moves[inst.sym]) r += Math.log(1 + s.moves[inst.sym]) / s.duration;
      }
      this.prices[k] *= Math.exp(r);
      const h = this.history[k];
      h.push(this.prices[k]);
      if (h.length > 720) h.shift();
    });
    this.historyStart = m - (this.history[0].length - 1);
  }

  price(sym: string): number {
    return this.prices[INSTRUMENT_INDEX.get(sym) ?? 0];
  }

  change(sym: string): number {
    const k = INSTRUMENT_INDEX.get(sym) ?? 0;
    return this.prices[k] / this.prevClose[k] - 1;
  }

  /** Last n minute prices for a symbol. */
  series(sym: string, n: number): number[] {
    const h = this.history[INSTRUMENT_INDEX.get(sym) ?? 0];
    return h.slice(Math.max(0, h.length - n));
  }
}

export function fmtPx(sym: string, v: number): string {
  const inst = INSTRUMENTS[INSTRUMENT_INDEX.get(sym) ?? 0];
  return v.toFixed(inst.decimals);
}
