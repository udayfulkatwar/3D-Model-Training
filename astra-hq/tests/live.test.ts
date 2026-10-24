// Live mode (Co-Invest read-only prices). Runs in its own file: switching to the live universe renames
// the shared instrument table for the rest of this module instance.
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/config/defaults';
import { parseNews, parseSnapshots } from '../src/live/feed';
import { INSTRUMENTS, LIVE_UNIVERSE } from '../src/sim/market';
import { BOOKS } from '../src/sim/finance';
import { Simulation } from '../src/sim/simulation';
import { liveLabStrategy } from '../src/sim/training';

// made-up prices in the connector's payload shape (no real observations embedded)
const snapshot = (scale = 1) => ({
  snapshots: LIVE_UNIVERSE.map((s, i) => ({ symbol: s.feed, displayName: s.sym, markPx: String((100 + i * 37) * scale), change24h: i % 2 ? -1.5 : 0.8 })),
  failures: [],
});

describe('live market data (read-only)', () => {
  it('parses price snapshots and headlines', () => {
    const q = parseSnapshots(snapshot());
    expect(q.size).toBe(12);
    expect(q.get('NVDA')).toEqual({ px: 100, change24h: 0.8 });
    expect(q.get('BTC')!.px).toBeGreaterThan(0);
    expect(parseSnapshots({ nope: 1 }).size).toBe(0);
    const news = parseNews({ text: 'Headlines:\n1. Markets drift ahead of data — Wire (https://example.com/a)\n2. Oil climbs — Desk\n\nUnusual Activity (x):\n1. ABC — 5x' });
    expect(news).toEqual([{ title: 'Markets drift ahead of data', source: 'Wire' }, { title: 'Oil climbs', source: 'Desk' }]);
  });

  it('switches the office to real instruments with positions sized at live prices', () => {
    const sim = new Simulation(defaultConfig());
    const notionalBefore = sim.finance.firm(Math.floor(sim.minute)).gross;
    sim.goLive(parseSnapshots(snapshot()));
    expect(sim.live).toBe(true);
    expect(INSTRUMENTS.map((i) => i.sym)).toEqual(LIVE_UNIVERSE.map((s) => s.sym));
    expect(sim.market.price('NVDA')).toBe(100);
    expect(sim.market.change('NVDA')).toBeCloseTo(0.008, 6);
    expect(BOOKS.find((b) => b.id === 'credit')!.name).toBe('Digital Assets');
    expect(Object.keys(BOOKS[0].base)).toContain('NVDA');
    const t = [...sim.finance.traders.values()][0];
    expect(t.coverage.every((s) => INSTRUMENTS.some((i) => i.sym === s))).toBe(true);
    // same exposure budget as before, now in real instruments
    const gross = sim.finance.firm(Math.floor(sim.minute)).gross;
    expect(gross / notionalBefore).toBeGreaterThan(0.9);
    expect(gross / notionalBefore).toBeLessThan(1.1);
    // no fictional shock in live mode, prices move only with the feed
    expect(sim.market.shocks).toEqual([]);
    while (sim.minute < 9 * 60) sim.advance(0.5);
    expect(sim.market.price('NVDA')).toBe(100);
    sim.updateLive(parseSnapshots(snapshot(1.01)));
    expect(sim.market.price('NVDA')).toBeCloseTo(101, 6);
    expect(sim.market.series('NVDA', 10).length).toBe(2);
    expect(sim.ceoReport().sections[1].lines.join(' ')).toMatch(/Digital Assets/);
  });

  it('live strategy lab reads the regime and starts a small forward test that is cut if it loses', () => {
    const ind = new Map([['NVDA', { price: 110, sma50: 105, sma200: 100, rsi: 62 }], ['MU', { price: 95, sma50: 99, sma200: 101, rsi: 40 }]]);
    const mixed = liveLabStrategy(['NVDA', 'MU'], ind);
    expect(mixed.mode).toBe('forward');
    expect(mixed.strategy.kind).toBe('meanrev');
    const trend = liveLabStrategy(['NVDA'], ind);
    expect(trend.strategy.kind).toBe('momentum');
    expect(liveLabStrategy(['GOLD'], ind).active).toBe(false);

    const sim = new Simulation(defaultConfig());
    sim.goLive(parseSnapshots(snapshot()));
    const id = [...sim.finance.traders.keys()][0];
    const cov = sim.finance.traders.get(id)!.coverage;
    for (const s of cov) sim.indicators.set(s, { price: 100, sma50: 99, sma200: 98, rsi: 60 });
    while (sim.minute < 9 * 60 + 40) sim.advance(0.5);
    sim.startTrainingProgramme();
    while (sim.minute < 10 * 60 + 30) sim.advance(0.5);
    const st = sim.finance.strategies.get(id)!;
    expect(sim.trainingRecord(id).strategy!.mode).toBe('forward');
    expect(st.size).toBe(0.1);
    // a losing forward test is suspended and reported
    const priv = sim.finance as unknown as { recordRoundTrip(id: string, st: unknown, pnl: number): void };
    for (let i = 0; i < 8; i++) priv.recordRoundTrip(id, st, -1000);
    expect(st.active).toBe(false);
    while (sim.minute < 10 * 60 + 33) sim.advance(0.5);
    expect(sim.ownerMessages.some((m) => m.empId === id && /suspended my strategy/.test(m.text))).toBe(true);
    expect(sim.trainingRecord(id).strategy!.active).toBe(false);
  });
});
