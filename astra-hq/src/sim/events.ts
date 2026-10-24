// Coordinated office events: scheduled meetings plus dynamic ones (risk review after a limit breach).
import type { EmployeeConfig, RoleType } from '../config/types';
import { fmtTime } from '../util/math';

export type EventKind = 'briefing' | 'standup' | 'research-review' | 'incident' | 'interview' | 'risk-review' | 'portfolio-review' | 'training' | 'owner-meeting' | 'coaching' | 'workshop';

export interface OfficeEvent {
  id: string;
  kind: EventKind;
  title: string;
  roomId: string;
  start: number;
  end: number;
  attendeeIds: string[];
  /** Attendees gather at standing spots instead of chairs. */
  standing?: boolean;
  status: 'scheduled' | 'in-progress' | 'completed' | 'cancelled';
  agenda: string[];
  /** Dynamic notes written during the meeting (whiteboard + room display). */
  notes: string[];
  dynamic?: boolean;
  alertId?: string;
  remoteNote?: string;
  /** A training session of the ASTRA Academy (completes each attendee's next module). */
  academy?: boolean;
}

const t = (h: number, m: number) => h * 60 + m;

function byRole(emps: EmployeeConfig[], role: RoleType): EmployeeConfig[] {
  return emps.filter((e) => e.roleType === role);
}

export const INCIDENT_START = t(11, 10);
export const SHOCK_MINUTE = t(13, 35);

/** Build the day's scheduled events from the current roster (attendees follow role assignments). */
export function scheduledEvents(emps: EmployeeConfig[], day: number): OfficeEvent[] {
  const traders = byRole(emps, 'trader');
  const pms = byRole(emps, 'pm');
  const research = byRole(emps, 'researcher');
  const risk = byRole(emps, 'risk');
  const tech = byRole(emps, 'tech');
  const ops = byRole(emps, 'ops');
  const ceo = byRole(emps, 'ceo');
  const coord = byRole(emps, 'coordinator');
  const ids = (l: EmployeeConfig[]) => l.map((e) => e.id);
  const ev = (e: Omit<OfficeEvent, 'status' | 'notes'>): OfficeEvent => ({ ...e, id: `d${day}-${e.id}`, status: 'scheduled', notes: [] });
  const list: OfficeEvent[] = [
    ev({
      id: 'briefing', kind: 'briefing', title: 'Morning Market Briefing', roomId: 'f-conf', start: t(8, 0), end: t(8, 30),
      attendeeIds: [...ids(traders), ...ids(pms), ...ids(ceo), ...ids(research.slice(0, 1)), ...ids(risk.slice(0, 1))],
      agenda: ['Overnight moves and positioning', 'Key levels for today', 'Risk limits status', 'Calendar: data releases'],
    }),
    ev({
      id: 'standup', kind: 'standup', title: 'Technology Stand-up', roomId: 's-tech', start: t(9, 15), end: t(9, 30), standing: true,
      attendeeIds: ids(tech), agenda: ['Yesterday / today / blockers', 'Release train status', 'On-call handover'],
    }),
    ev({
      id: 'research', kind: 'research-review', title: 'Research Review', roomId: 'f-m1a', start: t(10, 30), end: t(11, 10),
      attendeeIds: [...ids(research), ...ids(pms.slice(0, 1))],
      agenda: ['Draft notes in progress', 'Model updates and assumptions', 'Ideas for the equities book'],
    }),
    ev({
      id: 'incident', kind: 'incident', title: 'Incident Investigation: market data feed latency', roomId: 's-server', start: INCIDENT_START + 2, end: INCIDENT_START + 18, standing: true,
      attendeeIds: ids(tech), agenda: ['Check feed handler hosts', 'Confirm vendor failover status', 'Decide on hotfix'],
    }),
    ev({
      id: 'interview', kind: 'interview', title: 'Video Interview (remote candidate)', roomId: 'g-interview', start: t(14, 0), end: t(14, 45),
      attendeeIds: ids(tech.slice(0, 2)), agenda: ['Introductions', 'Systems design discussion', 'Candidate questions'],
      remoteNote: 'Candidate joins by video call; no visitor on site.',
    }),
    ev({
      id: 'portfolio', kind: 'portfolio-review', title: 'Portfolio Review', roomId: 's-board', start: t(15, 30), end: t(16, 15),
      attendeeIds: [...ids(pms), ...ids(ceo), ...ids(risk.slice(0, 1)), ...ids(research.slice(0, 1))],
      agenda: ['Book performance and attribution', 'Risk utilisation by book', 'Capital allocation proposals'],
    }),
    ev({
      id: 'training', kind: 'training', title: 'Compliance Training', roomId: 'g-training', start: t(16, 30), end: t(17, 10),
      attendeeIds: [...ids(ops), ...ids(coord), ...ids(research.slice(3, 5))],
      agenda: ['Personal account dealing policy', 'Information barriers', 'Record keeping'],
    }),
  ];
  return list.filter((e) => e.attendeeIds.length > 0);
}

export function eventLabel(e: OfficeEvent): string {
  return `${fmtTime(e.start)}-${fmtTime(e.end)} ${e.title}`;
}

export const BOOKABLE_FOR_REVIEW = ['f-m1b', 'f-m1a', 's-board', 'f-conf'];
