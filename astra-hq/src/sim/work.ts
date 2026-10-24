// How the office works, every day, around the clock: the CEO sets the day's objectives, each senior assigns
// tasks to their people, people do the work at their desks on REAL data (Co-Invest candles, live prices,
// headlines), report the result to their senior, the senior reviews it and decides what comes next, and
// problems go to a meeting where a decision is taken. Work never runs out: when a task is done the person
// asks their senior for the next one.
//
// The trading process is the one real systematic desks use: researchers read the market regime, traders
// test strategies on real history with a walk-forward split, Risk stress-tests anything that passes, the
// PM allocates paper capital with volatility-targeted sizing, the strategy desk executes, everyone monitors,
// losers are retired, and a firm-wide daily loss limit flattens everything if it is hit.
import type { Employee, Simulation } from './simulation';
import type { OfficeEvent } from './events';
import { BOOK_INDEX, roundQty } from './finance';
import { INSTRUMENTS } from './market';
import {
  FAMILIES, FAMILY_LABEL, INTERVALS, PASS, backtest, familiesFor, positions, realizedVol, regime, research, stressTest,
  type Candle, type Family, type Interval, type ResearchResult,
} from './research';
import { fmtMoney, fmtTime } from '../util/math';
import { ROOMS } from '../world/building';

/** Where the work gets its data. In the app: the Co-Invest connector; in tests: recorded/synthetic candles. */
export interface DataPort {
  candles(sym: string, iv: Interval): Candle[] | null;
  request(sym: string, iv: Interval): void;
  health(): { calls: number; errors: number; latencyMs: number; lastOkAt: number; lastError?: string };
}

export type TaskKind =
  | 'research' | 'review-live' | 'regime-report' | 'news-brief' | 'peer-review' | 'stress-test' | 'risk-report'
  | 'allocation' | 'perf-review' | 'data-refresh' | 'feed-check' | 'engine-selftest' | 'reconciliation' | 'pnl-report'
  | 'daily-plan' | 'review-reports' | 'room-schedule' | 'meeting-minutes';

export interface WorkTask {
  id: number;
  kind: TaskKind;
  title: string;
  owner: string;
  by: string;
  created: number;
  started?: number;
  finished?: number;
  duration: number;
  progress: number;
  status: 'queued' | 'waiting' | 'active' | 'review' | 'accepted' | 'rework';
  params: { sym?: string; family?: Family; interval?: Interval; stratId?: number; syms?: string[]; book?: string };
  result?: { ok: boolean; summary: string; detail?: string[] };
  log: { t: number; text: string }[];
}

export interface Strat {
  id: number;
  owner: string;
  sym: string;
  book: string;
  r: ResearchResult;
  status: 'risk-review' | 'rejected' | 'approved' | 'live' | 'paused' | 'retired';
  alloc: number;
  qty: number;
  entryPx: number;
  realized: number;
  fwd: { trades: number; pnl: number; peak: number; dd: number; since: number };
  peer?: string;
  notes: { t: number; text: string }[];
}

export interface Objective { id: number; day: number; text: string; metric: 'tests' | 'loss' | 'breaks' | 'reviews' | 'regimes'; target: number }
export interface Report { id: number; t: number; from: string; to: string; text: string; ok: boolean }

const DUR: Record<TaskKind, number> = {
  research: 35, 'review-live': 20, 'regime-report': 30, 'news-brief': 25, 'peer-review': 30, 'stress-test': 30, 'risk-report': 25,
  allocation: 25, 'perf-review': 25, 'data-refresh': 15, 'feed-check': 15, 'engine-selftest': 20, reconciliation: 20, 'pnl-report': 20,
  'daily-plan': 20, 'review-reports': 25, 'room-schedule': 30, 'meeting-minutes': 30,
};

/** Firm-wide paper risk limits. */
export const LIMITS = { dailyLossPct: 0.02, maxGrossMult: 1.5, volTarget: 0.2, maxAllocPct: 0.25, maxSymbolPct: 0.35, reservePct: 0.2 };

interface PendingDecision { kind: 'research-direction' | 'loss-limit' | 'data-incident'; data: Record<string, string | number> }

export class WorkEngine {
  tasks: WorkTask[] = [];
  strats: Strat[] = [];
  objectives: Objective[] = [];
  reports: Report[] = [];
  /** Results of every test run: key sym|family|interval. */
  tested = new Map<string, { t: number; pass: boolean; sharpe: number; family: Family; interval: Interval; sym: string }>();
  regimes = new Map<string, { trend: 'up' | 'down' | 'range'; rsi: number; vol: number; chg: number; t: number }>();
  focus = new Map<string, { family?: Family; interval?: Interval; until: number }>();
  failStreak = new Map<string, number>();
  kill: { on: boolean; at: number; reason: string } = { on: false, at: 0, reason: '' };
  data: DataPort | null = null;
  private seq = 1;
  private planDay = -1;
  private decisions = new Map<string, PendingDecision>();
  private lastAlloc = new Map<string, number>();
  private lastReview = new Map<string, number>();
  private lastRisk = 0;
  private lastNews = '';

  constructor(private sim: Simulation) {}

  /** Absolute minute (day × 1440 + minute of day). */
  now(): number {
    return this.sim.day * 1440 + Math.floor(this.sim.minute);
  }

  private name(id: string) {
    return this.sim.name(id);
  }

  // ------------------------------------------------------------------ organisation
  private head(role: Employee['cfg']['roleType']): Employee | undefined {
    const list = this.sim.employees.filter((e) => e.cfg.roleType === role);
    return list.find((e) => /head|manager|chief/i.test(e.cfg.title)) ?? list[0];
  }

  /** Who each person reports to (the CEO reports to the owner). */
  managerOf(id: string): string | null {
    const e = this.sim.byId.get(id);
    if (!e) return null;
    const ceo = this.sim.employees.find((x) => x.cfg.roleType === 'ceo')?.cfg.id ?? null;
    const role = e.cfg.roleType;
    if (role === 'ceo') return null;
    if (role === 'trader') return this.sim.finance.pmByBook.get(this.sim.finance.traders.get(id)?.bookId ?? 'eq') ?? ceo;
    if (role === 'pm' || role === 'receptionist' || role === 'coordinator') return ceo;
    const h = this.head(role);
    return h && h.cfg.id !== id ? h.cfg.id : ceo;
  }

