// Shared financial state: trader positions roll up into PM books, books roll up into risk and firm views.
// Every screen reads from this one model, so a trade on a trader's blotter moves the PM's allocation,
// the risk team's exposure and the CEO's firm summary at the same moment. All values are SIMULATED.
import { hashRand } from '../util/rng';
import type { BookId } from '../config/types';
import { INSTRUMENTS, INSTRUMENT_INDEX, isLiveUniverse, type Market } from './market';
import { MARKET_CLOSE, MARKET_OPEN } from './constants';
import { shouldExit, signalAt, type TraderStrategy } from './training';

export interface BookDef {
  id: BookId;
  name: string;
  short: string;
  capital: number;
  limits: { drawdownPct: number; grossMult: number; concentrationPct: number };
  base: Record<string, number>; // target notional by symbol at the start of the day
}

export const BOOKS: BookDef[] = [
  {
    id: 'eq', name: 'Global Equities L/S', short: 'Equities', capital: 400e6,
    limits: { drawdownPct: 0.01, grossMult: 0.9, concentrationPct: 0.15 },
    base: { AURX: 42e6, ORBL: 34e6, MRDN: 28e6, KSTL: 22e6, VNTA: -18e6, HLNE: 24e6, SX5F: -40e6 },
  },
  {
    id: 'macro', name: 'Global Macro', short: 'Macro', capital: 300e6,
    limits: { drawdownPct: 0.01, grossMult: 1.0, concentrationPct: 0.3 },
    base: { CRDX: 72e6, TY10: 55e6, EURS: -38e6, SX5F: 26e6 },
  },
  {
    id: 'credit', name: 'Credit Opportunities', short: 'Credit', capital: 250e6,
    limits: { drawdownPct: 0.01, grossMult: 0.8, concentrationPct: 0.3 },
    base: { HLN31: 60e6, KST29: 48e6, HLNE: -12e6, TY10: -20e6 },
  },
];
export const BOOK_INDEX = new Map(BOOKS.map((b) => [b.id, b]));
export const FIRM_CAPITAL = BOOKS.reduce((s, b) => s + b.capital, 0);
export function firmCapital(): number {
  return BOOKS.reduce((s, b) => s + b.capital, 0);
}
/** Paper capital for the real office (split 40/30/30 across the books). */
export function setPaperCapital(total: number) {
  const split: Record<string, number> = { eq: 0.4, macro: 0.3, credit: 0.3 };
  for (const b of BOOKS) b.capital = total * (split[b.id] ?? 0.3);
}

export type Side = 'BUY' | 'SELL';

export interface Position { sym: string; qty: number; avg: number; realized: number }

export interface Order {
  id: string;
  t: number;
  traderId: string;
  bookId: BookId;
  sym: string;
  side: Side;
  qty: number;
  type: 'MKT' | 'LMT';
  limit?: number;
  status: 'working' | 'filled' | 'cancelled';
  /** Set when the quantity was keyed wrong (fat finger). */
  error?: boolean;
  filledAt?: number;
  fillPx?: number;
  reason: string;
}

export type TradeStatus = 'pending' | 'matched' | 'break' | 'resolved';

export interface Fill {
  id: string;
  orderId: string;
  t: number;
  traderId: string;
  bookId: BookId;
  sym: string;
  side: Side;
  qty: number;
  px: number;
  notional: number;
  status: TradeStatus;
  confirmAt: number;
  breakReason?: string;
  resolvedBy?: string;
  resolvedAt?: number;
}

export interface TraderState {
  empId: string;
  bookId: BookId;
  coverage: string[];
  positions: Map<string, Position>;
  orders: Order[];
  fills: Fill[];
  reduced: Set<string>;
}

export type AlertStatus = 'open' | 'acknowledged' | 'in-review' | 'action' | 'resolved';

export interface RiskAlert {
  id: string;
  t: number;
  bookId: BookId;
  metric: 'drawdown' | 'gross' | 'concentration';
  value: number;
  limit: number;
  status: AlertStatus;
  grossAtBreach: number;
  ackBy?: string;
  reviewEventId?: string;
  resolvedAt?: number;
  log: { t: number; text: string }[];
}

export interface PosAgg { sym: string; qty: number; notional: number; pnl: number; sector: string }

