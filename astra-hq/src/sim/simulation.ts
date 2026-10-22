// The office simulation: one clock, one shared state. Employees follow schedules and events, reserve
// seats, walk along navigation routes, and drive the simulated market/risk/ops/tech state that every
// monitor renders. Pure TypeScript: runs headless in tests and in the browser.
import type { EmployeeConfig, OfficeConfig, RoleType } from '../config/types';
import { ROLE_LABELS } from '../config/types';
import { FLOOR_H, roomAt, roomById, ROOMS } from '../world/building';
import { DynamicWorld, type Agent } from '../world/dynamic';
import { MONITORS, SEATS, SEAT_INDEX, WORKSTATIONS, WS_INDEX, type Seat, type Workstation } from '../world/furniture';
import { findPath, nearestWalkable, type Waypoint } from '../world/nav';
import { fmtMoney, fmtTime } from '../util/math';
import { hashRand } from '../util/rng';
import { APPS, appFor, type AppId } from './apps';
import { DAY_END, DAY_START, SIM_MIN_PER_REAL_SEC, WALK_SPEED, type Speed } from './constants';
import { BOOKABLE_FOR_REVIEW, INCIDENT_START, SHOCK_MINUTE, scheduledEvents, type OfficeEvent } from './events';
import { BOOK_INDEX, Finance, type RiskAlert } from './finance';
import { INSTRUMENTS, Market, fmtPx } from './market';
import { buildSchedule, type Block } from './schedule';
import { Tech } from './tech';

export type Activity = 'working' | 'reviewing' | 'walking' | 'meeting' | 'cafe' | 'returning' | 'discussing' | 'investigating';
export const ACTIVITIES: Activity[] = ['working', 'reviewing', 'walking', 'meeting', 'cafe', 'returning', 'discussing', 'investigating'];
export const ACTIVITY_LABEL: Record<Activity, string> = {
  working: 'Working',
  reviewing: 'Reviewing screens',
  walking: 'Walking',
  meeting: 'In a meeting',
  cafe: 'Café break',
  returning: 'Returning to desk',
  discussing: 'Discussing work',
  investigating: 'Investigating incident',
};
export const ACTIVITY_COLOR: Record<Activity, string> = {
  working: '#5fb37a', reviewing: '#7fb6d9', walking: '#d9c27f', meeting: '#b48ad9', cafe: '#d99a6c',
  returning: '#c9b26a', discussing: '#6cd9c4', investigating: '#e06c6c',
};

export type Pose = 'sit' | 'sitType' | 'sitTalk' | 'stand' | 'standTalk' | 'walk';

export type Intent =
  | { kind: 'desk' }
  | { kind: 'event'; eventId: string; remote: boolean }
  | { kind: 'lunch'; blockId: string }
  | { kind: 'coffee'; blockId: string; where: 'cafe' | 'lounge' }
  | { kind: 'discuss'; blockId: string; withId: string };

type Phase = 'seated' | 'standing' | 'walking' | 'sitting-down' | 'standing-up' | 'door-wait';

export interface HistoryEntry { t: number; day: number; activity: Activity; text: string; room: string }

export interface Employee {
  cfg: EmployeeConfig;
  index: number;
  ws: Workstation;
  floor: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  pose: Pose;
  activity: Activity;
  task: string;
  intent: Intent;
  intentKey: string;
  seatId: string | null; // reserved target seat
  /** Destination seat/spot object (may be a virtual discussion spot). */
  target: Seat | null;
  /** Seat the employee is physically sitting on or standing at. */
  at: Seat | null;
  phase: Phase;
  blend: number;
  blendFrom: { x: number; y: number; z: number; h: number };
  blendTo: { x: number; y: number; z: number; h: number };
  path: Waypoint[];
  pathI: number;
  segStartY: number;
  speed: number;
  deskMode: 'working' | 'reviewing';
  deskModeUntil: number;
  discussWith: string | null;
  coffeePhase: 'queue' | 'sit' | null;
  coffeeUntil: number;
  startedBlocks: Set<string>;
  history: HistoryEntry[];
  schedule: Block[];
  work: { title: string; words: number; sym: string; file: string; line: number };
  lastAction: { t: number; text: string } | null;
  doorToClose: { id: string; x: number; z: number } | null;
  laneOffset: number;
}

export interface MonitorState { appId: AppId; tab: number; pinnedUntil: number; lastChange: number }

export interface CafeOrder { id: number; t: number; empId: string; name: string; drink: string; status: 'queued' | 'preparing' | 'ready' | 'collected'; readyAt: number }

export interface LogEntry { t: number; day: number; text: string; kind: 'event' | 'risk' | 'tech' | 'trade' | 'office' | 'door' }

const DRINKS = ['Flat white', 'Espresso', 'Americano', 'Cappuccino', 'Green tea', 'Oat latte', 'Cortado', 'Sparkling water'];
const RESEARCH_TOPICS = [
  { title: 'Sector rotation outlook: energy vs technology', sym: 'HLNE' },
  { title: 'Aurex Systems: cloud segment growth drivers', sym: 'AURX' },
  { title: 'Rates path and curve positioning', sym: 'TY10' },
  { title: 'Momentum factor decay study', sym: 'ORBL' },
  { title: 'Kestrel 2029 bond: refinancing risk', sym: 'KST29' },
];
const DEV_FILES = ['src/feed/handler.ts', 'src/oms/router.ts', 'src/risk/aggregate.ts', 'src/recon/matcher.ts'];

export class Simulation {
  config: OfficeConfig;
  seed: number;
  day = 0;
  minute = DAY_START;
  lastMinute = DAY_START;
  speed: Speed = 1;
  paused = false;
  dyn = new DynamicWorld();
  market!: Market;
  finance!: Finance;
  tech!: Tech;
  events: OfficeEvent[] = [];
  employees: Employee[] = [];
  byId = new Map<string, Employee>();
  reservations = new Map<string, string>(); // seatId -> employee id (or 'player')
  monitors = new Map<string, MonitorState>();
  wsOwner = new Map<string, string>(); // workstation -> employee id
  cafeOrders: CafeOrder[] = [];
  log: LogEntry[] = [];
  player: { x: number; y: number; z: number; floor: number } | null = null;
  /** Bumped whenever state visible in panels changes (once per simulated minute or on interactions). */
  version = 0;
  private orderSeq = 100;

  constructor(config: OfficeConfig) {
    this.config = config;
    this.seed = config.seed;
    this.build();
  }

