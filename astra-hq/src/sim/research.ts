// Strategy research on REAL price history (Co-Invest candles: up to 200 bars per interval).
// Standard, well-known systematic families are tested with a walk-forward split: parameters are chosen on
// the first part of the history and judged only on the later part they never saw. Costs are charged on every
// position change. A strategy must also survive a doubled-cost stress test before it may trade (paper).
// No result here is a promise of future profit; the point is to trade only what held up out of sample and
// to size and cut positions so losses stay small.

export interface Candle { t: number; o: number; h: number; l: number; c: number; v: number }
export type Interval = '1h' | '4h' | '1d';
export type Family = 'ma-cross' | 'breakout' | 'momentum' | 'rsi-revert' | 'bollinger';
export const FAMILIES: Family[] = ['ma-cross', 'breakout', 'momentum', 'rsi-revert', 'bollinger'];
export const INTERVALS: Interval[] = ['1h', '4h', '1d'];

export const FAMILY_LABEL: Record<Family, string> = {
  'ma-cross': 'Moving-average trend',
  breakout: 'Channel breakout',
  momentum: 'Time-series momentum',
  'rsi-revert': 'RSI mean reversion',
  bollinger: 'Bollinger mean reversion',
};

export interface Spec { family: Family; interval: Interval; params: Record<string, number> }

export interface Metrics {
  ret: number; // compounded return of the strategy over the period (fraction)
  sharpe: number; // annualised
  maxDD: number; // fraction
  trades: number;
  winRate: number;
  pf: number; // profit factor
  exposure: number; // share of bars in a position
  bars: number;
}

/** Fee + slippage per unit of position change (taker fee plus a little slippage). */
export const COST = 0.0006;
export const BARS_PER_YEAR: Record<Interval, number> = { '1h': 24 * 365, '4h': 6 * 365, '1d': 365 };

export const GRID: Record<Family, Record<string, number>[]> = {
  'ma-cross': [5, 10, 20].flatMap((fast) => [30, 50, 100].map((slow) => ({ fast, slow }))),
  breakout: [20, 40, 60].flatMap((n) => [10, 20].map((exit) => ({ n, exit }))),
  momentum: [12, 24, 48, 96].flatMap((look) => [0, 0.5].map((band) => ({ look, band }))),
  'rsi-revert': [25, 30].flatMap((lo) => [70, 75].map((hi) => ({ len: 14, lo, hi }))),
  bollinger: [20, 40].flatMap((n) => [2, 2.5].map((k) => ({ n, k }))),
};

function sma(x: number[], n: number, i: number): number {
  let s = 0;
  for (let j = i - n + 1; j <= i; j++) s += x[j];
  return s / n;
}

function rsiSeries(c: number[], len: number): number[] {
  const out = new Array(c.length).fill(50);
  let up = 0;
  let dn = 0;
  for (let i = 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    const u = Math.max(0, d);
    const v = Math.max(0, -d);
    if (i <= len) { up += u / len; dn += v / len; } else { up = (up * (len - 1) + u) / len; dn = (dn * (len - 1) + v) / len; }
    if (i >= len) out[i] = dn === 0 ? 100 : 100 - 100 / (1 + up / dn);
  }
  return out;
}

export function atr(cs: Candle[], i: number, n = 14): number {
  let s = 0;
  let k = 0;
  for (let j = Math.max(1, i - n + 1); j <= i; j++) {
    s += Math.max(cs[j].h - cs[j].l, Math.abs(cs[j].h - cs[j - 1].c), Math.abs(cs[j].l - cs[j - 1].c));
    k++;
  }
  return k ? s / k : 0;
}

/** Bars needed before a family can produce a signal. */
export function warmup(s: Spec): number {
  const p = s.params;
  switch (s.family) {
    case 'ma-cross': return p.slow;
    case 'breakout': return p.n + 1;
    case 'momentum': return p.look + 1;
    case 'rsi-revert': return p.len + 1;
    case 'bollinger': return p.n;
  }
}

/**
 * Target position (-1, 0, +1) decided at the close of each bar, applied over the next bar (no look-ahead).
 * Every family has a 2.5×ATR protective stop.
 */
