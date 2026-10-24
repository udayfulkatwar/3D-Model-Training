// Builders for every simulated application and wall display. Pure functions of the simulation state.
import { BOOK_IDS, type BookId } from '../config/types';
import { FLOOR_NAMES, ROOMS, roomById } from '../world/building';
import { MONITOR_INDEX, PANELS, WS_INDEX } from '../world/furniture';
import { fmtMoney, fmtNum, fmtPct, fmtTime } from '../util/math';
import { hashRand } from '../util/rng';
import { APPS } from '../sim/apps';
import { BOOKS, BOOK_INDEX } from '../sim/finance';
import { INSTRUMENTS, INSTRUMENT_INDEX, fmtPx } from '../sim/market';
import { ACTIVITY_LABEL, type Employee, type Simulation } from '../sim/simulation';
import { SERVICES } from '../sim/tech';
import type { AppView, Tone, Widget } from './types';
import { EXCHANGES, sessionStatus } from './worldMarkets';
import { realAppView, realServerView, strategiesTable } from './realViews';

const tone = (v: number): Tone | undefined => (v > 0 ? 'pos' : v < 0 ? 'neg' : undefined);
const utilTone = (u: number): Tone | undefined => (u >= 1 ? 'crit' : u >= 0.8 ? 'warn' : undefined);

function presence(sim: Simulation, e: Employee | undefined): string | undefined {
  if (!e) return undefined;
  if (sim.presentAtDesk(e)) return undefined;
  return `${e.cfg.name.split(' ')[0]} is away (${ACTIVITY_LABEL[e.activity].toLowerCase()}) · session locked to viewing`;
}

function bookOf(sim: Simulation, e: Employee | undefined): BookId {
  if (!e) return 'eq';
  return sim.finance.traders.get(e.cfg.id)?.bookId ?? e.cfg.bookId ?? 'eq';
}

function instrumentRow(sim: Simulation, sym: string): string[] {
  const px = sim.market.price(sym);
  const inst = INSTRUMENTS[INSTRUMENT_INDEX.get(sym)!];
  const spread = px * (inst.kind === 'equity' ? 0.0002 : 0.0001);
  return [sym, fmtPx(sym, px), fmtPct(sim.market.change(sym)), fmtPx(sym, px - spread), fmtPx(sym, px + spread)];
}

export function dataTag(sim: Simulation): string {
  return sim.live ? 'Live prices · Paper' : 'Simulated Data';
}

/** Instrument slots by role (stable positions in INSTRUMENTS, whatever their current symbols). */
const REF = { lead: 0, index: 6, rates: 7, energy: 9 } as const;
const refSym = (k: keyof typeof REF) => INSTRUMENTS[REF[k]].sym;

function feedBanner(sim: Simulation): AppView['banner'] {
  return sim.market.feedDelayed ? { text: `MARKET DATA DELAYED · ${sim.tech.incident.id} under investigation`, tone: 'warn' } : undefined;
}