  reportsOf(id: string): string[] {
    return this.sim.employees.filter((e) => this.managerOf(e.cfg.id) === id).map((e) => e.cfg.id);
  }

  current(id: string): WorkTask | undefined {
    return this.tasks.find((t) => t.owner === id && (t.status === 'active' || t.status === 'waiting'));
  }

  // ------------------------------------------------------------------ the minute loop
  minute() {
    const t = this.now();
    const m = Math.floor(this.sim.minute);
    if (this.planDay !== this.sim.day && (m >= 8 * 60 || this.sim.realMode)) this.dailyPlan();
    for (const e of this.sim.employees) {
      if (!this.sim.onSite(e)) continue;
      let task = this.current(e.cfg.id);
      if (!task) task = this.assign(e);
      if (task) this.progress(e, task, t);
    }
    for (const task of this.tasks) if (task.status === 'review') this.review(task);
    this.runDesk(m);
    if (this.tasks.length > 400) this.tasks = this.tasks.filter((x, i) => i < 300 || x.status === 'queued' || x.status === 'active' || x.status === 'waiting');
  }

  private task(kind: TaskKind, owner: string, by: string | null, params: WorkTask['params'], title: string, status: WorkTask['status'] = 'queued'): WorkTask {
    const t: WorkTask = { id: this.seq++, kind, title, owner, by: by ?? owner, created: this.now(), duration: DUR[kind], progress: 0, status, params, log: [] };
    t.log.push({ t: t.created, text: `${by ? `Assigned by ${this.name(by)}` : 'Self-assigned'}: ${title}` });
    this.tasks.unshift(t);
    return t;
  }

  /** The person asks their senior for the next piece of work (queued tasks first, then the senior's plan). */
  private assign(e: Employee): WorkTask | undefined {
    const id = e.cfg.id;
    const queued = this.tasks.filter((t) => t.owner === id && t.status === 'queued').sort((a, b) => a.created - b.created)[0];
    const next = queued ?? this.plan(e);
    if (!next) return undefined;
    next.status = this.needsData(next) ? 'waiting' : 'active';
    next.started = this.now();
    const boss = this.managerOf(id);
    this.sim.pushHistory(e, `${boss ? `Next task from ${this.name(boss)}` : 'Next task'}: ${next.title}`);
    return next;
  }

  private needsData(t: WorkTask): boolean {
    if (!this.data) return false;
    if (t.kind === 'research' || t.kind === 'peer-review') return !this.data.candles(t.params.sym!, t.params.interval!);
    return false;
  }

  private progress(e: Employee, t: WorkTask, now: number) {
    if (t.status === 'waiting') {
      if (t.params.sym && t.params.interval) this.data?.request(t.params.sym, t.params.interval);
      if (!this.needsData(t)) { t.status = 'active'; t.log.push({ t: now, text: 'Data arrived; working' }); }
      else if (now - (t.started ?? now) > 30) { this.finish(t, { ok: false, summary: `No ${t.params.interval} candles for ${t.params.sym} from Co-Invest after 30 min` }); }
      return;
    }
    // work happens at the desk (or remotely from a meeting room); not while walking, eating or in someone else's meeting
    if (!this.sim.presentAtDesk(e)) return;
    t.progress = Math.min(1, t.progress + 1 / t.duration);
    if (t.progress >= 1) this.finish(t, this.complete(t));
  }

  private finish(t: WorkTask, result: WorkTask['result']) {
    t.result = result;
    t.finished = this.now();
    t.status = 'review';
    t.log.push({ t: t.finished, text: `Done: ${result!.summary}` });
    const e = this.sim.byId.get(t.owner);
    const boss = this.managerOf(t.owner);
    if (e) this.sim.pushHistory(e, `Finished "${t.title}": ${result!.summary}`);
    if (boss) this.report(t.owner, boss, `${t.title}: ${result!.summary}`, result!.ok);
    else this.review(t);
  }

  private report(from: string, to: string, text: string, ok: boolean) {
    this.reports.unshift({ id: this.seq++, t: this.now(), from, to, text, ok });
    if (this.reports.length > 300) this.reports.pop();
  }

  /** The senior reads the report and decides: accept, send back, or follow up. */
  private review(t: WorkTask) {
    const boss = this.managerOf(t.owner);
    const b = boss ? this.sim.byId.get(boss) : undefined;
    if (b && !this.sim.onSite(b)) return;
    const r = t.result!;
    if (!r.ok && /No .* candles|no data/i.test(r.summary)) {
      t.status = 'rework';
      t.log.push({ t: this.now(), text: `${b?.cfg.name ?? 'Reviewer'}: no data yet; retry later` });
      return;
    }
    t.status = 'accepted';
    t.log.push({ t: this.now(), text: `Reviewed by ${b?.cfg.name ?? 'the owner'}: accepted` });
  }

  // ------------------------------------------------------------------ CEO
  private dailyPlan() {
    this.planDay = this.sim.day;
    const ceo = this.sim.employees.find((e) => e.cfg.roleType === 'ceo');
    const live = this.strats.filter((s) => s.status === 'live').length;
    const traders = this.sim.employees.filter((e) => e.cfg.roleType === 'trader').length;
    const id = () => this.seq++;
    this.objectives = [
      { id: id(), day: this.sim.day, text: `Test at least ${traders * 6} strategy set-ups on real Co-Invest history and only trade what passes out of sample`, metric: 'tests', target: traders * 6 },
      { id: id(), day: this.sim.day, text: `Keep the daily paper loss under ${(LIMITS.dailyLossPct * 100).toFixed(0)}% of capital (hard stop)`, metric: 'loss', target: LIMITS.dailyLossPct },
      { id: id(), day: this.sim.day, text: 'Zero reconciliation breaks between strategy books and the firm ledger', metric: 'breaks', target: 0 },
      { id: id(), day: this.sim.day, text: `Every live strategy (${live} now) reviewed by its trader and its PM today`, metric: 'reviews', target: live },
      { id: id(), day: this.sim.day, text: `Regime report on all ${INSTRUMENTS.length} markets`, metric: 'regimes', target: INSTRUMENTS.length },
    ];
    if (ceo) {
      this.sim.pushHistory(ceo, "Set today's objectives for the firm");
      this.sim.addLog(`${ceo.cfg.name} set today's objectives: ${this.objectives.length} goals`, 'office');
    }
  }