export interface BookMetrics {
  id: BookId;
  name: string;
  short: string;
  capital: number;
  pnl: number;
  pnlPct: number;
  peak: number;
  drawdown: number;
  ddPct: number;
  gross: number;
  net: number;
  var95: number;
  concentration: { sym: string; pct: number };
  util: { drawdown: number; gross: number; concentration: number };
  positions: PosAgg[];
  sectors: Record<string, number>;
  traders: string[];
  pnlSeries: number[];
  daily: number[];
}

export interface FirmMetrics {
  capital: number;
  nav: number;
  pnl: number;
  pnlPct: number;
  gross: number;
  net: number;
  var95: number;
  books: BookMetrics[];
}

export function roundQty(sym: string, q: number): number {
  const inst = INSTRUMENTS[INSTRUMENT_INDEX.get(sym)!];
  if (isLiveUniverse()) return Math.round(q * 1e4) / 1e4; // perpetuals trade in fractional sizes
  if (inst.kind === 'equity') return Math.round(q / 100) * 100;
  return Math.round(q);
}

export class Finance {
  traders = new Map<string, TraderState>();
  pmByBook = new Map<BookId, string>();
  alerts: RiskAlert[] = [];
  trades: Fill[] = [];
  peak = new Map<BookId, number>();
  pnlSeries = new Map<BookId, number[]>();
  daily = new Map<BookId, number[]>();
  derisk = new Map<BookId, { alertId: string; sector: string; targetGross: number; startedAt: number }>();
  private seq = 0;
  private metricsCache = new Map<BookId, BookMetrics>();
  private cacheMinute = -1;
  incidentDelay = false;
  /** Strategies from the traders' training: active ones trade an intraday overlay on top of core positions. */
  strategies = new Map<string, { s: TraderStrategy; active: boolean; size: number; forward: { trades: number; wins: number; pnl: number }; promote: boolean }>();
  /** Promotions and suspensions decided by the forward-test rules, for the office to report. */
  strategyEvents: { empId: string; kind: 'promoted' | 'suspended'; trades: number; pnl: number }[] = [];
  /** Human error model: chance that a trader keys a 10× quantity (set by the office from skill). */
  fatFinger?: (empId: string, orderId: string) => boolean;
  /** Pre-trade risk check: true if an oversized order is caught and blocked. */
  preTradeCatch?: (empId: string, orderId: string) => boolean;
  /** Keying errors for the office to follow up (blocked, or filled and needing correction). */
  errorEvents: { empId: string; orderId: string; sym: string; side: Side; excess: number; px: number; blocked: boolean; t: number }[] = [];
  /** Open strategy overlay per trader and symbol. */
  overlay = new Map<string, Map<string, { pos: number; entry: number; qty: number }>>();

  /** Real mode: no made-up starting positions, no random trading or random confirmation breaks; markets trade 24/7. */
  readonly real: boolean;

  constructor(private seed: number, private market: Market, traders: { empId: string; bookId: BookId }[], pms: { empId: string; bookId: BookId }[], opts: { real?: boolean } = {}) {
    this.real = !!opts.real;
    for (const p of pms) if (!this.pmByBook.has(p.bookId)) this.pmByBook.set(p.bookId, p.empId);
    for (const b of BOOKS) {
      const tr = traders.filter((t) => t.bookId === b.id);
      const syms = Object.keys(b.base);
      tr.forEach((t, i) => {
        const coverage = syms.filter((_, k) => k % tr.length === i);
        for (const s of syms) if (coverage.length < 2 && !coverage.includes(s)) coverage.push(s);
        this.traders.set(t.empId, { empId: t.empId, bookId: b.id, coverage, positions: new Map(), orders: [], fills: [], reduced: new Set() });
      });
      // prior 20 days of fictional daily P&L for the performance chart
      this.daily.set(b.id, Array.from({ length: 20 }, (_, d) => (hashRand(seed, 'bookdaily', b.id, d) - 0.46) * b.capital * 0.012));
    }
    if (!this.real) this.seedPositions();
    this.newDay();
  }

  /** Distribute each book's base exposure across the traders covering each symbol. */
  private seedPositions() {
    for (const b of BOOKS) {
      const tr = [...this.traders.values()].filter((t) => t.bookId === b.id);
      if (!tr.length) continue;
      Object.entries(b.base).forEach(([sym, notional], k) => {
        const owner = tr.find((t) => t.coverage[0] === sym) ?? tr.find((t) => t.coverage.includes(sym)) ?? tr[k % tr.length];
        const inst = INSTRUMENTS[INSTRUMENT_INDEX.get(sym)!];
        const qty = roundQty(sym, notional / (this.market.price(sym) * inst.mult));
        owner.positions.set(sym, { sym, qty, avg: this.market.price(sym), realized: 0 });
      });
    }
  }

