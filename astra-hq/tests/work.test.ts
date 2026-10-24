import { beforeAll, describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/config/defaults';
import { INSTRUMENTS, LIVE_UNIVERSE, type LiveQuote } from '../src/sim/market';
import type { Candle, Interval } from '../src/sim/research';
import { Simulation } from '../src/sim/simulation';
import type { DataPort } from '../src/sim/work';
import { series } from './research.test';

/** Candles for every market: tech names and crypto trend; the rest are noise. */
class FakePort implements DataPort {
  calls = 0;
  private data = new Map<string, Candle[]>();
  constructor() {
    LIVE_UNIVERSE.forEach((s, i) => {
      for (const iv of ['1h', '4h', '1d'] as Interval[]) {
        const trending = ['NVDA', 'MU', 'BTC', 'GOLD', 'SPX'].includes(s.sym);
        this.data.set(`${s.sym}|${iv}`, series(200, trending ? 0.35 : 0, trending ? 0.0015 : 0, 0.008, 7 + i * 13 + iv.length));
      }
    });
  }
  candles(sym: string, iv: Interval) { return this.data.get(`${sym}|${iv}`) ?? null; }
  request() { this.calls++; }
  health() { return { calls: this.calls, errors: 0, latencyMs: 120, lastOkAt: Date.now() }; }
}

describe('the real office: work, reports, research, strategies (accelerated clock)', () => {
  const t0 = new Date(2026, 9, 26, 7, 0).getTime(); // a Monday 07:00 local
  let now = t0;
  const sim = new Simulation(defaultConfig());
  sim.clock = () => new Date(now);
  sim.frameClamp = 20;
  sim.setRealMode(true);
  sim.work.data = new FakePort();
  const problems: string[] = [];
  let maxPresent = 0;

  beforeAll(() => {
    const q = new Map<string, LiveQuote>(LIVE_UNIVERSE.map((s) => [s.sym, { px: sim.work.data!.candles(s.sym, '1h')!.slice(-1)[0].c, change24h: 0 }]));
    sim.goLive(q);
    // 14 hours of office time, one minute per tick
    for (let i = 0; i < 14 * 60; i++) {
      now += 60_000;
      sim.tick(20);
      if (i % 30 === 0) problems.push(...sim.validate());
      maxPresent = Math.max(maxPresent, sim.employees.filter((e) => sim.onSite(e)).length);
    }
  }, 300000);

  it('runs on the wall clock, 24/7, with nobody leaving', () => {
    expect(sim.realMode).toBe(true);
    expect(Math.floor(sim.minute)).toBe(21 * 60);
    expect(sim.employees.every((e) => sim.onSite(e))).toBe(true);
    expect(INSTRUMENTS.map((i) => i.sym)).toContain('NVDA');
    expect(problems.slice(0, 5)).toEqual([]);
  });

  it('the CEO sets objectives and every senior keeps their people busy', () => {
    expect(sim.work.objectives.length).toBeGreaterThanOrEqual(4);
    for (const e of sim.employees) {
      const mine = sim.work.tasks.filter((t) => t.owner === e.cfg.id);
      expect(mine.length, e.cfg.name).toBeGreaterThan(0);
      const boss = sim.work.managerOf(e.cfg.id);
      if (boss) expect(mine[0].by).toBe(boss);
    }
    // org chart: traders report to their book's PM, PMs to the CEO, analysts to their heads
    expect(sim.work.managerOf('e03')).toBe('e20');
    expect(sim.work.managerOf('e20')).toBe('e29');
    expect(sim.work.managerOf('e18')).toBe('e17');
    expect(sim.work.managerOf('e17')).toBe('e29');
    expect(sim.work.managerOf('e29')).toBeNull();
    const done = sim.work.tasks.filter((t) => t.status === 'accepted');
    expect(done.length).toBeGreaterThan(30);
    expect(sim.work.reports.length).toBeGreaterThan(30);
  });

  it('traders test strategies on the candles; passes go to Risk, then the PM, then trade on paper', () => {
    expect(sim.work.tested.size).toBeGreaterThan(20);
    const passed = sim.work.strats;
    expect(passed.length).toBeGreaterThan(0);
    for (const s of passed) expect(['risk-review', 'approved', 'rejected', 'live', 'retired', 'paused']).toContain(s.status);
    expect(sim.work.tasks.some((t) => t.kind === 'stress-test' && t.status === 'accepted')).toBe(true);
    const live = passed.filter((s) => s.status === 'live');
    if (live.length) {
      expect(live.every((s) => s.alloc > 0)).toBe(true);
      expect(sim.finance.trades.some((f) => /Strategy #/.test([...sim.finance.traders.values()].flatMap((t) => t.orders).find((o) => o.id === f.orderId)?.reason ?? ''))).toBe(true);
    }
    // nothing trades except validated strategies, and the books reconcile
    expect(sim.work.reconcile().breaks).toBe(0);
  });

  it('researchers, risk, tech, ops and the front office do real work on the data', () => {
    expect(sim.work.regimes.size).toBeGreaterThan(6);
    const kinds = new Set(sim.work.tasks.map((t) => t.kind));
    for (const k of ['regime-report', 'risk-report', 'data-refresh', 'feed-check', 'engine-selftest', 'reconciliation', 'pnl-report', 'review-reports', 'room-schedule', 'meeting-minutes']) expect(kinds, k).toContain(k);
    expect(sim.tech.builds.some((b) => b.branch.startsWith('data/candles'))).toBe(true);
  });

  it('a loss-limit breach flattens everything and calls the risk committee', () => {
    (sim.work as unknown as { killSwitch(r: string): void }).killSwitch('test breach');
    expect(sim.work.kill.on).toBe(true);
    expect(sim.work.strats.filter((s) => s.status === 'live')).toEqual([]);
    expect(sim.events.some((e) => e.kind === 'workshop' && /Risk committee/.test(e.title))).toBe(true);
    expect(sim.work.reconcile().breaks).toBe(0);
  });

  it('remembers its work and paper ledger across reloads', () => {
    const saved = JSON.parse(JSON.stringify(sim.persistState()));
    const again = new Simulation(defaultConfig());
    again.clock = () => new Date(now);
    again.setRealMode(true);
    again.restoreState(saved);
    expect(again.work.strats.length).toBe(sim.work.strats.length);
    expect(again.work.tested.size).toBe(sim.work.tested.size);
    expect(again.finance.trades.length).toBe(sim.finance.trades.length);
  });
});