  objectiveProgress(o: Objective): { value: number; ok: boolean; text: string } {
    const dayStart = this.sim.day * 1440;
    switch (o.metric) {
      case 'tests': { const n = [...this.tested.values()].filter((x) => x.t >= dayStart).length; return { value: n, ok: n >= o.target, text: `${n}/${o.target}` }; }
      case 'loss': { const f = this.sim.finance.firm(Math.floor(this.sim.minute)); const pct = -f.pnl / Math.max(1, f.capital); return { value: pct, ok: pct < o.target, text: `${(f.pnl / Math.max(1, f.capital) * 100).toFixed(2)}% today` }; }
      case 'breaks': { const n = this.reconcile().breaks; return { value: n, ok: n === 0, text: `${n} breaks` }; }
      case 'reviews': { const n = this.tasks.filter((t) => (t.kind === 'review-live' || t.kind === 'perf-review') && (t.finished ?? 0) >= dayStart).length; return { value: n, ok: n >= Math.min(o.target, 1), text: `${n} reviews` }; }
      case 'regimes': { const n = [...this.regimes.values()].filter((r) => r.t >= dayStart).length; return { value: n, ok: n >= o.target, text: `${n}/${o.target}` }; }
    }
  }

  // ------------------------------------------------------------------ planning: what each senior gives each role next
  private plan(e: Employee): WorkTask | undefined {
    const id = e.cfg.id;
    const boss = this.managerOf(id);
    const t = this.now();
    const mk = (kind: TaskKind, params: WorkTask['params'], title: string) => this.task(kind, id, boss, params, title, 'active');
    switch (e.cfg.roleType) {
      case 'trader': {
        const mine = this.strats.filter((s) => s.owner === id && s.status === 'live');
        if (mine.length && t - (this.lastReview.get(id) ?? -1e9) > 240) {
          this.lastReview.set(id, t);
          return mk('review-live', {}, `Review my ${mine.length} live strateg${mine.length === 1 ? 'y' : 'ies'}`);
        }
        const next = this.nextResearch(id);
        return next ? mk('research', next, `Test ${FAMILY_LABEL[next.family!]} on ${next.sym} ${next.interval} (walk-forward)`) : undefined;
      }
      case 'researcher': {
        const unpeered = this.strats.find((s) => (s.status === 'risk-review' || s.status === 'approved' || s.status === 'live') && !s.peer && !this.tasks.some((x) => x.kind === 'peer-review' && x.params.stratId === s.id));
        if (unpeered) {
          const iv = unpeered.r.interval === '1d' ? '4h' : unpeered.r.interval === '4h' ? '1d' : '4h';
          return mk('peer-review', { stratId: unpeered.id, sym: unpeered.sym, family: unpeered.r.family, interval: iv }, `Peer review #${unpeered.id}: ${FAMILY_LABEL[unpeered.r.family]} on ${unpeered.sym} at ${iv}`);
        }
        const newsKey = this.sim.news.map((n) => n.title).join('|');
        if (newsKey && newsKey !== this.lastNews && this.sim.employees.filter((x) => x.cfg.roleType === 'researcher').indexOf(e) === 0) {
          this.lastNews = newsKey;
          return mk('news-brief', {}, 'News brief: which headlines touch our markets');
        }
        const stale = [...INSTRUMENTS].map((i) => i.sym).sort((a, b) => (this.regimes.get(a)?.t ?? -1) - (this.regimes.get(b)?.t ?? -1)).slice(0, 4);
        return mk('regime-report', { syms: stale }, `Regime report: ${stale.join(', ')}`);
      }
      case 'risk': {
        if (t - this.lastRisk > 60) {
          this.lastRisk = t;
          return mk('risk-report', {}, 'Firm risk report: exposure, VaR, daily loss vs limit');
        }
        return mk('risk-report', {}, 'Monitor limits and live positions');
      }
      case 'pm': {
        const book = this.sim.finance.traders.size ? [...this.sim.finance.pmByBook.entries()].find(([, pm]) => pm === id)?.[0] : undefined;
        if (!book) return mk('perf-review', {}, 'Review firm performance');
        const pending = this.strats.some((s) => s.book === book && s.status === 'approved');
        if (pending || t - (this.lastAlloc.get(book) ?? -1e9) > 240) {
          this.lastAlloc.set(book, t);
          return mk('allocation', { book }, `Allocate ${BOOK_INDEX.get(book as never)?.short ?? book} risk budget across approved strategies`);
        }
        return mk('perf-review', { book }, `Performance review: ${BOOK_INDEX.get(book as never)?.short ?? book} live strategies`);
      }
      case 'tech': {
        const k = (t + e.index) % 3;
        if (k === 0) { const iv = INTERVALS[(Math.floor(t / 20) + e.index) % INTERVALS.length]; return mk('data-refresh', { interval: iv }, `Refresh ${iv} candles for all ${INSTRUMENTS.length} markets`); }
        if (k === 1) return mk('feed-check', {}, 'Check Co-Invest feed health (latency, errors, staleness)');
        return mk('engine-selftest', {}, 'Backtest engine self-test (known-answer cases)');
      }
      case 'ops':
        return (t + e.index) % 2 ? mk('reconciliation', {}, 'Reconcile strategy books with the firm ledger') : mk('pnl-report', {}, 'P&L report by book and strategy');
      case 'ceo':
        return mk('review-reports', {}, 'Read reports from the heads of department and decide');
      case 'receptionist':
        return mk('room-schedule', {}, "Today's room bookings and meetings");
      case 'coordinator':
        return mk('meeting-minutes', {}, 'Write minutes for finished meetings');
    }
    return undefined;
  }

