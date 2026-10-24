import { beforeAll, describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/config/defaults';
import { DAY_START, REALTIME_MIN_PER_SEC } from '../src/sim/constants';
import { Simulation } from '../src/sim/simulation';
import { DynamicWorld } from '../src/world/dynamic';
import { SEATS } from '../src/world/furniture';
import { isWalkable } from '../src/world/nav';

describe('a working day from arrival to departure', () => {
  const sim = new Simulation(defaultConfig());
  const problems: string[] = [];
  const snap: Record<string, number> = {};
  let maxRiders = 0;
  let liftRides = 0;
  let restroomNow = 0;
  const seenRide = new Set<string>();
  const onBreak = new Set<string>();

  beforeAll(() => {
    snap.onSiteAtOpen = sim.employees.filter((e) => sim.onSite(e)).length;
    let n = 0;
    const until = (minute: number) => {
      while (sim.minute < minute) {
        sim.advance(0.1);
        if (++n % 10) continue;
        problems.push(...sim.validate());
        const riders = sim.employees.filter((e) => e.liftTrip?.stage === 'ride' || e.liftTrip?.stage === 'enter');
        maxRiders = Math.max(maxRiders, riders.length);
        for (const e of riders) {
          const key = `${e.cfg.id}:${e.liftTrip!.from}`;
          if (e.liftTrip!.stage === 'ride' && !seenRide.has(key)) { seenRide.add(key); liftRides++; }
          // riders move with the car
          if (e.liftTrip!.stage === 'ride' && Math.abs(e.y - sim.dyn.lift.y) > 1e-6) problems.push(`${e.cfg.id} not moving with the car`);
        }
        restroomNow = Math.max(restroomNow, sim.employees.filter((e) => e.activity === 'break').length);
        for (const e of sim.employees) if (e.activity === 'break' && ['g-wc-a', 'g-wc-b'].includes(sim.roomIdOf(e) ?? '')) onBreak.add(e.cfg.id);
      }
    };
    until(7 * 60 + 58);
    const brief = sim.events.find((e) => e.kind === 'briefing')!;
    snap.briefAttendeesOnSite = brief.attendeeIds.filter((id) => sim.onSite(sim.byId.get(id)!)).length;
    snap.briefAttendees = brief.attendeeIds.length;
    until(10 * 60);
    snap.onSiteMorning = sim.employees.filter((e) => sim.onSite(e)).length;
    until(17 * 60);
    snap.onSiteAfternoon = sim.employees.filter((e) => sim.onSite(e)).length;
    until(19 * 60 + 25);
    snap.onSiteNight = sim.employees.filter((e) => sim.onSite(e)).length;
  }, 240000);

  it('starts with an empty building and staff arrive through the entrance', () => {
    expect(snap.onSiteAtOpen).toBe(0);
    for (const e of sim.employees) {
      expect(e.badge.in).not.toBeNull();
      expect(e.badge.in!).toBeGreaterThanOrEqual(e.hours.arrive);
    }
    // briefing attendees are in before 08:00
    expect(snap.briefAttendeesOnSite).toBe(snap.briefAttendees);
    expect(snap.onSiteMorning).toBe(30);
  });

  it('staggers arrival and departure times by role', () => {
    const arrivals = sim.employees.map((e) => e.hours.arrive);
    expect(Math.min(...arrivals)).toBeGreaterThan(DAY_START);
    expect(new Set(arrivals).size).toBeGreaterThan(20);
    for (const e of sim.employees) expect(e.hours.leave - e.hours.arrive).toBeGreaterThan(8 * 60);
    expect(snap.onSiteAfternoon).toBe(30);
  });

  it('uses the elevator: riders wait, board, ride with the car (max 6) and step out', () => {
    expect(liftRides).toBeGreaterThan(5);
    expect(maxRiders).toBeLessThanOrEqual(6);
    expect(sim.employees.some((e) => e.history.some((h) => /by lift/.test(h.text)))).toBe(true);
    expect(sim.employees.filter((e) => e.liftTrip).length).toBe(0);
  });

  it('includes short restroom breaks in the ground-floor restrooms', () => {
    expect(restroomNow).toBeGreaterThan(0);
    expect(onBreak.size).toBeGreaterThan(15);
  });

  it('keeps every invariant all day and everyone has gone home by 19:25', () => {
    expect(problems.slice(0, 20)).toEqual([]);
    expect(snap.onSiteNight).toBe(0);
    for (const e of sim.employees) expect(e.badge.out!).toBeGreaterThan(e.badge.in!);
    expect(sim.floorOccupancy()).toEqual([0, 0, 0]);
    expect(sim.dyn.doors.get('s-d-server')!.open).toBe(false);
  });
});

describe('building details', () => {
  it('restroom spots are on walkable floor inside the restrooms', () => {
    const spots = SEATS.filter((s) => s.id.startsWith('wc-'));
    expect(spots.length).toBe(10);
    for (const s of spots) {
      expect(['g-wc-a', 'g-wc-b']).toContain(s.roomId);
      expect(isWalkable(0, s.x, s.z)).toBe(true);
    }
  });

  it('elevator doors re-open for someone stepping through (door sensor)', () => {
    const d = new DynamicWorld();
    d.selectFloor(2);
    expect(d.lift.phase).toBe('closing');
    d.update(0.3, [], false, false);
    expect(d.lift.doorT).toBeLessThan(1);
    d.update(0.1, [], false, true);
    expect(d.lift.phase).toBe('opening');
    for (let i = 0; i < 20; i++) d.update(0.1, [], false, false);
    for (let i = 0; i < 100; i++) d.update(0.1, [], true, false);
    expect(d.lift.floor).toBe(2);
  });

  it('real-time clock option runs one simulated minute per real minute', () => {
    const s = new Simulation(defaultConfig());
    s.realtime = true;
    for (let i = 0; i < 240; i++) s.tick(0.25);
    expect(s.minute - DAY_START).toBeCloseTo(60 * REALTIME_MIN_PER_SEC, 5);
    s.realtime = false;
    for (let i = 0; i < 12; i++) s.tick(0.25);
    expect(s.minute - DAY_START).toBeCloseTo(2, 5);
  });
});
