import { useMemo, useRef, useState } from 'react';
import { defaultConfig } from '../config/defaults';
import { clearConfig, exportConfigJson, saveConfig } from '../config/storage';
import { ROLE_LABELS, ROLE_TYPES, BOOK_IDS, type OfficeConfig, type RoleType } from '../config/types';
import { parseConfigJson, validateConfig } from '../config/validate';
import { WORKSTATIONS } from '../world/furniture';
import { roomById } from '../world/building';
import { getSim, rebuildSim } from '../store/simInstance';
import { useUI } from '../store/ui';
import { SPEEDS } from '../sim/constants';
import { setSoundEnabled } from '../audio/sound';
import { PRESETS } from '../scene/quality';

type Tab = 'simulation' | 'graphics' | 'editor' | 'about';

export function SettingsPanel({ tab: initial }: { tab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initial ?? 'simulation');
  const close = useUI((s) => s.closePanel);
  return (
    <div className="panel-wrap" onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <aside className="panel" role="dialog" aria-modal="true" aria-label="Settings" data-testid="settings-panel">
        <div className="panel-head">
          <div><h2>Settings</h2><div className="sub">Saved in this browser (localStorage)</div></div>
          <button className="btn close-btn" onClick={close} data-testid="close-panel">Close ✕</button>
        </div>
        <div className="panel-body">
          <div className="tabs">
            {(['simulation', 'graphics', 'editor', 'about'] as Tab[]).map((t) => (
              <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)} data-testid={`settings-tab-${t}`}>{t === 'editor' ? 'Office editor' : t[0].toUpperCase() + t.slice(1)}</button>
            ))}
          </div>
          {tab === 'simulation' && <SimulationTab />}
          {tab === 'graphics' && <GraphicsTab />}
          {tab === 'editor' && <OfficeEditor />}
          {tab === 'about' && <AboutTab />}
        </div>
      </aside>
    </div>
  );
}

function SimulationTab() {
  useUI((s) => s.simVersion);
  const settings = useUI((s) => s.settings);
  const update = useUI((s) => s.updateSettings);
  const sim = getSim();
  const [, force] = useState(0);
  return (
    <div>
      <div className="section">
        <h3>Clock</h3>
        <div className="row">
          <button className="btn" onClick={() => { sim.paused = !sim.paused; sim.version++; force((x) => x + 1); }}>{sim.paused ? 'Resume' : 'Pause'}</button>
          {SPEEDS.map((s) => <button key={s} className={`btn ${sim.speed === s ? 'active' : ''}`} onClick={() => { sim.speed = s; sim.version++; force((x) => x + 1); }}>{s}×</button>)}
          <button className="btn danger" onClick={() => { rebuildSim(sim.config); force((x) => x + 1); useUI.getState().showToast('Simulation reset'); }}>Reset day</button>
        </div>
        <p className="small muted">One clock drives schedules, events, markets and screens. At 1× one real second is 20 simulated seconds; walking happens at real pace multiplied by the speed.</p>
      </div>
      <div className="section">
        <h3>Display</h3>
        <label className="row"><input type="checkbox" checked={settings.labels} onChange={(e) => update({ labels: e.target.checked })} /> Employee labels</label>
        <label className="row"><input type="checkbox" checked={settings.minimap} onChange={(e) => update({ minimap: e.target.checked })} /> Minimap</label>
        <label className="row"><input type="checkbox" checked={settings.showFps} onChange={(e) => update({ showFps: e.target.checked })} data-testid="fps-toggle" /> FPS & renderer statistics</label>
        <label className="row"><input type="checkbox" checked={settings.sound} onChange={(e) => { setSoundEnabled(e.target.checked); update({ sound: e.target.checked }); }} /> Sound (synthesised; starts only after you enable it)</label>
        <div className="row" style={{ marginTop: 6 }}>
          <span>Lighting</span>
          {(['auto', 'day', 'night'] as const).map((l) => <button key={l} className={`btn small ${settings.lighting === l ? 'active' : ''}`} onClick={() => update({ lighting: l })}>{l === 'auto' ? 'Follow clock' : l}</button>)}
        </div>
      </div>
    </div>
  );
}