  /** Next untested (or least recently tested) set-up for a trader, guided by research and meeting decisions. */
  private nextResearch(id: string): WorkTask['params'] | null {
    const tr = this.sim.finance.traders.get(id);
    if (!tr) return null;
    const syms = tr.coverage.length ? tr.coverage : [INSTRUMENTS[0].sym];
    const t = this.now();
    const f = this.focus.get(id);
    const options: { sym: string; family: Family; interval: Interval; score: number }[] = [];
    syms.forEach((sym, si) => {
      const reg = this.regimes.get(sym);
      const fams = f?.family && f.until > t ? [f.family, ...FAMILIES.filter((x) => x !== f.family)] : familiesFor(reg?.trend ?? 'up');
      fams.forEach((family, fi) => {
        (f?.interval && f.until > t ? [f.interval, ...INTERVALS.filter((x) => x !== f.interval)] : (['4h', '1d', '1h'] as Interval[])).forEach((interval, ii) => {
          if (this.strats.some((s) => s.sym === sym && s.r.family === family && s.r.interval === interval && (s.status === 'live' || s.status === 'approved' || s.status === 'risk-review'))) return;
          if (this.tasks.some((x) => x.kind === 'research' && (x.status === 'active' || x.status === 'waiting') && x.params.sym === sym && x.params.family === family && x.params.interval === interval)) return;
          const last = this.tested.get(`${sym}|${family}|${interval}`);
          // untested first; retest after the data has moved on (1h: 12 h, 4h: 2 days, 1d: 5 days)
          const age = last ? t - last.t : Infinity;
          const fresh = { '1h': 720, '4h': 2880, '1d': 7200 }[interval];
          const score = (age === Infinity ? 1000 : age > fresh ? 100 + age / 60 : age / 600) - fi * 3 - ii * 2 - si;
          options.push({ sym, family, interval, score });
        });
      });
    });
    options.sort((a, b) => b.score - a.score);
    const o = options[0];
    return o ? { sym: o.sym, family: o.family, interval: o.interval } : null;
  }