  // ------------------------------------------------------------------ setup
  private build() {
    this.day = 0;
    this.minute = DAY_START;
    this.lastMinute = DAY_START;
    this.dyn.reset();
    this.dyn.onDoor = (d, by) => {
      if (by !== 'player') this.addLog(`${by} ${d.open ? 'opened' : 'closed'} the ${d.def.label} door`, 'door');
    };
    this.reservations.clear();
    this.wsOwner.clear();
    this.cafeOrders = [];
    this.log = [];
    this.market = new Market(this.seed, DAY_START);
    this.addShocks();
    const emps = this.config.employees;
    this.finance = new Finance(
      this.seed, this.market,
      emps.filter((e) => e.roleType === 'trader').map((e, i) => ({ empId: e.id, bookId: e.bookId ?? (['eq', 'macro', 'credit'] as const)[i % 3] })),
      emps.filter((e) => e.roleType === 'pm').map((e, i) => ({ empId: e.id, bookId: e.bookId ?? (['eq', 'macro', 'credit'] as const)[i % 3] })),
    );
    this.tech = new Tech(this.seed, INCIDENT_START);
    this.employees = emps.map((cfg, index) => this.makeEmployee(cfg, index));
    this.byId = new Map(this.employees.map((e) => [e.cfg.id, e]));
    for (const e of this.employees) this.wsOwner.set(e.ws.id, e.cfg.id);
    this.startDay();
    this.initMonitors();
  }

  private addShocks() {
    this.market.shocks = [{ minute: SHOCK_MINUTE, duration: 6, moves: { CRDX: -0.068, HLNE: -0.055, HLN31: -0.012 }, label: 'Energy sector sell-off (simulated news)' }];
  }

  private makeEmployee(cfg: EmployeeConfig, index: number): Employee {
    const ws = WS_INDEX.get(cfg.workstationId)!;
    const seat = SEAT_INDEX.get(ws.seatId)!;
    const topic = RESEARCH_TOPICS[index % RESEARCH_TOPICS.length];
    const e: Employee = {
      cfg, index, ws, floor: ws.floor, x: seat.x, y: seat.y, z: seat.z, heading: seat.heading, pose: 'sitType',
      activity: 'working', task: '', intent: { kind: 'desk' }, intentKey: 'desk', seatId: seat.id, target: seat, at: seat, phase: 'seated',
      blend: 1, blendFrom: { x: 0, y: 0, z: 0, h: 0 }, blendTo: { x: 0, y: 0, z: 0, h: 0 }, path: [], pathI: 0, segStartY: 0,
      speed: WALK_SPEED * (0.9 + hashRand(this.seed, 'speed', cfg.id) * 0.2),
      deskMode: 'working', deskModeUntil: DAY_START + 3 + Math.floor(hashRand(this.seed, 'dm', cfg.id) * 10),
      discussWith: null, coffeePhase: null, coffeeUntil: 0, startedBlocks: new Set(), history: [], schedule: [],
      work: { title: topic.title, sym: topic.sym, words: 600 + Math.floor(hashRand(this.seed, 'words', cfg.id) * 900), file: DEV_FILES[index % DEV_FILES.length], line: 40 + Math.floor(hashRand(this.seed, 'line', cfg.id) * 200) },
      lastAction: null, doorToClose: null, laneOffset: (hashRand(this.seed, 'lane', cfg.id) - 0.5) * 0.24,
    };
    this.reservations.set(seat.id, cfg.id);
    return e;
  }

  private startDay() {
    this.events = scheduledEvents(this.config.employees, this.day);
    for (const e of this.employees) {
      e.schedule = buildSchedule(this.seed, this.day, e.cfg, e.index, e.ws.floor, this.config.employees, this.events);
      e.startedBlocks.clear();
      e.task = this.deskTask(e);
      this.pushHistory(e, `Day ${this.day + 1} started at ${e.ws.label}`);
    }
    this.addLog(`Simulated day ${this.day + 1} begins. ${this.events.length} meetings scheduled.`, 'office');
  }

  private initMonitors() {
    this.monitors.clear();
    for (const m of MONITORS) {
      const owner = this.wsOwner.get(m.workstationId);
      const role = owner ? this.byId.get(owner)!.cfg.roleType : null;
      const appId = appFor(role, m.index);
      this.monitors.set(m.id, { appId, tab: 0, pinnedUntil: 0, lastChange: this.minute });
    }
  }

  /** Rebuild from (possibly edited) configuration and restart the day. */
  reset(config?: OfficeConfig) {
    if (config) {
      this.config = config;
      this.seed = config.seed;
    }
    this.paused = false;
    this.build();
    this.version++;
  }

  // ------------------------------------------------------------------ clock
  /** Advance by a real-time delta (seconds); applies pause and speed. */
  tick(realDt: number) {
    if (this.paused) {
      this.dyn.update(Math.min(realDt, 0.1), this.agents(), this.liftOccupied());
      return;
    }
    this.advance(Math.min(realDt, 0.1) * this.speed);
  }

  /** Advance by speed-scaled seconds (used directly by tests). */
  advance(dt: number) {
    let remaining = dt;
    while (remaining > 1e-6) {
      const step = Math.min(remaining, 0.1);
      remaining -= step;
      this.minute += step * SIM_MIN_PER_REAL_SEC;
      while (Math.floor(this.minute) > this.lastMinute) {
        this.lastMinute++;
        this.onMinute(this.lastMinute);
      }
      for (const e of this.employees) this.updateEmployee(e, step);
      this.dyn.update(step, this.agents(), this.liftOccupied());
      if (this.minute >= DAY_END) this.nextDay();
    }
  }

  private agents(): Agent[] {
    const a: Agent[] = this.employees.map((e) => ({ x: e.x, y: e.y, z: e.z }));
    if (this.player) a.push(this.player);
    return a;
  }

  private liftOccupied(): boolean {
    const p = this.player;
    return !!p && p.x > 20.9 && p.x < 23.3 && p.z > 3.5 && p.z < 5.95;
  }

  private nextDay() {
    this.day++;
    this.minute = DAY_START;
    this.lastMinute = DAY_START;
    this.market.newDay(this.day, DAY_START);
    this.addShocks();
    this.finance.newDay();
    this.tech.newDay(INCIDENT_START);
    this.cafeOrders = [];
    // overnight: everyone is back at their desk the next morning
    for (const e of this.employees) {
      if (e.seatId && e.seatId !== e.ws.seatId) this.release(e.seatId, e.cfg.id);
      const seat = SEAT_INDEX.get(e.ws.seatId)!;
      this.reservations.set(seat.id, e.cfg.id);
      Object.assign(e, { x: seat.x, y: seat.y, z: seat.z, floor: e.ws.floor, heading: seat.heading, seatId: seat.id, target: seat, at: seat, phase: 'seated', path: [], intent: { kind: 'desk' }, intentKey: 'desk', activity: 'working', discussWith: null, coffeePhase: null, pose: 'sitType' });
    }
    this.startDay();
    this.version++;
  }