// ------------------------------------------------------------------ monitors
export function buildAppView(sim: Simulation, monitorId: string): AppView {
  const mon = MONITOR_INDEX.get(monitorId)!;
  const ws = WS_INDEX.get(mon.workstationId)!;
  const st = sim.monitorState(monitorId)!;
  const app = APPS[st.appId];
  const e = sim.ownerOfWorkstation(ws.id);
  const m = Math.floor(sim.minute);
  const base: AppView = {
    key: monitorId, appId: st.appId, title: app.title, tabs: app.tabs, tab: st.tab,
    employeeName: e?.cfg.name ?? 'Unassigned', employeeId: e?.cfg.id, workstationLabel: ws.label,
    time: fmtTime(sim.minute), minute: m, theme: app.theme, layout: 'stack', widgets: [], status: presence(sim, e), dataTag: dataTag(sim),
  };
  const v = base;
  const tab = st.tab;
  if (realAppView(sim, e, v, mon.index)) return v;
  switch (st.appId) {
    case 'trade-chart': {
      const t = e ? sim.finance.traders.get(e.cfg.id) : undefined;
      v.banner = feedBanner(sim);
      if (tab === 2) {
        v.widgets.push({ type: 'table', title: 'Market overview', columns: ['Sym', 'Last', 'Chg', 'Bid', 'Ask'], align: ['l', 'r', 'r', 'r', 'r'], rows: INSTRUMENTS.map((i) => instrumentRow(sim, i.sym)), tones: INSTRUMENTS.map((i) => [undefined, undefined, tone(sim.market.change(i.sym))]) });
        break;
      }
      const sym = t?.coverage[tab] ?? t?.coverage[0] ?? refSym('index');
      const inst = INSTRUMENTS[INSTRUMENT_INDEX.get(sym)!];
      const pos = t?.positions.get(sym);
      const px = sim.market.price(sym);
      const posPnl = pos ? (px - pos.avg) * pos.qty * inst.mult + pos.realized : 0;
      v.widgets.push({ type: 'kpis', items: [
        { label: `${sym} last`, value: fmtPx(sym, px) },
        { label: 'Change', value: fmtPct(sim.market.change(sym)), tone: tone(sim.market.change(sym)) },
        { label: 'Position', value: fmtNum(pos?.qty ?? 0) },
        { label: 'Pos. P&L', value: fmtMoney(posPnl), tone: tone(posPnl) },
      ] });
      v.widgets.push({ type: 'chart', title: `${inst.name} (${sym}) · 1-minute`, series: sim.market.series(sym, 150), baseline: sim.market.prevClose[INSTRUMENT_INDEX.get(sym)!], footer: `Prev close ${fmtPx(sym, sim.market.prevClose[INSTRUMENT_INDEX.get(sym)!])}` });
      break;
    }
    case 'trade-orders': {
      const t = e ? sim.finance.traders.get(e.cfg.id) : undefined;
      v.banner = feedBanner(sim);
      if (tab === 0) {
        const syms = [...new Set([...(t?.coverage ?? []), ...Object.keys(BOOK_INDEX.get(bookOf(sim, e))!.base), refSym('index')])];
        v.widgets.push({ type: 'table', title: 'Watchlist', columns: ['Sym', 'Last', 'Chg', 'Bid', 'Ask'], align: ['l', 'r', 'r', 'r', 'r'], rows: syms.map((s) => instrumentRow(sim, s)), tones: syms.map((s) => [undefined, undefined, tone(sim.market.change(s))]) });
      } else {
        const orders = t?.orders ?? [];
        v.widgets.push({ type: 'kpis', items: [
          { label: 'Working', value: String(orders.filter((o) => o.status === 'working').length) },
          { label: 'Filled today', value: String(orders.filter((o) => o.status === 'filled').length) },
          { label: 'Cancelled', value: String(orders.filter((o) => o.status === 'cancelled').length) },
        ] });
        v.widgets.push({ type: 'table', title: 'Orders', columns: ['Time', 'Side', 'Qty', 'Sym', 'Type', 'Limit', 'Status'], align: ['l', 'l', 'r', 'l', 'l', 'r', 'l'],
          rows: orders.map((o) => [fmtTime(o.t), o.side, fmtNum(o.qty), o.sym, o.type, o.limit ? fmtPx(o.sym, o.limit) : '-', o.status]),
          tones: orders.map((o) => [undefined, o.side === 'BUY' ? 'pos' : 'neg', undefined, undefined, undefined, undefined, o.status === 'working' ? 'warn' : o.status === 'cancelled' ? 'muted' : undefined]) });
      }
      break;
    }
    case 'trade-blotter': {
      const t = e ? sim.finance.traders.get(e.cfg.id) : undefined;
      if (tab === 0) {
        const rows: string[][] = [];
        const tones: (Tone | undefined)[][] = [];
        let total = 0;
        for (const p of t?.positions.values() ?? []) {
          const inst = INSTRUMENTS[INSTRUMENT_INDEX.get(p.sym)!];
          const px = sim.market.price(p.sym);
          const pnl = (px - p.avg) * p.qty * inst.mult + p.realized;
          total += pnl;
          rows.push([p.sym, fmtNum(p.qty), fmtPx(p.sym, p.avg), fmtPx(p.sym, px), fmtMoney(p.qty * px * inst.mult), fmtMoney(pnl)]);
          tones.push([undefined, undefined, undefined, undefined, undefined, tone(pnl)]);
        }
        v.widgets.push({ type: 'kpis', items: [
          { label: 'Book', value: BOOK_INDEX.get(bookOf(sim, e))!.short },
          { label: 'Day P&L', value: fmtMoney(total), tone: tone(total) },
          { label: 'Positions', value: String(rows.length) },
        ] });
        v.widgets.push({ type: 'table', title: 'Positions', columns: ['Sym', 'Qty', 'Avg', 'Last', 'Notional', 'P&L'], align: ['l', 'r', 'r', 'r', 'r', 'r'], rows, tones });
      } else {
        const fills = t?.fills ?? [];
        v.widgets.push({ type: 'table', title: 'Trade blotter (today)', columns: ['Time', 'ID', 'Side', 'Qty', 'Sym', 'Price', 'Confirm'], align: ['l', 'l', 'l', 'r', 'l', 'r', 'l'],
          rows: fills.map((f) => [fmtTime(f.t), f.id, f.side, fmtNum(f.qty), f.sym, fmtPx(f.sym, f.px), f.status]),
          tones: fills.map((f) => [undefined, undefined, f.side === 'BUY' ? 'pos' : 'neg', undefined, undefined, undefined, f.status === 'break' ? 'crit' : f.status === 'pending' ? 'warn' : 'muted']) });
      }
      break;
    }
    case 'res-report': {
      const w = e?.work;
      const sym = INSTRUMENT_INDEX.has(w?.sym ?? '') ? w!.sym : refSym('lead');
      const px = sim.market.price(sym);
      if (tab === 0) {
        v.theme = 'light';
        v.widgets.push({ type: 'text', title: `${w?.title ?? 'Draft'} · draft v${1 + ((w?.words ?? 0) % 7)}`, cursor: e ? sim.presentAtDesk(e) && e.activity === 'working' : false, lines: [
          `Author: ${e?.cfg.name ?? '-'} · ${fmtNum(w?.words ?? 0)} words · INTERNAL DRAFT`,
          '',
          '1. Summary',
          `${sym} trades at ${fmtPx(sym, px)} (${fmtPct(sim.market.change(sym))} today). Our base case assumes`,
          'steady demand and modest margin expansion over the next four quarters.',
          '',
          '2. Key drivers',
          '- Pricing power versus input costs',
          '- Balance-sheet flexibility for the investment cycle',
          '- Positioning: crowded long per desk feedback',
          '',
          '3. Risks',
          '- Sector-wide de-rating if rates rise further',
          `- Event risk around guidance; implied move ${(2 + hashRand(1, sym) * 3).toFixed(1)}%`,
        ] });
      } else {
        v.widgets.push({ type: 'text', title: 'Research notes', lines: [
          `${fmtTime(sim.minute)} ${sym} ${fmtPx(sym, px)} - watching the ${fmtPct(sim.market.change(sym))} move`,
          `${fmtTime(Math.max(0, m - 37))} Call with sector specialist (summary filed)`,
          `${fmtTime(Math.max(0, m - 85))} Updated peer multiples table`,
          `${fmtTime(Math.max(0, m - 140))} Read-through from sector peers' latest results`,
          'TODO: send model to PM before the research review',
        ] });
      }
      break;
    }
    case 'res-model': {
      const sym = INSTRUMENT_INDEX.has(e?.work.sym ?? '') ? e!.work.sym : refSym('lead');
      const peers = [sym, ...INSTRUMENTS.filter((i) => i.sym !== sym && i.kind === 'equity').slice(0, 3).map((i) => i.sym)];
      const rows = peers.map((s, k) => {
        const px = sim.market.price(s);
        const eps = (INSTRUMENTS[INSTRUMENT_INDEX.get(s)!].px0 / (14 + k * 2.5));
        const target = eps * (17 + hashRand(7, s) * 6);
        return [s, fmtPx(s, px), eps.toFixed(2), (px / eps).toFixed(1) + 'x', target.toFixed(2), fmtPct(target / px - 1, 1)];
      });
      if (tab === 0) {
        v.widgets.push({ type: 'table', title: `Valuation model · ${sym} vs peers (prices live, simulated)`, columns: ['Ticker', 'Price', 'EPS (fwd)', 'P/E', 'Target', 'Upside'], align: ['l', 'r', 'r', 'r', 'r', 'r'], rows, tones: rows.map((r) => [undefined, undefined, undefined, undefined, undefined, r[5].startsWith('-') ? 'neg' : 'pos']) });
      } else {
        const px = sim.market.price(sym);
        const eps = INSTRUMENTS[INSTRUMENT_INDEX.get(sym)!].px0 / 14;
        const mults = [14, 16, 18, 20, 22];
        const growth = [-0.05, 0, 0.05, 0.1];
        v.widgets.push({ type: 'table', title: `Sensitivity · ${sym} implied upside (EPS growth x multiple)`, columns: ['Growth', ...mults.map((x) => `${x}x`)], align: ['l', 'r', 'r', 'r', 'r', 'r'],
          rows: growth.map((g) => [fmtPct(g, 0), ...mults.map((mu) => fmtPct((eps * (1 + g) * mu) / px - 1, 1))]),
          tones: growth.map((g) => [undefined, ...mults.map((mu) => tone((eps * (1 + g) * mu) / px - 1))]) });
      }
      break;
    }
    case 'risk-exposure': {
      const firm = sim.finance.firm(m);
      if (tab === 0) {
        v.widgets.push({ type: 'bars', title: 'Gross exposure vs limit', items: firm.books.map((b) => ({ label: b.short, value: b.util.gross, max: 1.2, text: `${fmtMoney(b.gross)} (${(b.util.gross * 100).toFixed(0)}%)`, tone: utilTone(b.util.gross) })) });
        const sectors = new Map<string, number>();
        for (const b of firm.books) for (const [s, n] of Object.entries(b.sectors)) sectors.set(s, (sectors.get(s) ?? 0) + n);
        const rows = [...sectors.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
        v.widgets.push({ type: 'table', title: 'Net exposure by sector (firm)', columns: ['Sector', 'Net', '% NAV'], align: ['l', 'r', 'r'], rows: rows.map(([s, n]) => [s, fmtMoney(n), fmtPct(n / firm.nav, 1)]), tones: rows.map(([, n]) => [undefined, tone(n)]) });
      } else {
        v.widgets.push({ type: 'kpis', items: firm.books.map((b) => ({ label: `${b.short} drawdown`, value: `${(b.ddPct * 100).toFixed(2)}%`, tone: utilTone(b.util.drawdown) })) });
        const worst = [...firm.books].sort((a, b) => b.util.drawdown - a.util.drawdown)[0];
        v.widgets.push({ type: 'chart', title: `${worst.name} intraday P&L (largest drawdown utilisation)`, series: worst.pnlSeries.slice(-240), baseline: 0, footer: `Peak ${fmtMoney(worst.peak)} · now ${fmtMoney(worst.pnl)} · limit ${(BOOK_INDEX.get(worst.id)!.limits.drawdownPct * 100).toFixed(1)}%` });
      }
      break;
    }
    case 'risk-limits': {
      const firm = sim.finance.firm(m);
      if (tab === 0) {
        const rows: string[][] = [];
        const tones: (Tone | undefined)[][] = [];
        for (const b of firm.books) {
          const def = BOOK_INDEX.get(b.id)!;
          for (const [metric, val, lim, u] of [
            ['Drawdown', `${(b.ddPct * 100).toFixed(2)}%`, `${(def.limits.drawdownPct * 100).toFixed(1)}%`, b.util.drawdown],
            ['Gross', fmtMoney(b.gross), fmtMoney(def.capital * def.limits.grossMult), b.util.gross],
            ['Concentration', `${b.concentration.sym} ${(b.concentration.pct * 100).toFixed(1)}%`, `${(def.limits.concentrationPct * 100).toFixed(0)}%`, b.util.concentration],
          ] as const) {
            rows.push([b.short, metric, val, lim, `${(u * 100).toFixed(0)}%`]);
            tones.push([undefined, undefined, undefined, undefined, utilTone(u)]);
          }
        }
        v.widgets.push({ type: 'table', title: 'Limit utilisation', columns: ['Book', 'Metric', 'Value', 'Limit', 'Used'], align: ['l', 'l', 'r', 'r', 'r'], rows, tones });
      } else {
        v.widgets.push(alertsWidget(sim));
      }
      const open = sim.finance.openAlerts()[0];
      if (open) v.banner = { text: `ALERT ${open.id}: ${BOOK_INDEX.get(open.bookId)!.short} ${open.metric} ${(open.value * 100).toFixed(2)}% > ${(open.limit * 100).toFixed(2)}% · ${open.status.toUpperCase()}`, tone: 'crit' };
      break;
    }
    case 'pm-alloc': {
      const b = sim.finance.bookMetrics(bookOf(sim, e), m);
      if (sim.realMode && tab === 1) { v.widgets.push(strategiesTable(sim, (s) => s.book === bookOf(sim, e))); break; }
      if (tab === 0) {
        v.widgets.push({ type: 'kpis', items: [
          { label: 'Capital', value: fmtMoney(b.capital, 0) },
          { label: 'Gross', value: fmtMoney(b.gross) },
          { label: 'Net', value: fmtMoney(b.net), tone: tone(b.net) },
          { label: 'VaR 95%', value: fmtMoney(b.var95) },
        ] });
        v.widgets.push({ type: 'bars', title: `${b.name} · allocation (% of capital)`, items: b.positions.map((p) => ({ label: p.sym, value: Math.abs(p.notional) / b.capital, max: 0.3, text: `${p.notional < 0 ? 'Short ' : ''}${fmtMoney(Math.abs(p.notional))} (${((p.notional / b.capital) * 100).toFixed(1)}%)`, tone: p.notional < 0 ? 'neg' : 'pos' })) });
      } else {
        v.widgets.push({ type: 'table', title: `${b.name} · positions (sum of trader books)`, columns: ['Sym', 'Qty', 'Notional', 'P&L', 'Sector'], align: ['l', 'r', 'r', 'r', 'l'],
          rows: b.positions.map((p) => [p.sym, fmtNum(p.qty), fmtMoney(p.notional), fmtMoney(p.pnl), p.sector]), tones: b.positions.map((p) => [undefined, undefined, undefined, tone(p.pnl)]) });
      }
      if (sim.finance.derisk.has(b.id)) v.banner = { text: 'Risk-reduction instruction in progress (from risk review)', tone: 'warn' };
      break;
    }
    case 'pm-perf': {
      const b = sim.finance.bookMetrics(bookOf(sim, e), m);
      if (tab === 0) {
        v.widgets.push({ type: 'kpis', items: [
          { label: 'Day P&L', value: fmtMoney(b.pnl), tone: tone(b.pnl) },
          { label: 'Return', value: fmtPct(b.pnlPct), tone: tone(b.pnl) },
          { label: 'Drawdown', value: `${(b.ddPct * 100).toFixed(2)}%`, tone: utilTone(b.util.drawdown) },
        ] });
        v.widgets.push({ type: 'chart', title: `${b.name} · intraday P&L`, series: b.pnlSeries.slice(-300), baseline: 0 });
      } else {
        v.widgets.push({ type: 'bars', title: 'Last 20 sessions (simulated history)', items: b.daily.slice(-10).map((d, i) => ({ label: `D-${10 - i}`, value: Math.abs(d) / (b.capital * 0.01), max: 1, text: fmtMoney(d), tone: tone(d) })) });
        v.widgets.push({ type: 'text', lines: [`Month-to-date: ${fmtMoney(b.daily.reduce((s, d) => s + d, 0) + b.pnl)}`, `Hit rate: ${b.daily.filter((d) => d > 0).length}/${b.daily.length} sessions`] });
      }
      break;
    }
    case 'dev-editor': {
      if (tab === 0) {
        const line = e?.work.line ?? 60;
        v.widgets.push({ type: 'code', title: e?.work.file ?? 'src/main.ts', cursorLine: line, lines: codeWindow(line, e?.work.file ?? '') });
      } else {
        v.widgets.push(buildsTable(sim));
      }
      break;
    }
    case 'dev-terminal': {
      if (tab === 0) {
        const lines: string[] = [];
        for (const b of sim.tech.builds.slice(0, 6)) lines.push(`$ ci status #${b.id}  ${b.branch}  ${b.status.toUpperCase()}`);
        for (const l of sim.tech.incident.log.slice(-3)) lines.push(`[${fmtTime(l.t)}] ${l.text}`);
        lines.push(`$ kubectl get pods -n trading   (simulated)`);
        for (const s of sim.tech.metrics(m).slice(0, 4)) lines.push(`${s.id.padEnd(12)} Running  cpu ${s.cpu.toFixed(0)}%  p99 ${s.latency.toFixed(0)}ms`);
        v.widgets.push({ type: 'text', lines, cursor: true });
      } else {
        v.widgets.push(servicesTable(sim));
      }
      if (sim.tech.incidentActive) v.banner = { text: `${sim.tech.incident.id} ${sim.tech.incident.title.toUpperCase()} · ${sim.tech.incident.status}`, tone: 'crit' };
      break;
    }
    case 'ops-recon': {
      const tr = sim.finance.trades;
      if (tab === 0) {
        v.widgets.push({ type: 'kpis', items: [
          { label: 'Trades today', value: String(tr.length) },
          { label: 'Matched', value: String(tr.filter((t) => t.status === 'matched').length), tone: 'pos' },
          { label: 'Pending', value: String(tr.filter((t) => t.status === 'pending').length), tone: 'warn' },
          { label: 'Breaks', value: String(tr.filter((t) => t.status === 'break').length), tone: tr.some((t) => t.status === 'break') ? 'crit' : undefined },
        ] });
        v.widgets.push({ type: 'table', title: 'Confirmations (latest)', columns: ['Trade', 'Time', 'Book', 'Sym', 'Side', 'Qty', 'Status'], align: ['l', 'l', 'l', 'l', 'l', 'r', 'l'],
          rows: tr.map((t) => [t.id, fmtTime(t.t), BOOK_INDEX.get(t.bookId)!.short, t.sym, t.side, fmtNum(t.qty), t.status]),
          tones: tr.map((t) => [undefined, undefined, undefined, undefined, undefined, undefined, t.status === 'break' ? 'crit' : t.status === 'pending' ? 'warn' : t.status === 'resolved' ? 'accent' : 'muted']) });
      } else {
        const br = tr.filter((t) => t.status === 'break' || t.status === 'resolved');
        v.widgets.push({ type: 'table', title: 'Breaks', columns: ['Trade', 'Sym', 'Reason', 'Status', 'Owner'], align: ['l', 'l', 'l', 'l', 'l'],
          rows: br.map((t) => [t.id, t.sym, t.breakReason ?? '', t.status, t.resolvedBy ? sim.name(t.resolvedBy) : 'unassigned']),
          tones: br.map((t) => [undefined, undefined, undefined, t.status === 'break' ? 'crit' : 'pos']) });
      }
      if (sim.finance.incidentDelay) v.banner = { text: 'Confirmations delayed: market data incident in progress', tone: 'warn' };
      break;
    }
    case 'ops-tasks': {
      const tr = sim.finance.trades;
      if (tab === 0) {
        const tasks: string[][] = [];
        for (const t of tr.filter((x) => x.status === 'break').slice(0, 6)) tasks.push(['High', `Resolve break ${t.id} (${t.sym})`, 'Open']);
        tasks.push(['Med', `Chase ${tr.filter((x) => x.status === 'pending').length} pending confirmations`, 'In progress']);
        tasks.push(['Med', 'Prepare end-of-day position file', m > 17 * 60 ? 'In progress' : 'Queued']);
        tasks.push(['Low', 'Archive yesterday settlement reports', m > 10 * 60 ? 'Done' : 'Queued']);
        v.widgets.push({ type: 'table', title: 'Task queue', columns: ['Priority', 'Task', 'Status'], align: ['l', 'l', 'l'], rows: tasks, tones: tasks.map((r) => [r[0] === 'High' ? 'crit' : r[0] === 'Med' ? 'warn' : 'muted']) });
      } else {
        const cut = [[9 * 60, 'Overnight settlement confirmation'], [12 * 60, 'Collateral call deadline'], [15 * 60 + 30, 'FX settlement cut-off'], [16 * 60 + 30, 'Bond settlement cut-off'], [18 * 60, 'End-of-day position file']] as const;
        v.widgets.push({ type: 'table', title: 'Today\'s operational schedule', columns: ['Time', 'Item', 'Status'], align: ['l', 'l', 'l'], rows: cut.map(([t, s]) => [fmtTime(t), s, m >= t ? 'Done' : m >= t - 60 ? 'Due soon' : 'Upcoming']), tones: cut.map(([t]) => [undefined, undefined, m >= t ? 'pos' : m >= t - 60 ? 'warn' : 'muted']) });
      }
      break;
    }
    case 'rec-visitors': {
      if (tab === 0) {
        const items: [number, string, string, string][] = sim.events.map((ev) => [ev.start, ev.title, roomById(ev.roomId)?.name ?? '', ev.remoteNote ? 'Video call' : ev.status]);
        items.push([10 * 60 + 5, 'Courier delivery (documents)', 'Reception', m > 10 * 60 + 5 ? 'Received' : 'Expected']);
        items.push([15 * 60, 'Facilities: window cleaning contractor', 'Exterior', m > 15 * 60 ? 'On site (exterior)' : 'Scheduled']);
        items.sort((a, b) => a[0] - b[0]);
        v.widgets.push({ type: 'table', title: 'Appointments & bookings today', columns: ['Time', 'Item', 'Where', 'Status'], align: ['l', 'l', 'l', 'l'], rows: items.map(([t, a, b, c]) => [fmtTime(t), a, b, c]), tones: items.map(([, , , s]) => [undefined, undefined, undefined, s === 'in-progress' ? 'accent' : s === 'completed' ? 'muted' : undefined]) });
      } else {
        v.widgets.push(directoryTable(sim));
      }
      break;
    }
    case 'rec-rooms': {
      if (tab === 0) v.widgets.push(bookingsTable(sim));
      else v.widgets.push(occupancyBars(sim));
      break;
    }
    case 'ceo-company': {
      const firm = sim.finance.firm(m);
      if (tab === 0) {
        v.widgets.push({ type: 'kpis', items: [
          { label: 'NAV (sim)', value: fmtMoney(firm.nav, 2) },
          { label: 'Day P&L', value: fmtMoney(firm.pnl), tone: tone(firm.pnl) },
          { label: 'In office', value: `${sim.employees.length}/${sim.employees.length}` },
          { label: 'Open alerts', value: String(sim.finance.openAlerts().length), tone: sim.finance.openAlerts().length ? 'crit' : undefined },
        ] });
        v.widgets.push(booksTable(sim));
      } else {
        v.widgets.push(occupancyBars(sim));
        const now = sim.events.filter((x) => x.status === 'in-progress');
        v.widgets.push({ type: 'text', title: 'Meetings now', lines: now.length ? now.map((x) => `${x.title} · ${roomById(x.roomId)?.name} · ${sim.presentAttendees(x).length}/${x.attendeeIds.length} present`) : ['No meetings in progress'] });
      }
      break;
    }
    case 'ceo-portfolio': {
      const firm = sim.finance.firm(m);
      if (tab === 0) {
        v.widgets.push(booksTable(sim));
        if (sim.realMode) v.widgets.push(strategiesTable(sim));
        const series = firm.books[0].pnlSeries.map((_, i) => firm.books.reduce((s, b) => s + (b.pnlSeries[i] ?? 0), 0));
        v.widgets.push({ type: 'chart', title: 'Firm intraday P&L', series: series.slice(-300), baseline: 0 });
      } else {
        v.widgets.push({ type: 'bars', title: 'Drawdown limit utilisation', items: firm.books.map((b) => ({ label: b.short, value: b.util.drawdown, max: 1.2, text: `${(b.util.drawdown * 100).toFixed(0)}%`, tone: utilTone(b.util.drawdown) })) });
        v.widgets.push(alertsWidget(sim));
      }
      break;
    }
    case 'cafe-orders': {
      if (tab === 0) {
        const o = sim.cafeOrders;
        v.widgets.push({ type: 'kpis', items: [
          { label: 'Queued', value: String(o.filter((x) => x.status === 'queued').length) },
          { label: 'Preparing', value: String(o.filter((x) => x.status === 'preparing').length), tone: 'warn' },
          { label: 'Ready', value: String(o.filter((x) => x.status === 'ready').length), tone: 'pos' },
          { label: 'Served today', value: String(o.length) },
        ] });
        v.widgets.push({ type: 'table', title: 'Orders', columns: ['#', 'Time', 'For', 'Drink', 'Status'], align: ['l', 'l', 'l', 'l', 'l'], rows: o.map((x) => [String(x.id), fmtTime(x.t), x.name, x.drink, x.status]), tones: o.map((x) => [undefined, undefined, undefined, undefined, x.status === 'ready' ? 'pos' : x.status === 'preparing' ? 'warn' : x.status === 'collected' ? 'muted' : undefined]) });
      } else {
        const up = sim.events.filter((x) => x.status !== 'completed');
        v.widgets.push({ type: 'table', title: 'Room set-up', columns: ['Time', 'Room', 'Meeting', 'People', 'Set-up'], align: ['l', 'l', 'l', 'r', 'l'], rows: up.map((x) => [fmtTime(x.start), roomById(x.roomId)?.name ?? '', x.title, String(x.attendeeIds.length), x.status === 'in-progress' ? 'In use' : x.start - m < 30 ? 'Water & coffee set' : 'Planned']) });
      }
      break;
    }
    case 'flex-idle':
      v.widgets.push({ type: 'text', large: true, lines: ['Flex desk available', 'Assign an employee in Settings > Office editor', `Local time ${fmtTime(sim.minute)}`] });
      break;
  }
  return v;
}

function codeWindow(line: number, file: string): { n: number; text: string; tone?: Tone }[] {
  const src = [
    `// ${file} (simulated source)`,
    "import { Feed, Quote } from './types';",
    '',
    'export async function onQuote(feed: Feed, q: Quote) {',
    '  const book = feed.books.get(q.symbol);',
    '  if (!book) return metrics.inc(\'unknown_symbol\');',
    '  if (q.seq <= book.lastSeq) return; // stale',
    '  book.apply(q);',
    '  publisher.enqueue(book.snapshot());',
    '  latency.observe(Date.now() - q.sentAt);',
    '}',
    '',
    'export function backpressure(queue: Queue) {',
    '  if (queue.depth > LIMIT) {',
    '    log.warn(`queue depth ${queue.depth}`);',
    '    return queue.shed(0.1);',
    '  }',
    '  return 0;',
    '}',
  ];
  const out: { n: number; text: string; tone?: Tone }[] = [];
  for (let i = 0; i < 14; i++) {
    const n = line - 6 + i;
    const text = src[((n % src.length) + src.length) % src.length];
    out.push({ n, text, tone: text.trim().startsWith('//') ? 'muted' : text.includes('export') ? 'accent' : undefined });
  }
  return out;
}

function buildsTable(sim: Simulation): Widget {
  const b = sim.tech.builds;
  return { type: 'table', title: 'CI builds', columns: ['#', 'Time', 'Branch', 'Author', 'Tests', 'Status'], align: ['l', 'l', 'l', 'l', 'r', 'l'],
    rows: b.map((x) => [String(x.id), fmtTime(x.t), x.branch, sim.name(x.author).split(' ')[0], String(x.tests), x.status]),
    tones: b.map((x) => [undefined, undefined, undefined, undefined, undefined, x.status === 'passed' ? 'pos' : x.status === 'failed' ? 'crit' : 'warn']) };
}

function servicesTable(sim: Simulation): Widget {
  const ms = sim.tech.metrics(sim.minute);
  return { type: 'table', title: 'Service health', columns: ['Service', 'Host', 'CPU', 'Mem', 'p99', 'Status'], align: ['l', 'l', 'r', 'r', 'r', 'l'],
    rows: ms.map((s) => [s.name, s.host, `${s.cpu.toFixed(0)}%`, `${s.mem.toFixed(0)}%`, `${s.latency.toFixed(0)} ms`, s.status]),
    tones: ms.map((s) => [undefined, undefined, s.cpu > 80 ? 'warn' : undefined, undefined, s.latency > 100 ? 'crit' : undefined, s.status === 'ok' ? 'pos' : 'crit']) };
}

function alertsWidget(sim: Simulation): Widget {
  const items = sim.finance.alerts.slice(0, 6).flatMap((a) => [
    { level: (a.status === 'resolved' ? 'info' : 'crit') as 'info' | 'crit', time: fmtTime(a.t), text: `${a.id} ${BOOK_INDEX.get(a.bookId)!.short} ${a.metric} ${(a.value * 100).toFixed(2)}% (limit ${(a.limit * 100).toFixed(2)}%) · ${a.status.toUpperCase()}` },
    ...a.log.slice(-2).map((l) => ({ level: 'info' as const, time: fmtTime(l.t), text: `   ${l.text}` })),
  ]);
  return { type: 'alerts', title: 'Risk alerts', items: items.length ? items : [{ level: 'info', time: fmtTime(sim.minute), text: 'No limit breaches today' }] };
}

function booksTable(sim: Simulation): Widget {
  const firm = sim.finance.firm(Math.floor(sim.minute));
  const rows = firm.books.map((b) => [b.short, sim.name(sim.finance.pmByBook.get(b.id) ?? '-'), fmtMoney(b.capital, 0), fmtMoney(b.pnl), fmtPct(b.pnlPct), fmtMoney(b.gross)]);
  rows.push(['Firm', '', fmtMoney(firm.capital, 0), fmtMoney(firm.pnl), fmtPct(firm.pnlPct), fmtMoney(firm.gross)]);
  return { type: 'table', title: 'Books (simulated)', columns: ['Book', 'PM', 'Capital', 'Day P&L', 'Return', 'Gross'], align: ['l', 'l', 'r', 'r', 'r', 'r'], rows,
    tones: [...firm.books.map((b) => [undefined, undefined, undefined, tone(b.pnl), tone(b.pnl)]), [undefined, undefined, undefined, tone(firm.pnl), tone(firm.pnl)]] };
}

function directoryTable(sim: Simulation): Widget {
  return { type: 'table', title: 'Staff directory (live location)', columns: ['Name', 'Department', 'Location', 'Status'], align: ['l', 'l', 'l', 'l'],
    rows: sim.employees.map((e) => [e.cfg.name, e.cfg.department, `${FLOOR_NAMES[e.floor].split(' ')[0]} · ${sim.roomName(e)}`, ACTIVITY_LABEL[e.activity]]) };
}

function bookingsTable(sim: Simulation): Widget {
  const ev = sim.events;
  return { type: 'table', title: 'Room bookings today', columns: ['Time', 'Room', 'Meeting', 'Present', 'Status'], align: ['l', 'l', 'l', 'r', 'l'],
    rows: ev.map((x) => [`${fmtTime(x.start)}-${fmtTime(x.end)}`, roomById(x.roomId)?.name ?? '', x.title, x.status === 'in-progress' ? `${sim.presentAttendees(x).length}/${x.attendeeIds.length}` : String(x.attendeeIds.length), x.status]),
    tones: ev.map((x) => [undefined, undefined, undefined, undefined, x.status === 'in-progress' ? 'accent' : x.status === 'completed' ? 'muted' : undefined]) };
}

function occupancyBars(sim: Simulation): Widget {
  const occ = sim.floorOccupancy();
  return { type: 'bars', title: 'People by floor', items: occ.map((n, f) => ({ label: FLOOR_NAMES[f], value: n, max: sim.employees.length, text: `${n}`, tone: 'accent' as Tone })) };
}

// ------------------------------------------------------------------ wall panels
export function buildPanelView(sim: Simulation, panelId: string, companyName: string): AppView {
  const p = PANELS.find((x) => x.id === panelId)!;
  const m = Math.floor(sim.minute);
  const v: AppView = { key: panelId, appId: 'panel', title: p.label, tabs: [], tab: 0, employeeName: '', workstationLabel: roomById(p.roomId)?.name ?? '', time: fmtTime(sim.minute), minute: m, theme: 'dark', layout: 'stack', widgets: [], dataTag: dataTag(sim) };
  switch (p.kind) {
    case 'roomDisplay': {
      const room = roomById(p.roomId)!;
      v.title = room.name;
      const cur = sim.currentEventInRoom(room.id);
      if (cur) {
        const present = sim.presentAttendees(cur);
        const remote = sim.remoteAttendees(cur);
        v.banner = { text: `IN USE · ${cur.title} · until ${fmtTime(cur.end)}`, tone: 'accent' };
        v.widgets.push({ type: 'text', title: `Present ${present.length}/${cur.attendeeIds.length}${remote.length ? ` · ${remote.length} remote` : ''}`, lines: cur.attendeeIds.map((id) => `${present.some((e) => e.cfg.id === id) ? '●' : remote.some((e) => e.cfg.id === id) ? '◐' : '○'} ${sim.name(id)}`) });
        if (cur.notes.length) v.widgets.push({ type: 'text', title: 'Live notes', lines: cur.notes.slice(0, 5) });
      } else {
        v.banner = { text: 'AVAILABLE', tone: 'pos' };
      }
      const list = sim.eventsForRoom(room.id);
      v.widgets.push({ type: 'table', title: 'Bookings today', columns: ['Time', 'Meeting', 'Status'], align: ['l', 'l', 'l'], rows: list.map((x) => [`${fmtTime(x.start)}-${fmtTime(x.end)}`, x.title, x.status]), tones: list.map((x) => [undefined, undefined, x.status === 'in-progress' ? 'accent' : x.status === 'completed' ? 'muted' : undefined]) });
      break;
    }
    case 'whiteboard': {
      v.theme = 'whiteboard';
      const evs = sim.eventsForRoom(p.roomId);
      const cur = evs.find((x) => x.status === 'in-progress') ?? [...evs].reverse().find((x) => x.status === 'completed');
      if (p.roomId === 'f-research' && !cur) {
        const res = sim.employees.filter((e) => e.cfg.roleType === 'researcher');
        v.widgets.push({ type: 'text', title: 'Research pipeline', lines: res.map((e) => `${e.cfg.name.split(' ')[0]}: ${e.work.title} - ${fmtNum(e.work.words)} words`) });
      } else if (p.roomId === 's-tech' && !cur?.status.includes('progress')) {
        v.widgets.push({ type: 'text', title: 'Kanban: this sprint', lines: ['DOING  feed handler backpressure', 'DOING  recon matcher tolerance', 'REVIEW risk aggregation by sector', 'DONE   blotter partial-fill sort', `INCIDENT ${sim.tech.incident.id}: ${sim.tech.incident.status}`] });
      } else if (p.roomId === 's-ops') {
        v.widgets.push({ type: 'text', title: 'Ops board', lines: [`Breaks open: ${sim.finance.trades.filter((t) => t.status === 'break').length}`, `Pending confirms: ${sim.finance.trades.filter((t) => t.status === 'pending').length}`, 'FX cut-off 15:30', 'Bond cut-off 16:30', 'EOD file 18:00'] });
      } else if (cur) {
        v.widgets.push({ type: 'text', title: `${cur.title} (${fmtTime(cur.start)})`, lines: [...cur.agenda.map((a) => `- ${a}`), ...cur.notes.map((n) => `> ${n}`)] });
      } else {
        const next = evs.find((x) => x.status === 'scheduled');
        v.widgets.push({ type: 'text', title: 'Whiteboard', lines: next ? [`Next: ${next.title} at ${fmtTime(next.start)}`, ...next.agenda.map((a) => `- ${a}`)] : ['(clean)'] });
      }
      break;
    }
    case 'marketWall': {
      v.title = `${companyName} Markets · ${dataTag(sim)}`;
      v.layout = 'grid';
      v.banner = feedBanner(sim);
      const shock = sim.market.shocks.find((s) => m >= s.minute && m < s.minute + 90);
      if (shock && !v.banner) v.banner = { text: `NEWS ${fmtTime(shock.minute)} · ${shock.label}`, tone: 'warn' };
      v.widgets.push({ type: 'table', title: 'Instruments', columns: ['Sym', 'Name', 'Last', 'Chg'], align: ['l', 'l', 'r', 'r'], rows: INSTRUMENTS.map((i) => [i.sym, i.name, fmtPx(i.sym, sim.market.price(i.sym)), fmtPct(sim.market.change(i.sym))]), tones: INSTRUMENTS.map((i) => [undefined, 'muted', undefined, tone(sim.market.change(i.sym))]) });
      if (sim.news.length) v.widgets.push({ type: 'text', title: 'Headlines (live, Co-Invest)', lines: sim.news.slice(0, 6).map((n) => `${n.title} — ${n.source}`) });
      for (const sym of [refSym('index'), refSym('energy'), refSym('rates')]) v.widgets.push({ type: 'chart', title: `${sym} ${fmtPx(sym, sim.market.price(sym))} (${fmtPct(sim.market.change(sym))})`, series: sim.market.series(sym, 240), baseline: sim.market.prevClose[INSTRUMENT_INDEX.get(sym)!] });
      v.widgets.push(booksTable(sim));
      break;
    }
    case 'serverDisplay': {
      v.title = 'Infrastructure monitor';
      v.theme = 'terminal';
      if (sim.realMode) { realServerView(sim, v); break; }
      if (sim.tech.incidentActive) v.banner = { text: `${sim.tech.incident.id} · ${sim.tech.incident.title} · ${sim.tech.incident.status.toUpperCase()}`, tone: 'crit' };
      else v.banner = { text: 'All services nominal', tone: 'pos' };
      v.widgets.push(servicesTable(sim));
      v.widgets.push({ type: 'bars', title: 'CPU by service', items: sim.tech.metrics(m).map((s) => ({ label: s.id, value: s.cpu, max: 100, text: `${s.cpu.toFixed(0)}%`, tone: s.cpu > 80 ? 'crit' : 'accent' })) });
      if (sim.tech.incident.log.length) v.widgets.push({ type: 'text', title: 'Incident log', lines: sim.tech.incident.log.map((l) => `${fmtTime(l.t)} ${l.text}`) });
      break;
    }
    case 'directory': {
      v.title = `${companyName} Office Directory`;
      v.theme = 'signage';
      for (let f = 2; f >= 0; f--) v.widgets.push({ type: 'text', title: FLOOR_NAMES[f], lines: [ROOMS.filter((r) => r.floor === f && !r.hidden).map((r) => r.name).join(' · ')] });
      v.widgets.push({ type: 'text', lines: ['Touch to open office navigation'] });
      break;
    }
    case 'worldMarkets': {
      v.title = `World markets · ${sim.live ? 'live prices' : 'simulated prices'} · exchange clocks in real time`;
      v.layout = 'grid';
      const now = Date.now();
      const st = EXCHANGES.map((x) => ({ x, s: sessionStatus(x, now) }));
      const open = st.filter((r) => r.s.state === 'open').length;
      v.banner = { text: `${open} of ${EXCHANGES.length} major exchanges open now · crypto and Co-Invest perpetuals trade 24/7`, tone: open ? 'accent' : 'muted' };
      v.widgets.push({ type: 'table', title: 'Exchanges (local time, regular sessions; holidays not shown)', columns: ['City', 'Exchange', 'Local', 'Status', ''], align: ['l', 'l', 'r', 'l', 'l'],
        rows: st.map(({ x, s }) => [x.city, x.name, `${s.day} ${s.local}`, s.state === 'open' ? 'OPEN' : s.state === 'lunch' ? 'LUNCH' : 'CLOSED', s.note]),
        tones: st.map(({ s }) => [undefined, 'muted', undefined, s.state === 'open' ? 'pos' : s.state === 'lunch' ? 'warn' : 'muted', 'muted']) });
      const keys = [6, 8, 7, 9, 10, 11].map((k) => INSTRUMENTS[k]).filter(Boolean);
      v.widgets.push({ type: 'table', title: sim.live ? 'Key markets (live, Co-Invest)' : 'Key markets (simulated)', columns: ['Market', 'Last', '24h / day'], align: ['l', 'r', 'r'],
        rows: keys.map((i) => [`${i.sym} · ${i.name}`, fmtPx(i.sym, sim.market.price(i.sym)), fmtPct(sim.market.change(i.sym))]),
        tones: keys.map((i) => [undefined, undefined, tone(sim.market.change(i.sym))]) });
      const shock = sim.market.shocks.find((s) => m >= s.minute);
      const heads = sim.news.length
        ? sim.news.slice(0, 7).map((n) => `• ${n.title} — ${n.source}`)
        : [shock ? `• ${fmtTime(shock.minute)} ${shock.label}` : '• No market-moving office news yet today', '• Live headlines appear here when the page runs in claude.ai with the Co-Invest connector.'];
      v.widgets.push({ type: 'text', title: sim.news.length ? 'Headlines (live)' : 'Headlines', lines: heads });
      break;
    }
    case 'ceoTv': {
      v.title = `${companyName} · Company overview`;
      const firm = sim.finance.firm(m);
      v.widgets.push({ type: 'kpis', items: [
        { label: 'NAV (sim)', value: fmtMoney(firm.nav, 2) },
        { label: 'Day P&L', value: fmtMoney(firm.pnl), tone: tone(firm.pnl) },
        { label: 'Open alerts', value: String(sim.finance.openAlerts().length), tone: sim.finance.openAlerts().length ? 'crit' : undefined },
      ] });
      v.widgets.push(booksTable(sim));
      break;
    }
    case 'riskWall': {
      v.title = 'Risk wall';
      v.widgets.push({ type: 'bars', title: 'Drawdown limit utilisation', items: sim.finance.firm(m).books.map((b) => ({ label: b.short, value: b.util.drawdown, max: 1.2, text: `${(b.util.drawdown * 100).toFixed(0)}%`, tone: utilTone(b.util.drawdown) })) });
      v.widgets.push(alertsWidget(sim));
      break;
    }
    case 'pmWall': {
      v.title = 'Portfolio summary';
      v.widgets.push(booksTable(sim));
      if (sim.realMode) v.widgets.push(strategiesTable(sim, () => true, 6));
      v.widgets.push({ type: 'bars', title: 'Gross utilisation', items: sim.finance.firm(m).books.map((b) => ({ label: b.short, value: b.util.gross, max: 1.2, text: `${(b.util.gross * 100).toFixed(0)}%`, tone: utilTone(b.util.gross) })) });
      break;
    }
    case 'menuBoard': {
      v.title = 'Café';
      v.theme = 'signage';
      const q = sim.cafeOrders.filter((o) => o.status === 'queued' || o.status === 'preparing').length;
      v.widgets.push({ type: 'text', large: true, lines: ['Espresso · Flat white · Cappuccino', 'Oat latte · Cortado · Tea', `Orders in queue: ${q}`] });
      break;
    }
    case 'floorSign': {
      const f = p.floor;
      v.title = `${FLOOR_NAMES[f]}`;
      v.theme = 'signage';
      v.widgets.push({ type: 'text', lines: ROOMS.filter((r) => r.floor === f && !r.hidden).map((r) => r.name) });
      break;
    }
    case 'logo':
    case 'trainingScreen':
      v.title = companyName;
      v.theme = 'signage';
      break;
  }
  return v;
}

export function bookIds(): readonly BookId[] {
  return BOOK_IDS;
}

export { BOOKS, SERVICES };