  // ------------------------------------------------------------------ doing the work (real computations)
  private complete(t: WorkTask): WorkTask['result'] {
    const p = t.params;
    switch (t.kind) {
      case 'research': {
        const cs = this.data?.candles(p.sym!, p.interval!);
        if (!cs) return { ok: false, summary: `no data for ${p.sym} ${p.interval}` };
        const r = research(p.sym!, p.family!, p.interval!, cs);
        if (!r) return { ok: false, summary: `only ${cs.length} candles: not enough history to test` };
        this.tested.set(`${p.sym}|${p.family}|${p.interval}`, { t: this.now(), pass: r.pass, sharpe: r.test.sharpe, family: p.family!, interval: p.interval!, sym: p.sym! });
        const streak = r.pass ? 0 : (this.failStreak.get(t.owner) ?? 0) + 1;
        this.failStreak.set(t.owner, streak);
        if (r.pass) this.newStrategy(t.owner, r);
        else if (streak >= 5) this.researchMeeting(t.owner);
        return { ok: true, summary: r.verdict, detail: [`In-sample: ${(r.train.ret * 100).toFixed(2)}%, Sharpe ${r.train.sharpe.toFixed(2)}, ${r.train.trades} trades`, `Out-of-sample: ${(r.test.ret * 100).toFixed(2)}%, Sharpe ${r.test.sharpe.toFixed(2)}, PF ${r.test.pf.toFixed(2)}, DD ${(r.test.maxDD * 100).toFixed(1)}%, ${r.test.trades} trades`, `Robustness ${(r.robustness * 100).toFixed(0)}% of ${r.tested} settings`] };
      }
      case 'peer-review': {
        const s = this.strats.find((x) => x.id === p.stratId);
        const cs = this.data?.candles(p.sym!, p.interval!);
        if (!s || !cs) return { ok: false, summary: `no data for ${p.sym} ${p.interval}` };
        const r = research(p.sym!, p.family!, p.interval!, cs);
        s.peer = r && r.test.sharpe > 0 ? `corroborated at ${p.interval} (Sharpe ${r.test.sharpe.toFixed(2)})` : `not seen at ${p.interval}${r ? ` (Sharpe ${r.test.sharpe.toFixed(2)})` : ''}: treat as fragile`;
        s.notes.push({ t: this.now(), text: `Peer review by ${this.name(t.owner)}: ${s.peer}` });
        return { ok: true, summary: `#${s.id} ${s.sym}: ${s.peer}` };
      }
      case 'regime-report': {
        const lines: string[] = [];
        for (const sym of p.syms ?? []) {
          const cs = this.data?.candles(sym, '4h');
          if (!cs) { this.data?.request(sym, '4h'); lines.push(`${sym}: waiting for data`); continue; }
          const r = regime(cs);
          if (!r) continue;
          this.regimes.set(sym, { ...r, t: this.now() });
          lines.push(`${sym}: ${r.trend === 'range' ? 'range-bound' : `${r.trend}-trend`}, RSI ${r.rsi.toFixed(0)}, 4-day ${(r.chg * 100).toFixed(1)}%, ATR ${(r.vol * 100).toFixed(2)}%`);
        }
        return { ok: lines.length > 0, summary: lines.slice(0, 2).join('; ') || 'no data yet', detail: lines };
      }
      case 'news-brief': {
        const hits = INSTRUMENTS.map((i) => ({ sym: i.sym, n: this.sim.news.filter((h) => new RegExp(`\\b(${i.sym}|${i.name.split(' ')[0]})\\b`, 'i').test(h.title)).length })).filter((x) => x.n);
        return { ok: true, summary: hits.length ? `Headlines touch ${hits.map((h) => `${h.sym} (${h.n})`).join(', ')}` : `${this.sim.news.length} headlines, none name our markets directly`, detail: this.sim.news.slice(0, 6).map((h) => h.title) };
      }
      case 'stress-test': {
        const s = this.strats.find((x) => x.id === p.stratId);
        const cs = s && this.data?.candles(s.sym, s.r.interval);
        if (!s || !cs) return { ok: false, summary: 'no data for the stress test' };
        const st = stressTest(s.r, cs);
        s.status = st.ok ? 'approved' : 'rejected';
        s.notes.push({ t: this.now(), text: `${this.name(t.owner)}: ${st.note}` });
        if (st.ok) {
          const pm = this.sim.finance.pmByBook.get(s.book as never);
          if (pm) this.task('allocation', pm, this.managerOf(pm), { book: s.book }, `Allocate capital to approved strategy #${s.id} (${s.sym})`);
        }
        return { ok: true, summary: `#${s.id} ${s.sym}: ${st.note}` };
      }
      case 'risk-report': return this.riskReport();
      case 'allocation': return this.allocate(p.book ?? 'eq', t.owner);
      case 'perf-review': return this.perfReview(p.book, t.owner);
      case 'review-live': {
        const mine = this.strats.filter((s) => s.owner === t.owner && s.status === 'live');
        const lines = mine.map((s) => `#${s.id} ${s.sym} ${s.r.interval}: forward ${fmtMoney(s.fwd.pnl)} over ${s.fwd.trades} trades, DD ${fmtMoney(s.fwd.dd)}, position ${s.qty.toFixed(4)}`);
        return { ok: true, summary: lines[0] ?? 'no live strategies', detail: lines };
      }
      case 'data-refresh': {
        for (const i of INSTRUMENTS) this.data?.request(i.sym, p.interval!);
        const h = this.data?.health();
        const have = INSTRUMENTS.filter((i) => this.data?.candles(i.sym, p.interval!)).length;
        const ok = !!h && have > 0;
        this.sim.tech.recordJob(Math.floor(this.sim.minute), t.owner, `data/candles-${p.interval}`, `Refresh ${p.interval} candles: ${have}/${INSTRUMENTS.length} markets`, ok, have);
        return { ok, summary: `${have}/${INSTRUMENTS.length} markets have ${p.interval} history; ${h ? `${h.calls} calls, ${h.errors} errors, ${h.latencyMs.toFixed(0)} ms avg` : 'no data connection'}` };
      }
      case 'feed-check': {
        const h = this.data?.health();
        const age = this.sim.live ? (Date.now() - this.sim.liveUpdatedAt) / 1000 : Infinity;
        const bad = !this.sim.live || age > 600;
        if (this.sim.tech) this.sim.tech.health = { latencyMs: h?.latencyMs ?? 0, errors: h?.errors ?? 0, staleSec: age, calls: h?.calls ?? 0 };
        if (bad && !this.sim.tech.incidentActive) {
          this.sim.tech.openIncident(Math.floor(this.sim.minute), 'Live market data not updating', `Last price update ${Number.isFinite(age) ? `${Math.round(age)} s ago` : 'never'}; ${h?.lastError ?? 'connector unavailable'}`);
          this.meeting('data-incident', 'Data incident: live prices not updating', [t.owner, this.head('tech')?.cfg.id ?? t.owner, this.head('risk')?.cfg.id ?? t.owner], 's-tech', { age: Math.round(Number.isFinite(age) ? age : -1) });
        } else if (!bad && this.sim.tech.incidentActive) {
          this.sim.tech.resolveIncident(Math.floor(this.sim.minute), `Feed healthy again (last update ${Math.round(age)} s ago)`);
        }
        return { ok: !bad, summary: bad ? `Live prices stale (${Number.isFinite(age) ? `${Math.round(age)} s` : 'never received'}): incident opened` : `Healthy: last price ${Math.round(age)} s ago, ${h?.latencyMs.toFixed(0) ?? '?'} ms avg latency, ${h?.errors ?? 0} errors` };
      }
      case 'engine-selftest': {
        const ok = selfTest();
        this.sim.tech.recordJob(Math.floor(this.sim.minute), t.owner, 'ci/backtest-selftest', 'Known-answer backtests (trend, reversal, costs)', ok, 3);
        return { ok, summary: ok ? 'All known-answer backtests pass' : 'Backtest self-test FAILED' };
      }
      case 'reconciliation': {
        const r = this.reconcile();
        return { ok: r.breaks === 0, summary: r.breaks ? `${r.breaks} breaks: ${r.lines.join('; ')}` : `Ledger matches strategy books (${r.checked} positions)` };
      }
      case 'pnl-report': {
        const f = this.sim.finance.firm(Math.floor(this.sim.minute));
        const lines = f.books.map((b) => `${b.short}: ${fmtMoney(b.pnl)} (${(b.pnlPct * 100).toFixed(2)}%), gross ${fmtMoney(b.gross)}`);
        return { ok: true, summary: `Firm ${fmtMoney(f.pnl)} today on ${fmtMoney(f.capital)} paper capital`, detail: lines };
      }
      case 'daily-plan': return { ok: true, summary: `${this.objectives.length} objectives set` };
      case 'review-reports': {
        const since = this.now() - 180;
        const rs = this.reports.filter((r) => r.t >= since);
        const bad = rs.filter((r) => !r.ok);
        const live = this.strats.filter((s) => s.status === 'live');
        return { ok: true, summary: `${rs.length} reports in 3 h (${bad.length} problems); ${live.length} strategies live; objectives: ${this.objectives.map((o) => this.objectiveProgress(o).text).join(', ')}` };
      }
      case 'room-schedule': {
        const up = this.sim.events.filter((ev) => ev.status === 'scheduled').slice(0, 5);
        return { ok: true, summary: up.length ? up.map((ev) => `${fmtTime(ev.start)} ${ev.title}`).join('; ') : 'No more meetings booked today' };
      }
      case 'meeting-minutes': {
        const done = this.sim.events.filter((ev) => ev.status === 'completed').slice(-3);
        return { ok: true, summary: done.length ? done.map((ev) => `${ev.title}: ${ev.notes.slice(-1)[0] ?? 'held'}`).join('; ') : 'No meetings finished yet' };
      }
    }
  }

