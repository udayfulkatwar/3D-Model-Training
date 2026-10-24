import { useEffect, useRef, useState } from 'react';
import { FLOOR_NAMES, FLOOR_SHORT } from '../world/building';
import { fmtTime } from '../util/math';
import { getSim } from '../store/simInstance';
import { useUI } from '../store/ui';
import { ACTIVITIES, ACTIVITY_COLOR, ACTIVITY_LABEL } from '../sim/simulation';
import { setSoundEnabled, playSound } from '../audio/sound';
import { enterWalk } from '../scene/CameraController';
import { Minimap } from './Minimap';
import { connectLive } from '../live/feed';
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
  const bar = useRef<HTMLDivElement>(null);
  // the top bar wraps on narrow screens; keep the side docks below it
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--dock-top', `${Math.round(el.getBoundingClientRect().bottom + 8)}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="topbar" ref={bar}>
      <div className="brand">
        <Logo />
        <div>
          <div className="brand-name">{sim.config.companyName.toUpperCase()}</div>
          <div className="brand-sub">Headquarters · {sim.realMode ? 'Live office' : 'Office Simulation'}</div>
        </div>
      </div>
      <div className="bar-group" aria-label="Simulation clock">
        <div>
          <div className="clock" data-testid="sim-clock">{fmtTime(sim.minute)}</div>
          <div className="clock-sub">{sim.realMode ? new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) : `Day ${sim.day + 1}${sim.paused ? ' · paused' : ''}`}</div>
        </div>
<span className="small muted" title="The office runs on your real clock, 24/7">Real time · 24/7</span>
      </div>
      <LiveChip />
      <div className="bar-group secondary">
        <button className={`btn small ${mode === 'walk' || mode === 'seated' ? 'active' : ''}`} onClick={() => enterWalk(document.querySelector('canvas'), false)} title="First-person walkthrough">Walk</button>
        <button className={`btn small ${mode === 'overview' ? 'active' : ''}`} onClick={() => showOverview()} title="Building overview">Overview</button>
        <button className="btn small" onClick={() => open({ kind: 'directory' })} title="Employee directory (F)">Directory</button>
        <button className="btn small" onClick={() => open({ kind: 'navigation' })} title="Floors and rooms (N)">Rooms</button>
        <button className="btn small" onClick={returnToReception} title="Return to reception">Reception</button>
        <HudToggle />
        <button className="btn small primary" onClick={() => open({ kind: 'owner' })} title="Owner: call meetings, call people, messages (O)" data-testid="open-owner">Owner</button>
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
  const hidden = useUI((s) => s.hudHidden);
  if (hidden) return null;
  return <LeftDockInner />;
}

