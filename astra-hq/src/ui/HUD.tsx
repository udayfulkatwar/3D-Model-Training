import { useEffect, useState } from 'react';
import { FLOOR_NAMES, FLOOR_SHORT } from '../world/building';
import { fmtTime } from '../util/math';
import { getSim, rebuildSim } from '../store/simInstance';
import { useUI } from '../store/ui';
import { ACTIVITIES, ACTIVITY_COLOR, ACTIVITY_LABEL } from '../sim/simulation';
import { SPEEDS } from '../sim/constants';
import { setSoundEnabled, playSound } from '../audio/sound';
import { enterWalk } from '../scene/CameraController';
import { Minimap } from './Minimap';
import { returnToReception, showOverview } from './actions';

function Logo() {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden>
      <path d="M16 4 L28 28 H22.5 L16 14.5 L9.5 28 H4 Z" fill="#d0ab62" />
    </svg>
  );
}

export function TopBar() {
  useUI((s) => s.simVersion);
  const settings = useUI((s) => s.settings);
  const update = useUI((s) => s.updateSettings);
  const open = useUI((s) => s.openPanel);
  const mode = useUI((s) => s.mode);
  const sim = getSim();
  const [, force] = useState(0);
  const rerender = () => force((x) => x + 1);
  return (
    <div className="topbar">
      <div className="brand">
        <Logo />
        <div>
          <div className="brand-name">{sim.config.companyName.toUpperCase()}</div>
          <div className="brand-sub">Headquarters · Office Simulation</div>
        </div>
      </div>
      <div className="bar-group" aria-label="Simulation clock">
        <div>
          <div className="clock" data-testid="sim-clock">{fmtTime(sim.minute)}</div>
          <div className="clock-sub">Day {sim.day + 1}{sim.paused ? ' · paused' : ''}</div>
        </div>
        <button className={`icon-btn ${sim.paused ? 'active' : ''}`} title={sim.paused ? 'Resume simulation (P)' : 'Pause simulation (P)'} aria-label={sim.paused ? 'Resume' : 'Pause'} data-testid="pause" onClick={() => { sim.paused = !sim.paused; sim.version++; rerender(); }}>
          {sim.paused ? '▶' : '❚❚'}
        </button>
        {SPEEDS.map((s) => (
          <button key={s} className={`btn small ${sim.speed === s ? 'active' : ''}`} data-testid={`speed-${s}`} onClick={() => { sim.speed = s; sim.version++; rerender(); }} title={`Simulation speed ${s}x`}>{s}×</button>
        ))}
        <button className="btn small" data-testid="reset" title="Restart the simulated day" onClick={() => { if (window.confirm('Restart the simulated day? Employee positions, markets and events reset (your office configuration is kept).')) { rebuildSim(sim.config); rerender(); useUI.getState().showToast('Simulation reset'); } }}>Reset</button>
      </div>
      <div className="bar-group secondary">
        <button className={`btn small ${mode === 'walk' || mode === 'seated' ? 'active' : ''}`} onClick={() => enterWalk(document.querySelector('canvas'), false)} title="First-person walkthrough">Walk</button>
        <button className={`btn small ${mode === 'overview' ? 'active' : ''}`} onClick={() => showOverview()} title="Building overview">Overview</button>
        <button className="btn small" onClick={() => open({ kind: 'directory' })} title="Employee directory (F)">Directory</button>
        <button className="btn small" onClick={() => open({ kind: 'navigation' })} title="Floors and rooms (N)">Rooms</button>
        <button className="btn small" onClick={returnToReception} title="Return to reception">Reception</button>
      </div>
      <span className="spacer" />
      <div className="bar-group">
        <select aria-label="Lighting" value={settings.lighting} onChange={(e) => update({ lighting: e.target.value as typeof settings.lighting })} style={{ width: 92 }}>
          <option value="auto">Auto light</option>
          <option value="day">Day</option>
          <option value="night">Night</option>
        </select>
        <button className={`icon-btn ${settings.sound ? 'active' : ''}`} title="Sound" aria-label="Toggle sound" onClick={() => { const on = !settings.sound; setSoundEnabled(on); update({ sound: on }); if (on) playSound('ui'); }}>{settings.sound ? '🔊' : '🔈'}</button>
        <button className={`icon-btn ${settings.labels ? 'active' : ''}`} title="Employee labels (L)" aria-label="Toggle labels" onClick={() => update({ labels: !settings.labels })}>Aa</button>
        <button className="icon-btn" title="Settings & office editor" aria-label="Settings" data-testid="open-settings" onClick={() => open({ kind: 'settings' })}>⚙</button>
        <button className="icon-btn" title="Help & controls (H)" aria-label="Help" onClick={() => open({ kind: 'help' })}>?</button>
      </div>
    </div>
  );
}