  // ------------------------------------------------------------------ strategies
  private newStrategy(owner: string, r: ResearchResult) {
    const book = this.sim.finance.traders.get(owner)?.bookId ?? 'eq';
    const s: Strat = { id: this.seq++, owner, sym: r.symbol, book, r, status: 'risk-review', alloc: 0, qty: 0, entryPx: 0, realized: 0, fwd: { trades: 0, pnl: 0, peak: 0, dd: 0, since: this.now() }, notes: [{ t: this.now(), text: `Passed walk-forward test (${this.name(owner)})` }] };
    this.strats.unshift(s);
    const head = this.head('risk');
    const analysts = this.sim.employees.filter((e) => e.cfg.roleType === 'risk');
    const who = analysts.sort((a, b) => this.tasks.filter((x) => x.owner === a.cfg.id && x.status === 'queued').length - this.tasks.filter((x) => x.owner === b.cfg.id && x.status === 'queued').length)[0];
    if (who) this.task('stress-test', who.cfg.id, head?.cfg.id ?? null, { stratId: s.id }, `Stress-test strategy #${s.id}: ${FAMILY_LABEL[r.family]} on ${r.symbol} ${r.interval}`);
    const e = this.sim.byId.get(owner);
    if (e) this.sim.addLog(`${e.cfg.name}: strategy #${s.id} passed (${r.verdict.slice(6, 90)}…); sent to Risk`, 'trade');
  }

  private allocate(book: string, pm: string): WorkTask['result'] {
    const b = BOOK_INDEX.get(book as never);
    if (!b) return { ok: false, summary: 'unknown book' };
    const cands = this.strats.filter((s) => s.book === book && (s.status === 'approved' || s.status === 'live'));
    if (!cands.length) return { ok: true, summary: `No approved strategies in ${b.short} yet; capital stays in cash` };
    const budget = b.capital * (1 - LIMITS.reservePct);
    const w = cands.map((s) => Math.max(0.2, s.r.test.sharpe) * (s.peer?.startsWith('corroborated') ? 1.2 : 0.8));
    const sum = w.reduce((a, x) => a + x, 0);
    const lines: string[] = [];
    const perSym = new Map<string, number>();
    cands.forEach((s, i) => {
      // diversify: no single strategy above 25 % and no single market above 35 % of the book
      const used = perSym.get(s.sym) ?? 0;
      s.alloc = Math.max(0, Math.min(b.capital * LIMITS.maxAllocPct, (budget * w[i]) / sum, b.capital * LIMITS.maxSymbolPct - used));
      perSym.set(s.sym, used + s.alloc);
      if (s.status === 'approved' && !this.kill.on) { s.status = 'live'; s.fwd.since = this.now(); s.notes.push({ t: this.now(), text: `Live with ${fmtMoney(s.alloc)} (paper), allocated by ${this.name(pm)}` }); }
      lines.push(`#${s.id} ${s.sym} ${s.r.interval}: ${fmtMoney(s.alloc)}`);
    });
    this.sim.addLog(`${this.name(pm)} allocated ${b.short}: ${lines.join(', ')}`, 'trade');
    return { ok: true, summary: `${cands.length} strategies funded: ${lines.join('; ')}`, detail: lines };
  }

  private perfReview(book: string | undefined, pm: string): WorkTask['result'] {
    const live = this.strats.filter((s) => s.status === 'live' && (!book || s.book === book));
    const cut: string[] = [];
    for (const s of live) {
      const ddLimit = Math.max(0.03 * s.alloc, 2 * s.r.test.maxDD * s.alloc);
      const losing = s.fwd.trades >= 12 && s.fwd.pnl < 0;
      if (s.fwd.dd > ddLimit || losing) {
        s.status = 'retired';
        s.notes.push({ t: this.now(), text: `Retired by ${this.name(pm)}: ${losing ? `losing after ${s.fwd.trades} trades` : `drawdown ${fmtMoney(s.fwd.dd)} > limit ${fmtMoney(ddLimit)}`}` });
        this.flatten(s, 'Strategy retired');
        cut.push(`#${s.id} ${s.sym}`);
      }
    }
    const pnl = live.reduce((a, s) => a + s.fwd.pnl, 0);
    return { ok: true, summary: `${live.length} live strategies, forward P&L ${fmtMoney(pnl)}${cut.length ? `; retired ${cut.join(', ')}` : '; none breached the cut rules'}` };
  }

  private riskReport(): WorkTask['result'] {
    const m = Math.floor(this.sim.minute);
    const f = this.sim.finance.firm(m);
    let varSum = 0;
    const lines: string[] = [];
    for (const p of this.firmPositions()) {
      const cs = this.data?.candles(p.sym, '1d');
      const vol = cs ? realizedVol(cs, '1d', 30) / Math.sqrt(365) : 0.03;
      varSum += Math.abs(p.notional) * vol * 1.65; // perfectly correlated (conservative)
      lines.push(`${p.sym}: ${fmtMoney(p.notional)} notional, daily vol ${(vol * 100).toFixed(2)}%`);
    }
    const lossPct = -f.pnl / Math.max(1, f.capital);
    const grossMult = f.gross / Math.max(1, f.capital);
    const breach = lossPct > LIMITS.dailyLossPct || grossMult > LIMITS.maxGrossMult;
    if (lossPct > LIMITS.dailyLossPct && !this.kill.on) this.killSwitch(`daily loss ${(lossPct * 100).toFixed(2)}% > ${(LIMITS.dailyLossPct * 100).toFixed(0)}% limit`);
    return { ok: !breach, summary: `Gross ${fmtMoney(f.gross)} (${grossMult.toFixed(2)}× capital), 1-day VaR95 ${fmtMoney(varSum)} (conservative), today ${fmtMoney(f.pnl)}${breach ? ' — LIMIT BREACH' : ''}`, detail: lines };
  }

  private firmPositions(): { sym: string; qty: number; notional: number }[] {
    const agg = new Map<string, number>();
    for (const t of this.sim.finance.traders.values()) for (const p of t.positions.values()) if (p.qty) agg.set(p.sym, (agg.get(p.sym) ?? 0) + p.qty);
    return [...agg.entries()].map(([sym, qty]) => ({ sym, qty, notional: qty * this.sim.market.price(sym) }));
  }

