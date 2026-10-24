// Claude as the employees' "brain" (claude.ai artifact runtime, `sample` capability). Replies are grounded
// in each person's live simulated (or live-priced, paper) state, and Claude may act on the owner's
// instructions through a few page tools that call the same Simulation methods as the Owner panel.
// Uses the viewer's own Claude plan; the page asks once before the first call. Falls back to the
// scripted replies when Claude is unavailable.
import { ROOMS, roomById } from '../world/building';
import type { Simulation } from '../sim/simulation';

interface SampleTool {
  name: string;
  description: string;
  inputSchema?: { type: 'object'; properties?: Record<string, unknown>; required?: string[] };
  execute(input: Record<string, unknown>, ctx: { signal: AbortSignal }): unknown;
}
interface SampleFn {
  (input: string | { role: 'user' | 'assistant'; content: string }[], opts?: Record<string, unknown>): Promise<{ text: string; truncated: boolean }>;
  limits(): Promise<{ tools?: { maxCount: number } }>;
}
export interface SampleError { code: string; message?: string; text?: string }

let samplePromise: Promise<SampleFn | null> | null = null;
export function getSample(): Promise<SampleFn | null> {
  if (!samplePromise) samplePromise = (window.claude?.use('sample') as Promise<SampleFn | null> | undefined)?.catch(() => null) ?? Promise.resolve(null);
  return samplePromise;
}

/** Hide-for-this-view codes: stop using Claude and fall back to scripted replies. */
export const PERMANENT = new Set(['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed', 'tools_unavailable']);

export function errorCopy(code: string): string {
  switch (code) {
    case 'not_granted': return 'Claude is not allowed for this page, so replies are scripted.';
    case 'sampling_disabled': return 'Claude is not available on this account, so replies are scripted.';
    case 'rate_limited': return 'Too many messages just now; wait a moment and try again.';
    case 'session_expired': return 'Sign in to claude.ai again to get Claude replies.';
    case 'refused': return 'Claude declined that message; try rephrasing.';
    case 'prompt_too_large': return 'The conversation is too long; close and reopen the chat.';
    case 'cancelled': return '';
    default: return 'The reply was interrupted; try again.';
  }
}

function findRoom(q: string): string | null {
  const s = q.toLowerCase().trim();
  const visible = ROOMS.filter((r) => !r.hidden);
  return (visible.find((r) => r.id.toLowerCase() === s) ?? visible.find((r) => r.name.toLowerCase() === s) ?? visible.find((r) => r.name.toLowerCase().includes(s) || s.includes(r.name.toLowerCase())))?.id ?? null;
}

function tools(sim: Simulation, empId: string, ownerSpot: () => { floor: number; x: number; z: number; yaw: number }): SampleTool[] {
  const e = sim.byId.get(empId)!;
  const list: SampleTool[] = [
    {
      name: 'accept_task',
      description: 'Take on a task the owner asked for; you work on it at your desk and report back when it is done. Returns the due time.',
      inputSchema: { type: 'object', properties: { task: { type: 'string', description: 'Short task description' }, minutes: { type: 'number', description: 'Simulated minutes needed (10-240)' } }, required: ['task'] },
      execute: (i) => {
        const minutes = Math.max(10, Math.min(240, Number(i.minutes) || 40));
        sim.assignTask(empId, String(i.task ?? '').slice(0, 140), minutes);
        return { ok: true, due: e.order?.until };
      },
    },
    {
      name: 'go_to_room',
      description: 'Walk to a room in the building and wait there for the owner (e.g. "Conference Room", "Boardroom", "Founder / CEO Office", "Café"). Returns the room name.',
      inputSchema: { type: 'object', properties: { room: { type: 'string' } }, required: ['room'] },
      execute: (i) => {
        const id = findRoom(String(i.room ?? ''));
        if (!id) throw new Error(`No room called "${String(i.room)}". Rooms: ${ROOMS.filter((r) => !r.hidden).map((r) => r.name).join(', ')}`);
        sim.orderRoom([empId], id);
        return { ok: true, room: roomById(id)?.name };
      },
    },
    {
      name: 'come_to_owner',
      description: 'Walk over to where the owner is standing now.',
      execute: () => { sim.orderCome([empId], ownerSpot()); return { ok: true }; },
    },
    {
      name: 'back_to_work',
      description: "Drop the owner's current instruction and go back to your normal routine.",
      execute: () => { sim.dismiss([empId]); return { ok: true }; },
    },
  ];
  if (e.cfg.roleType === 'ceo') {
    list.push(
      {
        name: 'call_meeting',
        description: 'Call a meeting now. who: "everyone", a department name (Trading, Research, Risk, Portfolio Management, Technology, Operations, ...) or comma-separated names. Returns how many were called.',
        inputSchema: { type: 'object', properties: { who: { type: 'string' }, room: { type: 'string' }, minutes: { type: 'number' }, topic: { type: 'string' } }, required: ['who', 'room', 'topic'] },
        execute: (i) => {
          const who = String(i.who ?? '').toLowerCase();
          const ids = who === 'everyone' || who === 'all'
            ? sim.employees.map((x) => x.cfg.id)
            : sim.employees.filter((x) => who.split(',').some((w) => { const t = w.trim(); return t && (x.cfg.department.toLowerCase() === t || x.cfg.name.toLowerCase().includes(t)); })).map((x) => x.cfg.id);
          const room = findRoom(String(i.room ?? '')) ?? 'f-conf';
          if (!ids.length) throw new Error('Nobody matched; use "everyone", a department or names.');
          sim.callMeeting({ attendeeIds: ids, roomId: room, minutes: Math.max(10, Math.min(120, Number(i.minutes) || 30)), topic: String(i.topic ?? '') });
          return { called: ids.length, room: roomById(room)?.name };
        },
      },
      {
        name: 'start_training',
        description: 'Start or continue the staff training programme (strategy lab for traders, Training Room sessions for everyone else). Returns what was booked.',
        execute: () => { const r = sim.startTrainingProgramme(); return { strategyLab: r.lab, sessionsBooked: r.sessions.length, cohortsWaiting: r.waiting }; },
      },
    );
  }
  return list;
}

