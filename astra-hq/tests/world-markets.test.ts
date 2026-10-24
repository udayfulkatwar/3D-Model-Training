import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/config/defaults';
import { EXCHANGES, sessionStatus } from '../src/apps/worldMarkets';
import { buildPanelView } from '../src/apps/views';
import { Simulation } from '../src/sim/simulation';
import { PANELS } from '../src/world/furniture';

const ny = EXCHANGES.find((x) => x.city === 'New York')!;
const tokyo = EXCHANGES.find((x) => x.city === 'Tokyo')!;

describe('world market clocks', () => {
  it('knows when exchanges are open, at lunch or closed (time zones and weekends)', () => {
    // Wednesday 2026-10-21 14:00 UTC = 10:00 in New York (EDT), 23:00 in Tokyo
    const t = Date.UTC(2026, 9, 21, 14, 0);
    expect(sessionStatus(ny, t)).toMatchObject({ state: 'open', local: '10:00', note: 'closes in 6h 00m' });
    expect(sessionStatus(tokyo, t)).toMatchObject({ state: 'closed', local: '23:00', note: 'opens in 10h 00m' });
    // Tokyo lunch: 03:00 UTC = 12:00 JST
    expect(sessionStatus(tokyo, Date.UTC(2026, 9, 21, 3, 0)).state).toBe('lunch');
    // Saturday: closed, opens Monday
    const sat = sessionStatus(ny, Date.UTC(2026, 9, 24, 16, 0));
    expect(sat.state).toBe('closed');
    expect(sat.note).toMatch(/opens in 1d/);
    // after DST ends in the US (8 Nov 2026), 14:30 UTC is 09:30 EST: open
    expect(sessionStatus(ny, Date.UTC(2026, 10, 9, 14, 30)).state).toBe('open');
  });

  it('puts a world markets screen in every room where people follow markets', () => {
    const rooms = new Set(PANELS.filter((p) => p.kind === 'worldMarkets').map((p) => p.roomId));
    for (const r of ['g-lobby', 'g-cafe', 'f-trading', 'f-research', 'f-risk', 'f-conf', 's-board', 's-ceo', 's-pm', 's-lounge']) expect(rooms).toContain(r);
    const sim = new Simulation(defaultConfig());
    const v = buildPanelView(sim, 'p-world-trading', 'ASTRA');
    expect(v.widgets.map((w) => w.type)).toEqual(['table', 'table', 'text']);
    expect((v.widgets[0] as { rows: string[][] }).rows.length).toBe(EXCHANGES.length);
  });
});
