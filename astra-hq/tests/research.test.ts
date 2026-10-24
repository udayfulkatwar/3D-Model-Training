import { describe, expect, it } from 'vitest';
import { parseCandles } from '../src/live/candles';
import { FAMILIES, GRID, PASS, backtest, positions, realizedVol, regime, research, stressTest, type Candle } from '../src/sim/research';
import { selfTest } from '../src/sim/work';

/** Deterministic test series: persistent returns (trending) or anti-persistent (mean-reverting). */
export function series(n: number, phi: number, drift = 0, vol = 0.01, seed = 1): Candle[] {
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  let px = 100;
  let prev = 0;
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const r = drift + phi * prev + vol * gauss();
    prev = r;
    const o = px;
    px *= Math.exp(r);
    out.push({ t: i * 4 * 3600e3, o, h: Math.max(o, px) * (1 + vol * 0.3), l: Math.min(o, px) * (1 - vol * 0.3), c: px, v: 1 });
  }
  return out;
}

describe('strategy research on candles', () => {
  it('never looks ahead: a position decided at bar i is earned over bar i+1', () => {
    const cs = series(200, 0.3, 0.002);
    const pos = positions({ family: 'ma-cross', interval: '4h', params: { fast: 5, slow: 30 } }, cs);
    expect(pos.slice(0, 30).every((p) => p === 0)).toBe(true);
    // changing a future candle cannot change earlier positions
    const cs2 = cs.map((c) => ({ ...c }));
    cs2[150].c *= 1.5;
    const pos2 = positions({ family: 'ma-cross', interval: '4h', params: { fast: 5, slow: 30 } }, cs2);
    expect(pos2.slice(0, 150)).toEqual(pos.slice(0, 150));
  });

  it('charges costs on every position change and passes the engine self-test', () => {
    expect(selfTest()).toBe(true);
    const flat = series(200, 0, 0, 0.00001);
    const m = backtest({ family: 'momentum', interval: '4h', params: { look: 12, band: 0 } }, flat);
    expect(m.ret).toBeLessThanOrEqual(0.0001);
  });

  it('finds an edge in a persistent trend and rejects pure noise out of sample', () => {
    const trend = series(200, 0.35, 0.0015, 0.008, 7);
    const best = FAMILIES.map((f) => research('TEST', f, '4h', trend)!).sort((a, b) => b.test.sharpe - a.test.sharpe)[0];
    expect(best.test.sharpe).toBeGreaterThan(0);
    const noise = series(200, 0, 0, 0.01, 11);
    const noiseResults = FAMILIES.map((f) => research('TEST', f, '4h', noise)!);
    // a random walk should rarely pass every gate (Sharpe, PF, trades, drawdown, robustness)
    expect(noiseResults.filter((r) => r.pass).length).toBeLessThanOrEqual(1);
    for (const r of noiseResults) expect(r.verdict).toMatch(/^(PASS|FAIL)/);
    expect(GRID['ma-cross'].length).toBeGreaterThan(5);
    expect(PASS.testSharpe).toBeGreaterThanOrEqual(1);
  });

  it('stress test doubles costs; regime and volatility read the candles', () => {
    const trend = series(200, 0.35, 0.0015, 0.008, 7);
    const r = research('TEST', 'ma-cross', '4h', trend)!;
    const st = stressTest(r, trend);
    expect(st.m.ret).toBeLessThanOrEqual(backtest(r.best, trend, Math.floor(200 * 0.65)).ret + 1e-12);
    expect(regime(trend)!.trend).toBe('up');
    expect(realizedVol(trend, '4h')).toBeGreaterThan(0);
  });

  it('parses Co-Invest candles and drops the still-forming bar', () => {
    const now = Date.UTC(2026, 9, 24, 12, 30);
    const payload = { candles: [
      { timestamp: Date.UTC(2026, 9, 24, 10), open: '1', high: '2', low: '0.5', close: '1.5', volume: '3' },
      { timestamp: Date.UTC(2026, 9, 24, 11), open: '1.5', high: '2', low: '1', close: '1.8', volume: '3' },
      { timestamp: Date.UTC(2026, 9, 24, 12), open: '1.8', high: '2', low: '1', close: '1.9', volume: '1' },
    ] };
    const cs = parseCandles(payload, '1h', now);
    expect(cs.map((c) => c.c)).toEqual([1.5, 1.8]);
    expect(parseCandles({}, '1h', now)).toEqual([]);
  });
});