function instructions(sim: Simulation, empId: string): string {
  const e = sim.byId.get(empId)!;
  return [
    `You are ${e.cfg.name}, an employee of ${sim.config.companyName} (a fictional investment firm in the ASTRA HQ office simulation). The person talking to you is the company owner.`,
    'Stay in character, be respectful and professional, and answer in the same language and script the owner uses (Hindi, English or Hinglish).',
    'Ground every fact in the briefing below; never invent figures. If something is not in the briefing, say you will check.',
    sim.live
      ? 'Prices are LIVE from the Co-Invest connector, but every position, order and P&L is PAPER trading: never say real money was traded or earned, and never promise profits.'
      : 'All markets and figures are simulated paper data: never claim real money or real trades, and never promise profits.',
    'If the owner asks you to do something you can do with your tools, use the tool, then confirm briefly. You cannot place real orders.',
    'Keep replies short: at most 90 words unless the owner asks for a full report.',
    '',
    'Briefing (live office state):',
    sim.briefingFor(empId),
  ].join('\n');
}

/**
 * Ask Claude for this employee's reply. Streams through onText; resolves with the final text.
 * Rejects with the sample error ({code}) so the caller can fall back.
 */
export async function askEmployee(
  sim: Simulation,
  empId: string,
  ownerText: string,
  opts: { onText?: (t: string) => void; signal?: AbortSignal; ownerSpot: () => { floor: number; x: number; z: number; yaw: number } },
): Promise<string> {
  const sample = await getSample();
  if (!sample) throw { code: 'capability_disabled' } as SampleError;
  const e = sim.byId.get(empId)!;
  // earlier turns of this conversation (the new owner line is already the last chat entry)
  const history = e.chat.slice(-13, -1).map((c) => ({ role: c.from === 'owner' ? ('user' as const) : ('assistant' as const), content: c.text }));
  const turns = [{ role: 'user' as const, content: instructions(sim, empId) }, ...history, { role: 'user' as const, content: ownerText }];
  const lim = await sample.limits().catch(() => null);
  const res = await sample(turns, {
    modelTier: e.cfg.roleType === 'ceo' ? 'default' : 'quick',
    cache: false,
    signal: opts.signal,
    onText: ({ text }: { text: string }) => opts.onText?.(text),
    ...(lim?.tools ? { tools: tools(sim, empId, opts.ownerSpot) } : {}),
  });
  return res.text;
}

/** The CEO's written analysis of the full report (Owner → CEO report). */
export async function ceoAnalysis(sim: Simulation, opts: { onText?: (t: string) => void; signal?: AbortSignal }): Promise<string> {
  const sample = await getSample();
  if (!sample) throw { code: 'capability_disabled' } as SampleError;
  const ceo = sim.employees.find((x) => x.cfg.roleType === 'ceo');
  const r = sim.ceoReport();
  const prompt = [
    `You are ${ceo?.cfg.name ?? 'the CEO'}, CEO of ${sim.config.companyName} (office simulation), writing to the company owner.`,
    sim.live ? 'Prices are live (Co-Invest, read-only); all trading is paper.' : 'All figures are simulated paper data.',
    'Write a short management briefing from the report below: 1) headline numbers, 2) what went well, 3) problems and mistakes, 4) three concrete actions you recommend (training, risk, staffing, strategy). Never promise profits; be candid about losses and uncertainty. Max 220 words. Use the owner\'s language if they have written to you in Hindi; otherwise English.',
    `Recent owner messages to you: ${(ceo?.chat ?? []).filter((c) => c.from === 'owner').slice(-3).map((c) => c.text).join(' | ') || 'none'}`,
    '',
    r.title,
    ...r.sections.map((s) => `${s.title}: ${s.lines.join(' | ')}`),
  ].join('\n');
  const res = await sample(prompt, { modelTier: 'default', cache: false, signal: opts.signal, onText: ({ text }: { text: string }) => opts.onText?.(text) });
  return res.text;
}