  /** New trading day: positions are marked at the open, intraday P&L restarts. */
  newDay() {
    for (const b of BOOKS) {
      const prev = this.pnlSeries.get(b.id);
      if (prev && prev.length > 1) {
        const d = this.daily.get(b.id)!;
        d.push(prev[prev.length - 1]);
        if (d.length > 20) d.shift();
      }
      this.peak.set(b.id, 0);
      this.pnlSeries.set(b.id, [0]);
    }
    for (const t of this.traders.values()) {
      for (const p of t.positions.values()) { p.avg = this.market.price(p.sym); p.realized = 0; }
      t.orders = [];
      t.fills = [];
      t.reduced.clear();
    }
    this.trades = [];
    this.overlay.clear();
    this.alerts = this.alerts.filter((a) => a.status !== 'resolved');
    this.derisk.clear();
    this.cacheMinute = -1;
  }

  private nextId(prefix: string) {
    this.seq++;
    return `${prefix}${String(this.seq).padStart(5, '0')}`;
  }

  private applyFill(t: TraderState, o: Order, px: number, minute: number): Fill {
    const inst = INSTRUMENTS[INSTRUMENT_INDEX.get(o.sym)!];
    const signed = o.side === 'BUY' ? o.qty : -o.qty;
    const pos = t.positions.get(o.sym) ?? { sym: o.sym, qty: 0, avg: px, realized: 0 };
    if (pos.qty === 0 || Math.sign(pos.qty) === Math.sign(signed)) {
      const nq = pos.qty + signed;
      pos.avg = (pos.avg * Math.abs(pos.qty) + px * Math.abs(signed)) / Math.abs(nq);
      pos.qty = nq;
    } else {
      const closing = Math.min(Math.abs(signed), Math.abs(pos.qty));
      pos.realized += (px - pos.avg) * closing * Math.sign(pos.qty) * inst.mult;
      const nq = pos.qty + signed;
      if (Math.sign(nq) !== Math.sign(pos.qty) && nq !== 0) pos.avg = px;
      pos.qty = nq;
    }
    t.positions.set(o.sym, pos);
    o.status = 'filled';
    o.filledAt = minute;
    o.fillPx = px;
    const r = hashRand(this.seed, 'confirm', o.id);
    const isBreak = !this.real && r < (this.incidentDelay ? 0.18 : 0.05);
    const fill: Fill = {
      id: this.nextId('T'), orderId: o.id, t: minute, traderId: t.empId, bookId: t.bookId, sym: o.sym, side: o.side,
      qty: o.qty, px, notional: o.qty * px * inst.mult, status: 'pending',
      confirmAt: minute + 4 + Math.floor(hashRand(this.seed, 'confirmT', o.id) * 14) + (this.incidentDelay ? 22 : 0),
      breakReason: isBreak ? (r < 0.02 ? 'Price mismatch vs counterparty' : 'Quantity mismatch vs counterparty') : undefined,
    };
    t.fills.unshift(fill);
    if (t.fills.length > 40) t.fills.pop();
    this.trades.unshift(fill);
    if (this.trades.length > 200) this.trades.pop();
    this.cacheMinute = -1;
    return fill;
  }

  /** Fill price adjustment for market orders: real mode charges fee + slippage like the backtests. */
  get slip(): number {
    return this.real ? 0.0006 : 0.0001;
  }

  /** Paper ledger for the real office (survives reloads). */
  serialize() {
    return {
      v: 1,
      traders: [...this.traders.values()].map((t) => ({ empId: t.empId, positions: [...t.positions.values()], orders: t.orders.slice(0, 20), fills: t.fills.slice(0, 20) })),
      trades: this.trades.slice(0, 150),
      daily: [...this.daily.entries()],
      realizedBase: [...this.traders.values()].map((t) => [t.empId, [...t.positions.values()].reduce((a, p) => a + p.realized, 0)]),
    };
  }