  // ------------------------------------------------------------------ per minute
  private onMinute(m: number) {
    this.market.advanceTo(m, (mm) => {
      const alerts = this.finance.onMinute(mm);
      for (const a of alerts) this.handleAlert(a, mm);
    });
    const shock = this.market.shocks.find((s) => s.minute === m);
    if (shock) this.addLog(`Market: ${shock.label}. CRDX and HLNE falling.`, 'trade');
    const devs = this.employees.filter((e) => e.cfg.roleType === 'tech' && this.atDesk(e)).map((e) => e.cfg.id);
    const prevInc = this.tech.incident.status;
    this.tech.onMinute(m, this.day, devs, new Map(this.employees.map((e) => [e.cfg.id, e.cfg.name])));
    if (this.tech.incident.status !== prevInc) {
      const last = this.tech.incident.log[this.tech.incident.log.length - 1];
      if (last) this.addLog(`Technology: ${last.text}`, 'tech');
    }
    this.market.feedDelayed = this.tech.incidentActive;
    this.finance.incidentDelay = this.tech.incidentActive;
    this.updateEvents(m);
    for (const e of this.employees) this.decide(e, m);
    this.updateDeskWork(m);
    this.updateCafe(m);
    this.version++;
  }

  private updateEvents(m: number) {
    for (const ev of this.events) {
      if (ev.status === 'cancelled') continue;
      if (ev.status === 'scheduled' && m >= ev.start) {
        ev.status = 'in-progress';
        this.addLog(`${ev.title} started in ${roomById(ev.roomId)?.name}`, 'event');
        this.onEventStart(ev, m);
      }
      if (ev.status === 'in-progress' && m >= ev.end) {
        ev.status = 'completed';
        this.addLog(`${ev.title} finished`, 'event');
        this.onEventEnd(ev, m);
      }
      if (ev.status === 'in-progress') this.updateEventNotes(ev, m);
    }
  }

  private onEventStart(ev: OfficeEvent, m: number) {
    if (ev.kind === 'risk-review' && ev.alertId) {
      const a = this.finance.alerts.find((x) => x.id === ev.alertId);
      if (a && a.status !== 'resolved') {
        a.status = 'in-review';
        a.log.push({ t: m, text: `Review started in ${roomById(ev.roomId)?.name} with ${ev.attendeeIds.map((id) => this.name(id)).join(', ')}` });
      }
    }
    this.updateEventNotes(ev, m);
  }

  private onEventEnd(ev: OfficeEvent, m: number) {
    if (ev.kind === 'risk-review' && ev.alertId) {
      const a = this.finance.alerts.find((x) => x.id === ev.alertId);
      if (a && a.status !== 'resolved') {
        this.finance.startDerisk(a, m);
        this.addLog(`Risk review outcome: ${BOOK_INDEX.get(a.bookId)?.name} traders to cut largest positions by 30%`, 'risk');
        ev.notes.push(`${fmtTime(m)} Decision: reduce largest positions 30%; Risk to confirm closure.`);
      }
    }
  }

  /** Meeting notes reflect live simulated data (shown on whiteboards and room displays). */
  private updateEventNotes(ev: OfficeEvent, m: number) {
    const keep = ev.notes.filter((n) => n.includes('Decision'));
    const notes: string[] = [];
    const firm = this.finance.firm(m);
    switch (ev.kind) {
      case 'briefing': {
        const movers = INSTRUMENTS.map((i) => ({ i, c: this.market.change(i.sym) })).sort((a, b) => Math.abs(b.c) - Math.abs(a.c)).slice(0, 3);
        notes.push(`Firm P&L since open: ${fmtMoney(firm.pnl)}`);
        for (const { i, c } of movers) notes.push(`${i.sym} ${(c * 100).toFixed(2)}% at ${fmtPx(i.sym, this.market.price(i.sym))}`);
        notes.push(`Gross exposure ${fmtMoney(firm.gross)} · VaR95 ${fmtMoney(firm.var95)}`);
        break;
      }
      case 'research-review':
        for (const id of ev.attendeeIds) {
          const e = this.byId.get(id);
          if (e?.cfg.roleType === 'researcher') notes.push(`${e.cfg.name.split(' ')[0]}: ${e.work.title} (${e.work.words.toLocaleString()} words)`);
        }
        break;
      case 'incident':
        notes.push(`${this.tech.incident.id}: ${this.tech.incident.title}`);
        for (const l of this.tech.incident.log.slice(-2)) notes.push(`${fmtTime(l.t)} ${l.text}`);
        break;
      case 'risk-review': {
        const a = this.finance.alerts.find((x) => x.id === ev.alertId);
        if (a) {
          const b = this.finance.bookMetrics(a.bookId, m);
          notes.push(`Breach: ${a.metric} ${(a.value * 100).toFixed(2)}% vs limit ${(a.limit * 100).toFixed(2)}%`);
          notes.push(`${b.name}: P&L ${fmtMoney(b.pnl)}, drawdown ${(b.ddPct * 100).toFixed(2)}%`);
          const worst = [...b.positions].sort((x, y) => x.pnl - y.pnl)[0];
          if (worst) notes.push(`Largest loss: ${worst.sym} ${fmtMoney(worst.pnl)}`);
        }
        break;
      }
      case 'portfolio-review':
        for (const b of firm.books) notes.push(`${b.short}: ${fmtMoney(b.pnl)} (${(b.pnlPct * 100).toFixed(2)}%), gross ${fmtMoney(b.gross)}`);
        notes.push(`Open risk alerts: ${this.finance.openAlerts().length}`);
        break;
      case 'standup':
        notes.push(`Builds today: ${this.tech.builds.length} (${this.tech.builds.filter((b) => b.status === 'failed').length} failed)`);
        notes.push('On-call: feed handler watch');
        break;
      case 'interview':
        notes.push('Video call in progress (remote candidate)');
        break;
      case 'training':
        notes.push('Module 2 of 3: information barriers');
        break;
    }
    ev.notes = [...notes, ...keep];
  }

  /** Breach -> analyst acknowledges -> review meeting booked with the book's PM -> traders de-risk. */
  private handleAlert(a: RiskAlert, m: number) {
    const book = BOOK_INDEX.get(a.bookId)!;
    this.addLog(`Risk alert ${a.id}: ${book.name} ${a.metric} limit breached`, 'risk');
    const riskTeam = this.employees.filter((e) => e.cfg.roleType === 'risk');
    const analyst = riskTeam.find((e) => this.atDesk(e)) ?? riskTeam[0];
    if (analyst) {
      a.ackBy = analyst.cfg.id;
      if (this.atDesk(analyst)) {
        a.status = 'acknowledged';
        a.log.push({ t: m, text: `Acknowledged by ${analyst.cfg.name}` });
      }
      analyst.lastAction = { t: m, text: `Reviewing ${a.metric} alert ${a.id} (${book.short} book)` };
    }
    const pm = this.finance.pmByBook.get(a.bookId);
    const attendees = [...new Set([analyst?.cfg.id, riskTeam[0]?.cfg.id, pm].filter((x): x is string => !!x))];
    if (!attendees.length) return;
    let start = Math.ceil((m + 15) / 5) * 5;
    let room = '';
    for (let tries = 0; tries < 12 && !room; tries++) {
      room = BOOKABLE_FOR_REVIEW.find((r) => !this.events.some((e) => e.roomId === r && e.status !== 'cancelled' && start < e.end && start + 30 > e.start)) ?? '';
      if (!room) start += 15;
    }
    if (!room) room = BOOKABLE_FOR_REVIEW[0];
    const ev: OfficeEvent = {
      id: `d${this.day}-review-${a.id}`, kind: 'risk-review', title: `Risk Review: ${book.short} ${a.metric} breach`, roomId: room,
      start, end: start + 30, attendeeIds: attendees, status: 'scheduled', dynamic: true, alertId: a.id,
      agenda: ['Breach details and drivers', 'Position-level attribution', 'Decide remediation'], notes: [],
    };
    a.reviewEventId = ev.id;
    a.log.push({ t: m, text: `Review booked ${fmtTime(start)} in ${roomById(room)?.name}` });
    this.events.push(ev);
    this.events.sort((x, y) => x.start - y.start);
    this.addLog(`Booked ${ev.title} at ${fmtTime(start)} (${roomById(room)?.name})`, 'event');
  }