function GraphicsTab() {
  const settings = useUI((s) => s.settings);
  const update = useUI((s) => s.updateSettings);
  const stats = useUI((s) => s.renderStats);
  const fps = useUI((s) => s.fps);
  const desc = {
    low: 'No anti-aliasing, 1x pixel ratio, no shadows or AO, low-res monitors with a small refresh budget, smaller city.',
    medium: 'Anti-aliasing, up to 1.5x pixel ratio, no real-time shadows, medium monitor textures.',
    high: 'Up to 2x pixel ratio, sun shadows (2048 map), ambient occlusion + SMAA, high-res monitors refreshed more often.',
  } as const;
  return (
    <div>
      <div className="section">
        <h3>Graphics preset</h3>
        <div className="list">
          {(['low', 'medium', 'high'] as const).map((p) => (
            <label key={p} className="list-item" style={{ cursor: 'pointer' }}>
              <input type="radio" name="preset" checked={settings.graphics === p} onChange={() => update({ graphics: p })} data-testid={`preset-${p}`} />
              <div><b style={{ textTransform: 'capitalize' }}>{p}</b><div className="small muted">{desc[p]} Monitor canvas {PRESETS[p].monitorRes.join('×')}.</div></div>
            </label>
          ))}
        </div>
        <p className="small muted">Changing the preset rebuilds the renderer (a short reload of the 3D view). The simulation keeps running.</p>
      </div>
      <div className="section">
        <h3>Controls</h3>
        <label className="row">Mouse sensitivity <input type="range" min={0.3} max={2.5} step={0.1} value={settings.mouseSensitivity} onChange={(e) => update({ mouseSensitivity: Number(e.target.value) })} style={{ width: 160 }} /> {settings.mouseSensitivity.toFixed(1)}</label>
        <label className="row"><input type="checkbox" checked={settings.invertY} onChange={(e) => update({ invertY: e.target.checked })} /> Invert vertical look</label>
      </div>
      <div className="section">
        <h3>Measured in this browser</h3>
        <dl className="kv">
          <dt>Frame rate</dt><dd>{fps} fps (rolling 1 s)</dd>
          <dt>Draw calls</dt><dd>{stats.calls}</dd>
          <dt>Triangles</dt><dd>{stats.triangles.toLocaleString()}</dd>
          <dt>GPU textures</dt><dd>{stats.textures}</dd>
          <dt>Geometries</dt><dd>{stats.geometries}</dd>
        </dl>
      </div>
    </div>
  );
}