  restore(d: ReturnType<Finance['serialize']>) {
    if (!d || d.v !== 1) return;
    for (const x of d.traders ?? []) {
      const t = this.traders.get(x.empId);
      if (!t) continue;
      t.positions = new Map(x.positions.filter((p) => INSTRUMENT_INDEX.has(p.sym)).map((p) => [p.sym, { ...p }]));
      t.orders = x.orders ?? [];
      t.fills = x.fills ?? [];
    }
    this.trades = d.trades ?? [];
    for (const [k, v] of d.daily ?? []) this.daily.set(k, v);
    this.cacheMinute = -1;
  }

  /** Create (and for market orders, fill) an order. Returns the order. */
  placeOrder(empId: string, sym: string, side: Side, qty: number, type: 'MKT' | 'LMT', minute: number, reason: string): Order | null {
    const t = this.traders.get(empId);
    if (!t || qty <= 0) return null;
    const px = this.market.price(sym);
    const o: Order = { id: this.nextId('O'), t: minute, traderId: empId, bookId: t.bookId, sym, side, qty, type, status: 'working', reason };
    if (!reason.startsWith('Error correction') && this.fatFinger?.(empId, o.id)) {
      o.error = true;
      o.qty = qty * 10;
      if (this.preTradeCatch?.(empId, o.id)) {
        o.status = 'cancelled';
        o.reason = `Blocked by risk pre-trade check: ${o.qty.toLocaleString()} is 10× the intended size (${reason})`;
        t.orders.unshift(o);
        if (t.orders.length > 30) t.orders.pop();
        this.errorEvents.push({ empId, orderId: o.id, sym, side, excess: o.qty - qty, px, blocked: true, t: minute });
        return o;
      }
      this.errorEvents.push({ empId, orderId: o.id, sym, side, excess: o.qty - qty, px, blocked: false, t: minute });
    }
    if (type === 'LMT') o.limit = px * (side === 'BUY' ? 0.9996 : 1.0004);
    t.orders.unshift(o);
    if (t.orders.length > 30) t.orders.pop();
    if (type === 'MKT') this.applyFill(t, o, px * (side === 'BUY' ? 1 + this.slip : 1 - this.slip), minute);
    return o;
  }

  /** Seeded trading decision for a trader who is at their desk. Returns the order placed, if any. */
  traderDecision(empId: string, day: number, minute: number): Order | null {
    const t = this.traders.get(empId);
    if (!t || (!this.real && (minute < MARKET_OPEN || minute > MARKET_CLOSE))) return null;
    const ds = this.derisk.get(t.bookId);
    if (ds) {
      // Execute the risk-review instruction: cut the largest positions in the book by 30%.
      if (hashRand(this.seed, 'derisk', empId, day, minute) > 0.35) return null;
      let best: Position | null = null;
      let bestN = 0;
      for (const p of t.positions.values()) {
        if (t.reduced.has(p.sym) || p.qty === 0) continue;
        const inst = INSTRUMENTS[INSTRUMENT_INDEX.get(p.sym)!];
        const n = Math.abs(p.qty * this.market.price(p.sym) * inst.mult);
        if (n > bestN) { best = p; bestN = n; }
      }
      if (!best) return null;
      t.reduced.add(best.sym);
      const qty = roundQty(best.sym, Math.abs(best.qty) * 0.3);
      if (qty <= 0) return null;
      return this.placeOrder(empId, best.sym, best.qty > 0 ? 'SELL' : 'BUY', qty, 'MKT', minute, 'Risk reduction (review instruction)');
    }
    if (this.real) return null; // real mode: only validated strategies trade (run by the strategy desk)
    const st = this.strategies.get(empId);
    if (st?.active) {
      const o = this.strategyDecision(t, st, minute);
      if (o) return o;
    }
    // core-position maintenance; after training without a proven edge, turnover is kept low
    const r = hashRand(this.seed, 'trade', empId, day, minute);
    if (r > (st ? (st.active ? 1 / 45 : 1 / 90) : 1 / 16)) return null;
    const sym = t.coverage[Math.floor(hashRand(this.seed, 'tsym', empId, day, minute) * t.coverage.length)];
    const book = BOOK_INDEX.get(t.bookId)!;
    const base = book.base[sym] ?? 10e6;
    const inst = INSTRUMENTS[INSTRUMENT_INDEX.get(sym)!];
    const px = this.market.price(sym);
    const pos = t.positions.get(sym);
    const cur = (pos?.qty ?? 0) * px * inst.mult;
    const series = this.market.series(sym, 30);
    const ma = series.reduce((a, b) => a + b, 0) / series.length;
    let side: Side = px >= ma ? 'BUY' : 'SELL';
    if (hashRand(this.seed, 'tside', empId, day, minute) < 0.3) side = side === 'BUY' ? 'SELL' : 'BUY';
    // keep exposure near the book's target: trim when stretched beyond 125% of base
    if (Math.abs(cur) > Math.abs(base) * 1.25) side = cur > 0 ? 'SELL' : 'BUY';
    const size = Math.abs(base) * (0.02 + hashRand(this.seed, 'tsize', empId, day, minute) * 0.04);
    const qty = roundQty(sym, size / (px * inst.mult));
    if (qty <= 0) return null;
    const type = hashRand(this.seed, 'ttype', empId, day, minute) < 0.7 ? 'MKT' : 'LMT';
    return this.placeOrder(empId, sym, side, qty, type, minute, side === (base >= 0 ? 'BUY' : 'SELL') ? 'Adding to position' : 'Trimming position');
  }

