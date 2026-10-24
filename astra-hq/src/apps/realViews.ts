// Monitor content for the real office: what each person is actually doing (their task from their senior,
// progress, result) and the real data behind it: Co-Invest candles, strategy test results, the strategy desk,
// feed health and the jobs the office ran. Used instead of the illustrative screens wherever those showed
// made-up content (code, valuation models, service CPU).
import type { Employee, Simulation } from '../sim/simulation';
import type { WorkTask } from '../sim/work';
import { FAMILY_LABEL } from '../sim/research';
import { INSTRUMENTS, fmtPx } from '../sim/market';
import { fmtMoney, fmtPct, fmtTime } from '../util/math';
import type { AppView, Tone, Widget } from './types';

const STATUS_TONE: Record<string, Tone> = { live: 'pos', approved: 'accent', 'risk-review': 'warn', rejected: 'muted', retired: 'neg', paused: 'warn' };

export function taskWidget(sim: Simulation, e: Employee): Widget {
  const t = sim.work.current(e.cfg.id);
  const last = sim.work.tasks.find((x) => x.owner === e.cfg.id && x.result);
  const boss = sim.work.managerOf(e.cfg.id);
  return {
    type: 'kpis', items: [
      { label: 'Current task', value: t ? t.title : 'Asking for the next task', tone: 'accent' },
      { label: 'Progress', value: t ? (t.status === 'waiting' ? 'waiting for data' : `${Math.round(t.progress * 100)}%`) : '-' },
      { label: 'Assigned by', value: t ? sim.name(t.by) : boss ? sim.name(boss) : 'Owner' },
      { label: 'Last result', value: last?.result ? last.result.summary.slice(0, 90) : '-', tone: last?.result ? (last.result.ok ? 'pos' : 'warn') : undefined },
    ],
  };
}

function taskLog(sim: Simulation, id: string, n = 8): Widget {
  const ts = sim.work.tasks.filter((t) => t.owner === id).slice(0, n);
  return { type: 'table', title: 'My work today', columns: ['Time', 'Task', 'From', 'Status', 'Result'], align: ['l', 'l', 'l', 'l', 'l'],
    rows: ts.map((t) => [fmtTime(t.created % 1440), t.title, sim.name(t.by).split(' ')[0], t.status, t.result?.summary.slice(0, 70) ?? '']),
    tones: ts.map((t) => [undefined, undefined, 'muted', t.status === 'accepted' ? 'pos' : t.status === 'rework' ? 'warn' : 'accent', t.result ? (t.result.ok ? undefined : 'warn') : 'muted']) };
}

function candleChart(sim: Simulation, sym: string, iv: '1h' | '4h' | '1d'): Widget {
  const cs = sim.work.data?.candles(sym, iv);
  if (!cs) return { type: 'text', title: `${sym} ${iv}`, lines: ['Waiting for Co-Invest candles…'] };
  return { type: 'chart', title: `${sym} ${iv} · ${cs.length} real candles · last ${fmtPx(sym, cs[cs.length - 1].c)}`, series: cs.map((c) => c.c), baseline: cs[0].c, footer: `${new Date(cs[0].t).toLocaleDateString()} – ${new Date(cs[cs.length - 1].t).toLocaleString()}` };
}

function testsTable(sim: Simulation, filter: (k: { sym: string }) => boolean, title: string, n = 10): Widget {
  const rows = [...sim.work.tested.values()].filter(filter).sort((a, b) => b.t - a.t).slice(0, n);
  return { type: 'table', title, columns: ['Market', 'Strategy', 'Bars', 'Out-of-sample Sharpe', 'Result'], align: ['l', 'l', 'l', 'r', 'l'],
    rows: rows.map((r) => [r.sym, FAMILY_LABEL[r.family], r.interval, r.sharpe.toFixed(2), r.pass ? 'PASS' : 'fail']),
    tones: rows.map((r) => [undefined, undefined, 'muted', r.sharpe > 0 ? 'pos' : 'neg', r.pass ? 'pos' : 'muted']) };
}

export function strategiesTable(sim: Simulation, filter: (s: { book: string; owner: string }) => boolean = () => true, n = 12): Widget {
  const ss = sim.work.strats.filter(filter).slice(0, n);
  return { type: 'table', title: `Strategies (${ss.filter((s) => s.status === 'live').length} live)`, columns: ['#', 'Market', 'Strategy', 'Owner', 'Status', 'Allocation', 'Position', 'Forward P&L'], align: ['l', 'l', 'l', 'l', 'l', 'r', 'r', 'r'],
    rows: ss.map((s) => [String(s.id), `${s.sym} ${s.r.interval}`, FAMILY_LABEL[s.r.family], sim.name(s.owner).split(' ')[0], s.status, fmtMoney(s.alloc), s.qty ? s.qty.toFixed(4) : '0', fmtMoney(s.fwd.pnl)]),
    tones: ss.map((s) => [undefined, undefined, undefined, 'muted', STATUS_TONE[s.status], undefined, undefined, s.fwd.pnl >= 0 ? 'pos' : 'neg']) };
}

function healthWidget(sim: Simulation): Widget {
  const h = sim.work.data?.health();
  const age = sim.live ? Math.round((Date.now() - sim.liveUpdatedAt) / 1000) : null;
  return { type: 'kpis', items: [
    { label: 'Live prices', value: age === null ? 'not connected' : `${age}s old`, tone: age === null || age > 120 ? 'crit' : 'pos' },
    { label: 'Co-Invest calls', value: String(h?.calls ?? 0) },
    { label: 'Errors', value: String(h?.errors ?? 0), tone: h?.errors ? 'warn' : undefined },
    { label: 'Avg latency', value: h?.latencyMs ? `${h.latencyMs.toFixed(0)} ms` : '-' },
  ] };
}