function LeftDockInner() {
  useUI((s) => s.simVersion);
  const mode = useUI((s) => s.mode);
  const overviewFloor = useUI((s) => s.overviewFloor);
  const playerFloor = useUI((s) => s.playerFloor);
  const playerRoom = useUI((s) => s.playerRoom);
  const followId = useUI((s) => s.followId);
  const inspect = useUI((s) => s.inspect);
  const sim = getSim();
  const followed = mode === 'follow' && followId ? sim.byId.get(followId) : undefined;
  return (
    <div className="left-dock">
      {followed && (
        <div className="card" data-testid="follow-card">
          <h3>Following</h3>
          <div style={{ fontWeight: 600 }}>{followed.cfg.name}</div>
          <div className="small" style={{ color: ACTIVITY_COLOR[followed.activity] }}>● {ACTIVITY_LABEL[followed.activity]}</div>
          <div className="small muted" style={{ marginTop: 4 }}>{followed.task}</div>
          <div className="small muted">{FLOOR_NAMES[Math.max(0, Math.min(2, Math.floor((followed.y + 0.3) / 4)))]} · {sim.roomName(followed)}</div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn small" onClick={() => useUI.getState().openPanel({ kind: 'employee', id: followed.cfg.id })}>Profile</button>
            <button className="btn small" onClick={() => { useUI.getState().follow(null); showOverview(); }}>Stop following</button>
          </div>
        </div>
      )}
      {mode === 'inspect' && inspect && (
        <div className="card">
          <h3>Orbit inspection</h3>
          <div style={{ fontWeight: 600 }}>{inspect.label}</div>
          <div className="small muted">Drag to orbit · scroll to zoom</div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn small" onClick={() => enterWalk(document.querySelector('canvas'), false)}>Back to walkthrough</button>
            <button className="btn small" onClick={() => showOverview()}>Overview</button>
          </div>
        </div>
      )}
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
  const hidden = useUI((s) => s.hudHidden);
  if (hidden) return null;
  return <RightDockInner />;
}

function RightDockInner() {
  useUI((s) => s.simVersion);
  const minimap = useUI((s) => s.settings.minimap);
  const sim = getSim();
  const occ = sim.floorOccupancy();
  const counts = sim.activityCounts();
  return (
    <div className="right-dock">
      {minimap && <Minimap />}
      <div className="card stats-card" data-testid="occupancy">
        <h3>Occupancy · in building {occ[0] + occ[1] + occ[2]}/{sim.employees.length}</h3>
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
  const simVersion = useUI((s) => s.simVersion);
  const lastMsg = useRef(getSim().ownerMessages[0]?.id ?? 0);
  useEffect(() => {
    const m = getSim().ownerMessages[0];
    const ui = useUI.getState();
    if (m && m.id > lastMsg.current) {
      // the reply is already visible in an open talk window for that person
      if (!(ui.panel?.kind === 'talk' && ui.panel.id === m.empId)) ui.showToast(`${m.name}: ${m.text}`);
      lastMsg.current = m.id;
    }
  }, [simVersion]);
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
      <div className="disclaimer">{getSim().realMode ? `Live office · AI staff · ${getSim().live ? 'live prices (Co-Invest), paper trading only' : 'waiting for live prices'}` : 'Office Simulation · fictional people · Simulated Data'}</div>
    </>
  );
}

export function IntroOverlay() {
  const mode = useUI((s) => s.mode);
  const sim = getSim();
  if (mode !== 'intro') return null;
  return (
    <div className="overlay" data-testid="intro">
      <div className="overlay-card">
        {sim.realMode
          ? <div className="row"><span className="chip sim-chip">LIVE OFFICE</span><span className="chip">Real time · live prices · paper trading</span></div>
          : <div className="row"><span className="chip sim-chip">OFFICE SIMULATION</span><span className="chip">Simulated Data</span></div>}
        <h1>{sim.config.companyName.toUpperCase()} Headquarters</h1>
        {sim.realMode
          ? <p>Your firm, running now in real time, 24/7. Thirty AI staff (editable, not real people) take tasks from their seniors, test trading strategies on real Co-Invest price history, check risk, allocate paper capital and report to the CEO, who reports to you. Prices are live; every trade is paper; nothing is replayed or sped up.</p>
          : <p>An interactive, frontend-only office simulation inspired by a premium investment firm. Thirty fictional, editable employees work, meet and take breaks across three floors; every screen shows simulated applications driven by one shared, seeded model. Nothing here is real trading data or real people.</p>}
        <div className="keys">
          <kbd>W A S D</kbd><span>Move (hold <kbd>Shift</kbd> to walk faster)</span>
          <kbd>Mouse</kbd><span>Look around</span>
          <kbd>E</kbd><span>Interact: doors, monitors, chairs, coffee, elevator</span>
          <kbd>Esc</kbd><span>Release the cursor</span>
          <kbd>F</kbd><span>Employee directory · <kbd>N</kbd> rooms · <kbd>M</kbd> overview · <kbd>O</kbd> owner</span>
          <kbd>O</kbd><span>Owner tools: call meetings, call anyone to you, talk to anyone</span>
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
      if (ui.panel && !ui.panelMin) return;
      switch (e.code) {
        case 'KeyF': ui.openPanel({ kind: 'directory' }); e.preventDefault(); break;
        case 'KeyN': ui.openPanel({ kind: 'navigation' }); break;
        case 'KeyM': if (ui.mode === 'overview') enterWalk(document.querySelector('canvas'), false); else showOverview(); break;
        case 'KeyL': ui.updateSettings({ labels: !ui.settings.labels }); break;
        case 'KeyH': ui.toggleHud(); break;
        case 'KeyO': ui.openPanel({ kind: 'owner' }); break;
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

/** Live data status: green when Co-Invest prices are flowing; explains how to fix it otherwise. */
function LiveChip() {
  const live = useUI((s) => s.live);
  useUI((s) => s.simVersion);
  const color = live.state === 'live' ? 'var(--pos)' : live.state === 'stale' || live.state === 'connecting' ? 'var(--warn)' : live.state === 'off' ? 'var(--muted)' : 'var(--neg)';
  const label = live.state === 'live' ? 'LIVE PRICES' : live.state === 'connecting' ? 'CONNECTING' : live.state === 'stale' ? 'PRICES STALE' : live.state === 'off' ? 'SIMULATED' : 'LIVE DATA OFF';
  const age = live.updatedAt ? Math.max(0, Math.round((Date.now() - live.updatedAt) / 1000)) : null;
  return (
    <div className="bar-group" data-testid="live-chip" title={live.message}>
      <span className="chip" style={{ borderColor: color, color }}>● {label}{age !== null && live.state !== 'off' ? ` · ${age}s` : ''}</span>
      {live.state === 'needs-approval' && <button className="btn small" data-testid="live-allow" onClick={() => void connectLive(getSim, (s) => useUI.getState().setLive(s))}>Allow live prices</button>}
    </div>
  );
}

/** Hide or show the side cards for a clear view of the office (also the H key). */
function HudToggle() {
  const hidden = useUI((s) => s.hudHidden);
  const toggle = useUI((s) => s.toggleHud);
  return <button className={`btn small ${hidden ? 'active' : ''}`} onClick={toggle} title="Hide or show the side panels (H)" data-testid="toggle-hud">{hidden ? 'Show panels' : 'Hide panels'}</button>;
}