  // ------------------------------------------------------------------ decisions
  private travelMinutes(e: Employee, roomId: string): number {
    const r = roomById(roomId);
    if (!r) return 5;
    const d = Math.abs(r.entry.x - e.x) + Math.abs(r.entry.z - e.z) + Math.abs(r.floor - e.floor) * 22;
    return (d / e.speed) * SIM_MIN_PER_REAL_SEC;
  }

  private desiredIntent(e: Employee, m: number): Intent {
    for (const ev of this.events) {
      if (ev.status === 'cancelled' || ev.status === 'completed' || !ev.attendeeIds.includes(e.cfg.id)) continue;
      if (m >= ev.end) continue;
      const committed = e.intent.kind === 'event' && e.intent.eventId === ev.id;
      const depart = ev.start - this.travelMinutes(e, ev.roomId) - 2;
      if (committed || m >= depart) {
        const remote = e.intent.kind === 'event' && e.intent.eventId === ev.id ? e.intent.remote : false;
        return { kind: 'event', eventId: ev.id, remote };
      }
    }
    for (const b of e.schedule) {
      if (m < b.start || m >= b.end) continue;
      if (b.kind === 'lunch') return { kind: 'lunch', blockId: b.id };
      if (b.kind === 'coffee') return { kind: 'coffee', blockId: b.id, where: b.where ?? 'cafe' };
      if (b.kind === 'discuss' && b.withId) {
        if (e.intent.kind === 'discuss' && e.intent.blockId === b.id) {
          const partner = this.byId.get(b.withId);
          if (partner && this.atDesk(partner)) return e.intent;
          continue; // partner left their desk: discussion ends
        }
        if (e.startedBlocks.has(b.id)) continue;
        const partner = this.byId.get(b.withId);
        if (partner && this.atDesk(partner) && !partner.discussWith && !this.reservations.has(`discuss:${partner.ws.id}`)) return { kind: 'discuss', blockId: b.id, withId: b.withId };
      }
    }
    return { kind: 'desk' };
  }

  private intentKey(i: Intent): string {
    switch (i.kind) {
      case 'desk': return 'desk';
      case 'event': return `event:${i.eventId}`;
      case 'lunch': return `lunch:${i.blockId}`;
      case 'coffee': return `coffee:${i.blockId}`;
      case 'discuss': return `discuss:${i.blockId}`;
    }
  }

  private decide(e: Employee, m: number) {
    // coffee: after queueing at the counter, find a seat for the rest of the break
    if (e.intent.kind === 'coffee' && e.coffeePhase === 'queue' && e.phase === 'standing' && m >= e.coffeeUntil) {
      this.coffeeSitDown(e, m);
    }
    const want = this.desiredIntent(e, m);
    const key = this.intentKey(want);
    if (key !== e.intentKey) this.switchIntent(e, want, m);
  }

  atDesk(e: Employee): boolean {
    return e.intent.kind === 'desk' && e.phase === 'seated' && e.seatId === e.ws.seatId;
  }

  /** Employee is at their desk (including remote meeting attendance and receiving a discussion). */
  presentAtDesk(e: Employee): boolean {
    return e.phase === 'seated' && e.seatId === e.ws.seatId;
  }

  private reserve(seatId: string, who: string): boolean {
    const cur = this.reservations.get(seatId);
    if (cur && cur !== who) return false;
    this.reservations.set(seatId, who);
    return true;
  }

  private release(seatId: string | null, who: string) {
    if (seatId && this.reservations.get(seatId) === who) this.reservations.delete(seatId);
  }

  private pickSeat(e: Employee, candidates: Seat[], key: string): Seat | null {
    const free = candidates.filter((s) => !this.reservations.has(s.id));
    if (!free.length) return null;
    const i = Math.floor(hashRand(this.seed, key, e.cfg.id, this.day) * free.length);
    return free[i];
  }

  private switchIntent(e: Employee, want: Intent, m: number) {
    const prevKey = e.intentKey;
    let target: Seat | null = null;
    const deskSeat = SEAT_INDEX.get(e.ws.seatId)!;
    switch (want.kind) {
      case 'desk':
        target = deskSeat;
        break;
      case 'event': {
        const evId = want.eventId;
        const ev = this.events.find((x) => x.id === evId)!;
        const room = ev.roomId;
        const pool = SEATS.filter((s) => s.roomId === room && (ev.standing ? s.kind === 'stand' : s.kind === 'meeting' || s.kind === 'lounge'));
        target = this.pickSeat(e, pool, `ev:${ev.id}`);
        if (!target) {
          want.remote = true;
          target = deskSeat;
        }
        break;
      }
      case 'lunch': {
        target = this.pickSeat(e, SEATS.filter((s) => s.roomId === 'g-cafe' && s.kind === 'cafe'), `lunch:${want.blockId}`)
          ?? this.pickSeat(e, SEATS.filter((s) => s.roomId === 's-lounge' && s.kind !== 'stand'), `lunch2:${want.blockId}`)
          ?? deskSeat;
        break;
      }
      case 'coffee': {
        const prefix = want.where === 'cafe' ? 'cafe-q' : 'slounge-q';
        const q = SEATS.filter((s) => s.kind === 'stand' && s.id.startsWith(prefix));
        target = this.pickSeat(e, q, `cq:${want.blockId}`);
        e.coffeePhase = 'queue';
        if (!target) {
          e.coffeePhase = 'sit';
          target = this.coffeeSeat(e, want.where, want.blockId) ?? deskSeat;
        }
        break;
      }
      case 'discuss': {
        const partner = this.byId.get(want.withId)!;
        const id = `discuss:${partner.ws.id}`;
        if (this.reservations.has(id)) { target = deskSeat; want = { kind: 'desk' }; break; }
        const spot = nearestWalkable(partner.ws.floor, partner.ws.discussSpot.x, partner.ws.discussSpot.z, 1.2) ?? partner.ws.discussSpot;
        const ps = SEAT_INDEX.get(partner.ws.seatId)!;
        target = { id, floor: partner.ws.floor, x: spot.x, z: spot.z, y: partner.ws.floor * FLOOR_H, heading: Math.atan2(ps.x - spot.x, ps.z - spot.z), kind: 'stand', roomId: partner.ws.roomId, approach: { x: spot.x, z: spot.z } };
        e.startedBlocks.add(want.blockId);
        break;
      }
    }
    if (!target) target = deskSeat;
    // release previous non-desk reservation
    if (e.seatId && e.seatId !== target.id && e.seatId !== e.ws.seatId) this.release(e.seatId, e.cfg.id);
    if (e.intent.kind === 'discuss') {
      const old = this.byId.get(e.intent.withId);
      if (old && old.discussWith === e.cfg.id) old.discussWith = null;
    }
    if (target.id !== e.ws.seatId && !this.reserve(target.id, e.cfg.id)) target = deskSeat;
    if (want.kind === 'event' && want.remote) target = deskSeat;
    e.intent = want;
    e.intentKey = this.intentKey(want);
    if (want.kind !== 'coffee') e.coffeePhase = null;
    e.seatId = target.id;
    e.target = target;
    // Already there (e.g. remote meeting from the desk)?
    if (e.at?.id === target.id && (e.phase === 'seated' || e.phase === 'standing')) {
      this.arrive(e, m);
    } else {
      this.depart(e, target, m);
    }
    if (prevKey !== e.intentKey && want.kind === 'event') {
      const ev = this.events.find((x) => x.id === want.eventId);
      if (ev && want.remote) this.pushHistory(e, `Joining ${ev.title} remotely (room at capacity)`);
    }
  }

