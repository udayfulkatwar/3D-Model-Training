import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/config/defaults';
import { Simulation } from '../src/sim/simulation';
import { roomAt } from '../src/world/building';

const run = (sim: Simulation, simMinutes: number, check?: () => void) => {
  const end = sim.minute + simMinutes;
  let n = 0;
  while (sim.minute < end) {
    sim.advance(0.1);
    if (check && ++n % 25 === 0) check();
  }
};

describe('owner features', () => {
  it('calls the whole company to the Conference Room and everyone fits (chairs + standing room)', () => {
    const sim = new Simulation(defaultConfig());
    const ev = sim.callMeeting({ attendeeIds: sim.employees.map((e) => e.cfg.id), roomId: 'f-conf', minutes: 20, topic: 'Quarterly plan' })!;
    expect(ev).toBeTruthy();
    const errs: string[] = [];
    run(sim, 30, () => errs.push(...sim.validate()));
    expect(errs).toEqual([]);
    expect(ev.status).toBe('in-progress');
    expect(sim.presentAttendees(ev).length).toBe(30);
    expect(sim.remoteAttendees(ev).length).toBe(0);
    sim.endMeeting(ev.id);
    run(sim, 25);
    expect(sim.employees.filter((e) => e.intent.kind === 'event' && e.intent.eventId === ev.id).length).toBe(0);
  }, 60000);

  it('runs an all-hands standing in the lobby', () => {
    const sim = new Simulation(defaultConfig());
    const ev = sim.callMeeting({ attendeeIds: sim.employees.map((e) => e.cfg.id), roomId: 'g-lobby', minutes: 15, topic: '' })!;
    run(sim, 30);
    expect(ev.title).toMatch(/All-hands/);
    expect(sim.presentAttendees(ev).length).toBe(30);
    expect(sim.validate()).toEqual([]);
  }, 60000);

  it('calls a department to the owner, then lets them go', () => {
    const sim = new Simulation(defaultConfig());
    const risk = sim.employees.filter((e) => e.cfg.department === 'Risk').map((e) => e.cfg.id);
    sim.orderCome(risk, { floor: 0, x: 19, z: 17.2, yaw: 0 });
    run(sim, 20);
    for (const id of risk) {
      const e = sim.byId.get(id)!;
      expect(e.phase).toBe('standing');
      expect(Math.hypot(e.x - 19, e.z - 17.2)).toBeLessThan(3.5);
      expect(e.floor).toBe(0);
      expect(e.task).toMatch(/speak with you/);
    }
    expect(sim.ownerMessages.some((m) => /I'm here/.test(m.text))).toBe(true);
    sim.dismiss(risk);
    run(sim, 25);
    for (const id of risk) expect(sim.atDesk(sim.byId.get(id)!) || sim.byId.get(id)!.intent.kind !== 'owner').toBe(true);
  }, 60000);

  it('sends someone to a room and assigns a task that is reported back', () => {
    const sim = new Simulation(defaultConfig());
    sim.orderRoom(['e13'], 's-board');
    run(sim, 20);
    const e = sim.byId.get('e13')!;
    expect(roomAt(e.floor, e.x, e.z)?.id).toBe('s-board');
    sim.dismiss(['e13']);
    sim.assignTask('e02', 'Prepare a summary of energy exposure', 10);
    run(sim, 1);
    expect(sim.byId.get('e02')!.order?.kind).toBe('task');
    run(sim, 12);
    expect(sim.byId.get('e02')!.order).toBeNull();
    expect(sim.ownerMessages.some((m) => m.empId === 'e02' && /^Done:/.test(m.text))).toBe(true);
  }, 60000);

  it('answers questions from live data', () => {
    const sim = new Simulation(defaultConfig());
    run(sim, 60);
    expect(sim.talk('e02', 'What is your P&L?')).toMatch(/\$/);
    expect(sim.talk('e17', 'Any risk alerts?')).toMatch(/alert|utilisation/);
    expect(sim.talk('e12', 'Status update please')).toMatch(/words/);
    expect(sim.talk('e23', 'Where are you?')).toMatch(/floor/);
    expect(sim.byId.get('e02')!.chat.length).toBe(2);
  }, 60000);

  it('CEO stands to greet the owner and sits again once the owner is seated', () => {
    const sim = new Simulation(defaultConfig());
    const ceo = sim.employees.find((e) => e.cfg.roleType === 'ceo')!;
    sim.advance(0.5);
    sim.player = { x: 8.0, y: 8, z: 10.2, floor: 2 }; // just inside the CEO office door
    sim.advance(1.5);
    expect(ceo.greet?.stage).toBe('hold');
    expect(ceo.phase).toBe('standing');
    expect(ceo.pose).toBe('standTalk');
    expect(sim.ownerMessages[0].text).toMatch(/have a seat/);
    sim.advance(3);
    expect(ceo.phase).toBe('standing'); // still standing while the owner stands
    expect(sim.playerSit('ceo-guest-s1')).toBe(true);
    sim.advance(3);
    expect(ceo.greet).toBeNull();
    expect(ceo.phase).toBe('seated');
    // no second greeting while the owner stays in the office
    sim.advance(3);
    expect(ceo.greet).toBeNull();
  });
});
