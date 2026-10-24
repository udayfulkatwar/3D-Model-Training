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
let SECTORS = [...new Set(INSTRUMENTS.map((i) => i.sector))];
const MINUTES_PER_DAY = 510; // 08:30-17:00 trading session
/**
 * Mild intraday persistence of each fictional instrument's own moves (positive = trends, negative = mean
 * reverts). Real markets show weak effects like this; they are what the traders' training can find.
 */
export const PERSISTENCE: Record<string, number> = {
  AURX: 0.12, ORBL: 0.14, MRDN: -0.12, KSTL: -0.1, VNTA: 0.08, HLNE: 0.1,
  SX5F: 0.06, TY10: -0.1, EURS: -0.08, CRDX: 0.12, HLN31: -0.12, KST29: -0.12,
};

/**
 * Live mode: each office instrument slot is mapped to a real market read from the Co-Invest connector
 * (read-only). Prices are real; positions, orders and P&L stay paper.
 */
export interface LiveSlot { from: string; sym: string; feed: string; name: string; sector: string; kind: InstrumentKind; vol: number; decimals: number }
export const LIVE_UNIVERSE: LiveSlot[] = [
  { from: 'AURX', sym: 'NVDA', feed: 'xyz:NVDA', name: 'NVIDIA', sector: 'Semiconductors', kind: 'equity', vol: 0.03, decimals: 2 },
  { from: 'ORBL', sym: 'MU', feed: 'xyz:MU', name: 'Micron Technology', sector: 'Semiconductors', kind: 'equity', vol: 0.035, decimals: 2 },
  { from: 'MRDN', sym: 'AAPL', feed: 'xyz:AAPL', name: 'Apple', sector: 'Technology', kind: 'equity', vol: 0.016, decimals: 2 },
  { from: 'KSTL', sym: 'TSLA', feed: 'xyz:TSLA', name: 'Tesla', sector: 'Autos', kind: 'equity', vol: 0.035, decimals: 2 },
  { from: 'VNTA', sym: 'SNDK', feed: 'xyz:SNDK', name: 'SanDisk', sector: 'Storage', kind: 'equity', vol: 0.04, decimals: 2 },
  { from: 'HLNE', sym: 'SKHX', feed: 'xyz:SKHX', name: 'SK hynix', sector: 'Semiconductors', kind: 'equity', vol: 0.03, decimals: 2 },
  { from: 'SX5F', sym: 'SPX', feed: 'xyz:SP500', name: 'S&P 500 (perp)', sector: 'Index', kind: 'index', vol: 0.01, decimals: 1 },
  { from: 'TY10', sym: 'GOLD', feed: 'xyz:GOLD', name: 'Gold (perp)', sector: 'Metals', kind: 'future', vol: 0.012, decimals: 1 },
  { from: 'EURS', sym: 'NDX', feed: 'xyz:XYZ100', name: 'NASDAQ 100 (perp)', sector: 'Index', kind: 'index', vol: 0.013, decimals: 1 },
  { from: 'CRDX', sym: 'WTI', feed: 'xyz:CL', name: 'WTI crude oil (perp)', sector: 'Energy', kind: 'future', vol: 0.025, decimals: 2 },
  { from: 'HLN31', sym: 'BTC', feed: 'BTC', name: 'Bitcoin (perp)', sector: 'Crypto', kind: 'future', vol: 0.03, decimals: 0 },
  { from: 'KST29', sym: 'ETH', feed: 'ETH', name: 'Ether (perp)', sector: 'Crypto', kind: 'future', vol: 0.04, decimals: 2 },
];

let liveUniverse = false;
export function isLiveUniverse(): boolean {
  return liveUniverse;
}

/** Rename the instrument slots to the real markets (once). Returns the old→new symbol map. */
export function applyLiveUniverse(): Map<string, string> {
  const map = new Map(LIVE_UNIVERSE.map((s) => [s.from, s.sym]));
  if (liveUniverse) return map;
  liveUniverse = true;
  for (const inst of INSTRUMENTS) {
    const s = LIVE_UNIVERSE.find((x) => x.from === inst.sym);
    if (!s) continue;
    Object.assign(inst, { sym: s.sym, name: s.name, sector: s.sector, kind: s.kind, vol: s.vol, decimals: s.decimals, mult: 1 });
  }
  INSTRUMENT_INDEX.clear();
  INSTRUMENTS.forEach((i, k) => INSTRUMENT_INDEX.set(i.sym, k));
  SECTORS = [...new Set(INSTRUMENTS.map((i) => i.sector))];
  return map;
}

export interface LiveQuote { px: number; change24h: number }

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
  /** Prices come from the live feed instead of the model. */
  liveMode = false;
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

  /** Switch to live prices (keyed by the instrument's current symbol). */
  applyLive(q: Map<string, LiveQuote>) {
    this.liveMode = true;
    this.shocks = [];
    INSTRUMENTS.forEach((inst, k) => {
      const v = q.get(inst.sym);
      if (!v || !(v.px > 0)) return;
      const prev = v.px / (1 + v.change24h / 100);
      const ratio = prev / this.daily[k][this.daily[k].length - 1];
      this.daily[k] = this.daily[k].map((x) => x * ratio);
      this.prices[k] = v.px;
      this.prevClose[k] = prev;
      this.open[k] = prev;
      this.history[k] = [v.px];
    });
  }

  /** A new live snapshot: record a tick per changed price; the 24h change sets the reference close. */
  updateLive(q: Map<string, LiveQuote>) {
    INSTRUMENTS.forEach((inst, k) => {
      const v = q.get(inst.sym);
      if (!v || !(v.px > 0)) return;
      this.prevClose[k] = v.px / (1 + v.change24h / 100);
      if (v.px === this.prices[k] && this.history[k].length > 1) return;
      this.prices[k] = v.px;
      const h = this.history[k];
      h.push(v.px);
      if (h.length > 720) h.shift();
    });
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
    if (this.liveMode) return; // live prices move only when the feed updates
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