  /** Strategy books vs the firm ledger: the sum of each trader's strategy positions must equal their ledger position. */
  reconcile(): { breaks: number; checked: number; lines: string[] } {
    const want = new Map<string, number>();
    for (const s of this.strats) if (s.qty) want.set(`${s.owner}|${s.sym}`, (want.get(`${s.owner}|${s.sym}`) ?? 0) + s.qty);
    const lines: string[] = [];
    let checked = 0;
    const keys = new Set(want.keys());
    for (const t of this.sim.finance.traders.values()) for (const p of t.positions.values()) if (p.qty) keys.add(`${t.empId}|${p.sym}`);
    for (const k of keys) {
      checked++;
      const [emp, sym] = k.split('|');
      const have = this.sim.finance.traders.get(emp)?.positions.get(sym)?.qty ?? 0;
      if (Math.abs(have - (want.get(k) ?? 0)) > 1e-6) lines.push(`${this.name(emp)} ${sym}: ledger ${have} vs strategies ${want.get(k) ?? 0}`);
    }
    return { breaks: lines.length, checked, lines };
  }

  // ------------------------------------------------------------------ strategy desk (execution, paper)
  private runDesk(m: number) {
    // no live price, no trading: positions are only opened, marked and closed at real market prices
    if (!this.sim.live) return;
    const f = this.sim.finance.firm(m);
    if (!this.kill.on && f.capital > 0 && -f.pnl / f.capital > LIMITS.dailyLossPct) this.killSwitch(`daily loss ${(-f.pnl / f.capital * 100).toFixed(2)}% hit the ${(LIMITS.dailyLossPct * 100).toFixed(0)}% limit`);
    for (const s of this.strats) {
      if (s.status !== 'live' || this.kill.on) continue;
      const cs = this.data?.candles(s.sym, s.r.interval);
      this.data?.request(s.sym, s.r.interval);
      if (!cs || cs.length < 30) continue;
      const px = this.sim.market.price(s.sym) || cs[cs.length - 1].c;
      if (!(px > 0)) continue;
      const pos = positions(s.r.best, cs);
      const sig = pos[pos.length - 1];
      const vol = realizedVol(cs, s.r.interval) || 0.6;
      const size = s.alloc * Math.min(1.5, LIMITS.volTarget / vol);
      const target = roundQty(s.sym, (sig * size) / px);
      this.mark(s, px);
      const diff = target - s.qty;
      if (Math.abs(diff) * px < 0.02 * s.alloc || Math.abs(diff) < 1e-4) continue;
      // gross limit
      if (sig !== 0 && f.gross + Math.abs(diff) * px > LIMITS.maxGrossMult * f.capital) continue;
      this.execute(s, diff, m, sig === 0 ? 'Strategy exit' : `Strategy #${s.id} signal ${sig > 0 ? 'long' : 'short'} (${FAMILY_LABEL[s.r.family]}, ${s.r.interval})`);
    }
  }

  private execute(s: Strat, diff: number, m: number, reason: string) {
    const o = this.sim.finance.placeOrder(s.owner, s.sym, diff > 0 ? 'BUY' : 'SELL', Math.abs(diff), 'MKT', m, reason);
    if (!o || o.status !== 'filled' || o.fillPx === undefined) return;
    const px = o.fillPx;
    const before = s.qty;
    const after = before + diff;
    // realized P&L on the part that reduces the position
    if (before !== 0 && Math.sign(diff) !== Math.sign(before)) {
      const closed = Math.min(Math.abs(diff), Math.abs(before));
      s.realized += (px - s.entryPx) * closed * Math.sign(before);
      if (after === 0 || Math.sign(after) !== Math.sign(before)) s.fwd.trades++;
    }
    if (after !== 0 && (before === 0 || Math.sign(after) !== Math.sign(before))) s.entryPx = px;
    else if (after !== 0 && Math.sign(diff) === Math.sign(before)) s.entryPx = (s.entryPx * Math.abs(before) + px * Math.abs(diff)) / Math.abs(after);
    s.qty = after;
    this.mark(s, px);
  }

  private mark(s: Strat, px: number) {
    const pnl = s.realized + (s.qty ? (px - s.entryPx) * s.qty : 0);
    s.fwd.pnl = pnl;
    s.fwd.peak = Math.max(s.fwd.peak, pnl);
    s.fwd.dd = Math.max(s.fwd.dd, s.fwd.peak - pnl);
  }

  private flatten(s: Strat, reason: string) {
    if (s.qty) this.execute(s, -s.qty, Math.floor(this.sim.minute), reason);
  }

  private killSwitch(reason: string) {
    this.kill = { on: true, at: this.now(), reason };
    for (const s of this.strats) if (s.status === 'live') { this.flatten(s, `Kill switch: ${reason}`); s.status = 'paused'; s.notes.push({ t: this.now(), text: `Paused by kill switch: ${reason}` }); }
    this.sim.addLog(`KILL SWITCH: ${reason}. All strategies flattened and paused.`, 'risk');
    const ceo = this.sim.employees.find((e) => e.cfg.roleType === 'ceo');
    if (ceo) this.sim.ownerMessage(ceo, `Risk alert: ${reason}. I have flattened and paused every strategy and called the risk committee.`);
    const people = [ceo?.cfg.id, this.head('risk')?.cfg.id, ...this.sim.employees.filter((e) => e.cfg.roleType === 'pm').map((e) => e.cfg.id)].filter((x): x is string => !!x);
    this.meeting('loss-limit', 'Risk committee: daily loss limit hit', people, 's-board', { reason });
  }

  /** A real finance alert (limit breach on live paper positions). */
  onAlert(text: string) {
    const head = this.head('risk');
    if (head) this.task('risk-report', head.cfg.id, this.managerOf(head.cfg.id), {}, `Urgent: ${text}`);
  }

  // ------------------------------------------------------------------ problem-solving meetings
  private researchMeeting(trader: string) {
    const pm = this.managerOf(trader);
    const people = [trader, pm, this.head('researcher')?.cfg.id, this.sim.employees.find((e) => /head trader/i.test(e.cfg.title))?.cfg.id].filter((x, i, a): x is string => !!x && a.indexOf(x) === i);
    this.failStreak.set(trader, 0);
    this.meeting('research-direction', `Research direction: ${this.name(trader)} has 5 failed tests in a row`, people, 'f-m1a', { trader });
  }