export function positions(s: Spec, cs: Candle[]): number[] {
  const c = cs.map((x) => x.c);
  const p = s.params;
  const pos = new Array(cs.length).fill(0);
  const rsi = s.family === 'rsi-revert' ? rsiSeries(c, p.len) : [];
  let cur = 0;
  let entry = 0;
  for (let i = warmup(s); i < cs.length; i++) {
    let want = cur;
    switch (s.family) {
      case 'ma-cross':
        want = sma(c, p.fast, i) > sma(c, p.slow, i) ? 1 : -1;
        break;
      case 'breakout': {
        let hi = -Infinity;
        let lo = Infinity;
        for (let j = i - p.n; j < i; j++) { hi = Math.max(hi, cs[j].h); lo = Math.min(lo, cs[j].l); }
        let ehi = -Infinity;
        let elo = Infinity;
        for (let j = i - p.exit; j < i; j++) { ehi = Math.max(ehi, cs[j].h); elo = Math.min(elo, cs[j].l); }
        if (c[i] > hi) want = 1;
        else if (c[i] < lo) want = -1;
        else if (cur > 0 && c[i] < elo) want = 0;
        else if (cur < 0 && c[i] > ehi) want = 0;
        break;
      }
      case 'momentum': {
        const r = c[i] / c[i - p.look] - 1;
        const vol = atr(cs, i) / c[i];
        want = r > p.band * vol ? 1 : r < -p.band * vol ? -1 : 0;
        break;
      }
      case 'rsi-revert':
        if (cur === 0) want = rsi[i] < p.lo ? 1 : rsi[i] > p.hi ? -1 : 0;
        else if ((cur > 0 && rsi[i] > 50) || (cur < 0 && rsi[i] < 50)) want = 0;
        break;
      case 'bollinger': {
        const m = sma(c, p.n, i);
        let v = 0;
        for (let j = i - p.n + 1; j <= i; j++) v += (c[j] - m) ** 2;
        const sd = Math.sqrt(v / p.n);
        if (cur === 0) want = c[i] < m - p.k * sd ? 1 : c[i] > m + p.k * sd ? -1 : 0;
        else if ((cur > 0 && c[i] >= m) || (cur < 0 && c[i] <= m)) want = 0;
        break;
      }
    }
    // protective stop
    if (cur !== 0 && (c[i] - entry) * cur < -2.5 * atr(cs, i)) want = 0;
    if (want !== cur && want !== 0) entry = c[i];
    cur = want;
    pos[i] = cur;
  }
  return pos;
}

/** Strategy returns over bars [from, to) with costs. */
export function backtest(s: Spec, cs: Candle[], from = 0, to = cs.length, costMult = 1): Metrics {
  const pos = positions(s, cs);
  const rets: number[] = [];
  let eq = 1;
  let peak = 1;
  let maxDD = 0;
  let trades = 0;
  let wins = 0;
  let gw = 0;
  let gl = 0;
  let tradeRet = 0;
  let inPos = 0;
  for (let i = Math.max(from, 1); i < to; i++) {
    const prev = pos[i - 1];
    let r = prev * (cs[i].c / cs[i - 1].c - 1);
    const change = Math.abs(pos[i] - prev);
    r -= change * COST * costMult;
    rets.push(r);
    eq *= 1 + r;
    peak = Math.max(peak, eq);
    maxDD = Math.max(maxDD, 1 - eq / peak);
    if (prev !== 0) { tradeRet += r; inPos++; }
    // a trade closes when the position changes from non-zero
    if (prev !== 0 && pos[i] !== prev) {
      trades++;
      if (tradeRet > 0) { wins++; gw += tradeRet; } else gl -= tradeRet;
      tradeRet = 0;
    }
  }
  const n = rets.length || 1;
  const mean = rets.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  return {
    ret: eq - 1,
    sharpe: sd > 0 ? (mean / sd) * Math.sqrt(BARS_PER_YEAR[s.interval]) : 0,
    maxDD,
    trades,
    winRate: trades ? wins / trades : 0,
    pf: gl > 0 ? gw / gl : gw > 0 ? 99 : 0,
    exposure: inPos / n,
    bars: rets.length,
  };
}

export interface ResearchResult {
  symbol: string;
  family: Family;
  interval: Interval;
  best: Spec;
  train: Metrics;
  test: Metrics;
  /** Share of the grid with a positive in-sample Sharpe (robustness: a lone lucky parameter set scores low). */
  robustness: number;
  tested: number;
  pass: boolean;
  verdict: string;
  /** When the candles used ended (epoch ms). */
  dataEnd: number;
}

export const PASS = { testSharpe: 1.0, testPf: 1.2, minTrades: 4, maxDD: 0.12, trainSharpe: 0.5, robustness: 0.3 };

