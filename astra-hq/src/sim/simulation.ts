// The office simulation: one clock, one shared state. Employees follow schedules and events, reserve
// seats, walk along navigation routes, and drive the simulated market/risk/ops/tech state that every
// monitor renders. Pure TypeScript: runs headless in tests and in the browser.
import type { EmployeeConfig, OfficeConfig, RoleType } from '../config/types';
import { ROLE_LABELS } from '../config/types';
import { ELEVATOR, FLOOR_H, roomAt, roomById, ROOMS } from '../world/building';
import { DynamicWorld, type Agent } from '../world/dynamic';
import { MONITORS, SEATS, SEAT_INDEX, WORKSTATIONS, WS_INDEX, rotLocal, type Seat, type Workstation } from '../world/furniture';
import { findPath, nearestWalkable, type Waypoint } from '../world/nav';
import { fmtMoney, fmtTime } from '../util/math';
import { hashRand } from '../util/rng';
import { APPS, appFor, type AppId } from './apps';
import { DAY_END, DAY_START, REALTIME_MIN_PER_SEC, SIM_MIN_PER_REAL_SEC, WALK_SPEED, type Speed } from './constants';
import { BOOKABLE_FOR_REVIEW, INCIDENT_START, SHOCK_MINUTE, scheduledEvents, type OfficeEvent } from './events';
import { BOOK_INDEX, Finance, type RiskAlert } from './finance';
import { INSTRUMENTS, Market, fmtPx } from './market';
import { buildSchedule, workingHours, type Block } from './schedule';
import { Tech } from './tech';

export type Activity = 'working' | 'reviewing' | 'walking' | 'meeting' | 'cafe' | 'returning' | 'discussing' | 'investigating' | 'break' | 'away';
export const ACTIVITIES: Activity[] = ['working', 'reviewing', 'walking', 'meeting', 'cafe', 'returning', 'discussing', 'investigating', 'break', 'away'];
export const ACTIVITY_LABEL: Record<Activity, string> = {
  working: 'Working',
  reviewing: 'Reviewing screens',
  walking: 'Walking',
  meeting: 'In a meeting',
  cafe: 'Café break',
  returning: 'Returning to desk',
  discussing: 'Discussing work',
  investigating: 'Investigating incident',
  break: 'Short break',
  away: 'Out of office',
};
export const ACTIVITY_COLOR: Record<Activity, string> = {
  working: '#5fb37a', reviewing: '#7fb6d9', walking: '#d9c27f', meeting: '#b48ad9', cafe: '#d99a6c',
  returning: '#c9b26a', discussing: '#6cd9c4', investigating: '#e06c6c', break: '#a3a8d9', away: '#6b7280',
};

export type Pose = 'sit' | 'sitType' | 'sitTalk' | 'stand' | 'standTalk' | 'walk';

export type Intent =
  | { kind: 'desk' }
  | { kind: 'event'; eventId: string; remote: boolean }
  | { kind: 'lunch'; blockId: string }
  | { kind: 'coffee'; blockId: string; where: 'cafe' | 'lounge' }
  | { kind: 'discuss'; blockId: string; withId: string }
  | { kind: 'restroom'; blockId: string }
  | { kind: 'home' }
  | { kind: 'owner'; orderId: number };

/** Instructions given by the company owner (the visitor) to an employee. */
export type OwnerOrder =
  | { id: number; kind: 'come'; floor: number; x: number; z: number; heading: number; until: number; place: string }
  | { id: number; kind: 'room'; roomId: string; until: number }
  | { id: number; kind: 'task'; text: string; until: number; started: number };

export interface ChatLine { t: number; day: number; from: 'owner' | 'employee'; text: string }
export interface OwnerMessage { id: number; t: number; day: number; empId: string; name: string; text: string }

type Phase = 'seated' | 'standing' | 'walking' | 'sitting-down' | 'standing-up' | 'door-wait' | 'lift' | 'away';

/** An elevator trip: walk to the lift lobby, call the car, board, ride, step out, carry on. */
export interface LiftTrip { from: number; to: number; stage: 'approach' | 'wait' | 'enter' | 'ride' | 'exit'; t: number; slot: number; lobby: { x: number; z: number } }