  /** Trade the trained strategy: one overlay unit (25% of the symbol's core size) per signal. */
  private strategyDecision(t: TraderState, st: { s: TraderStrategy; active: boolean; size: number; forward: { trades: number; wins: number; pnl: number }; promote: boolean }, minute: number): Order | null {
    const s = st.s;
    const book = BOOK_INDEX.get(t.bookId)!;
    let ov = this.overlay.get(t.empId);
    if (!ov) { ov = new Map(); this.overlay.set(t.empId, ov); }
    const closing = minute >= MARKET_CLOSE - 5;
    for (const sym of t.coverage) {
      const base = book.base[sym];
      if (!base) continue;
      const inst = INSTRUMENTS[INSTRUMENT_INDEX.get(sym)!];
      const px = this.market.price(sym);
      const cur = ov.get(sym) ?? { pos: 0, entry: px, qty: 0 };
      const series = this.market.series(sym, s.lookback + 1);
      const sg = series.length > s.lookback ? signalAt(s, series, series.length - 1) : null;
      if (!sg) continue;
      let want = cur.pos;
      const exit = cur.pos !== 0 && (closing || shouldExit(s, cur.pos, sg.z, px, cur.entry));
      if (exit) want = 0;
      else if (cur.pos === 0 && !closing && sg.sig !== 0) want = sg.sig;
      if (want === cur.pos) continue;
      if (want === 0) {
        ov.set(sym, { pos: 0, entry: px, qty: 0 });
        const stop = (px / cur.entry - 1) * cur.pos < -s.stopPct;
        this.recordRoundTrip(t.empId, st, (px - cur.entry) * cur.pos * cur.qty * inst.mult);
        return this.placeOrder(t.empId, sym, cur.pos > 0 ? 'SELL' : 'BUY', cur.qty, 'MKT', minute, closing ? 'Strategy: flat before the close' : stop ? 'Strategy: stop loss' : 'Strategy: signal faded, exit');
      }
      const qty = roundQty(sym, (Math.abs(base) * st.size) / (px * inst.mult));
      if (qty <= 0) continue;
      ov.set(sym, { pos: want, entry: px, qty });
      return this.placeOrder(t.empId, sym, want > 0 ? 'BUY' : 'SELL', qty, 'MKT', minute, `Strategy: ${s.kind === 'momentum' ? 'momentum' : 'mean-reversion'} signal z=${sg.z.toFixed(2)} (trained)`);
    }
    return null;
  }

  /**
   * Forward-test discipline on every live strategy: after 8 round trips a losing strategy is suspended;
   * a winning forward test is promoted from 10% to the full 25% overlay.
   */
  private recordRoundTrip(empId: string, st: { active: boolean; size: number; forward: { trades: number; wins: number; pnl: number }; promote: boolean }, pnl: number) {
    st.forward.trades++;
    st.forward.pnl += pnl;
    if (pnl > 0) st.forward.wins++;
    if (st.forward.trades < 8) return;
    if (st.forward.pnl < 0) {
      st.active = false;
      this.strategyEvents.push({ empId, kind: 'suspended', trades: st.forward.trades, pnl: st.forward.pnl });
    } else if (st.promote && st.size < 0.25) {
      st.size = 0.25;
      this.strategyEvents.push({ empId, kind: 'promoted', trades: st.forward.trades, pnl: st.forward.pnl });
    }
  }

