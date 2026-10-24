// World exchange clocks for the "World markets" screens. Uses the real current time (the viewer's clock)
// and each exchange's own time zone, so daylight-saving changes are handled by the browser's time-zone data.
// Regular weekday sessions only; exchange holidays are not modelled.

export interface Exchange {
  city: string;
  name: string;
  tz: string;
  /** Session in local minutes; optional lunch break. */
  open: number;
  close: number;
  lunch?: [number, number];
}

const T = (h: number, m = 0) => h * 60 + m;

export const EXCHANGES: Exchange[] = [
  { city: 'Sydney', name: 'ASX', tz: 'Australia/Sydney', open: T(10), close: T(16) },
  { city: 'Tokyo', name: 'JPX', tz: 'Asia/Tokyo', open: T(9), close: T(15, 30), lunch: [T(11, 30), T(12, 30)] },
  { city: 'Shanghai', name: 'SSE', tz: 'Asia/Shanghai', open: T(9, 30), close: T(15), lunch: [T(11, 30), T(13)] },
  { city: 'Hong Kong', name: 'HKEX', tz: 'Asia/Hong_Kong', open: T(9, 30), close: T(16), lunch: [T(12), T(13)] },
  { city: 'Mumbai', name: 'NSE', tz: 'Asia/Kolkata', open: T(9, 15), close: T(15, 30) },
  { city: 'Dubai', name: 'DFM', tz: 'Asia/Dubai', open: T(10), close: T(15) },
  { city: 'Frankfurt', name: 'Xetra', tz: 'Europe/Berlin', open: T(9), close: T(17, 30) },
  { city: 'London', name: 'LSE', tz: 'Europe/London', open: T(8), close: T(16, 30) },
  { city: 'New York', name: 'NYSE', tz: 'America/New_York', open: T(9, 30), close: T(16) },
];

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Local weekday (0 = Sunday) and minute of day at `now` in a time zone. */
export function localTime(tz: string, now: number): { wd: number; min: number; hhmm: string } {
  let f = formatters.get(tz);
  if (!f) { f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); formatters.set(tz, f); }
  const parts = f.formatToParts(new Date(now));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const h = Number(get('hour')) % 24;
  const m = Number(get('minute'));
  return { wd: WD.indexOf(get('weekday')), min: h * 60 + m, hhmm: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` };
}

function dur(mins: number): string {
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  return d ? `${d}d ${h}h` : h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

export interface SessionStatus { state: 'open' | 'lunch' | 'closed'; local: string; day: string; note: string }

export function sessionStatus(x: Exchange, now: number): SessionStatus {
  const { wd, min, hhmm } = localTime(x.tz, now);
  const weekday = wd >= 1 && wd <= 5;
  const day = WD[wd] ?? '';
  if (weekday && min >= x.open && min < x.close) {
    if (x.lunch && min >= x.lunch[0] && min < x.lunch[1]) return { state: 'lunch', local: hhmm, day, note: `lunch, reopens in ${dur(x.lunch[1] - min)}` };
    return { state: 'open', local: hhmm, day, note: `closes in ${dur(x.close - min)}` };
  }
  // minutes until the next weekday open
  let wait = weekday && min < x.open ? x.open - min : 1440 - min + x.open;
  let d = (wd + (weekday && min < x.open ? 0 : 1)) % 7;
  while (d === 0 || d === 6) { wait += 1440; d = (d + 1) % 7; }
  return { state: 'closed', local: hhmm, day, note: `opens in ${dur(wait)}` };
}