const LIFT_CAPACITY = 6;
/** Standing positions inside the car (3 × 2). */
const LIFT_SLOTS = [21.4, 22.1, 22.8].flatMap((x) => [4.05, 4.95].map((z) => ({ x, z })));
const RESTROOMS = ['g-wc-a', 'g-wc-b'];

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
  /** Current instruction from the owner, if any. */
  order: OwnerOrder | null;
  /** Conversation with the owner. */
  chat: ChatLine[];
  /** True while the owner has this employee's talk window open. */
  talking: boolean;
  /** CEO courtesy: stand up when the owner enters the office, sit again afterwards. */
  greet: { stage: 'up' | 'hold' | 'down'; t: number } | null;
  /** Today's arrival and departure times (simulated minutes). */
  hours: { arrive: number; leave: number };
  /** Access-control record for today: when the badge was used at the entrance. */
  badge: { in: number | null; out: number | null };
  liftTrip: LiftTrip | null;
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
  /** Replies, acknowledgements and greetings addressed to the owner (newest first). */
  ownerMessages: OwnerMessage[] = [];
  private orderSeq = 100;
  private ownerSeq = 1;
  private ceoGreetArmed = true;
  /** Clock runs at real time (1 simulated minute per real minute) instead of the 20× office clock. */
  realtime = false;

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
    this.ownerMessages = [];
    this.ceoGreetArmed = true;
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
      order: null, chat: [], talking: false, greet: null, hours: { arrive: DAY_START, leave: DAY_END }, badge: { in: null, out: null }, liftTrip: null,
    };
    this.reservations.set(seat.id, cfg.id);
    return e;
  }

  private startDay() {
    this.events = scheduledEvents(this.config.employees, this.day);
    for (const e of this.employees) {
      e.schedule = buildSchedule(this.seed, this.day, e.cfg, e.index, e.ws.floor, this.config.employees, this.events);
      e.startedBlocks.clear();
      e.hours = workingHours(this.seed, this.day, e.cfg, this.events, e.schedule);
      this.placeAway(e);
      e.badge = { in: null, out: null };
      this.pushHistory(e, `Day ${this.day + 1}: due in at ${fmtTime(e.hours.arrive)}`);
    }
    this.addLog(`Simulated day ${this.day + 1} begins. ${this.events.length} meetings scheduled.`, 'office');
  }

  /** Outside on the plaza, off-site: where people appear from in the morning and disappear to at night. */
  private exitSpot(e: Employee): Seat {
    const w = nearestWalkable(0, 16.2 + (e.index % 10) * 0.65, 26.6, 1) ?? { x: 19, z: 26.6 };
    return { id: `exit:${e.cfg.id}`, floor: 0, x: w.x, z: w.z, y: 0, heading: 0, kind: 'stand', roomId: 'outside', approach: w };
  }

  private placeAway(e: Employee) {
    const s = this.exitSpot(e);
    if (e.seatId && e.seatId !== e.ws.seatId) this.release(e.seatId, e.cfg.id);
    this.reservations.set(e.ws.seatId, e.cfg.id);
    this.reservations.set(s.id, e.cfg.id);
    Object.assign(e, {
      x: s.x, y: 0, z: s.z, floor: 0, heading: 0, seatId: s.id, target: s, at: s, phase: 'away', path: [], pathI: 0,
      intent: { kind: 'home' }, intentKey: 'home', activity: 'away', task: `Out of office (due in at ${fmtTime(e.hours.arrive)})`,
      discussWith: null, coffeePhase: null, pose: 'stand', liftTrip: null, doorToClose: null, talking: false,
    });
  }

  /** In the building (not off-site). */
  onSite(e: Employee): boolean {
    return e.phase !== 'away';
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
      this.dyn.update(Math.min(realDt, 0.1), this.agents(), this.liftOccupied(), this.liftBoarding());
      return;
    }
    // clamp long frames (tab switches, slow devices) so the office never jumps ahead
    this.advance(Math.min(realDt, 0.25) * this.speed);
  }

  /** Advance by speed-scaled seconds (used directly by tests). */
  advance(dt: number) {
    let remaining = dt;
    while (remaining > 1e-6) {
      const step = Math.min(remaining, 0.1);
      remaining -= step;
      this.minute += step * (this.realtime ? REALTIME_MIN_PER_SEC : SIM_MIN_PER_REAL_SEC);
      while (Math.floor(this.minute) > this.lastMinute) {
        this.lastMinute++;
        this.onMinute(this.lastMinute);
      }
      for (const e of this.employees) this.updateEmployee(e, step);
      this.updateCeoCourtesy();
      this.dyn.update(step, this.agents(), this.liftOccupied(), this.liftBoarding());
      // riders move with the car
      for (const e of this.employees) if (e.liftTrip?.stage === 'ride') e.y = this.dyn.lift.y;
      if (this.minute >= DAY_END) this.nextDay();
    }
  }

  private agents(): Agent[] {
    const a: Agent[] = this.employees.filter((e) => e.phase !== 'away').map((e) => ({ x: e.x, y: e.y, z: e.z }));
    if (this.player) a.push(this.player);
    return a;
  }

  private liftOccupied(): boolean {
    const p = this.player;
    if (p && p.x > 20.9 && p.x < 23.3 && p.z > 3.5 && p.z < 5.95) return true;
    return this.employees.some((e) => e.liftTrip?.stage === 'ride');
  }

  /** Someone is stepping in or out of the car: the doors stay open (door sensor). */
  private liftBoarding(): boolean {
    return this.employees.some((e) => e.liftTrip?.stage === 'enter' || e.liftTrip?.stage === 'exit');
  }

  private liftRiders(): Employee[] {
    return this.employees.filter((e) => e.liftTrip?.stage === 'enter' || e.liftTrip?.stage === 'ride');
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
    // overnight: everyone has gone home; tomorrow they come in through the entrance again
    for (const e of this.employees) {
      e.order = null;
      e.greet = null;
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
      case 'owner-meeting':
        notes.push('Called by the company owner');
        for (const a of ev.agenda) notes.push(`Topic: ${a}`);
        notes.push(`In the room: ${this.presentAttendees(ev).length}/${ev.attendeeIds.length}`);
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
    // 1. meetings the owner called, 2. the owner's personal instructions, 3. the regular calendar
    for (const ev of this.events) {
      if (ev.kind !== 'owner-meeting' || ev.status === 'cancelled' || ev.status === 'completed' || m >= ev.end) continue;
      if (!ev.attendeeIds.includes(e.cfg.id)) continue;
      const remote = e.intent.kind === 'event' && e.intent.eventId === ev.id ? e.intent.remote : false;
      return { kind: 'event', eventId: ev.id, remote };
    }
    if (e.order && m >= e.order.until) this.finishOrder(e, m);
    if (e.order && (e.order.kind === 'come' || e.order.kind === 'room')) return { kind: 'owner', orderId: e.order.id };
    for (const ev of this.events) {
      if (ev.kind === 'owner-meeting') continue;
      if (ev.status === 'cancelled' || ev.status === 'completed' || !ev.attendeeIds.includes(e.cfg.id)) continue;
      if (m >= ev.end) continue;
      const committed = e.intent.kind === 'event' && e.intent.eventId === ev.id;
      const depart = ev.start - this.travelMinutes(e, ev.roomId) - 2;
      if (committed || m >= depart) {
        const remote = e.intent.kind === 'event' && e.intent.eventId === ev.id ? e.intent.remote : false;
        return { kind: 'event', eventId: ev.id, remote };
      }
    }
    // before arriving and after leaving for the day (owner's instructions and meetings still bring people in)
    if (m < e.hours.arrive || m >= e.hours.leave) return { kind: 'home' };
    // a restroom trip is finished once there (a few minutes), however long the walk took
    if (e.intent.kind === 'restroom' && m < e.coffeeUntil) return e.intent;
    for (const b of e.schedule) {
      if (m < b.start || m >= b.end) continue;
      if (b.kind === 'restroom') {
        if (e.intent.kind === 'restroom' && e.intent.blockId === b.id) return e.intent;
        if (!e.startedBlocks.has(b.id)) return { kind: 'restroom', blockId: b.id };
        continue;
      }
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
      case 'restroom': return `restroom:${i.blockId}`;
      case 'home': return 'home';
      case 'owner': return `owner:${i.orderId}`;
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
        // chairs full: stand at the side of the room before falling back to joining remotely
        if (!target && !ev.standing) target = this.pickSeat(e, SEATS.filter((s) => s.roomId === room && s.kind === 'stand' && !s.id.startsWith('cafe-q') && !s.id.startsWith('slounge-q')), `evs:${ev.id}`);
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
      case 'restroom': {
        e.startedBlocks.add(want.blockId);
        e.coffeeUntil = Number.MAX_SAFE_INTEGER;
        target = this.pickSeat(e, SEATS.filter((s) => RESTROOMS.includes(s.roomId) && s.kind === 'stand'), `wc:${want.blockId}`);
        if (!target) { want = { kind: 'desk' }; target = deskSeat; } // all occupied: try again at the next break
        break;
      }
      case 'home':
        target = this.exitSpot(e);
        break;
      case 'owner':
        target = this.ownerTarget(e) ?? deskSeat;
        break;
    }
    if (!target) target = deskSeat;
    e.greet = null;
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
    if (e.phase === 'away') {
      this.pushHistory(e, 'Arrived at the office (badged in at the entrance)');
      this.addLog(`${e.cfg.name} badged in at the entrance`, 'office');
      if (e.badge.in === null) e.badge.in = Math.floor(this.minute);
      // called in early (e.g. by the owner): they stay for the day rather than going home again
      if (this.minute < e.hours.arrive) e.hours.arrive = Math.floor(this.minute);
    }
    // Inside or stepping into the car: keep the ride and only change the floor; the route continues from there.
    const trip = e.liftTrip;
    if (trip && e.phase === 'lift' && trip.stage !== 'wait') {
      e.at = null;
      if (trip.stage !== 'exit' && trip.to !== target.floor) {
        trip.to = target.floor;
        if (trip.stage === 'ride') this.dyn.selectFloor(target.floor);
      }
      this.setWalkingTask(e, target);
      return;
    }
    if (trip) {
      e.liftTrip = null;
      if (e.phase === 'lift') e.phase = 'standing';
    }
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
    const closed = (id: string) => {
      const d = this.dyn.doors.get(id);
      return !!d && !d.open;
    };
    // Changing floors: two or more floors always by lift, one floor sometimes (most people take the stairs).
    let rest: Waypoint[] | null = null;
    const floors = Math.abs(target.floor - from.floor);
    if (!prefix.length && floors > 0 && (floors >= 2 || hashRand(this.seed, 'lift', e.cfg.id, this.day, Math.floor(this.minute)) < 0.3)) {
      const lobby = this.liftLobby(from.floor, e);
      const toLift = lobby && findPath(from, { floor: from.floor, x: lobby.x, z: lobby.z }, closed);
      if (lobby && toLift) {
        rest = toLift;
        e.liftTrip = { from: from.floor, to: target.floor, stage: 'approach', t: 0, slot: -1, lobby };
      }
    }
    if (!rest) rest = findPath(from, { floor: target.floor, x: goal.x, z: goal.z }, closed);
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
    this.setWalkingTask(e, target);
    void m;
  }

  private setWalkingTask(e: Employee, target: Seat) {
    const dest = target.roomId === 'outside' ? 'entrance' : roomById(target.roomId)?.name ?? 'destination';
    const lift = e.liftTrip ? ' by lift' : '';
    e.activity = e.intent.kind === 'desk' ? 'returning' : 'walking';
    if (e.intent.kind === 'home') e.task = `Leaving for the day${lift}`;
    else if (e.intent.kind === 'desk') e.task = e.history[0]?.text.startsWith('Arrived') ? `Arrived; heading to ${e.ws.label}${lift}` : `Returning to desk${lift}`;
    else e.task = `Walking to ${this.purpose(e)} (${dest})${lift}`;
    this.pushHistory(e, e.task);
  }

  /** Waiting spot in front of the lift doors on a floor (spread out a little per person). */
  private liftLobby(floor: number, e: Employee): { x: number; z: number } | null {
    const ox = ((e.index % 5) - 2) * 0.32;
    const oz = 0.75 + (e.index % 3) * 0.3;
    return nearestWalkable(floor, ELEVATOR.doorCenter + ox, 6.0 + oz, 0.8);
  }

  /** Elevator ride state machine: wait → enter → ride → exit, then continue on foot. */
  private rideLift(e: Employee, dt: number) {
    const trip = e.liftTrip;
    if (!trip) { e.phase = 'standing'; return; }
    const L = this.dyn.lift;
    trip.t += dt;
    const moveTo = (x: number, z: number, sp: number): boolean => {
      const dx = x - e.x;
      const dz = z - e.z;
      const d = Math.hypot(dx, dz);
      const step = e.speed * 0.8 * dt;
      if (d > 1e-3) e.heading = Math.atan2(dx, dz);
      if (d <= step * sp) { e.x = x; e.z = z; return true; }
      e.x += (dx / d) * step * sp;
      e.z += (dz / d) * step * sp;
      return false;
    };
    switch (trip.stage) {
      case 'wait': {
        e.heading = Math.PI; // facing the lift doors
        const riders = this.liftRiders();
        if (this.dyn.liftDoorOpenAt(trip.from) && riders.length < LIFT_CAPACITY) {
          const used = new Set(riders.map((o) => o.liftTrip!.slot));
          trip.slot = LIFT_SLOTS.findIndex((_, i) => !used.has(i));
          trip.stage = 'enter';
          trip.t = 0;
        } else if (!this.dyn.liftDoorOpenAt(trip.from)) {
          const atFloor = L.phase !== 'moving' && Math.abs(L.y - trip.from * FLOOR_H) < 0.02;
          if (!(atFloor && (L.phase === 'opening')) && !L.queue.includes(trip.from)) this.dyn.callLift(trip.from);
        }
        // nobody comes for a long time: take the stairs instead
        if (trip.stage === 'wait' && trip.t > 70) {
          e.liftTrip = null;
          e.phase = 'standing';
          this.pushHistory(e, 'Lift busy; taking the stairs');
          if (e.target) this.depart(e, e.target, this.minute);
        }
        break;
      }
      case 'enter': {
        const s = LIFT_SLOTS[trip.slot];
        // through the middle of the doorway, then to a free spot inside
        const inside = e.z < 5.9;
        if (inside ? moveTo(s.x, s.z, 1) : (moveTo(ELEVATOR.doorCenter, 5.7, 1), false)) {
          trip.stage = 'ride';
          trip.t = 0;
          e.heading = 0; // face the doors
          this.dyn.selectFloor(trip.to);
        }
        break;
      }
      case 'ride': {
        e.y = L.y;
        e.floor = Math.max(0, Math.round(L.y / FLOOR_H));
        const there = L.phase !== 'moving' && Math.abs(L.y - trip.to * FLOOR_H) < 0.02;
        if (there && this.dyn.liftDoorOpenAt(trip.to)) {
          trip.stage = 'exit';
          trip.t = 0;
          e.y = trip.to * FLOOR_H;
          e.floor = trip.to;
          trip.lobby = this.liftLobby(trip.to, e) ?? { x: ELEVATOR.doorCenter, z: 6.8 };
        } else if (there && L.phase === 'idle') {
          this.dyn.callLift(trip.to); // doors closed at our floor: press "open"
        } else if (!there && !L.queue.includes(trip.to) && !(L.phase === 'moving' && L.target === trip.to)) {
          this.dyn.selectFloor(trip.to);
        }
        break;
      }
      case 'exit': {
        const out = e.z > 6.1;
        if (out ? moveTo(trip.lobby.x, trip.lobby.z, 1) : (moveTo(ELEVATOR.doorCenter, 6.3, 1), false)) {
          e.liftTrip = null;
          e.phase = 'standing';
          e.y = e.floor * FLOOR_H;
          e.segStartY = e.y;
          if (e.target) this.depart(e, e.target, this.minute);
        }
        break;
      }
      case 'approach':
        break;
    }
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
      case 'restroom': return 'the restroom';
      case 'home': return 'the exit';
      case 'owner': {
        const o = e.order;
        if (o?.kind === 'come') return 'meet you';
        if (o?.kind === 'room') return `wait for you in ${roomById(o.roomId)?.name ?? 'the room'}`;
        return 'your request';
      }
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
      case 'restroom':
        e.coffeeUntil = m + 3 + Math.floor(hashRand(this.seed, 'wcdur', e.cfg.id, m) * 3);
        e.activity = 'break';
        e.task = `Short break (${roomById(e.target?.roomId ?? '')?.name ?? 'restroom'})`;
        text = e.task;
        break;
      case 'home':
        e.phase = 'away';
        e.activity = 'away';
        e.task = `Out of office (left at ${fmtTime(m)})`;
        text = 'Left the office for the day';
        this.addLog(`${e.cfg.name} left the building`, 'office');
        e.badge.out = m;
        break;
      case 'owner': {
        const o = e.order;
        e.activity = o?.kind === 'room' ? 'meeting' : 'discussing';
        e.task = o?.kind === 'room' ? `Waiting for you in ${roomById(o.roomId)?.name ?? 'the room'}, as you asked` : 'Here to speak with you, as you asked';
        text = e.task;
        this.ownerMessage(e, o?.kind === 'room' ? `I'm in the ${roomById(o.roomId)?.name ?? 'room'} now.` : "I'm here. What can I do for you?");
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
            if (e.greet?.stage === 'up') e.greet = { stage: 'hold', t: 0 };
          } else {
            e.phase = 'seated';
            if (e.greet?.stage === 'down') {
              e.greet = null;
              e.activity = e.deskMode;
              e.task = this.deskTask(e);
            }
          }
        }
        break;
      }
      case 'walking':
      case 'door-wait':
        this.walk(e, dt);
        break;
      case 'lift':
        this.rideLift(e, dt);
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
    if (e.greet?.stage === 'hold') this.holdGreeting(e, dt);
    // face the owner while they talk to you in person
    const p = this.player;
    if (p && (e.talking || e.greet || (e.intent.kind === 'owner' && e.order?.kind === 'come')) && e.phase === 'standing' && Math.abs(p.y - e.floor * FLOOR_H) < 1.5 && Math.hypot(p.x - e.x, p.z - e.z) < 6) {
      const want = Math.atan2(p.x - e.x, p.z - e.z);
      let dh = want - e.heading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      e.heading += dh * Math.min(1, dt * 6);
    }
    // pose
    if (e.phase === 'walking' || (e.phase === 'lift' && (e.liftTrip?.stage === 'enter' || e.liftTrip?.stage === 'exit'))) e.pose = 'walk';
    else if (e.phase === 'lift' || e.phase === 'away') e.pose = 'stand';
    else if (e.phase === 'door-wait' || e.phase === 'standing-up') e.pose = 'stand';
    else if (e.phase === 'standing') e.pose = e.activity === 'discussing' || e.activity === 'meeting' || e.activity === 'investigating' ? 'standTalk' : 'stand';
    else if (e.phase === 'seated' || e.phase === 'sitting-down') {
      if (e.activity === 'working' || (e.activity === 'meeting' && e.intent.kind === 'event' && e.intent.remote)) e.pose = 'sitType';
      else if (e.activity === 'discussing' || e.activity === 'meeting' || e.activity === 'cafe') e.pose = 'sitTalk';
      else e.pose = 'sit';
    }
    if (e.talking && (e.phase === 'seated' || e.phase === 'standing')) e.pose = e.phase === 'seated' ? 'sitTalk' : 'standTalk';
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
      if (e.liftTrip?.stage === 'approach') {
        e.phase = 'lift';
        e.liftTrip.stage = 'wait';
        e.liftTrip.t = 0;
        this.dyn.callLift(e.liftTrip.from);
        return;
      }
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
    if (e.order?.kind === 'task') return `Working on your request: ${e.order.text}`;
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
    if (e.phase === 'away') return 'Off-site';
    if (e.phase === 'lift') return 'Elevator';
    return roomAt(e.floor, e.x, e.z)?.name ?? (e.z > 19.6 ? 'Entrance plaza' : 'Office');
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
    for (const e of this.employees) if (this.onSite(e)) occ[Math.max(0, Math.min(2, e.floor))]++;
    return occ;
  }

  roleLabel(role: RoleType): string {
    return ROLE_LABELS[role];
  }

  addLog(text: string, kind: LogEntry['kind']) {
    this.log.unshift({ t: Math.floor(this.minute), day: this.day, text, kind });
    if (this.log.length > 400) this.log.pop();
  }

  private pushHistory(e: Employee, text: string) {
    const last = e.history[0];
    if (last && last.text === text && last.activity === e.activity) return;
    e.history.unshift({ t: Math.floor(this.minute), day: this.day, activity: e.activity, text, room: roomAt(e.floor, e.x, e.z)?.name ?? '' });
    if (e.history.length > 60) e.history.pop();
  }


  // ------------------------------------------------------------------ owner (the visitor) features
  private ownerMessage(e: Employee, text: string) {
    this.ownerMessages.unshift({ id: this.ownerSeq++, t: Math.floor(this.minute), day: this.day, empId: e.cfg.id, name: e.cfg.name, text });
    if (this.ownerMessages.length > 80) this.ownerMessages.pop();
    e.chat.push({ t: Math.floor(this.minute), day: this.day, from: 'employee', text });
    if (e.chat.length > 60) e.chat.shift();
    this.version++;
  }

  /** Where an employee goes for a 'come' or 'room' instruction. */
  private ownerTarget(e: Employee): Seat | null {
    const o = e.order;
    if (!o) return null;
    if (o.kind === 'come') {
      const id = `owner:${e.cfg.id}`;
      return { id, floor: o.floor, x: o.x, z: o.z, y: o.floor * FLOOR_H, heading: o.heading, kind: 'stand', roomId: roomAt(o.floor, o.x, o.z)?.id ?? 'unknown', approach: { x: o.x, z: o.z } };
    }
    if (o.kind === 'room') {
      const chairs = SEATS.filter((s) => s.roomId === o.roomId && (s.kind === 'meeting' || s.kind === 'lounge' || s.kind === 'cafe'));
      const stands = SEATS.filter((s) => s.roomId === o.roomId && s.kind === 'stand' && !s.id.startsWith('cafe-q') && !s.id.startsWith('slounge-q'));
      const seat = this.pickSeat(e, chairs, `own:${o.id}`) ?? this.pickSeat(e, stands, `owns:${o.id}`);
      if (seat) return seat;
      const r = roomById(o.roomId);
      if (!r) return null;
      const a = (e.index / Math.max(1, this.employees.length)) * Math.PI * 2;
      const spot = nearestWalkable(r.floor, r.entry.x + Math.cos(a) * 0.9, r.entry.z + Math.sin(a) * 0.9, 2) ?? r.entry;
      return { id: `owner:${e.cfg.id}`, floor: r.floor, x: spot.x, z: spot.z, y: r.floor * FLOOR_H, heading: Math.atan2(r.entry.x - spot.x, r.entry.z - spot.z), kind: 'stand', roomId: r.id, approach: spot };
    }
    return null;
  }

  private finishOrder(e: Employee, m: number) {
    const o = e.order;
    if (!o) return;
    e.order = null;
    if (o.kind === 'task') {
      this.ownerMessage(e, `Done: ${o.text}. I've filed it and I'm back on my regular work.`);
      this.pushHistory(e, `Completed the owner's request: ${o.text}`);
      this.addLog(`${e.cfg.name} completed a task for the owner: ${o.text}`, 'office');
    }
    void m;
  }

  /** Spots in a fan in front of the owner, one per employee, on walkable floor. */
  private spotsNear(at: { floor: number; x: number; z: number; yaw: number }, n: number): { x: number; z: number }[] {
    const out: { x: number; z: number }[] = [];
    const fwd = { x: -Math.sin(at.yaw), z: -Math.cos(at.yaw) };
    const base = Math.atan2(fwd.x, fwd.z);
    for (let ring = 0; out.length < n && ring < 6; ring++) {
      const r = 1.3 + ring * 0.8;
      const count = 5 + ring * 4;
      for (let k = 0; k < count && out.length < n; k++) {
        const off = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / (count + 1));
        const a = base + off;
        const w = nearestWalkable(at.floor, at.x + Math.sin(a) * r, at.z + Math.cos(a) * r, 0.5);
        if (!w || Math.hypot(w.x - at.x, w.z - at.z) < 0.9) continue;
        if (out.some((o) => Math.hypot(o.x - w.x, o.z - w.z) < 0.65)) continue;
        out.push(w);
      }
    }
    return out;
  }

  /** "Come to me": employees walk over and stand in front of the owner. */
  orderCome(ids: string[], at: { floor: number; x: number; z: number; yaw: number }, minutes = 30): number {
    const emps = ids.map((id) => this.byId.get(id)).filter((e): e is Employee => !!e);
    const spots = this.spotsNear(at, emps.length);
    const place = roomAt(at.floor, at.x, at.z)?.name ?? 'your location';
    emps.forEach((e, i) => {
      const s = spots[i] ?? nearestWalkable(at.floor, at.x, at.z, 3) ?? { x: at.x, z: at.z };
      e.order = { id: this.ownerSeq++, kind: 'come', floor: at.floor, x: s.x, z: s.z, heading: Math.atan2(at.x - s.x, at.z - s.z), until: this.minute + minutes, place };
      this.pushHistory(e, `The owner asked me to come to ${place}`);
      this.ownerMessage(e, `On my way to ${place}.`);
      this.decide(e, Math.floor(this.minute));
    });
    this.addLog(`Owner called ${emps.length === 1 ? emps[0].cfg.name : `${emps.length} employees`} to ${place}`, 'office');
    return emps.length;
  }

  /** Send employees to a room and have them wait there. */
  orderRoom(ids: string[], roomId: string, minutes = 30): number {
    const r = roomById(roomId);
    if (!r) return 0;
    const emps = ids.map((id) => this.byId.get(id)).filter((e): e is Employee => !!e);
    for (const e of emps) {
      e.order = { id: this.ownerSeq++, kind: 'room', roomId, until: this.minute + minutes };
      this.pushHistory(e, `The owner asked me to go to ${r.name}`);
      this.ownerMessage(e, `Heading to ${r.name} now.`);
      this.decide(e, Math.floor(this.minute));
    }
    this.addLog(`Owner sent ${emps.length === 1 ? emps[0].cfg.name : `${emps.length} employees`} to ${r.name}`, 'office');
    return emps.length;
  }

  /** Give an employee a task; they work on it at their desk and report back when it is done. */
  assignTask(id: string, text: string, minutes = 40) {
    const e = this.byId.get(id);
    const t = text.trim().slice(0, 140);
    if (!e || !t) return;
    e.order = { id: this.ownerSeq++, kind: 'task', text: t, until: this.minute + minutes, started: this.minute };
    e.chat.push({ t: Math.floor(this.minute), day: this.day, from: 'owner', text: `Please: ${t}` });
    this.pushHistory(e, `New task from the owner: ${t}`);
    this.ownerMessage(e, `Understood. I'll work on "${t}" at my desk and report back by ${fmtTime(this.minute + minutes)}.`);
    this.addLog(`Owner assigned ${e.cfg.name}: ${t}`, 'office');
    this.decide(e, Math.floor(this.minute));
  }

  /** Release employees from any owner instruction; they go back to their routine. */
  dismiss(ids: string[]) {
    for (const id of ids) {
      const e = this.byId.get(id);
      if (!e || !e.order) continue;
      const wasTask = e.order.kind === 'task';
      e.order = null;
      this.ownerMessage(e, wasTask ? 'OK, I will drop that task.' : 'Thank you. Heading back to my desk.');
      this.decide(e, Math.floor(this.minute));
    }
    this.version++;
  }

  /** Call a meeting now with any group, in any bookable room (or an all-hands in the lobby). */
  callMeeting(opts: { attendeeIds: string[]; roomId: string; minutes: number; topic: string }): OfficeEvent | null {
    const room = roomById(opts.roomId);
    const ids = [...new Set(opts.attendeeIds)].filter((id) => this.byId.has(id));
    if (!room || !ids.length) return null;
    const m = Math.floor(this.minute);
    // allow time to walk there (up to ~2 floors) before the meeting clock starts
    const walk = Math.ceil(Math.max(...ids.map((id) => this.travelMinutes(this.byId.get(id)!, room.id)))) + 2;
    const topic = opts.topic.trim().slice(0, 80) || (ids.length === this.employees.length ? 'All-hands' : 'Meeting with the owner');
    const ev: OfficeEvent = {
      id: `d${this.day}-owner-${this.ownerSeq++}`, kind: 'owner-meeting', title: `Owner's meeting: ${topic}`, roomId: room.id,
      start: m, end: m + walk + Math.max(5, opts.minutes), attendeeIds: ids, status: 'scheduled',
      standing: room.id === 'g-lobby', agenda: [topic], notes: [],
    };
    this.events.push(ev);
    this.events.sort((a, b) => a.start - b.start);
    for (const id of ids) {
      const e = this.byId.get(id)!;
      this.pushHistory(e, `Called to "${topic}" in ${room.name} by the owner`);
      this.decide(e, m);
    }
    this.addLog(`Owner called ${ids.length} ${ids.length === 1 ? 'person' : 'people'} to ${room.name}: ${topic}`, 'event');
    this.version++;
    return ev;
  }

  endMeeting(eventId: string) {
    const ev = this.events.find((e) => e.id === eventId);
    if (!ev || ev.status === 'completed' || ev.status === 'cancelled') return;
    ev.status = ev.start <= this.minute ? 'completed' : 'cancelled';
    ev.end = Math.floor(this.minute);
    this.addLog(`Owner ended ${ev.title}`, 'event');
    for (const id of ev.attendeeIds) {
      const e = this.byId.get(id);
      if (e) this.decide(e, Math.floor(this.minute));
    }
    this.version++;
  }

  ownerMeetings(): OfficeEvent[] {
    return this.events.filter((e) => e.kind === 'owner-meeting');
  }

  /** The owner opened/closed a conversation with this employee. */
  setTalking(id: string | null) {
    for (const e of this.employees) e.talking = e.cfg.id === id;
  }

  /** In person when on the same floor within ~5 m, otherwise by phone. */
  talkMode(id: string): 'in person' | 'by phone' {
    const e = this.byId.get(id);
    const p = this.player;
    if (!e || !p) return 'by phone';
    const ef = Math.max(0, Math.min(2, Math.floor((e.y + 0.3) / FLOOR_H)));
    return ef === p.floor && Math.hypot(e.x - p.x, e.z - p.z) < 5 ? 'in person' : 'by phone';
  }

  /** Talk to an employee. Replies are composed locally from their live simulated work (no AI service). */
  talk(id: string, text: string): string {
    const e = this.byId.get(id);
    const said = text.trim().slice(0, 300);
    if (!e || !said) return '';
    e.chat.push({ t: Math.floor(this.minute), day: this.day, from: 'owner', text: said });
    const reply = this.composeReply(e, said.toLowerCase());
    this.pushHistory(e, `Spoke with the owner (${this.talkMode(id)})`);
    this.ownerMessage(e, reply);
    return reply;
  }

  private composeReply(e: Employee, q: string): string {
    const m = Math.floor(this.minute);
    const first = e.cfg.name.split(' ')[0];
    const greeting = m < 12 * 60 ? 'Good morning' : m < 17 * 60 ? 'Good afternoon' : 'Good evening';
    const firm = this.finance.firm(m);
    const book = e.cfg.bookId ? this.finance.bookMetrics(this.finance.traders.get(e.cfg.id)?.bookId ?? e.cfg.bookId, m) : null;
    const next = this.events.find((ev) => ev.attendeeIds.includes(e.cfg.id) && ev.status === 'scheduled');
    const has = (...w: string[]) => w.some((x) => q.includes(x));
    if (e.phase === 'away') {
      const back = m < e.hours.arrive ? `I'm on my way in; I'll be at my desk around ${fmtTime(e.hours.arrive + 10)}.` : `I've left the office for today; I'm back tomorrow morning.`;
      if (has('come', 'here', 'office', 'need you')) return `${back} Use "Come to me" or call a meeting and I'll come straight in.`;
      if (has('where are you', 'location', 'where r u')) return `I'm not in the building. ${back}`;
      if (has('status', 'update', 'working on', 'doing', 'progress', 'how is', "how's", 'how are')) return `${back} Before I left: ${this.statusLine(e)}`;
    }
    if (has('thank', 'well done', 'good job', 'great work', 'appreciate')) return `Thank you, that means a lot. ${e.cfg.roleType === 'trader' ? 'The desk will be glad to hear it.' : 'I will pass it on to the team.'}`;
    if (has('where are you', 'location', 'where r u')) return `I'm in the ${this.roomName(e)} on the ${['ground', 'first', 'second'][Math.max(0, Math.min(2, e.floor))]} floor.`;
    if (has('p&l', 'pnl', 'profit', 'money', 'perform', 'return', 'loss')) {
      if (e.cfg.roleType === 'trader') return `My positions are ${fmtMoney(this.finance.traderPnl(e.cfg.id))} today (simulated); the ${book?.short ?? ''} book is ${fmtMoney(book?.pnl ?? 0)}.`;
      if (book) return `${book.name} is ${fmtMoney(book.pnl)} today (${(book.pnlPct * 100).toFixed(2)}%), gross ${fmtMoney(book.gross)}. All simulated figures.`;
      return `I don't run a book, but the firm is ${fmtMoney(firm.pnl)} today across all books (simulated).`;
    }
    if (has('risk', 'limit', 'alert', 'drawdown', 'exposure')) {
      const open = this.finance.openAlerts();
      const worst = [...firm.books].sort((a, b) => b.util.drawdown - a.util.drawdown)[0];
      return open.length ? `There ${open.length === 1 ? 'is one open alert' : `are ${open.length} open alerts`}: ${open.map((a) => `${BOOK_INDEX.get(a.bookId)?.short} ${a.metric} (${a.status})`).join(', ')}.` : `No open limit alerts. Highest drawdown utilisation is ${worst.short} at ${(worst.util.drawdown * 100).toFixed(0)}% of its limit.`;
    }
    if (has('problem', 'issue', 'blocker', 'help', 'stuck', 'wrong')) {
      if (this.tech.incidentActive) return `The market-data feed incident (${this.tech.incident.id}) is the main issue right now; technology is ${this.tech.incident.status}. ${e.cfg.roleType === 'tech' ? 'We expect the hotfix shortly.' : 'Some screens show delayed prices.'}`;
      const breaks = this.finance.trades.filter((t) => t.status === 'break').length;
      if (e.cfg.roleType === 'ops' && breaks) return `${breaks} trade break${breaks === 1 ? '' : 's'} open; I'm working through them.`;
      return `No blockers on my side. I'll come to you if anything changes.`;
    }
    if (has('meeting', 'schedule', 'today', 'calendar', 'next')) {
      return next ? `My next meeting is ${next.title} at ${fmtTime(next.start)} in ${roomById(next.roomId)?.name}.` : 'No more meetings for me today; I am at my desk the rest of the day apart from breaks.';
    }
    if (has('status', 'update', 'working on', 'doing', 'progress', 'how is', "how's", 'how are')) {
      const where = e.intent.kind === 'desk' ? '' : ` Right now I'm ${ACTIVITY_LABEL[e.activity].toLowerCase()}.`;
      return `${this.statusLine(e)}${where}`;
    }
    if (has('hello', 'hi ', 'hey', 'good morning', 'good afternoon', 'good evening') || q === 'hi') return `${greeting}! How can I help?`;
    if (has('coffee', 'break', 'lunch')) {
      const b = e.schedule.find((x) => (x.kind === 'coffee' || x.kind === 'lunch') && x.start > m);
      return b ? `My next ${b.kind === 'lunch' ? 'lunch' : 'coffee break'} is at ${fmtTime(b.start)}. Happy to grab something for you.` : 'I already had my breaks today, thanks.';
    }
    return `Understood, ${first} here: I've noted "${q.length > 80 ? `${q.slice(0, 80)}…` : q}". Tell me if you want me to act on it now; you can also assign it as a task.`;
  }

  private statusLine(e: Employee): string {
    const m = Math.floor(this.minute);
    if (e.order?.kind === 'task') return `I'm working on your request "${e.order.text}"; done by ${fmtTime(e.order.until)}.`;
    switch (e.cfg.roleType) {
      case 'trader': {
        const t = this.finance.traders.get(e.cfg.id);
        return `I cover ${t?.coverage.join(', ') ?? 'my names'}; ${t?.orders.filter((o) => o.status === 'filled').length ?? 0} fills today and my P&L is ${fmtMoney(this.finance.traderPnl(e.cfg.id))} (simulated).`;
      }
      case 'researcher': return `I'm drafting "${e.work.title}" — ${e.work.words.toLocaleString()} words so far.`;
      case 'risk': return this.deskTask(e) + '.';
      case 'pm': return this.deskTask(e) + '.';
      case 'tech': return this.tech.incidentActive ? `We're on the feed incident (${this.tech.incident.status}).` : `I'm in ${e.work.file}; ${this.tech.builds.filter((b) => b.status === 'passed').length} builds passed today.`;
      case 'ops': return `${this.finance.trades.filter((t) => t.status === 'matched').length} trades matched, ${this.finance.trades.filter((t) => t.status === 'pending').length} pending, ${this.finance.trades.filter((t) => t.status === 'break').length} breaks open.`;
      case 'receptionist': {
        const next = this.events.find((ev) => ev.status === 'scheduled');
        return next ? `Front desk is covered. Next booking: ${next.title} at ${fmtTime(next.start)}.` : 'Front desk is covered; no more bookings today.';
      }
      case 'ceo': return `The firm is ${fmtMoney(this.finance.firm(m).pnl)} today (simulated) with ${this.finance.openAlerts().length} open risk alerts. Happy to walk you through it.`;
      case 'coordinator': return `${this.cafeOrders.filter((o) => o.status !== 'collected').length} café orders in progress; rooms are set for the afternoon.`;
    }
  }

  /** CEO stands to greet the owner entering the office, and sits again once the owner is seated (or leaves). */
  private updateCeoCourtesy() {
    const ceo = this.employees.find((x) => x.cfg.roleType === 'ceo');
    const p = this.player;
    if (!ceo) return;
    const inRoom = !!p && roomAt(p.floor, p.x, p.z)?.id === ceo.ws.roomId;
    if (!inRoom) {
      this.ceoGreetArmed = true;
      return;
    }
    if (this.ceoGreetArmed && this.atDesk(ceo) && !ceo.greet) {
      this.ceoGreetArmed = false;
      const seat = SEAT_INDEX.get(ceo.ws.seatId)!;
      const side = rotLocal(0.55, -0.4, seat.heading);
      ceo.greet = { stage: 'up', t: 0 };
      ceo.phase = 'standing-up';
      ceo.blend = 0;
      ceo.blendFrom = { x: ceo.x, y: ceo.y, z: ceo.z, h: ceo.heading };
      ceo.blendTo = { x: seat.x + side.x, y: seat.floor * FLOOR_H, z: seat.z + side.z, h: ceo.heading };
      ceo.activity = 'discussing';
      ceo.task = 'Standing to greet you';
      const m = this.minute;
      this.pushHistory(ceo, 'Stood up to greet the owner');
      this.ownerMessage(ceo, `${m < 12 * 60 ? 'Good morning' : m < 17 * 60 ? 'Good afternoon' : 'Good evening'}, welcome. Please, have a seat.`);
    }
  }

  private holdGreeting(e: Employee, dt: number) {
    if (!e.greet) return;
    e.greet.t += dt;
    const p = this.player;
    const ownerSeated = [...this.reservations.entries()].some(([seat, who]) => who === 'player' && SEAT_INDEX.get(seat)?.roomId === e.ws.roomId);
    const ownerLeft = !p || roomAt(p.floor, p.x, p.z)?.id !== e.ws.roomId;
    // remain standing until the owner sits (or leaves); never longer than ~25 s
    if (!(ownerSeated && e.greet.t > 1.2) && !ownerLeft && e.greet.t < 25) return;
    const seat = SEAT_INDEX.get(e.ws.seatId)!;
    e.greet = { stage: 'down', t: 0 };
    e.phase = 'sitting-down';
    e.blend = 0;
    e.blendFrom = { x: e.x, y: e.y, z: e.z, h: e.heading };
    e.blendTo = { x: seat.x, y: seat.y, z: seat.z, h: seat.heading };
    e.at = seat;
    if (ownerSeated) this.pushHistory(e, 'Sat down after the owner took a seat');
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
    const held = new Map<string, number>();
    for (const [seat, who] of this.reservations) {
      if (who === 'player') continue;
      const e = this.byId.get(who);
      if (!e) errs.push(`reservation ${seat} by unknown ${who}`);
      else if (seat !== e.ws.seatId) held.set(who, (held.get(who) ?? 0) + 1);
    }
    for (const [who, n] of held) if (n > 1) errs.push(`${who} holds ${n} non-desk reservations`);
    return errs;
  }

  roomsList() {
    return ROOMS.filter((r) => !r.hidden);
  }

  workstations() {
    return WORKSTATIONS;
  }
}