  /** Per-minute processing: limit fills/expiry, confirmations, P&L series, limit checks. */
  onMinute(minute: number): RiskAlert[] {
    for (const t of this.traders.values()) {
      for (const o of t.orders) {
        if (o.status !== 'working') continue;
        const px = this.market.price(o.sym);
        if ((o.side === 'BUY' && px <= o.limit!) || (o.side === 'SELL' && px >= o.limit!)) this.applyFill(t, o, o.limit!, minute);
        else if (minute - o.t > 30) o.status = 'cancelled';
      }
    }
    for (const f of this.trades) {
      if (f.status === 'pending' && minute >= f.confirmAt) f.status = f.breakReason ? 'break' : 'matched';
    }
    this.cacheMinute = -1;
    const created: RiskAlert[] = [];
    for (const b of BOOKS) {
      const m = this.bookMetrics(b.id, minute);
      const s = this.pnlSeries.get(b.id)!;
      s.push(m.pnl);
      if (s.length > 720) s.shift();
      if (m.pnl > (this.peak.get(b.id) ?? 0)) this.peak.set(b.id, m.pnl);
      if (!this.real && (minute < MARKET_OPEN || minute > MARKET_CLOSE)) continue;
      for (const metric of ['drawdown', 'gross', 'concentration'] as const) {
        const u = m.util[metric];
        if (u < 1) continue;
        const active = this.alerts.find((a) => a.bookId === b.id && a.metric === metric && (a.status !== 'resolved' || minute - (a.resolvedAt ?? 0) < 90));
        if (active) continue;
        const limit = metric === 'drawdown' ? b.limits.drawdownPct : metric === 'gross' ? b.limits.grossMult : b.limits.concentrationPct;
        const value = metric === 'drawdown' ? m.ddPct : metric === 'gross' ? m.gross / b.capital : m.concentration.pct;
        const a: RiskAlert = {
          id: this.nextId('RA'), t: minute, bookId: b.id, metric, value, limit, status: 'open', grossAtBreach: m.gross,
          log: [{ t: minute, text: `${metric === 'drawdown' ? 'Intraday drawdown' : metric === 'gross' ? 'Gross exposure' : 'Single-name concentration'} ${(value * 100).toFixed(2)}% exceeded limit ${(limit * 100).toFixed(2)}%` }],
        };
        this.alerts.unshift(a);
        created.push(a);
      }
    }
    // de-risk completion check
    for (const [bookId, ds] of this.derisk) {
      const m = this.bookMetrics(bookId, minute);
      const alert = this.alerts.find((a) => a.id === ds.alertId);
      if (!alert) { this.derisk.delete(bookId); continue; }
      const allDone = [...this.traders.values()].filter((t) => t.bookId === bookId).every((t) => [...t.positions.values()].every((p) => p.qty === 0 || t.reduced.has(p.sym)));
      if (m.gross <= ds.targetGross || allDone || minute - ds.startedAt > 120 || minute >= MARKET_CLOSE) {
        alert.status = 'resolved';
        alert.resolvedAt = minute;
        alert.log.push({ t: minute, text: m.gross <= ds.targetGross || allDone ? `Exposure reduced to ${(m.gross / 1e6).toFixed(1)}m (from ${(alert.grossAtBreach / 1e6).toFixed(1)}m). Alert closed.` : minute >= MARKET_CLOSE ? 'Market closed before the full reduction; residual exposure carried overnight with PM and Head of Risk sign-off. Alert closed.' : 'Reduction window ended; residual exposure accepted by PM and Head of Risk. Alert closed.' });
        this.derisk.delete(bookId);
      }
    }
    return created;
  }