  private coffeeSeat(e: Employee, where: 'cafe' | 'lounge', blockId: string): Seat | null {
    const pool = SEATS.filter((s) => (where === 'cafe' ? s.roomId === 'g-cafe' && s.kind === 'cafe' : s.roomId === 's-lounge' && s.kind !== 'stand'));
    return this.pickSeat(e, pool, `cs:${blockId}`);
  }

  private coffeeSitDown(e: Employee, m: number) {
    if (e.intent.kind !== 'coffee') return;
    const seat = this.coffeeSeat(e, e.intent.where, e.intent.blockId);
    // collect the order when leaving the counter
    const order = this.cafeOrders.find((o) => o.empId === e.cfg.id && o.status !== 'collected');
    if (order && (order.status === 'ready' || this.coordinatorAway())) order.status = 'collected';
    e.coffeePhase = 'sit';
    if (!seat) { e.coffeeUntil = Number.MAX_SAFE_INTEGER; return; } // stand at the counter for the rest of the break
    this.release(e.seatId, e.cfg.id);
    this.reserve(seat.id, e.cfg.id);
    e.seatId = seat.id;
    e.target = seat;
    this.depart(e, seat, m);
  }

  private coordinatorAway(): boolean {
    const c = this.employees.find((x) => x.cfg.roleType === 'coordinator');
    return !c || !this.presentAtDesk(c);
  }

  private depart(e: Employee, target: Seat, m: number) {
    const fromSeat = (e.phase === 'seated' || e.phase === 'sitting-down') && !!e.at;
    let start = { x: e.x, z: e.z };
    if (fromSeat && e.at) start = nearestWalkable(e.at.floor, e.at.approach.x, e.at.approach.z, 0.8) ?? e.at.approach;
    e.at = null;
    const goal = nearestWalkable(target.floor, target.approach.x, target.approach.z, 0.8) ?? target.approach;
    // Re-routing while on the stairs: finish the current flight sequence to the next landing first.
    let prefix: Waypoint[] = [];
    let from = { floor: e.floor, x: start.x, z: start.z };
    if (e.phase === 'walking' && e.path[e.pathI]?.stair) {
      let j = e.pathI;
      while (j + 1 < e.path.length && e.path[j + 1].stair) j++;
      prefix = e.path.slice(e.pathI, j + 1);
      const last = prefix[prefix.length - 1];
      from = { floor: last.floor, x: last.x, z: last.z };
    }
    const rest = findPath(from, { floor: target.floor, x: goal.x, z: goal.z }, (id) => {
      const d = this.dyn.doors.get(id);
      return !!d && !d.open;
    });
    const path = rest ? [...prefix, ...rest] : null;
    if (!path) {
      // Should not happen (layout tests cover reachability); fall back to a direct placement.
      this.pushHistory(e, `Could not find a route to ${roomById(target.roomId)?.name ?? 'destination'}; waiting`);
      e.path = [];
      return;
    }
    e.path = path;
    e.pathI = 0;
    if (!prefix.length) e.segStartY = e.floor * FLOOR_H;
    if (fromSeat) {
      e.phase = 'standing-up';
      e.blend = 0;
      e.blendFrom = { x: e.x, y: e.y, z: e.z, h: e.heading };
      e.blendTo = { x: start.x, y: e.floor * FLOOR_H, z: start.z, h: e.heading };
    } else {
      e.phase = 'walking';
    }
    const dest = roomById(target.roomId)?.name ?? 'destination';
    e.activity = e.intent.kind === 'desk' ? 'returning' : 'walking';
    e.task = e.intent.kind === 'desk' ? 'Returning to desk' : `Walking to ${this.purpose(e)} (${dest})`;
    this.pushHistory(e, e.task);
    void m;
  }

  private purpose(e: Employee): string {
    switch (e.intent.kind) {
      case 'event': {
        const id = e.intent.eventId;
        return this.events.find((x) => x.id === id)?.title ?? 'meeting';
      }
      case 'lunch': return 'lunch';
      case 'coffee': return 'coffee break';
      case 'discuss': return `discuss work with ${this.name(e.intent.withId)}`;
      default: return 'desk';
    }
  }

  private arrive(e: Employee, m: number) {
    const target = e.target ?? SEAT_INDEX.get(e.seatId ?? '');
    if (!target) return;
    e.at = target;
    if (target.kind === 'stand') {
      e.phase = 'standing';
      e.x = target.x; e.z = target.z; e.y = target.floor * FLOOR_H; e.floor = target.floor; e.heading = target.heading;
    } else if (e.phase !== 'seated') {
      e.phase = 'sitting-down';
      e.blend = 0;
      e.blendFrom = { x: e.x, y: e.y, z: e.z, h: e.heading };
      e.blendTo = { x: target.x, y: target.y, z: target.z, h: target.heading };
    }
    this.setArrivedActivity(e, m);
  }