function jobsTable(sim: Simulation): Widget {
  const b = sim.tech.builds.slice(0, 10);
  return { type: 'table', title: 'Jobs run by the office (real)', columns: ['#', 'Time', 'Job', 'By', 'Result'], align: ['l', 'l', 'l', 'l', 'l'],
    rows: b.map((x) => [String(x.id), fmtTime(x.t), x.message, sim.name(x.author).split(' ')[0], x.status]),
    tones: b.map((x) => [undefined, undefined, undefined, 'muted', x.status === 'passed' ? 'pos' : x.status === 'failed' ? 'crit' : 'accent']) };
}

function regimeTable(sim: Simulation): Widget {
  const rows = INSTRUMENTS.map((i) => ({ sym: i.sym, r: sim.work.regimes.get(i.sym) }));
  return { type: 'table', title: 'Market regimes (from real 4h candles)', columns: ['Market', 'Regime', 'RSI', '4-day', 'ATR', 'Read'], align: ['l', 'l', 'r', 'r', 'r', 'l'],
    rows: rows.map(({ sym, r }) => [sym, r ? r.trend : '-', r ? r.rsi.toFixed(0) : '-', r ? fmtPct(r.chg, 1) : '-', r ? fmtPct(r.vol, 2) : '-', r ? fmtTime(r.t % 1440) : 'not yet']),
    tones: rows.map(({ r }) => [undefined, r?.trend === 'up' ? 'pos' : r?.trend === 'down' ? 'neg' : 'muted', undefined, r ? (r.chg >= 0 ? 'pos' : 'neg') : undefined, undefined, 'muted']) };
}

/** Real-office version of a monitor; returns false to fall back to the standard app (which already shows real data). */
export function realAppView(sim: Simulation, e: Employee | undefined, v: AppView, monitorIndex: number): boolean {
  if (!sim.realMode || !e) return false;
  const tab = v.tab;
  const task: WorkTask | undefined = sim.work.current(e.cfg.id);
  const sym = task?.params.sym ?? sim.finance.traders.get(e.cfg.id)?.coverage[0] ?? INSTRUMENTS[0].sym;
  switch (v.appId) {
    case 'trade-chart':
      v.widgets.push(taskWidget(sim, e));
      v.widgets.push(candleChart(sim, sym, task?.params.interval ?? '1h'));
      return true;
    case 'res-report':
      v.theme = 'light';
      v.widgets.push(taskWidget(sim, e));
      v.widgets.push(tab === 0 ? regimeTable(sim) : { type: 'text', title: 'Headlines (live)', lines: sim.news.length ? sim.news.slice(0, 8).map((n) => `• ${n.title} — ${n.source}`) : ['Waiting for Co-Invest headlines…'] });
      return true;
    case 'res-model':
      v.theme = 'light';
      v.widgets.push(tab === 0 ? testsTable(sim, () => true, 'Latest strategy tests across the desk (real candles)') : strategiesTable(sim));
      return true;
    case 'dev-editor':
      v.widgets.push(taskWidget(sim, e));
      v.widgets.push(tab === 0 ? taskLog(sim, e.cfg.id) : jobsTable(sim));
      return true;
    case 'dev-terminal':
      v.widgets.push(healthWidget(sim));
      v.widgets.push(tab === 0 ? jobsTable(sim) : { type: 'text', title: 'Incidents', lines: sim.tech.incident.log.length ? sim.tech.incident.log.map((l) => `${fmtTime(l.t)} ${l.text}`) : ['No incidents'] });
      if (sim.tech.incidentActive) v.banner = { text: `${sim.tech.incident.id} ${sim.tech.incident.title.toUpperCase()} · ${sim.tech.incident.status}`, tone: 'crit' };
      return true;
    case 'ops-tasks':
      v.widgets.push(taskWidget(sim, e));
      v.widgets.push(tab === 0 ? taskLog(sim, e.cfg.id) : { type: 'text', title: 'Reconciliation', lines: (() => { const r = sim.work.reconcile(); return [`${r.checked} positions checked, ${r.breaks} breaks`, ...r.lines]; })() });
      return true;
    case 'rec-visitors':
      v.widgets.push(taskWidget(sim, e));
      if (tab === 1) return false;
      v.widgets.push({ type: 'table', title: "Today's meetings", columns: ['Time', 'Meeting', 'Room', 'Status'], align: ['l', 'l', 'l', 'l'],
        rows: sim.events.slice(0, 14).map((ev) => [fmtTime(ev.start), ev.title, ev.roomId, ev.status]) });
      return true;
    default:
      // every first screen starts with the person's current task; the rest of the app shows its real data
      if (monitorIndex === 0 && tab === 0) v.widgets.push(taskWidget(sim, e));
      return false;
  }
}

/** Server room / infrastructure display in the real office: feed health and real jobs. */
export function realServerView(sim: Simulation, v: AppView) {
  v.widgets.push(healthWidget(sim));
  v.widgets.push(jobsTable(sim));
  if (sim.tech.incidentActive) v.banner = { text: `${sim.tech.incident.id} · ${sim.tech.incident.title} · ${sim.tech.incident.status.toUpperCase()}`, tone: 'crit' };
  else v.banner = { text: sim.live ? 'Live data flowing' : 'Waiting for live data', tone: sim.live ? 'pos' : 'warn' };
}
