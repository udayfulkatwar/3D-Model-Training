import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/config/defaults';
import { parseConfigJson, validateConfig, MAX_IMPORT_BYTES } from '../src/config/validate';
import { Simulation } from '../src/sim/simulation';

describe('configuration validation', () => {
  it('accepts the default configuration', () => {
    const r = validateConfig(defaultConfig());
    expect(r.ok).toBe(true);
  });

  it('round-trips through JSON export/import', () => {
    const c = defaultConfig();
    c.companyName = 'Orion Capital';
    c.employees[4].name = 'Renamed Person';
    const r = parseConfigJson(JSON.stringify(c, null, 2));
    expect(r.ok && r.config.companyName).toBe('Orion Capital');
    expect(r.ok && r.config.employees[4].name).toBe('Renamed Person');
  });

  it('rejects malformed JSON without throwing', () => {
    const r = parseConfigJson('{ "schemaVersion": 1, ');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/Not valid JSON/);
  });

  it('rejects oversized files', () => {
    const r = parseConfigJson(' '.repeat(MAX_IMPORT_BYTES + 1));
    expect(r.ok).toBe(false);
  });

  it('reports useful errors for invalid fields', () => {
    const c = defaultConfig() as unknown as Record<string, unknown> & { employees: Record<string, unknown>[] };
    c.employees[1].workstationId = c.employees[0].workstationId; // duplicate desk
    c.employees[2].roleType = 'wizard';
    c.employees[3].id = c.employees[0].id; // duplicate id
    c.employees[4].name = '';
    (c.employees[5].appearance as Record<string, unknown>).skin = 'red';
    c.employees[6].workstationId = 'ws-nowhere';
    c.companyName = '';
    const r = validateConfig(c);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const all = r.errors.join('\n');
      expect(all).toMatch(/employees\[1\]\.workstationId "ws-reception" is already assigned/);
      expect(all).toMatch(/employees\[2\]\.roleType must be one of/);
      expect(all).toMatch(/employees\[3\]\.id "e01" is duplicated/);
      expect(all).toMatch(/employees\[4\]\.name must be 1-60 characters/);
      expect(all).toMatch(/employees\[5\]\.appearance\.skin must be a #rrggbb colour/);
      expect(all).toMatch(/employees\[6\]\.workstationId "ws-nowhere" is not a known workstation/);
      expect(all).toMatch(/companyName/);
    }
  });

  it('rejects wrong top-level shapes', () => {
    expect(validateConfig(null).ok).toBe(false);
    expect(validateConfig([]).ok).toBe(false);
    expect(validateConfig({ schemaVersion: 2, companyName: 'X', employees: [] }).ok).toBe(false);
    expect(validateConfig({ schemaVersion: 1, companyName: 'X', employees: 'nope' }).ok).toBe(false);
  });

  it('applies role, desk and name edits to the simulation', () => {
    const c = defaultConfig();
    // swap a trader onto a flex desk and make a researcher a trader
    c.employees[2].workstationId = 'ws-flex-01';
    c.employees[11].roleType = 'trader';
    c.employees[11].bookId = 'macro';
    c.employees[0].name = 'Front Desk Lead';
    const r = validateConfig(c);
    expect(r.ok).toBe(true);
    const sim = new Simulation(r.ok ? r.config : c);
    const moved = sim.byId.get(c.employees[2].id)!;
    expect(moved.ws.id).toBe('ws-flex-01');
    expect(sim.monitorState('ws-flex-01-m1')!.appId).toBe('trade-chart');
    expect(sim.monitorState('ws-trade-02-m1')!.appId).toBe('flex-idle');
    const promoted = sim.byId.get(c.employees[11].id)!;
    expect(sim.monitorState(promoted.ws.monitors[0].id)!.appId).toBe('trade-chart');
    expect(sim.finance.traders.has(promoted.cfg.id)).toBe(true);
    expect(sim.byId.get('e01')!.cfg.name).toBe('Front Desk Lead');
    expect(sim.validate()).toEqual([]);
  });
});