  private setArrivedActivity(e: Employee, m: number) {
    const i = e.intent;
    let text = '';
    switch (i.kind) {
      case 'desk':
        e.activity = e.deskMode;
        e.task = this.deskTask(e);
        text = `Back at ${e.ws.label}`;
        break;
      case 'event': {
        const ev = this.events.find((x) => x.id === i.eventId);
        e.activity = ev?.kind === 'incident' ? 'investigating' : 'meeting';
        e.task = i.remote ? `Joining ${ev?.title} remotely` : ev?.kind === 'incident' ? `Investigating ${this.tech.incident.title} at the server racks` : `Attending ${ev?.title}`;
        text = e.task;
        break;
      }
      case 'lunch':
        e.activity = 'cafe';
        e.task = e.seatId === e.ws.seatId ? 'Lunch at desk (café full)' : `Lunch in the ${roomById(SEAT_INDEX.get(e.seatId ?? '')?.roomId ?? '')?.name ?? 'café'}`;
        text = e.task;
        break;
      case 'coffee': {
        e.activity = 'cafe';
        if (e.coffeePhase === 'queue') {
          e.coffeeUntil = m + 3;
          if (i.where === 'cafe') {
            const drink = DRINKS[Math.floor(hashRand(this.seed, 'drink', e.cfg.id, this.day, m) * DRINKS.length)];
            this.cafeOrders.unshift({ id: ++this.orderSeq, t: m, empId: e.cfg.id, name: e.cfg.name, drink, status: 'queued', readyAt: 0 });
            if (this.cafeOrders.length > 30) this.cafeOrders.pop();
            e.task = `Ordering a ${drink.toLowerCase()} at the café counter`;
          } else {
            e.task = 'Making coffee at the staff lounge machine';
          }
        } else {
          e.task = `Coffee break in the ${roomById(SEAT_INDEX.get(e.seatId ?? '')?.roomId ?? '')?.name ?? 'café'}`;
        }
        text = e.task;
        break;
      }
      case 'discuss': {
        const p = this.byId.get(i.withId);
        e.activity = 'discussing';
        e.task = `Discussing ${this.discussTopic(e)} with ${p?.cfg.name}`;
        if (p) {
          p.discussWith = e.cfg.id;
          p.activity = 'discussing';
          p.task = `Discussing ${this.discussTopic(e)} with ${e.cfg.name}`;
          this.pushHistory(p, p.task);
        }
        text = e.task;
        break;
      }
    }
    this.pushHistory(e, text);
  }

  private discussTopic(e: Employee): string {
    switch (e.cfg.roleType) {
      case 'trader': case 'pm': return 'positions and execution';
      case 'researcher': return 'research findings';
      case 'risk': return 'risk utilisation';
      case 'tech': return 'a code review';
      case 'ops': return 'settlement breaks';
      case 'ceo': return 'book performance';
      default: return 'work';
    }
  }

  // ------------------------------------------------------------------ movement
  private updateEmployee(e: Employee, dt: number) {
    switch (e.phase) {
      case 'standing-up':
      case 'sitting-down': {
        e.blend = Math.min(1, e.blend + dt / 0.55);
        const k = e.blend;
        e.x = e.blendFrom.x + (e.blendTo.x - e.blendFrom.x) * k;
        e.y = e.blendFrom.y + (e.blendTo.y - e.blendFrom.y) * k;
        e.z = e.blendFrom.z + (e.blendTo.z - e.blendFrom.z) * k;
        if (e.phase === 'sitting-down') {
          let dh = e.blendTo.h - e.blendFrom.h;
          dh = Math.atan2(Math.sin(dh), Math.cos(dh));
          e.heading = e.blendFrom.h + dh * k;
        }
        if (e.blend >= 1) {
          if (e.phase === 'standing-up') {
            e.phase = e.path.length ? 'walking' : 'standing';
          } else {
            e.phase = 'seated';
          }
        }
        break;
      }
      case 'walking':
      case 'door-wait':
        this.walk(e, dt);
        break;
      default:
        break;
    }
    // door hygiene: close doors that are normally kept shut once clear of them
    if (e.doorToClose) {
      const d = this.dyn.doors.get(e.doorToClose.id);
      const far = Math.hypot(e.x - e.doorToClose.x, e.z - e.doorToClose.z) > 1.6;
      if (!d || !d.open) e.doorToClose = null;
      else if (far) {
        const others = this.employees.some((o) => o !== e && Math.abs(o.y - e.y) < 2 && Math.hypot(o.x - e.doorToClose!.x, o.z - e.doorToClose!.z) < 1.6);
        const playerNear = this.player && Math.abs(this.player.y - d.def.floor * FLOOR_H) < 2 && Math.hypot(this.player.x - e.doorToClose.x, this.player.z - e.doorToClose.z) < 2.2;
        if (!others && !playerNear) {
          this.dyn.setDoor(d.def.id, false, e.cfg.name);
          e.doorToClose = null;
        }
      }
    }
    // pose
    if (e.phase === 'walking') e.pose = 'walk';
    else if (e.phase === 'door-wait' || e.phase === 'standing-up') e.pose = 'stand';
    else if (e.phase === 'standing') e.pose = e.activity === 'discussing' || e.activity === 'meeting' || e.activity === 'investigating' ? 'standTalk' : 'stand';
    else if (e.phase === 'seated' || e.phase === 'sitting-down') {
      if (e.activity === 'working' || (e.activity === 'meeting' && e.intent.kind === 'event' && e.intent.remote)) e.pose = 'sitType';
      else if (e.activity === 'discussing' || e.activity === 'meeting' || e.activity === 'cafe') e.pose = 'sitTalk';
      else e.pose = 'sit';
    }
  }

  private walk(e: Employee, dt: number) {
    let budget = e.speed * dt;
    while (budget > 0 && e.pathI < e.path.length) {
      const wp = e.path[e.pathI];
      if (wp.door) {
        const d = this.dyn.doors.get(wp.door);
        if (d && this.dyn.doorBlocks(d)) {
          const dc = d.def.axis === 'x' ? { x: d.def.center, z: d.def.at } : { x: d.def.at, z: d.def.center };
          const dd = Math.hypot(dc.x - e.x, dc.z - e.z);
          if (dd < 1.15) {
            if (!d.open) {
              this.dyn.setDoor(d.def.id, true, e.cfg.name);
              if (!d.def.defaultOpen) e.doorToClose = { id: d.def.id, x: dc.x, z: dc.z };
            }
            e.phase = 'door-wait';
            e.heading = Math.atan2(dc.x - e.x, dc.z - e.z);
            return;
          }
        } else if (d && !d.def.defaultOpen && d.open && !e.doorToClose) {
          const dc = d.def.axis === 'x' ? { x: d.def.center, z: d.def.at } : { x: d.def.at, z: d.def.center };
          if (Math.hypot(dc.x - e.x, dc.z - e.z) < 1.2) e.doorToClose = { id: d.def.id, x: dc.x, z: dc.z };
        }
      }
      e.phase = 'walking';
      const dx = wp.x - e.x;
      const dz = wp.z - e.z;
      const dist = Math.hypot(dx, dz);
      const slow = this.blockedAhead(e, dx / (dist || 1), dz / (dist || 1));
      const sp = (wp.stair ? 0.72 : 1) * slow;
      if (sp <= 0.01) return;
      const step = budget * sp;
      if (dist <= step) {
        e.x = wp.x;
        e.z = wp.z;
        e.y = wp.y;
        e.floor = wp.floor;
        e.segStartY = wp.y;
        e.pathI++;
        budget -= dist / sp;
      } else {
        const k = step / dist;
        const segLen = dist; // remaining
        e.x += dx * k;
        e.z += dz * k;
        // vertical interpolation along stair segments
        e.y = e.y + (wp.y - e.y) * Math.min(1, step / segLen);
        if (Math.abs(dx) + Math.abs(dz) > 1e-4) {
          const want = Math.atan2(dx, dz);
          let dh = want - e.heading;
          dh = Math.atan2(Math.sin(dh), Math.cos(dh));
          e.heading += dh * Math.min(1, dt * 10);
        }
        budget = 0;
      }
    }
    if (e.pathI >= e.path.length) {
      e.path = [];
      this.arrive(e, this.minute);
    }
  }