  private meeting(kind: PendingDecision['kind'], title: string, people: string[], room: string, data: Record<string, string | number>) {
    const m = Math.floor(this.sim.minute);
    let start = Math.ceil((m + 10) / 5) * 5;
    const rooms = [room, 'f-m1a', 'f-m1b', 'g-interview', 's-board'].filter((r, i, a) => a.indexOf(r) === i && ROOMS.some((x) => x.id === r));
    let chosen = '';
    for (let tries = 0; tries < 30 && !chosen; tries++) {
      const end = start + 20;
      const busy = this.sim.events.some((ev) => ev.status !== 'cancelled' && ev.status !== 'completed' && start < ev.end && end > ev.start && ev.attendeeIds.some((id) => people.includes(id)));
      if (!busy) chosen = rooms.find((r) => !this.sim.events.some((ev) => ev.roomId === r && ev.status !== 'cancelled' && ev.status !== 'completed' && start < ev.end && end > ev.start)) ?? '';
      if (!chosen) start += 10;
    }
    if (!chosen) chosen = rooms[0];
    const ev: OfficeEvent = { id: `d${this.sim.day}-work-${this.seq++}`, kind: 'workshop', title, roomId: chosen, start, end: start + 20, attendeeIds: people, status: 'scheduled', agenda: [title], notes: [], dynamic: true };
    this.sim.events.push(ev);
    this.sim.events.sort((a, b) => a.start - b.start);
    this.decisions.set(ev.id, { kind, data });
    this.sim.addLog(`Meeting booked ${fmtTime(start)}: ${title}`, 'event');
  }

  /** Called when a work meeting ends: the decision taken from the evidence on the table. */
  onMeetingEnd(ev: OfficeEvent) {
    const d = this.decisions.get(ev.id);
    if (!d) return;
    this.decisions.delete(ev.id);
    let decision = '';
    if (d.kind === 'research-direction') {
      const trader = String(d.data.trader);
      // pick the family and interval that have done best out of sample across the whole firm so far
      const stats = new Map<string, { n: number; s: number }>();
      for (const r of this.tested.values()) {
        for (const k of [`f:${r.family}`, `i:${r.interval}`]) { const x = stats.get(k) ?? { n: 0, s: 0 }; x.n++; x.s += r.sharpe; stats.set(k, x); }
      }
      const best = (prefix: string) => [...stats.entries()].filter(([k]) => k.startsWith(prefix)).sort((a, b) => b[1].s / b[1].n - a[1].s / a[1].n)[0]?.[0].slice(2);
      const family = best('f:') as Family | undefined;
      const interval = best('i:') as Interval | undefined;
      this.focus.set(trader, { family, interval, until: this.now() + 1440 });
      decision = `Decision: ${this.name(trader)} focuses on ${family ? FAMILY_LABEL[family] : 'other families'}${interval ? ` at ${interval}` : ''} for the next day (best firm-wide out-of-sample results so far).`;
    } else if (d.kind === 'loss-limit') {
      decision = 'Decision: strategies stay paused until tomorrow; each PM re-reviews their book and halves allocations on restart.';
      for (const s of this.strats) if (s.status === 'paused') s.alloc *= 0.5;
    } else if (d.kind === 'data-incident') {
      decision = 'Decision: no new positions while prices are stale; Technology keeps checking every 15 minutes and Risk watches open positions.';
    }
    ev.notes.push(decision);
    this.sim.addLog(`${ev.title}: ${decision}`, 'event');
    const ceo = this.sim.employees.find((e) => e.cfg.roleType === 'ceo');
    if (ceo && d.kind !== 'research-direction') this.sim.ownerMessage(ceo, `${ev.title}. ${decision}`);
  }

  /** New day: the kill switch is lifted (with the reduced allocations decided by the committee). */
  newDay() {
    if (this.kill.on) {
      this.kill = { on: false, at: 0, reason: '' };
      for (const s of this.strats) if (s.status === 'paused') { s.status = 'live'; s.notes.push({ t: this.now(), text: 'Restarted after the loss-limit pause (half allocation)' }); }
    }
  }

  // ------------------------------------------------------------------ persistence (the office keeps its memory across reloads)
  serialize() {
    return { v: 1, seq: this.seq, tasks: this.tasks.slice(0, 200), strats: this.strats, reports: this.reports.slice(0, 150), tested: [...this.tested.entries()], regimes: [...this.regimes.entries()], focus: [...this.focus.entries()], kill: this.kill, objectives: this.objectives, planDay: this.planDay };
  }

  restore(d: ReturnType<WorkEngine['serialize']>) {
    if (!d || d.v !== 1) return;
    this.seq = Math.max(this.seq, d.seq ?? 1);
    // unfinished work resumes as queued (the page was closed: nothing ran in between)
    this.tasks = (d.tasks ?? []).map((t) => (t.status === 'active' || t.status === 'waiting' ? { ...t, status: 'queued' as const, progress: 0 } : t));
    this.strats = d.strats ?? [];
    this.reports = d.reports ?? [];
    this.tested = new Map(d.tested ?? []);
    this.regimes = new Map(d.regimes ?? []);
    this.focus = new Map(d.focus ?? []);
    this.kill = d.kill ?? this.kill;
    this.objectives = d.objectives ?? [];
    this.planDay = d.planDay ?? -1;
  }
}

/** Known-answer checks for the backtest engine (run by Technology). */
export function selfTest(): boolean {
  const mk = (closes: number[]): Candle[] => closes.map((c, i) => ({ t: i * 3600e3, o: c, h: c * 1.001, l: c * 0.999, c, v: 1 }));
  const up = mk(Array.from({ length: 150 }, (_, i) => 100 * Math.pow(1.002, i)));
  const trend = backtest({ family: 'ma-cross', interval: '1h', params: { fast: 5, slow: 30 } }, up);
  const flat = mk(Array.from({ length: 150 }, () => 100));
  const none = backtest({ family: 'ma-cross', interval: '1h', params: { fast: 5, slow: 30 } }, flat);
  const costOnly = backtest({ family: 'momentum', interval: '1h', params: { look: 12, band: 0 } }, mk(Array.from({ length: 150 }, (_, i) => 100 + (i % 2 ? 0.3 : -0.3))));
  return trend.ret > 0.1 && Math.abs(none.ret) < 0.01 && costOnly.ret <= 0.001 && PASS.minTrades > 0;
}