export function LeftDock() {
  useUI((s) => s.simVersion);
  const mode = useUI((s) => s.mode);
  const overviewFloor = useUI((s) => s.overviewFloor);
  const playerFloor = useUI((s) => s.playerFloor);
  const playerRoom = useUI((s) => s.playerRoom);
  const sim = getSim();
  return (
    <div className="left-dock">
      <div className="card">
        <h3>Location</h3>
        <div style={{ fontWeight: 600 }}>{mode === 'overview' ? (overviewFloor >= 3 ? 'Building overview' : `${FLOOR_NAMES[overviewFloor]} (cutaway)`) : playerRoom}</div>
        <div className="small muted">{mode === 'overview' ? 'Drag to orbit · scroll to zoom' : FLOOR_NAMES[playerFloor]}</div>
        <div className="floor-buttons" style={{ marginTop: 8 }}>
          {[0, 1, 2].map((f) => (
            <button key={f} className={`btn small ${mode === 'overview' && overviewFloor === f ? 'active' : ''}`} onClick={() => showOverview(f)} title={`Cutaway of the ${FLOOR_NAMES[f]}`}>{FLOOR_SHORT[f]}</button>
          ))}
          <button className={`btn small ${mode === 'overview' && overviewFloor >= 3 ? 'active' : ''}`} onClick={() => showOverview(3)} title="Whole building">All</button>
        </div>
      </div>
      <div className="card feed-card">
        <h3>Office activity</h3>
        <div className="feed" data-testid="feed">
          {sim.log.slice(0, 12).map((l, i) => (
            <div key={i} className="feed-item"><span className="t">{fmtTime(l.t)}</span>{l.text}</div>
          ))}
        </div>
        <button className="btn small" style={{ marginTop: 6 }} onClick={() => useUI.getState().openPanel({ kind: 'log' })}>Full log</button>
      </div>
    </div>
  );
}

export function RightDock() {
  useUI((s) => s.simVersion);
  const minimap = useUI((s) => s.settings.minimap);
  const sim = getSim();
  const occ = sim.floorOccupancy();
  const counts = sim.activityCounts();
  return (
    <div className="right-dock">
      {minimap && <Minimap />}
      <div className="card stats-card" data-testid="occupancy">
        <h3>Occupancy</h3>
        {[2, 1, 0].map((f) => (
          <div className="stat-row" key={f}><span>{FLOOR_NAMES[f]}</span><span>{occ[f]}</span></div>
        ))}
        <h3 style={{ marginTop: 8 }}>Activities</h3>
        {ACTIVITIES.filter((a) => counts[a] > 0).map((a) => (
          <div className="stat-row" key={a}><span><span className="dot" style={{ background: ACTIVITY_COLOR[a] }} /> {ACTIVITY_LABEL[a]}</span><span>{counts[a]}</span></div>
        ))}
      </div>
    </div>
  );
}

export function CenterOverlays() {
  const mode = useUI((s) => s.mode);
  const prompt = useUI((s) => s.prompt);
  const toast = useUI((s) => s.toast);
  const fade = useUI((s) => s.fade);
  const fps = useUI((s) => s.fps);
  const stats = useUI((s) => s.renderStats);
  const showFps = useUI((s) => s.settings.showFps);
  const [toastVisible, setToastVisible] = useState(false);
  useEffect(() => {
    if (!toast) return;
    setToastVisible(true);
    const id = window.setTimeout(() => setToastVisible(false), 2600);
    return () => window.clearTimeout(id);
  }, [toast]);
  const walkish = mode === 'walk' || mode === 'seated';
  return (
    <>
      {walkish && <div className="crosshair" />}
      {prompt && (walkish ? <div className="prompt" data-testid="prompt">{prompt}</div> : <div className="hover-tip">{prompt}</div>)}
      {toastVisible && toast && <div className="toast" key={toast.id} data-testid="toast">{toast.text}</div>}
      {fade > 0 && <div className="fade" style={{ opacity: fade }} />}
      {showFps && <div className="fps" data-testid="fps">{fps} fps · {stats.calls} draw calls · {(stats.triangles / 1000).toFixed(0)}k tris · {stats.textures} textures</div>}
      <div className="disclaimer">Office Simulation · fictional people · Simulated Data</div>
    </>
  );
}