  startDerisk(alert: RiskAlert, minute: number) {
    const m = this.bookMetrics(alert.bookId, minute);
    const worst = Object.entries(m.sectors).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0]?.[0] ?? 'All';
    this.derisk.set(alert.bookId, { alertId: alert.id, sector: worst, targetGross: alert.grossAtBreach * 0.8, startedAt: minute });
    for (const t of this.traders.values()) if (t.bookId === alert.bookId) t.reduced.clear();
    alert.status = 'action';
    alert.log.push({ t: minute, text: `PM instructed traders to cut largest positions by 30% (target gross ${(alert.grossAtBreach * 0.8 / 1e6).toFixed(1)}m).` });
    // A book with no traders cannot reduce; close it in the next minute check.
  }

  /** Ops resolves the oldest open break. */
  resolveBreak(empId: string, minute: number): Fill | null {
    const f = [...this.trades].reverse().find((x) => x.status === 'break');
    if (!f) return null;
    f.status = 'resolved';
    f.resolvedBy = empId;
    f.resolvedAt = minute;
    return f;
  }

  bookMetrics(id: BookId, minute: number): BookMetrics {
    if (this.cacheMinute !== minute) { this.metricsCache.clear(); this.cacheMinute = minute; }
    const cached = this.metricsCache.get(id);
    if (cached) return cached;
    const def = BOOK_INDEX.get(id)!;
    const agg = new Map<string, PosAgg>();
    const traders: string[] = [];
    for (const t of this.traders.values()) {
      if (t.bookId !== id) continue;
      traders.push(t.empId);
      for (const p of t.positions.values()) {
        const inst = INSTRUMENTS[INSTRUMENT_INDEX.get(p.sym)!];
        const px = this.market.price(p.sym);
        const a = agg.get(p.sym) ?? { sym: p.sym, qty: 0, notional: 0, pnl: 0, sector: inst.sector };
        a.qty += p.qty;
        a.notional += p.qty * px * inst.mult;
        a.pnl += (px - p.avg) * p.qty * inst.mult + p.realized;
        agg.set(p.sym, a);
      }
    }
    const positions = [...agg.values()].sort((a, b) => Math.abs(b.notional) - Math.abs(a.notional));
    let pnl = 0, gross = 0, net = 0;
    const sectors: Record<string, number> = {};
    const sectorRisk: Record<string, number> = {};
    for (const p of positions) {
      pnl += p.pnl;
      gross += Math.abs(p.notional);
      net += p.notional;
      sectors[p.sector] = (sectors[p.sector] ?? 0) + p.notional;
      const inst = INSTRUMENTS[INSTRUMENT_INDEX.get(p.sym)!];
      sectorRisk[p.sector] = (sectorRisk[p.sector] ?? 0) + p.notional * inst.vol;
    }
    const var95 = 1.65 * Math.sqrt(Object.values(sectorRisk).reduce((s, v) => s + v * v, 0));
    const peak = Math.max(this.peak.get(id) ?? 0, pnl);
    const drawdown = peak - pnl;
    const top = positions[0];
    const concentration = { sym: top?.sym ?? '-', pct: top ? Math.abs(top.notional) / def.capital : 0 };
    const m: BookMetrics = {
      id, name: def.name, short: def.short, capital: def.capital, pnl, pnlPct: pnl / def.capital, peak, drawdown,
      ddPct: drawdown / def.capital, gross, net, var95, concentration,
      util: {
        drawdown: drawdown / def.capital / def.limits.drawdownPct,
        gross: gross / (def.capital * def.limits.grossMult),
        concentration: concentration.pct / def.limits.concentrationPct,
      },
      positions, sectors, traders, pnlSeries: this.pnlSeries.get(id) ?? [0], daily: this.daily.get(id) ?? [],
    };
    this.metricsCache.set(id, m);
    return m;
  }

  firm(minute: number): FirmMetrics {
    const books = BOOKS.map((b) => this.bookMetrics(b.id, minute));
    const pnl = books.reduce((s, b) => s + b.pnl, 0);
    return {
      capital: firmCapital(), nav: firmCapital() + pnl, pnl, pnlPct: pnl / firmCapital(),
      gross: books.reduce((s, b) => s + b.gross, 0), net: books.reduce((s, b) => s + b.net, 0),
      var95: Math.sqrt(books.reduce((s, b) => s + b.var95 * b.var95, 0)), books,
    };
  }

  traderPnl(empId: string): number {
    const t = this.traders.get(empId);
    if (!t) return 0;
    let pnl = 0;
    for (const p of t.positions.values()) {
      const inst = INSTRUMENTS[INSTRUMENT_INDEX.get(p.sym)!];
      pnl += (this.market.price(p.sym) - p.avg) * p.qty * inst.mult + p.realized;
    }
    return pnl;
  }

  openAlerts(): RiskAlert[] {
    return this.alerts.filter((a) => a.status !== 'resolved');
  }
}
