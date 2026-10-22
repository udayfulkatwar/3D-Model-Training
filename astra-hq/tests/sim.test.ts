import { beforeAll, describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/config/defaults';
import { Simulation } from '../src/sim/simulation';
import { MONITOR_INDEX, SEAT_INDEX, WS_INDEX } from '../src/world/furniture';
import { isWalkable } from '../src/world/nav';
import { STATIC_BOXES, inStairwell } from '../src/world/physics';

/** Distance from (x,z) to the nearest obstacle in the body height band of floor f. */
function clearance(f: number, x: number, z: number): number {
  let best = Infinity;
  for (const b of STATIC_BOXES) {
    if (b.y1 <= f * 4 + 0.15 || b.y0 >= f * 4 + 1.8) continue;
    const dx = Math.max(b.x0 - x, 0, x - b.x1);
    const dz = Math.max(b.z0 - z, 0, z - b.z1);
    best = Math.min(best, Math.hypot(dx, dz));
  }
  return best;
}
import { INSTRUMENTS, INSTRUMENT_INDEX } from '../src/sim/market';
import { BOOKS } from '../src/sim/finance';
import { DAY_START } from '../src/sim/constants';
import { buildAppView } from '../src/apps/views';

const toMinute = (sim: Simulation, minute: number, check?: (s: Simulation) => void) => {
  let n = 0;
  while (sim.minute < minute) {
    sim.advance(0.1);
    if (check && ++n % 25 === 0) check(sim);
  }
};

describe('roster', () => {
  it('has exactly 30 employees with the required role mix and valid assignments', () => {
    const sim = new Simulation(defaultConfig());
    expect(sim.employees.length).toBe(30);
    const count = (r: string) => sim.employees.filter((e) => e.cfg.roleType === r).length;
    expect([count('receptionist'), count('trader'), count('researcher'), count('risk'), count('pm'), count('tech'), count('ops'), count('ceo'), count('coordinator')])
      .toEqual([1, 10, 5, 3, 3, 4, 2, 1, 1]);
    const desks = new Set<string>();
    for (const e of sim.employees) {
      expect(WS_INDEX.has(e.cfg.workstationId)).toBe(true);
      expect(desks.has(e.cfg.workstationId)).toBe(false);
      desks.add(e.cfg.workstationId);
      for (const m of e.ws.monitors) expect(MONITOR_INDEX.get(m.id)?.workstationId).toBe(e.ws.id);
      expect(e.schedule.length).toBeGreaterThan(0);
    }
  });
});

describe('a full simulated day', () => {
  const sim = new Simulation(defaultConfig());
  const problems: string[] = [];
  const snapshots: Record<string, unknown> = {};
  const check = (s: Simulation) => {
    problems.push(...s.validate());
    for (const e of s.employees) {
      if (e.phase === 'walking' || e.phase === 'standing' || e.phase === 'door-wait') {
        if (inStairwell(e.x, e.z) && e.z < 4.45) continue; // on a flight or its top step
        const f = Math.round(e.y / 4);
        if (!isWalkable(f, e.x, e.z) && clearance(f, e.x, e.z) < 0.14 && !(e.target?.kind === 'stand' && e.phase === 'standing')) problems.push(`${e.cfg.id} off-grid at ${e.x.toFixed(2)},${e.z.toFixed(2)} y ${e.y.toFixed(2)} (${e.phase}) ${e.intentKey} -> ${e.target?.id} wp ${e.pathI}/${e.path.length} next ${e.path[e.pathI] ? `${e.path[e.pathI].x.toFixed(2)},${e.path[e.pathI].z.toFixed(2)}` : '-'}`);
      }
    }
  };

  beforeAll(() => {
    toMinute(sim, 8 * 60 + 15, check);
    const brief = sim.events.find((e) => e.kind === 'briefing')!;
    snapshots.briefPresent = sim.presentAttendees(brief).length;
    snapshots.briefStatus = brief.status;
    toMinute(sim, 11 * 60 + 20, check);
    snapshots.incidentAttendees = sim.events.find((e) => e.kind === 'incident')!.attendeeIds.length;
    snapshots.incidentStatus = sim.tech.incident.status;
    snapshots.serverRoomPeople = sim.employees.filter((e) => sim.roomIdOf(e) === 's-server').length;
    toMinute(sim, 12 * 60 + 40, check);
    snapshots.lunchCafe = sim.employees.filter((e) => e.activity === 'cafe').length;
    toMinute(sim, 18 * 60, check);
  }, 120000);

  it('keeps every seat single-occupancy and everyone on walkable ground', () => {
    expect(problems.slice(0, 30)).toEqual([]);
  });

  it('runs the morning briefing with people physically present', () => {
    expect(snapshots.briefStatus).toBe('in-progress');
    expect(snapshots.briefPresent as number).toBeGreaterThanOrEqual(12);
  });

  it('runs the technology incident with the tech team in the server room', () => {
    expect(snapshots.incidentAttendees).toBe(4);
    expect(['investigating', 'fixing']).toContain(snapshots.incidentStatus);
    expect(snapshots.serverRoomPeople as number).toBeGreaterThanOrEqual(3);
  });

  it('has people at lunch in staggered waves', () => {
    expect(snapshots.lunchCafe as number).toBeGreaterThan(3);
    expect(snapshots.lunchCafe as number).toBeLessThan(25);
  });

  it('turns a simulated breach into an alert, a review meeting with the PM, and a resolution', () => {
    const alert = sim.finance.alerts.find((a) => a.metric === 'drawdown');
    expect(alert).toBeTruthy();
    expect(alert!.t).toBeGreaterThanOrEqual(13 * 60 + 35);
    const review = sim.events.find((e) => e.kind === 'risk-review' && e.alertId === alert!.id)!;
    expect(review).toBeTruthy();
    const pm = sim.finance.pmByBook.get(alert!.bookId)!;
    expect(review.attendeeIds).toContain(pm);
    expect(review.status).toBe('completed');
    expect(alert!.log.some((l) => l.text.startsWith('Acknowledged'))).toBe(true);
    expect(alert!.status).toBe('resolved');
    expect(sim.log.some((l) => l.text.includes('Risk review outcome'))).toBe(true);
  });

  it('every employee has activity history and the day produced trades and builds', () => {
    for (const e of sim.employees) expect(e.history.length).toBeGreaterThan(2);
    const failures = sim.employees.flatMap((e) => e.history.filter((h) => h.text.startsWith('Could not find a route')).map((h) => `${e.cfg.id}: ${h.text}`));
    expect(failures).toEqual([]);
    expect(sim.finance.trades.length).toBeGreaterThan(20);
    expect(sim.tech.builds.length).toBeGreaterThan(1);
    expect(sim.tech.incident.status).toBe('resolved');
  });

  it('keeps related financial views consistent', () => {
    const m = Math.floor(sim.minute);
    const firm = sim.finance.firm(m);
    for (const b of BOOKS) {
      const bm = sim.finance.bookMetrics(b.id, m);
      // book = sum of its traders' positions
      const qty = new Map<string, number>();
      let pnl = 0;
      for (const t of sim.finance.traders.values()) {
        if (t.bookId !== b.id) continue;
        pnl += sim.finance.traderPnl(t.empId);
        for (const p of t.positions.values()) qty.set(p.sym, (qty.get(p.sym) ?? 0) + p.qty);
      }
      for (const p of bm.positions) expect(p.qty).toBe(qty.get(p.sym));
      expect(bm.pnl).toBeCloseTo(pnl, 2);
      const gross = bm.positions.reduce((s, p) => s + Math.abs(p.notional), 0);
      expect(bm.gross).toBeCloseTo(gross, 2);
      for (const p of bm.positions) {
        const inst = INSTRUMENTS[INSTRUMENT_INDEX.get(p.sym)!];
        expect(p.notional).toBeCloseTo(p.qty * sim.market.price(p.sym) * inst.mult, 2);
      }
    }
    expect(firm.pnl).toBeCloseTo(firm.books.reduce((s, b) => s + b.pnl, 0), 2);
    expect(firm.gross).toBeCloseTo(firm.books.reduce((s, b) => s + b.gross, 0), 2);
  });

  it('every assigned monitor shows its role application with live data, and views agree', () => {
    for (const e of sim.employees) {
      for (const mon of e.ws.monitors) {
        const st = sim.monitorState(mon.id)!;
        expect(st).toBeTruthy();
        expect(st.appId).not.toBe('flex-idle');
        const v = buildAppView(sim, mon.id);
        expect(v.widgets.length).toBeGreaterThan(0);
        expect(v.employeeName).toBe(e.cfg.name);
      }
    }
    // trader blotter positions == PM allocation rows for the same book
    const trader = sim.employees.find((e) => e.cfg.roleType === 'trader')!;
    const pm = sim.employees.find((e) => e.cfg.roleType === 'pm' && e.cfg.bookId === trader.cfg.bookId)!;
    const tMon = trader.ws.monitors[2].id;
    sim.setMonitorTab(tMon, 0);
    const tv = buildAppView(sim, tMon);
    const pMon = pm.ws.monitors[0].id;
    sim.setMonitorTab(pMon, 1);
    const pv = buildAppView(sim, pMon);
    const tTable = tv.widgets.find((w) => w.type === 'table')!;
    const pTable = pv.widgets.find((w) => w.type === 'table')!;
    expect(tTable && pTable).toBeTruthy();
    if (tTable.type === 'table' && pTable.type === 'table') {
      for (const row of tTable.rows) {
        const sym = row[0];
        const pmRow = pTable.rows.find((r) => r[0] === sym);
        expect(pmRow, `PM view lists ${sym}`).toBeTruthy();
      }
    }
  });
});

describe('clock controls', () => {
  it('pause freezes the whole simulation; speed scales it', () => {
    const a = new Simulation(defaultConfig());
    a.paused = true;
    for (let i = 0; i < 50; i++) a.tick(0.05);
    expect(a.minute).toBe(DAY_START);
    const px = a.market.prices.slice();
    a.paused = false;
    a.speed = 1;
    for (let i = 0; i < 120; i++) a.tick(0.05);
    const at1 = a.minute - DAY_START;
    const b = new Simulation(defaultConfig());
    b.speed = 5;
    for (let i = 0; i < 120; i++) b.tick(0.05);
    expect((b.minute - DAY_START) / at1).toBeCloseTo(5, 1);
    expect(a.market.prices).not.toEqual(px);
  });

  it('is deterministic for a seed and reset restarts the day', () => {
    const a = new Simulation(defaultConfig());
    const b = new Simulation(defaultConfig());
    toMinute(a, DAY_START + 90);
    toMinute(b, DAY_START + 90);
    expect(a.market.prices).toEqual(b.market.prices);
    expect(a.employees.map((e) => e.activity)).toEqual(b.employees.map((e) => e.activity));
    a.reset();
    expect(a.minute).toBe(DAY_START);
    expect(a.finance.trades.length).toBe(0);
    for (const e of a.employees) expect(SEAT_INDEX.get(e.ws.seatId)!.x).toBeCloseTo(e.x, 5);
  });

  it('rolls over into a second day with a fresh schedule', () => {
    const c = new Simulation(defaultConfig());
    c.speed = 5;
    while (c.day === 0) c.advance(0.5);
    expect(c.day).toBe(1);
    expect(c.minute).toBeLessThan(DAY_START + 1);
    expect(c.events.every((e) => e.status === 'scheduled')).toBe(true);
    expect(c.validate()).toEqual([]);
    toMinute(c, 9 * 60);
    expect(c.validate()).toEqual([]);
  }, 60000);
});
