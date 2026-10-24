import { beforeAll, describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/config/defaults';
import { Simulation } from '../src/sim/simulation';

describe('office workflow, mistakes and coaching over two days', () => {
  const sim = new Simulation(defaultConfig());
  const problems: string[] = [];
  const all = { tickets: [] as Simulation['tickets'], mistakes: [] as Simulation['mistakes'], coachings: 0 };
  beforeAll(() => {
    let n = 0;
    let lastDay = 0;
    const seenCoach = new Set<string>();
    while (sim.day < 2) {
      sim.advance(0.5);
      if (++n % 10 === 0) problems.push(...sim.validate());
      for (const ev of sim.events) if (ev.kind === 'coaching' && ev.status === 'completed') seenCoach.add(ev.id);
      if (sim.day !== lastDay) { lastDay = sim.day; }
      for (const k of sim.tickets) if (!all.tickets.includes(k)) all.tickets.push(k);
      for (const x of sim.mistakes) if (!all.mistakes.includes(x)) all.mistakes.push(x);
    }
    all.coachings = seenCoach.size;
  }, 300000);

  it('passes research ideas from researchers to PMs to traders, with outcomes tracked', () => {
    const ideas = all.tickets.filter((k) => k.kind === 'idea');
    expect(ideas.length).toBeGreaterThan(2);
    for (const k of ideas) {
      expect(sim.byId.get(k.from)!.cfg.roleType).toBe('researcher');
      expect(k.log[0].text).toMatch(/published a note/);
    }
    const executed = ideas.filter((k) => k.status === 'executed');
    expect(executed.length + ideas.filter((k) => k.status === 'rejected').length).toBeGreaterThan(0);
    for (const k of executed) expect(sim.byId.get(k.to)!.cfg.roleType).toBe('trader');
  });

  it('makes human mistakes, catches most of them, and corrects the rest', () => {
    expect(all.mistakes.length).toBeGreaterThan(0);
    const ff = all.mistakes.filter((x) => x.kind === 'fat-finger');
    for (const x of ff) expect(sim.byId.get(x.empId)!.cfg.roleType).toBe('trader');
    const errTickets = all.tickets.filter((k) => k.kind === 'error-trade');
    for (const k of errTickets) expect(['caught', 'fixed', 'open']).toContain(k.status);
    expect(errTickets.filter((k) => k.status === 'open' && k.day < sim.day).length).toBe(0);
  });

  it('follows work mistakes with one-to-one coaching from the manager', () => {
    const coached = [...sim.training.values()].filter((r) => (r.coaching ?? []).length);
    const workMistakes = all.mistakes.filter((x) => x.kind !== 'late');
    if (workMistakes.length) {
      expect(coached.length).toBeGreaterThan(0);
      expect(all.coachings + coached.flatMap((r) => r.coaching!).filter((c) => c.status !== 'done').length).toBeGreaterThan(0);
    }
    expect(problems.slice(0, 10)).toEqual([]);
  });

  it('reports workflow and mistakes in the CEO report', () => {
    const sec = sim.ceoReport().sections.find((s) => s.title === 'Workflow and mistakes')!;
    expect(sec.lines[0]).toMatch(/Research ideas/);
  });
});