function download(name: string, text: string) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function OfficeEditor() {
  const sim = getSim();
  const [draft, setDraft] = useState<OfficeConfig>(() => structuredClone(sim.config));
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const deskOwner = useMemo(() => new Map(draft.employees.map((e) => [e.workstationId, e.id])), [draft]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(sim.config);

  const apply = (cfg: OfficeConfig, msg: string) => {
    const r = validateConfig(cfg);
    if (!r.ok) { setErrors(r.errors); setMessage(null); return false; }
    const saved = saveConfig(r.config);
    rebuildSim(r.config);
    setDraft(structuredClone(r.config));
    setErrors([]);
    setMessage(`${msg}${saved ? '' : ' (browser storage unavailable: changes last until reload)'}`);
    useUI.getState().bumpSim(getSim().version + 1);
    return true;
  };

  const setEmp = (id: string, patch: Partial<OfficeConfig['employees'][number]>) => {
    setDraft((d) => ({ ...d, employees: d.employees.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
    setMessage(null);
  };

  const assignDesk = (id: string, wsId: string) => {
    setDraft((d) => {
      const me = d.employees.find((e) => e.id === id)!;
      const other = d.employees.find((e) => e.workstationId === wsId && e.id !== id);
      return {
        ...d,
        employees: d.employees.map((e) => (e.id === id ? { ...e, workstationId: wsId } : other && e.id === other.id ? { ...e, workstationId: me.workstationId } : e)),
      };
    });
    const other = draft.employees.find((e) => e.workstationId === wsId && e.id !== id);
    setMessage(other ? `Desks swapped with ${other.name} (unsaved)` : null);
  };

  const onImport = async (file: File) => {
    setMessage(null);
    let text = '';
    try {
      text = await file.text();
    } catch {
      setErrors(['Could not read the file']);
      return;
    }
    const r = parseConfigJson(text);
    if (!r.ok) {
      setErrors([`Import rejected: the previous configuration is unchanged.`, ...r.errors.slice(0, 25), ...(r.errors.length > 25 ? [`…and ${r.errors.length - 25} more`] : [])]);
      return;
    }
    apply(r.config, `Imported ${r.config.employees.length} employees from ${file.name}; saved and applied (the simulated day restarted).`);
  };

  const rows = draft.employees.filter((e) => `${e.name} ${e.title} ${e.department} ${e.roleType}`.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div data-testid="office-editor">
      <p className="small muted">These are editable placeholders for your own team. Names and roles here are fictional; replace them with your team. Saving restarts the simulated day so schedules, apps and events follow the new roles.</p>
      <div className="section">
        <h3>Company display name</h3>
        <input type="text" value={draft.companyName} maxLength={40} onChange={(e) => { setDraft({ ...draft, companyName: e.target.value }); setMessage(null); }} data-testid="company-name" aria-label="Company display name" />
      </div>
      <div className="section">
        <div className="row" style={{ marginBottom: 6 }}>
          <h3 style={{ margin: 0 }}>Employees ({draft.employees.length})</h3>
          <span className="spacer" />
          <input type="search" placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 160 }} aria-label="Filter employees" />
        </div>
        <div style={{ maxHeight: '44vh', overflow: 'auto' }}>
          <table className="editor-table">
            <thead><tr><th>Name</th><th>Role title</th><th>Role type</th><th>Department</th><th>Book</th><th>Desk</th></tr></thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td><input type="text" value={e.name} onChange={(ev) => setEmp(e.id, { name: ev.target.value })} aria-label={`Name of ${e.id}`} data-testid={`edit-name-${e.id}`} /></td>
                  <td><input type="text" value={e.title} onChange={(ev) => setEmp(e.id, { title: ev.target.value })} aria-label={`Role title of ${e.id}`} /></td>
                  <td>
                    <select value={e.roleType} onChange={(ev) => setEmp(e.id, { roleType: ev.target.value as RoleType })} aria-label={`Role type of ${e.id}`}>
                      {ROLE_TYPES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                    </select>
                  </td>
                  <td><input type="text" value={e.department} onChange={(ev) => setEmp(e.id, { department: ev.target.value })} aria-label={`Department of ${e.id}`} /></td>
                  <td>
                    <select value={e.bookId ?? ''} onChange={(ev) => setEmp(e.id, { bookId: (ev.target.value || undefined) as never })} aria-label={`Book of ${e.id}`} disabled={e.roleType !== 'trader' && e.roleType !== 'pm'}>
                      <option value="">—</option>
                      {BOOK_IDS.map((b) => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </td>
                  <td>
                    <select value={e.workstationId} onChange={(ev) => assignDesk(e.id, ev.target.value)} aria-label={`Desk of ${e.id}`} data-testid={`edit-desk-${e.id}`}>
                      {WORKSTATIONS.map((w) => {
                        const owner = deskOwner.get(w.id);
                        const ownerName = owner && owner !== e.id ? draft.employees.find((x) => x.id === owner)?.name : null;
                        return <option key={w.id} value={w.id}>{w.label} · {roomById(w.roomId)?.name}{ownerName ? ` (swap with ${ownerName})` : owner === e.id ? '' : ' (available)'}</option>;
                      })}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {errors.length > 0 && (
        <div className="error-box" data-testid="config-errors" role="alert">
          {errors.map((er, i) => <div key={i}>{er}</div>)}
        </div>
      )}
      {message && <div className="ok-box" data-testid="config-message" role="status">{message}</div>}
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn primary" disabled={!dirty} onClick={() => apply(draft, 'Saved locally and applied; the simulated day restarted.')} data-testid="save-config">Save & apply</button>
        <button className="btn" onClick={() => { setDraft(structuredClone(sim.config)); setErrors([]); setMessage('Unsaved edits discarded'); }} disabled={!dirty}>Discard edits</button>
        <button className="btn" onClick={() => download(`${sim.config.companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'office'}-config.json`, exportConfigJson(sim.config))} data-testid="export-config">Export JSON</button>
        <button className="btn" onClick={() => fileRef.current?.click()} data-testid="import-config">Import JSON</button>
        <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} data-testid="import-file" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onImport(f); e.target.value = ''; }} />
        <span className="spacer" />
        <button className="btn danger" data-testid="restore-defaults" onClick={() => { if (window.confirm('Restore the default ASTRA configuration? Your saved edits in this browser will be replaced.')) { clearConfig(); apply(defaultConfig(), 'Defaults restored.'); } }}>Restore defaults</button>
      </div>
    </div>
  );
}

function AboutTab() {
  return (
    <div className="small" style={{ lineHeight: 1.6 }}>
      <div className="section">
        <h3>What this is</h3>
        <p>ASTRA Headquarters is a local <b>Office Simulation</b>. All people are fictional placeholders and all financial figures are <b>Simulated Data</b> produced by a seeded model in your browser. There is no backend, no real trading, no market data feed and no monitoring of real employees.</p>
        <p>The design is an original office inspired by the financial industry; it is not a replica of any real firm.</p>
      </div>
      <div className="section">
        <h3>Assets & licences</h3>
        <p>All geometry, textures, people, screens and sounds are generated procedurally at runtime by this project's code; no third-party art, model or audio files are bundled. Open-source libraries: React (MIT), three.js (MIT), @react-three/fiber, drei and postprocessing (MIT), postprocessing (Zlib), N8AO (CC0), zustand (MIT). See ATTRIBUTION.md.</p>
      </div>
      <div className="section">
        <h3>Storage</h3>
        <p>Settings and your office configuration are stored in this browser's localStorage only. Export the configuration to keep a copy.</p>
      </div>
    </div>
  );
}
