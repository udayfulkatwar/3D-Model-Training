// Real price history for the office's research and strategies: OHLCV candles from the viewer's Co-Invest
// connector (`show_chart`, read-only, up to 200 candles per call). Candles are cached in memory and in the
// browser so the office remembers its data between visits; the still-forming last candle is dropped so
// decisions are made on completed bars only.
import { LIVE_UNIVERSE } from '../sim/market';
import type { Candle, Interval } from '../sim/research';
import type { DataPort } from '../sim/work';
import { SERVER, getMcp } from './feed';

const IV_MS: Record<Interval, number> = { '1h': 3600e3, '4h': 4 * 3600e3, '1d': 86400e3 };
/** How old a series may get before it is fetched again. */
const STALE_MS: Record<Interval, number> = { '1h': 10 * 60e3, '4h': 30 * 60e3, '1d': 3 * 3600e3 };
const STORE_KEY = 'astra-hq:candles:v1';
const MAX_IN_FLIGHT = 3;

interface Series { candles: Candle[]; fetchedAt: number }

export function parseCandles(payload: unknown, iv: Interval, now = Date.now()): Candle[] {
  const raw = (payload as { candles?: unknown })?.candles;
  if (!Array.isArray(raw)) return [];
  const out: Candle[] = [];
  for (const x of raw as Record<string, unknown>[]) {
    const c: Candle = { t: Number(x.timestamp), o: Number(x.open), h: Number(x.high), l: Number(x.low), c: Number(x.close), v: Number(x.volume) };
    if (Number.isFinite(c.t) && c.c > 0 && c.h > 0 && c.l > 0) out.push(c);
  }
  out.sort((a, b) => a.t - b.t);
  // the last candle may still be forming: trade and test on completed bars only
  while (out.length && out[out.length - 1].t + IV_MS[iv] > now) out.pop();
  return out;
}

export class CandleStore implements DataPort {
  private series = new Map<string, Series>();
  private loading = new Set<string>();
  private queue: [string, Interval][] = [];
  private stats = { calls: 0, errors: 0, latencyMs: 0, lastOkAt: 0, lastError: undefined as string | undefined };
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  onUpdate?: () => void;

  constructor() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) for (const [k, v] of JSON.parse(raw) as [string, Series][]) this.series.set(k, v);
    } catch {
      /* nothing cached */
    }
  }

  candles(sym: string, iv: Interval): Candle[] | null {
    const s = this.series.get(`${sym}|${iv}`);
    return s && s.candles.length ? s.candles : null;
  }

  fetchedAt(sym: string, iv: Interval): number {
    return this.series.get(`${sym}|${iv}`)?.fetchedAt ?? 0;
  }

  health() {
    return { ...this.stats };
  }

  request(sym: string, iv: Interval) {
    const key = `${sym}|${iv}`;
    const s = this.series.get(key);
    if (this.loading.has(key) || (s && Date.now() - s.fetchedAt < STALE_MS[iv])) return;
    if (this.queue.some(([a, b]) => a === sym && b === iv)) return;
    this.queue.push([sym, iv]);
    this.pump();
  }

  private pump() {
    while (this.loading.size < MAX_IN_FLIGHT && this.queue.length) {
      const [sym, iv] = this.queue.shift()!;
      void this.fetch(sym, iv);
    }
  }

  private async fetch(sym: string, iv: Interval) {
    const key = `${sym}|${iv}`;
    const slot = LIVE_UNIVERSE.find((x) => x.sym === sym);
    if (!slot) return;
    this.loading.add(key);
    const t0 = performance.now();
    try {
      const mcp = await getMcp();
      if (!mcp) throw { code: 'not_available' };
      this.stats.calls++;
      const r = await mcp.callTool(SERVER, 'show_chart', { symbol: slot.feed, interval: iv, limit: 200 }, { cache: { staleTime: STALE_MS[iv], gcTime: STALE_MS[iv] * 4 } });
      const candles = parseCandles(r.payload, iv);
      if (!candles.length) throw { code: 'empty', message: `no candles for ${sym} ${iv}` };
      this.series.set(key, { candles, fetchedAt: Date.now() });
      this.stats.lastOkAt = Date.now();
      const ms = performance.now() - t0;
      this.stats.latencyMs = this.stats.latencyMs ? this.stats.latencyMs * 0.8 + ms * 0.2 : ms;
      this.scheduleSave();
      this.onUpdate?.();
    } catch (e) {
      this.stats.errors++;
      const err = e as { code?: string; message?: string };
      this.stats.lastError = `${err.code ?? 'error'}${err.message ? `: ${err.message}` : ''}`;
      // remember the failure for a short while so a broken connector is not hammered
      const prev = this.series.get(key);
      this.series.set(key, { candles: prev?.candles ?? [], fetchedAt: Date.now() - STALE_MS[iv] + 60e3 });
    } finally {
      this.loading.delete(key);
      this.pump();
    }
  }

  private scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify([...this.series.entries()].filter(([, v]) => v.candles.length)));
      } catch {
        /* storage full: keep in memory only */
      }
    }, 5000);
  }
}