export function ResumeOverlay() {
  const mode = useUI((s) => s.mode);
  const locked = useUI((s) => s.pointerLocked);
  const panel = useUI((s) => s.panel);
  const touch = useUI((s) => s.touch);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => { if (locked) setDismissed(false); }, [locked]);
  if (mode !== 'walk' || locked || panel || touch || dismissed) return null;
  return (
    <div className="resume" data-testid="resume">
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Walkthrough paused</div>
      <div className="small muted" style={{ marginBottom: 10 }}>Click to look around with the mouse. <kbd>Esc</kbd> releases the cursor.</div>
      <div className="row" style={{ justifyContent: 'center' }}>
        <button className="btn primary" onClick={() => enterWalk(document.querySelector('canvas'), false)}>Resume walkthrough</button>
        <button className="btn" onClick={() => setDismissed(true)} title="Look around by dragging with the left mouse button">Drag to look</button>
        <button className="btn" onClick={() => showOverview()}>Overview</button>
      </div>
    </div>
  );
}

export function IntroOverlay() {
  const mode = useUI((s) => s.mode);
  const sim = getSim();
  if (mode !== 'intro') return null;
  return (
    <div className="overlay" data-testid="intro">
      <div className="overlay-card">
        <div className="row"><span className="chip sim-chip">OFFICE SIMULATION</span><span className="chip">Simulated Data</span></div>
        <h1>{sim.config.companyName.toUpperCase()} Headquarters</h1>
        <p>An interactive, frontend-only office simulation inspired by a premium investment firm. Thirty fictional, editable employees work, meet and take breaks across three floors; every screen shows simulated applications driven by one shared, seeded model. Nothing here is real trading data or real people.</p>
        <div className="keys">
          <kbd>W A S D</kbd><span>Move (hold <kbd>Shift</kbd> to walk faster)</span>
          <kbd>Mouse</kbd><span>Look around</span>
          <kbd>E</kbd><span>Interact: doors, monitors, chairs, coffee, elevator</span>
          <kbd>Esc</kbd><span>Release the cursor</span>
          <kbd>F</kbd><span>Employee directory · <kbd>N</kbd> rooms · <kbd>M</kbd> overview · <kbd>P</kbd> pause</span>
        </div>
        <div className="row">
          <button className="btn primary" data-testid="enter-office" onClick={() => { const s = useUI.getState(); if (s.settings.sound) setSoundEnabled(true); enterWalk(document.querySelector('canvas'), true); }}>Enter Office</button>
          <button className="btn" onClick={() => showOverview(3)}>Building overview</button>
          <button className="btn" onClick={() => useUI.getState().openPanel({ kind: 'directory' })}>Employee directory</button>
        </div>
      </div>
    </div>
  );
}

/** Global keyboard shortcuts (ignored while typing in inputs). */
export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = document.activeElement as HTMLElement | null;
      if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT')) return;
      const ui = useUI.getState();
      if (e.code === 'Escape' && ui.panel) { ui.closePanel(); return; }
      if (ui.panel) return;
      const sim = getSim();
      switch (e.code) {
        case 'KeyP': sim.paused = !sim.paused; sim.version++; break;
        case 'KeyF': ui.openPanel({ kind: 'directory' }); e.preventDefault(); break;
        case 'KeyN': ui.openPanel({ kind: 'navigation' }); break;
        case 'KeyM': if (ui.mode === 'overview') enterWalk(document.querySelector('canvas'), false); else showOverview(); break;
        case 'KeyL': ui.updateSettings({ labels: !ui.settings.labels }); break;
        case 'KeyH': ui.openPanel({ kind: 'help' }); break;
        case 'Digit1': if (ui.mode === 'overview') ui.setOverviewFloor(0); break;
        case 'Digit2': if (ui.mode === 'overview') ui.setOverviewFloor(1); break;
        case 'Digit3': if (ui.mode === 'overview') ui.setOverviewFloor(2); break;
        case 'Digit4': if (ui.mode === 'overview') ui.setOverviewFloor(3); break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