  /** Slow down behind other walkers and stop for the player. */
  private blockedAhead(e: Employee, fx: number, fz: number): number {
    let k = 1;
    if (this.player && Math.abs(this.player.y - e.y) < 1.2) {
      const dx = this.player.x - e.x;
      const dz = this.player.z - e.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.75 && (dx * fx + dz * fz) / (d || 1) > 0.5) return 0;
    }
    for (const o of this.employees) {
      if (o === e || o.phase !== 'walking' || Math.abs(o.y - e.y) > 1) continue;
      const dx = o.x - e.x;
      const dz = o.z - e.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.6 && (dx * fx + dz * fz) / (d || 1) > 0.7 && o.index < e.index) k = Math.min(k, 0.35);
    }
    return k;
  }

  // ------------------------------------------------------------------ desk work
  private updateDeskWork(m: number) {
    for (const e of this.employees) {
      if (!this.presentAtDesk(e)) continue;
      const remoteMeeting = e.intent.kind === 'event' && e.intent.remote;
      if (e.intent.kind === 'desk' && !e.discussWith) {
        if (m >= e.deskModeUntil) {
          e.deskMode = e.deskMode === 'working' ? 'reviewing' : 'working';
          e.deskModeUntil = m + (e.deskMode === 'working' ? 6 : 2) + Math.floor(hashRand(this.seed, 'dmu', e.cfg.id, this.day, m) * 9);
          e.activity = e.deskMode;
        }
      }
      if (e.discussWith) {
        const p = this.byId.get(e.discussWith);
        if (!p || p.intent.kind !== 'discuss' || p.phase !== 'standing') {
          e.discussWith = null;
          e.activity = e.deskMode;
        }
      }
      // role work
      switch (e.cfg.roleType) {
        case 'trader': {
          if (remoteMeeting) break;
          const o = this.finance.traderDecision(e.cfg.id, this.day, m);
          if (o) {
            e.lastAction = { t: m, text: `${o.type === 'MKT' ? 'Executed' : 'Working'} ${o.side} ${o.qty.toLocaleString()} ${o.sym}${o.type === 'LMT' ? ` limit ${fmtPx(o.sym, o.limit!)}` : ` at ${fmtPx(o.sym, o.fillPx!)}`} - ${o.reason}` };
            if (hashRand(this.seed, 'logtrade', o.id) < 0.25 || o.reason.startsWith('Risk')) this.addLog(`${e.cfg.name}: ${e.lastAction.text}`, 'trade');
          }
          break;
        }
        case 'researcher':
          if (e.activity === 'working') e.work.words += 8 + Math.floor(hashRand(this.seed, 'w', e.cfg.id, m) * 14);
          break;
        case 'tech':
          if (e.activity === 'working') e.work.line = 20 + ((e.work.line + 1 + Math.floor(hashRand(this.seed, 'l', e.cfg.id, m) * 3)) % 260);
          break;
        case 'ops':
          if (e.activity === 'working' && hashRand(this.seed, 'recon', e.cfg.id, m) < 0.18) {
            const f = this.finance.resolveBreak(e.cfg.id, m);
            if (f) e.lastAction = { t: m, text: `Resolved break on ${f.id} (${f.sym} ${f.side} ${f.qty.toLocaleString()})` };
          }
          break;
        case 'risk': {
          const open = this.finance.alerts.find((a) => a.ackBy === e.cfg.id && a.status === 'open');
          if (open) {
            open.status = 'acknowledged';
            open.log.push({ t: m, text: `Acknowledged by ${e.cfg.name}` });
            e.lastAction = { t: m, text: `Reviewing ${open.metric} alert ${open.id}` };
            e.activity = 'reviewing';
            e.deskMode = 'reviewing';
            e.deskModeUntil = m + 10;
          }
          break;
        }
      }
      if (e.intent.kind === 'desk' && !e.discussWith) e.task = this.deskTask(e);
      // the occupant flips between application tabs now and then
      for (const mon of e.ws.monitors) {
        const st = this.monitors.get(mon.id);
        if (!st) continue;
        const tabs = APPS[st.appId].tabs.length;
        if (tabs > 1 && m >= st.pinnedUntil && hashRand(this.seed, 'tab', mon.id, this.day, m) < 1 / 22) {
          st.tab = (st.tab + 1) % tabs;
          st.lastChange = m;
        }
      }
    }
  }

  deskTask(e: Employee): string {
    const recent = e.lastAction && this.minute - e.lastAction.t < 6 ? e.lastAction.text : null;
    const m = Math.floor(this.minute);
    switch (e.cfg.roleType) {
      case 'trader': {
        const t = this.finance.traders.get(e.cfg.id);
        if (this.finance.derisk.has(t?.bookId ?? 'eq')) return recent ?? 'Executing risk-reduction instruction from review';
        return recent ?? `Monitoring ${t?.coverage.join(', ') ?? 'markets'}; P&L ${fmtMoney(this.finance.traderPnl(e.cfg.id))}`;
      }
      case 'researcher':
        return e.activity === 'reviewing' ? `Reviewing data for ${e.work.sym} model` : `Drafting: ${e.work.title} (${e.work.words.toLocaleString()} words)`;
      case 'risk': {
        if (recent) return recent;
        const worst = this.finance.firm(m).books.sort((a, b) => b.util.drawdown - a.util.drawdown)[0];
        return `Monitoring limits; highest drawdown utilisation ${worst.short} ${(worst.util.drawdown * 100).toFixed(0)}%`;
      }
      case 'pm': {
        const bookId = this.config.employees.find((x) => x.id === e.cfg.id)?.bookId;
        const b = bookId ? this.finance.bookMetrics(bookId, m) : null;
        return b ? `Reviewing ${b.name}: P&L ${fmtMoney(b.pnl)}, gross ${fmtMoney(b.gross)}` : 'Reviewing allocations';
      }
      case 'tech':
        if (this.tech.incidentActive) return this.tech.incident.status === 'fixing' ? 'Shipping hotfix for feed latency incident' : 'Investigating feed latency alerts';
        return `Editing ${e.work.file} (line ${e.work.line})`;
      case 'ops': {
        const breaks = this.finance.trades.filter((t) => t.status === 'break').length;
        return recent ?? `Reconciling trades; ${breaks} open break${breaks === 1 ? '' : 's'}`;
      }
      case 'receptionist': {
        const next = this.events.find((ev) => ev.status === 'scheduled');
        return next ? `Front desk; next booking ${fmtTime(next.start)} ${next.title}` : 'Front desk; managing room bookings';
      }
      case 'ceo': {
        const f = this.finance.firm(m);
        return `Reviewing firm P&L ${fmtMoney(f.pnl)} and open risk alerts (${this.finance.openAlerts().length})`;
      }
      case 'coordinator': {
        const o = this.cafeOrders.find((x) => x.status === 'preparing' || x.status === 'queued');
        return o ? `Preparing ${o.drink.toLowerCase()} for ${o.name}` : 'Café counter; restocking and room set-up';
      }
    }
  }

  private updateCafe(m: number) {
    const coordPresent = !this.coordinatorAway();
    for (const o of this.cafeOrders) {
      if (o.status === 'queued' && coordPresent && !this.cafeOrders.some((x) => x.status === 'preparing')) {
        o.status = 'preparing';
        o.readyAt = m + 2;
      } else if (o.status === 'preparing' && m >= o.readyAt) {
        o.status = 'ready';
      }
      if (o.status !== 'collected') {
        const e = this.byId.get(o.empId);
        if (e && !(e.intent.kind === 'coffee' && e.coffeePhase === 'queue') && o.empId !== 'visitor') o.status = 'collected';
      }
    }
  }

  /** The player uses a coffee machine: a short interaction that is logged like any other order. */
  playerCoffee(where: 'cafe' | 'lounge'): string {
    const m = Math.floor(this.minute);
    const drink = DRINKS[Math.floor(hashRand(this.seed, 'pdrink', this.day, m) * 6)];
    if (where === 'cafe') {
      this.cafeOrders.unshift({ id: ++this.orderSeq, t: m, empId: 'visitor', name: 'Guest (you)', drink, status: this.coordinatorAway() ? 'ready' : 'preparing', readyAt: m + 2 });
    }
    this.version++;
    return drink;
  }

  // ------------------------------------------------------------------ queries
  name(id: string): string {
    return this.byId.get(id)?.cfg.name ?? id;
  }

  roomName(e: Employee): string {
    return roomAt(e.floor, e.x, e.z)?.name ?? 'Office';
  }

  roomIdOf(e: Employee): string | undefined {
    return roomAt(e.floor, e.x, e.z)?.id;
  }

  eventsForRoom(roomId: string): OfficeEvent[] {
    return this.events.filter((e) => e.roomId === roomId);
  }

  currentEventInRoom(roomId: string): OfficeEvent | undefined {
    return this.events.find((e) => e.roomId === roomId && e.status === 'in-progress');
  }

  /** Attendees physically present in the event room. */
  presentAttendees(ev: OfficeEvent): Employee[] {
    return ev.attendeeIds.map((id) => this.byId.get(id)!).filter((e) => e && e.intent.kind === 'event' && e.intent.eventId === ev.id && !e.intent.remote && (e.phase === 'seated' || e.phase === 'standing') && this.roomIdOf(e) === ev.roomId);
  }

  remoteAttendees(ev: OfficeEvent): Employee[] {
    return ev.attendeeIds.map((id) => this.byId.get(id)!).filter((e) => e && e.intent.kind === 'event' && e.intent.eventId === ev.id && e.intent.remote);
  }

  ownerOfWorkstation(wsId: string): Employee | undefined {
    const id = this.wsOwner.get(wsId);
    return id ? this.byId.get(id) : undefined;
  }

  monitorState(id: string): MonitorState | undefined {
    return this.monitors.get(id);
  }

  /** Switching a tab in the expanded panel switches the physical monitor too (one shared state). */
  setMonitorTab(id: string, tab: number) {
    const st = this.monitors.get(id);
    if (!st) return;
    st.tab = Math.max(0, Math.min(APPS[st.appId].tabs.length - 1, tab));
    st.pinnedUntil = this.minute + 15;
    st.lastChange = this.minute;
    this.version++;
  }

  activityCounts(floor?: number): Record<Activity, number> {
    const c = Object.fromEntries(ACTIVITIES.map((a) => [a, 0])) as Record<Activity, number>;
    for (const e of this.employees) if (floor === undefined || e.floor === floor) c[e.activity]++;
    return c;
  }

  floorOccupancy(): number[] {
    const occ = [0, 0, 0];
    for (const e of this.employees) occ[Math.max(0, Math.min(2, e.floor))]++;
    return occ;
  }

  roleLabel(role: RoleType): string {
    return ROLE_LABELS[role];
  }

  addLog(text: string, kind: LogEntry['kind']) {
    this.log.unshift({ t: Math.floor(this.minute), day: this.day, text, kind });
    if (this.log.length > 120) this.log.pop();
  }

  private pushHistory(e: Employee, text: string) {
    const last = e.history[0];
    if (last && last.text === text && last.activity === e.activity) return;
    e.history.unshift({ t: Math.floor(this.minute), day: this.day, activity: e.activity, text, room: roomAt(e.floor, e.x, e.z)?.name ?? '' });
    if (e.history.length > 60) e.history.pop();
  }

  // ------------------------------------------------------------------ player seat
  playerSit(seatId: string): boolean {
    if (this.reservations.has(seatId)) return false;
    for (const [k, v] of this.reservations) if (v === 'player') this.reservations.delete(k);
    this.reservations.set(seatId, 'player');
    return true;
  }

  playerStand() {
    for (const [k, v] of this.reservations) if (v === 'player') this.reservations.delete(k);
  }

  /** Invariant check used by tests and the debug overlay. */
  validate(): string[] {
    const errs: string[] = [];
    const seen = new Map<string, string>();
    for (const e of this.employees) {
      if (e.seatId && (e.phase === 'seated' || e.phase === 'sitting-down')) {
        const prev = seen.get(e.seatId);
        if (prev && prev !== e.cfg.id) errs.push(`seat ${e.seatId} used by ${prev} and ${e.cfg.id}`);
        seen.set(e.seatId, e.cfg.id);
      }
    }
    for (const [seat, who] of this.reservations) {
      if (who === 'player') continue;
      const e = this.byId.get(who);
      if (!e) errs.push(`reservation ${seat} by unknown ${who}`);
    }
    return errs;
  }

  roomsList() {
    return ROOMS.filter((r) => !r.hidden);
  }

  workstations() {
    return WORKSTATIONS;
  }
}