/** Walk-forward: choose parameters on the first 65 % of the candles, judge on the last 35 %. */
export function research(symbol: string, family: Family, interval: Interval, cs: Candle[]): ResearchResult | null {
  if (cs.length < 80) return null;
  const split = Math.floor(cs.length * 0.65);
  let best: { s: Spec; m: Metrics } | null = null;
  let positive = 0;
  for (const params of GRID[family]) {
    const s: Spec = { family, interval, params };
    if (warmup(s) > split - 20) continue;
    const m = backtest(s, cs, 0, split);
    if (m.sharpe > 0) positive++;
    if (m.trades >= 3 && (!best || m.sharpe > best.m.sharpe)) best = { s, m };
  }
  const tested = GRID[family].length;
  if (!best) {
    return { symbol, family, interval, best: { family, interval, params: GRID[family][0] }, train: backtest({ family, interval, params: GRID[family][0] }, cs, 0, split), test: backtest({ family, interval, params: GRID[family][0] }, cs, split), robustness: 0, tested, pass: false, verdict: `FAIL: ${FAMILY_LABEL[family]} on ${symbol} ${interval}: not enough trades in the training window to judge.`, dataEnd: cs[cs.length - 1].t };
  }
  const test = backtest(best.s, cs, split);
  const robustness = positive / tested;
  const fails: string[] = [];
  if (best.m.sharpe < PASS.trainSharpe) fails.push(`in-sample Sharpe ${best.m.sharpe.toFixed(2)} < ${PASS.trainSharpe}`);
  if (test.sharpe < PASS.testSharpe) fails.push(`out-of-sample Sharpe ${test.sharpe.toFixed(2)} < ${PASS.testSharpe}`);
  if (test.pf < PASS.testPf) fails.push(`profit factor ${test.pf.toFixed(2)} < ${PASS.testPf}`);
  if (test.trades < PASS.minTrades) fails.push(`only ${test.trades} trades out of sample`);
  if (test.maxDD > PASS.maxDD) fails.push(`drawdown ${(test.maxDD * 100).toFixed(1)}% > ${PASS.maxDD * 100}%`);
  if (robustness < PASS.robustness) fails.push(`fragile: only ${(robustness * 100).toFixed(0)}% of settings worked in-sample`);
  const pass = fails.length === 0;
  const p = Object.entries(best.s.params).map(([k, v]) => `${k} ${v}`).join(', ');
  const verdict = pass
    ? `PASS: ${FAMILY_LABEL[family]} (${p}) on ${symbol} ${interval}: out-of-sample ${(test.ret * 100).toFixed(2)}%, Sharpe ${test.sharpe.toFixed(2)}, PF ${test.pf.toFixed(2)}, max DD ${(test.maxDD * 100).toFixed(1)}%, ${test.trades} trades.`
    : `FAIL: ${FAMILY_LABEL[family]} on ${symbol} ${interval}: ${fails.join('; ')}.`;
  return { symbol, family, interval, best: best.s, train: best.m, test, robustness, tested, pass, verdict, dataEnd: cs[cs.length - 1].t };
}

/** Risk's stress test: the same strategy on the same unseen window with costs doubled. */
export function stressTest(r: ResearchResult, cs: Candle[]): { ok: boolean; m: Metrics; note: string } {
  const split = Math.floor(cs.length * 0.65);
  const m = backtest(r.best, cs, split, cs.length, 2);
  const ok = m.ret > 0 && m.sharpe >= 0.5 && m.maxDD <= PASS.maxDD * 1.25;
  return { ok, m, note: `${ok ? 'Approved' : 'Rejected'} by stress test: with double costs ${(m.ret * 100).toFixed(2)}%, Sharpe ${m.sharpe.toFixed(2)}, max DD ${(m.maxDD * 100).toFixed(1)}%` };
}

/** Annualised volatility of close-to-close returns. */
export function realizedVol(cs: Candle[], interval: Interval, n = 60): number {
  const c = cs.slice(-n - 1).map((x) => x.c);
  const r: number[] = [];
  for (let i = 1; i < c.length; i++) r.push(Math.log(c[i] / c[i - 1]));
  if (r.length < 5) return 0;
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  const v = r.reduce((a, b) => a + (b - m) ** 2, 0) / r.length;
  return Math.sqrt(v * BARS_PER_YEAR[interval]);
}

/** Simple indicators from candles for regime reports (no extra data calls). */
export function regime(cs: Candle[]): { trend: 'up' | 'down' | 'range'; rsi: number; vol: number; chg: number } | null {
  if (cs.length < 60) return null;
  const c = cs.map((x) => x.c);
  const i = c.length - 1;
  const s20 = sma(c, 20, i);
  const s50 = sma(c, 50, i);
  const trend = c[i] > s20 && s20 > s50 ? 'up' : c[i] < s20 && s20 < s50 ? 'down' : 'range';
  return { trend, rsi: rsiSeries(c, 14)[i], vol: atr(cs, i) / c[i], chg: c[i] / c[Math.max(0, i - 24)] - 1 };
}

/** Families worth testing first in a given regime (researchers' recommendation). */
export function familiesFor(trend: 'up' | 'down' | 'range'): Family[] {
  return trend === 'range' ? ['rsi-revert', 'bollinger', 'ma-cross', 'breakout', 'momentum'] : ['ma-cross', 'breakout', 'momentum', 'rsi-revert', 'bollinger'];
}
