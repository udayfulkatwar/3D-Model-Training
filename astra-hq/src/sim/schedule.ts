// Per-employee daily routine (coffee, lunch, desk discussions) generated from the seed and staggered
// around the event calendar so people are never synchronised.
import type { EmployeeConfig } from '../config/types';
import { hashRand } from '../util/rng';
import type { OfficeEvent } from './events';

export type BlockKind = 'coffee' | 'lunch' | 'discuss';

export interface Block {
  id: string;
  kind: BlockKind;
  start: number;
  end: number;
  /** Discussion partner. */
  withId?: string;
  where?: 'cafe' | 'lounge';
}

const H = (h: number, m = 0) => h * 60 + m;

function busy(start: number, end: number, events: OfficeEvent[], blocks: Block[], empId: string, pad = 12): boolean {
  for (const e of events) {
    if (!e.attendeeIds.includes(empId)) continue;
    if (start < e.end + pad && end > e.start - pad - 10) return true;
  }
  for (const b of blocks) if (start < b.end + pad && end > b.start - pad) return true;
  return false;
}

function place(seed: number, key: string, lo: number, hi: number, dur: number, events: OfficeEvent[], blocks: Block[], empId: string): number | null {
  for (let tries = 0; tries < 24; tries++) {
    const s = Math.round(lo + hashRand(seed, key, tries) * (hi - lo - dur));
    if (!busy(s, s + dur, events, blocks, empId)) return s;
  }
  return null;
}

/** Floor of an employee's desk decides whether coffee happens in the café or the second-floor staff lounge. */
export function buildSchedule(seed: number, day: number, emp: EmployeeConfig, index: number, deskFloor: number, all: EmployeeConfig[], events: OfficeEvent[]): Block[] {
  const blocks: Block[] = [];
  const k = (s: string) => `${s}:${emp.id}:${day}`;
  // Lunch in three staggered waves; the receptionist and coordinator cover the quieter slots.
  let lunchStart: number;
  if (emp.roleType === 'receptionist') lunchStart = H(13, 30);
  else if (emp.roleType === 'coordinator') lunchStart = H(14, 30);
  else lunchStart = H(12, 0) + (index % 3) * 30 + Math.floor(hashRand(seed, k('lunchj')) * 9);
  let lunchDur = emp.roleType === 'receptionist' ? 30 : 40;
  // shift lunch if it collides with an event
  for (let i = 0; i < 6 && busy(lunchStart, lunchStart + lunchDur, events, [], emp.id, 5); i++) lunchStart += 25;
  if (emp.roleType === 'coordinator') lunchDur = 30;
  blocks.push({ id: k('lunch'), kind: 'lunch', start: lunchStart, end: lunchStart + lunchDur, where: 'cafe' });

  const where: 'cafe' | 'lounge' = deskFloor === 2 ? 'lounge' : deskFloor === 1 ? (hashRand(seed, k('cw')) < 0.5 ? 'cafe' : 'lounge') : 'cafe';
  if (emp.roleType !== 'coordinator') {
    const c1 = place(seed, k('coffee1'), H(9, 20), H(11, 50), 14, events, blocks, emp.id);
    if (c1 !== null) blocks.push({ id: k('coffee1'), kind: 'coffee', start: c1, end: c1 + 14, where });
    if (hashRand(seed, k('second')) < 0.7) {
      const c2 = place(seed, k('coffee2'), H(14, 20), H(17, 40), 14, events, blocks, emp.id);
      if (c2 !== null) blocks.push({ id: k('coffee2'), kind: 'coffee', start: c2, end: c2 + 14, where: hashRand(seed, k('cw2')) < 0.5 ? where : 'cafe' });
    }
  }

  // Desk discussions with a relevant colleague.
  const partners = discussionPartners(emp, all);
  if (partners.length) {
    const n = 1 + Math.floor(hashRand(seed, k('ndisc')) * 2);
    for (let i = 0; i < n; i++) {
      const p = partners[Math.floor(hashRand(seed, k(`dp${i}`)) * partners.length)];
      const dur = 6 + Math.floor(hashRand(seed, k(`dd${i}`)) * 5);
      const s = place(seed, k(`disc${i}`), H(9, 0), H(17, 50), dur, events, blocks, emp.id);
      if (s !== null) blocks.push({ id: k(`disc${i}`), kind: 'discuss', start: s, end: s + dur, withId: p.id });
    }
  }
  return blocks.sort((a, b) => a.start - b.start);
}

function discussionPartners(emp: EmployeeConfig, all: EmployeeConfig[]): EmployeeConfig[] {
  const others = all.filter((e) => e.id !== emp.id);
  switch (emp.roleType) {
    case 'trader': return others.filter((e) => (e.roleType === 'trader' || e.roleType === 'pm') && e.bookId === emp.bookId);
    case 'researcher': return others.filter((e) => e.roleType === 'researcher' || e.roleType === 'pm');
    case 'risk': return others.filter((e) => e.roleType === 'risk' || e.roleType === 'pm');
    case 'pm': return others.filter((e) => e.roleType === 'trader' && e.bookId === emp.bookId);
    case 'tech': return others.filter((e) => e.roleType === 'tech');
    case 'ops': return others.filter((e) => e.roleType === 'ops' || e.roleType === 'tech');
    case 'ceo': return others.filter((e) => e.roleType === 'pm');
    default: return [];
  }
}
