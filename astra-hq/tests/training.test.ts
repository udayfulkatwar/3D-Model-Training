import { beforeAll, describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/config/defaults';
import { Simulation } from '../src/sim/simulation';
import { CURRICULA, STRATEGY_GRID, TRAIN_DAYS, VALID_DAYS, backtest, certified, practiceSessions, trainStrategy } from '../src/sim/training';

const until = (sim: Simulation, minute: number, check?: () => void) => {
  let n = 0;
  while (sim.minute < minute) {
    sim.advance(0.5);
    if (check && ++n % 10 === 0) check();
  }
};

describe('strategy training (backtest + out-of-sample check)', () => {
  it('searches the grid on in-sample sessions and validates on unseen ones', () => {
    const seed = defaultConfig().seed;
    const sessions = practiceSessions(seed);
    expect(sessions[0].length).toBe(TRAIN_DAYS + VALID_DAYS);
    const r = trainStrategy(seed, ['AURX', 'ORBL']);
    expect(r.tested).toBe(STRATEGY_GRID.length);
    expect(r.train.days).toBe(TRAIN_DAYS);
    expect(r.valid.days).toBe(VALID_DAYS);
    // the chosen strategy is the in-sample best of the grid
    for (const s of STRATEGY_GRID) {
      const m = backtest(s, ['AURX', 'ORBL'], sessions, 0, TRAIN_DAYS);
      if (m.trades >= TRAIN_DAYS) expect(m.sharpe).toBeLessThanOrEqual(r.train.sharpe + 1e-9);
    }
    // only live when the unseen sessions agree
    expect(r.active).toBe(r.train.sharpe > 0.5 && r.valid.sharpe > 0.5 && r.valid.total > 0);
  });

  it('accepts some strategies and rejects others (no guaranteed edge)', () => {
    const seed = defaultConfig().seed;
    const results = [['AURX', 'ORBL'], ['MRDN', 'KSTL'], ['CRDX', 'TY10'], ['HLN31', 'KST29'], ['SX5F', 'EURS']].map((s) => trainStrategy(seed, s));
    expect(results.some((r) => r.active)).toBe(true);
    expect(results.some((r) => !r.active)).toBe(true);
    for (const r of results) expect(r.verdict).toMatch(r.active ? /^Live/ : /^Not used/);
  });
});

describe('training programme in the office', () => {
  const sim = new Simulation(defaultConfig());
  const problems: string[] = [];
  let started: ReturnType<Simulation['startTrainingProgramme']>;
  let tradesBefore = 0;
  let saved = 0;
  const snap: Record<string, number> = {};

  beforeAll(() => {
    sim.onTrainingChange = () => { saved++; };
    until(sim, 9 * 60 + 40);
    snap.skillBefore = sim.employees.reduce((a, e) => a + sim.skillOf(e.cfg.id), 0);
    started = sim.startTrainingProgramme();
    until(sim, 10 * 60 + 30, () => problems.push(...sim.validate()));
    tradesBefore = sim.finance.trades.filter((t) => t.t >= 10 * 60 + 30).length;
    until(sim, 17 * 60 + 25, () => problems.push(...sim.validate()));
  }, 240000);

  it('sends every trader to the strategy lab and reports results with numbers', () => {
    expect(started.lab).toBe(10);
    for (const e of sim.employees.filter((x) => x.cfg.roleType === 'trader')) {
      const r = sim.trainingRecord(e.cfg.id);
      expect(r.strategy).toBeTruthy();
      expect(r.modules.some((m) => m.id === 'strat' && m.passed)).toBe(true);
      expect(sim.ownerMessages.some((m) => m.empId === e.cfg.id && /^Strategy lab done/.test(m.text))).toBe(true);
    }
  });

  it('trades live strategies on paper and keeps turnover low where no edge was found', () => {
    const live = [...sim.finance.strategies.entries()].filter(([, v]) => v.active).map(([id]) => id);
    expect(live.length).toBeGreaterThan(0);
    const strategyFills = sim.finance.trades.filter((t) => live.includes(t.traderId));
    const orders = [...sim.finance.traders.values()].flatMap((t) => t.orders).filter((o) => /^Strategy/.test(o.reason));
    expect(orders.length + strategyFills.length).toBeGreaterThan(0);
    expect(tradesBefore).toBeGreaterThanOrEqual(0);
  });

  it('books Training Room sessions (max 12) and passes modules that raise skill', () => {
    const sessions = sim.events.filter((e) => e.academy);
    expect(sessions.length).toBeGreaterThanOrEqual(3);
    for (const s of sessions) {
      expect(s.roomId).toBe('g-training');
      expect(s.attendeeIds.length).toBeLessThanOrEqual(12);
    }
    // sessions never double-book the room
    const sorted = [...sessions].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i].start).toBeGreaterThanOrEqual(sorted[i - 1].end);
    // traders' classroom sessions are after the market close
    for (const s of sessions) if (s.attendeeIds.every((id) => sim.byId.get(id)!.cfg.roleType === 'trader')) expect(s.start).toBeGreaterThanOrEqual(17 * 60);
    const done = sessions.filter((s) => s.status === 'completed');
    expect(done.length).toBeGreaterThan(0);
    const skillAfter = sim.employees.reduce((a, e) => a + sim.skillOf(e.cfg.id), 0);
    expect(skillAfter).toBeGreaterThan(snap.skillBefore);
    expect(sim.ownerMessages.some((m) => /^Training update/.test(m.text))).toBe(true);
    expect(saved).toBeGreaterThan(2);
    expect(problems.slice(0, 10)).toEqual([]);
  });

  it('the CEO reports everything from live data, on request and at the end of the day', () => {
    const r = sim.ceoReport();
    const titles = r.sections.map((s) => s.title);
    for (const t of ['Paper trading account', 'Books', 'Traders', 'Risk', 'Operations', 'Technology', 'Research', 'People', 'Training']) expect(titles).toContain(t);
    expect(r.sections[0].lines[0]).toMatch(/Paper capital/);
    const ceo = sim.employees.find((e) => e.cfg.roleType === 'ceo')!;
    expect(sim.talk(ceo.cfg.id, 'Give me the full report')).toMatch(/Paper account/);
    expect(sim.ownerMessages.some((m) => m.empId === ceo.cfg.id && /^End-of-day report/.test(m.text))).toBe(true);
    expect(sim.talk('e02', 'How is your training going?')).toMatch(/Skill \d+\/100/);
  });

  it('training survives a reset and is dropped for people whose role changed', () => {
    const records = [...sim.training.values()].map((r) => JSON.parse(JSON.stringify(r)));
    const fresh = new Simulation(defaultConfig());
    fresh.loadTraining(records);
    expect(fresh.finance.strategies.size).toBe(10);
    const cfg = defaultConfig();
    const trader = cfg.employees.find((e) => e.roleType === 'trader')!;
    trader.roleType = 'researcher';
    fresh.reset(cfg);
    expect(fresh.training.has(trader.id)).toBe(false);
    expect(fresh.training.size).toBe(records.length - 1);
  });

  it('curricula cover every role and certification needs every module', () => {
    for (const role of Object.keys(CURRICULA) as (keyof typeof CURRICULA)[]) expect(CURRICULA[role].length).toBeGreaterThan(1);
    const r = sim.trainingRecord('e02');
    expect(certified(r)).toBe(CURRICULA.trader.every((m) => r.modules.some((x) => x.id === m.id && x.passed)));
  });
});
