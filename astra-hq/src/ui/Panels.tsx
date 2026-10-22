import { useEffect, useMemo, useState } from 'react';
import { FLOOR_NAMES, ROOMS, roomById } from '../world/building';
import { MONITOR_INDEX, PANELS, WS_INDEX } from '../world/furniture';
import { fmtTime } from '../util/math';
import { getSim } from '../store/simInstance';
import { useUI, type Panel } from '../store/ui';
import { ACTIVITY_COLOR, ACTIVITY_LABEL } from '../sim/simulation';
import { APPS } from '../sim/apps';
import { buildAppView, buildPanelView } from '../apps/views';
import { HtmlApp } from '../apps/HtmlApp';
import { forceRedraw, lastDrawn } from '../scene/Screens';
import { playSound } from '../audio/sound';
import { followEmployee, goToDesk, goToEmployee, goToRoom, inspectMonitors, inspectWorkstation, returnToReception, showOverview } from './actions';
import { SettingsPanel } from './Settings';

function Shell({ title, sub, children, foot, narrow, testId }: { title: React.ReactNode; sub?: React.ReactNode; children: React.ReactNode; foot?: React.ReactNode; narrow?: boolean; testId?: string }) {
  const close = useUI((s) => s.closePanel);
  return (
    <div className="panel-wrap" onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <aside className={`panel ${narrow ? 'narrow' : ''}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} data-testid={testId}>
        <div className="panel-head">
          <div>
            <h2>{title}</h2>
            {sub && <div className="sub">{sub}</div>}
          </div>
          <button className="btn close-btn" onClick={close} data-testid="close-panel" aria-label="Close panel">Close ✕</button>
        </div>
        <div className="panel-body">{children}</div>
        {foot && <div className="panel-foot">{foot}</div>}
      </aside>
    </div>
  );
}

export function PanelHost() {
  const panel = useUI((s) => s.panel);
  if (!panel) return null;
  return <PanelSwitch panel={panel} />;
}

function PanelSwitch({ panel }: { panel: Panel }) {
  switch (panel.kind) {
    case 'employee': return <EmployeePanel id={panel.id} />;
    case 'monitor': return <MonitorPanel monitorId={panel.monitorId} />;
    case 'wall': return <WallPanelView panelId={panel.panelId} />;
    case 'directory': return <DirectoryPanel />;
    case 'navigation': return <NavigationPanel />;
    case 'settings': return <SettingsPanel tab={panel.tab} />;
    case 'elevator': return <ElevatorPanel />;
    case 'coffee': return <CoffeePanel where={panel.where} drink={panel.drink} />;
    case 'help': return <HelpPanel />;
    case 'log': return <LogPanel />;
  }
}

function EmployeePanel({ id }: { id: string }) {
  useUI((s) => s.simVersion);
  const sim = getSim();
  const e = sim.byId.get(id);
  const [tab, setTab] = useState<'now' | 'schedule' | 'history'>('now');
  if (!e) return <Shell title="Employee not found"><p>This employee no longer exists in the configuration.</p></Shell>;
  const floor = Math.max(0, Math.min(2, Math.floor((e.y + 0.3) / 4)));
  const events = sim.events.filter((ev) => ev.attendeeIds.includes(id));
  const schedule = [
    ...events.map((ev) => ({ start: ev.start, end: ev.end, text: ev.title, where: roomById(ev.roomId)?.name ?? '', status: ev.status })),
    ...e.schedule.map((b) => ({ start: b.start, end: b.end, text: b.kind === 'lunch' ? 'Lunch' : b.kind === 'coffee' ? 'Coffee break' : `Discussion with ${sim.name(b.withId ?? '')}`, where: b.kind === 'discuss' ? roomById(sim.byId.get(b.withId ?? '')?.ws.roomId ?? '')?.name ?? '' : b.where === 'lounge' ? 'Staff Lounge' : 'Café', status: sim.minute >= b.end ? 'completed' : sim.minute >= b.start ? 'in-progress' : 'scheduled' })),
  ].sort((a, b) => a.start - b.start);
  return (
    <Shell
      testId="employee-panel"
      title={e.cfg.name}
      sub={<>{e.cfg.title} · {e.cfg.department} · <span className="muted">fictional placeholder (editable)</span></>}
      foot={
        <>
          <button className="btn primary" onClick={() => followEmployee(id)} data-testid="follow">Follow Employee</button>
          <button className="btn" onClick={() => goToDesk(id)} data-testid="go-desk">Go to Desk</button>
          <button className="btn" onClick={() => inspectMonitors(id)} data-testid="inspect-monitors">Inspect Monitors</button>
          <button className="btn" onClick={() => goToEmployee(id)} data-testid="go-employee">Go to Employee</button>
          <button className="btn" onClick={() => inspectWorkstation(e.ws.id)}>Orbit workstation</button>
        </>
      }
    >
      <div className="tabs">
        {(['now', 'schedule', 'history'] as const).map((t) => <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t === 'now' ? 'Current' : t === 'schedule' ? 'Daily schedule' : 'Activity history'}</button>)}
      </div>
      {tab === 'now' && (
        <>
          <div className="section">
            <div className="row" style={{ marginBottom: 8 }}>
              <span className="chip" style={{ borderColor: ACTIVITY_COLOR[e.activity], color: ACTIVITY_COLOR[e.activity] }} data-testid="emp-activity">● {ACTIVITY_LABEL[e.activity]}</span>
              <span className="chip">{FLOOR_NAMES[floor]} · {sim.roomName(e)}</span>
            </div>
            <dl className="kv">
              <dt>Current task</dt><dd data-testid="emp-task">{e.task}</dd>
              <dt>Employee ID</dt><dd>{e.cfg.id}</dd>
              <dt>Role</dt><dd>{sim.roleLabel(e.cfg.roleType)}{e.cfg.bookId ? ` · ${e.cfg.bookId === 'eq' ? 'Equities' : e.cfg.bookId === 'macro' ? 'Macro' : 'Credit'} book` : ''}</dd>
              <dt>Department</dt><dd>{e.cfg.department}</dd>
              <dt>Workstation</dt><dd>{e.ws.label} ({e.ws.id}) · {roomById(e.ws.roomId)?.name}</dd>
              <dt>Monitors</dt><dd>{e.ws.monitors.map((m) => m.id).join(', ')}</dd>
              <dt>Seat</dt><dd>{e.seatId ?? '-'} {e.intent.kind === 'event' && e.intent.remote ? '(attending remotely)' : ''}</dd>
            </dl>
          </div>
          <div className="section">
            <h3>Screens</h3>
            <div className="list">
              {e.ws.monitors.map((m) => {
                const st = sim.monitorState(m.id)!;
                return (
                  <div className="list-item" key={m.id}>
                    <span>{m.id}</span><span className="muted">{APPS[st.appId].title} · {APPS[st.appId].tabs[st.tab]}</span>
                    <span className="spacer" />
                    <button className="btn small" onClick={() => useUI.getState().openPanel({ kind: 'monitor', monitorId: m.id })}>Open</button>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
      {tab === 'schedule' && (
        <div className="list" data-testid="emp-schedule">
          {schedule.map((s, i) => (
            <div className="list-item" key={i}>
              <span style={{ fontFamily: 'var(--mono)' }}>{fmtTime(s.start)}-{fmtTime(s.end)}</span>
              <span>{s.text}</span>
              <span className="spacer" />
              <span className="muted small">{s.where}</span>
              <span className={`chip ${s.status === 'in-progress' ? 'active' : ''}`}>{s.status}</span>
            </div>
          ))}
          <div className="small muted">Desk work fills the remaining time. Schedules are generated from the seed and staggered around meetings.</div>
        </div>
      )}
      {tab === 'history' && (
        <div className="history" data-testid="emp-history">
          {e.history.map((h, i) => (
            <div key={i}><span className="t">D{h.day + 1} {fmtTime(h.t)}</span><span style={{ color: ACTIVITY_COLOR[h.activity] }}>●</span> {h.text} <span className="muted">· {h.room}</span></div>
          ))}
        </div>
      )}
    </Shell>
  );
}

function MonitorPanel({ monitorId }: { monitorId: string }) {
  const version = useUI((s) => s.simVersion);
  const sim = getSim();
  const mon = MONITOR_INDEX.get(monitorId);
  const [, force] = useState(0);
  const view = useMemo(() => (mon ? buildAppView(sim, monitorId) : null), [sim, monitorId, version, mon]);
  useEffect(() => { forceRedraw(monitorId); }, [monitorId, version]);
  if (!mon || !view) return <Shell title="Monitor not found"><p>Unknown monitor.</p></Shell>;
  const ws = WS_INDEX.get(mon.workstationId)!;
  const owner = sim.ownerOfWorkstation(ws.id);
  const drawn = lastDrawn.get(monitorId);
  const setTab = (i: number) => {
    sim.setMonitorTab(monitorId, i);
    forceRedraw(monitorId);
    playSound('click');
    force((x) => x + 1);
  };
  return (
    <Shell
      testId="monitor-panel"
      title={<>{owner?.cfg.name ?? 'Unassigned'} · {view.title}</>}
      sub={<>{ws.label} ({ws.id}) · Monitor {mon.index + 1} of {ws.monitors.length} · <span data-testid="monitor-id">{monitorId}</span></>}
      foot={
        <>
          {ws.monitors.map((m) => (
            <button key={m.id} className={`btn ${m.id === monitorId ? 'active' : ''}`} data-testid={`switch-${m.id}`} onClick={() => useUI.getState().openPanel({ kind: 'monitor', monitorId: m.id })}>
              Monitor {m.index + 1}: {APPS[sim.monitorState(m.id)!.appId].title.split('·').pop()?.trim()}
            </button>
          ))}
          <span className="spacer" />
          {owner && <button className="btn" onClick={() => useUI.getState().openPanel({ kind: 'employee', id: owner.cfg.id })}>Profile</button>}
        </>
      }
    >
      <div className="sync-line" data-testid="sync-line">
        <span className="chip">Shared state</span>
        <span>In-world screen last drawn at <b data-testid="drawn-minute">{drawn ? fmtTime(drawn.minute) : '—'}</b> showing tab <b data-testid="drawn-tab">{drawn ? view.tabs[drawn.tab] : '—'}</b>; this panel shows <b>{view.time}</b> · <b data-testid="panel-tab">{view.tabs[view.tab]}</b>. Switching tabs here switches the physical monitor.</span>
      </div>
      <HtmlApp view={view} onTab={setTab} />
    </Shell>
  );
}

function WallPanelView({ panelId }: { panelId: string }) {
  const version = useUI((s) => s.simVersion);
  const sim = getSim();
  const p = PANELS.find((x) => x.id === panelId);
  const view = useMemo(() => (p ? buildPanelView(sim, panelId, sim.config.companyName) : null), [sim, panelId, version, p]);
  useEffect(() => { forceRedraw(panelId); }, [panelId, version]);
  if (!p || !view) return <Shell title="Display not found"><p>Unknown display.</p></Shell>;
  const room = roomById(p.roomId);
  const ev = room ? sim.currentEventInRoom(room.id) : undefined;
  return (
    <Shell testId="wall-panel" title={p.label} sub={<>{room?.name ?? ''} · {FLOOR_NAMES[p.floor]}</>} foot={room && !room.hidden ? <button className="btn" onClick={() => goToRoom(room.id)}>Go to {room.name}</button> : undefined}>
      {ev && (
        <div className="section">
          <h3>Meeting in progress</h3>
          <div className="small">{ev.title} · {fmtTime(ev.start)}-{fmtTime(ev.end)} · {sim.presentAttendees(ev).length}/{ev.attendeeIds.length} present{ev.remoteNote ? ` · ${ev.remoteNote}` : ''}</div>
        </div>
      )}
      <HtmlApp view={view} />
    </Shell>
  );
}

function DirectoryPanel() {
  useUI((s) => s.simVersion);
  const sim = getSim();
  const [q, setQ] = useState('');
  const list = sim.employees.filter((e) => {
    const s = `${e.cfg.name} ${e.cfg.title} ${e.cfg.department} ${e.cfg.roleType} ${sim.roomName(e)} ${e.ws.label}`.toLowerCase();
    return s.includes(q.trim().toLowerCase());
  });
  return (
    <Shell testId="directory" title="Employee directory" sub={`${sim.employees.length} fictional employees · live locations (simulated)`} narrow>
      <input type="search" placeholder="Search name, role, department, room…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus data-testid="directory-search" aria-label="Search employees" />
      <div className="list" style={{ marginTop: 10 }}>
        {list.map((e) => (
          <div className="list-item" key={e.cfg.id} data-testid={`dir-${e.cfg.id}`}>
            <span className="dot" style={{ background: ACTIVITY_COLOR[e.activity] }} title={ACTIVITY_LABEL[e.activity]} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{e.cfg.name}</div>
              <div className="small muted" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.cfg.title} · {['G', '1', '2'][Math.max(0, Math.min(2, Math.floor((e.y + 0.3) / 4)))]} · {sim.roomName(e)}</div>
            </div>
            <button className="btn small" onClick={() => goToEmployee(e.cfg.id)} data-testid={`goto-${e.cfg.id}`}>Go to</button>
            <button className="btn small" onClick={() => useUI.getState().openPanel({ kind: 'employee', id: e.cfg.id })}>Profile</button>
          </div>
        ))}
        {!list.length && <div className="muted">No matches.</div>}
      </div>
    </Shell>
  );
}

function NavigationPanel() {
  useUI((s) => s.simVersion);
  const sim = getSim();
  return (
    <Shell testId="navigation" title="Floors & rooms" sub="Teleport to any room, or view a floor from above" narrow foot={<><button className="btn primary" onClick={returnToReception} data-testid="return-reception">Return to Reception</button><button className="btn" onClick={() => showOverview(3)}>Building overview</button></>}>
      {[2, 1, 0].map((f) => (
        <div className="section" key={f}>
          <div className="row"><h3 style={{ margin: 0 }}>{FLOOR_NAMES[f]}</h3><span className="spacer" /><button className="btn small" onClick={() => showOverview(f)}>Cutaway view</button></div>
          <div className="list" style={{ marginTop: 6 }}>
            {ROOMS.filter((r) => r.floor === f && !r.hidden).map((r) => {
              const people = sim.employees.filter((e) => sim.roomIdOf(e) === r.id).length;
              const ev = sim.currentEventInRoom(r.id);
              return (
                <div className="list-item" key={r.id}>
                  <span>{r.name}</span>
                  <span className="muted small">{people} {people === 1 ? 'person' : 'people'}{ev ? ` · ${ev.title}` : ''}</span>
                  <span className="spacer" />
                  <button className="btn small" onClick={() => goToRoom(r.id)} data-testid={`room-${r.id}`}>Go</button>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </Shell>
  );
}

function ElevatorPanel() {
  useUI((s) => s.simVersion);
  const sim = getSim();
  const l = sim.dyn.lift;
  const [, force] = useState(0);
  useEffect(() => { const id = window.setInterval(() => force((x) => x + 1), 250); return () => window.clearInterval(id); }, []);
  return (
    <Shell testId="elevator-panel" title="Elevator" sub={`Car at ${FLOOR_NAMES[l.floor]} · ${l.phase === 'moving' ? `moving to ${FLOOR_NAMES[l.target]}` : l.phase}`} narrow>
      <p className="small muted">Choose a floor. Stay inside the car; the doors close and the car moves. Employees use the stairs.</p>
      <div className="row">
        {[2, 1, 0].map((f) => (
          <button key={f} className={`btn ${l.floor === f && l.phase !== 'moving' ? 'active' : ''}`} style={{ minWidth: 90, padding: '14px 10px' }} data-testid={`lift-${f}`} onClick={() => { sim.dyn.selectFloor(f); playSound('click'); useUI.getState().closePanel(); useUI.getState().showToast(`Going to ${FLOOR_NAMES[f]}`); }}>
            {['G', '1', '2'][f]}<br /><span className="small muted">{FLOOR_NAMES[f]}</span>
          </button>
        ))}
      </div>
    </Shell>
  );
}

function CoffeePanel({ where, drink }: { where: 'cafe' | 'lounge'; drink: string }) {
  const [p, setP] = useState(0);
  const reduced = useUI((s) => s.reducedMotion);
  useEffect(() => {
    if (reduced) { setP(1); return; }
    const t0 = performance.now();
    let raf = 0;
    const step = () => { const k = Math.min(1, (performance.now() - t0) / 3000); setP(k); if (k < 1) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);
  return (
    <Shell testId="coffee-panel" title={where === 'cafe' ? 'Café coffee machine' : 'Staff lounge coffee machine'} sub="A short break" narrow>
      <p>{p < 1 ? `Preparing your ${drink.toLowerCase()}…` : `Your ${drink.toLowerCase()} is ready. Enjoy!`}</p>
      <div className="bar-track" style={{ height: 10, borderRadius: 5, background: '#0e1013' }}><span className="bar-fill tone-accent" style={{ display: 'block', height: '100%', width: `${p * 100}%` }} /></div>
      <p className="small muted" style={{ marginTop: 12 }}>{where === 'cafe' ? 'The order appears on the café coordinator\'s order screen (simulated).' : 'Self-service machine in the second-floor staff lounge.'}</p>
    </Shell>
  );
}

function HelpPanel() {
  return (
    <Shell title="Help & controls" sub="Office Simulation · all people fictional · all financial data simulated" narrow>
      <div className="keys">
        <kbd>Enter Office</kbd><span>Start the walkthrough (locks the cursor)</span>
        <kbd>W A S D / arrows</kbd><span>Move · <kbd>Shift</kbd> faster</span>
        <kbd>Mouse</kbd><span>Look (or drag with the left button if pointer lock is unavailable)</span>
        <kbd>E / click</kbd><span>Interact with what is under the crosshair</span>
        <kbd>Esc</kbd><span>Release cursor / close panel</span>
        <kbd>F</kbd><span>Employee directory & search</span>
        <kbd>N</kbd><span>Floors & rooms navigation</span>
        <kbd>M</kbd><span>Toggle building overview · <kbd>1-4</kbd> pick floor</span>
        <kbd>P</kbd><span>Pause / resume the simulation</span>
        <kbd>L</kbd><span>Toggle employee labels</span>
      </div>
      <div className="section">
        <h3>Things to try</h3>
        <ul className="small" style={{ lineHeight: 1.7, paddingLeft: 18 }}>
          <li>Open a trader's monitor, switch tabs, and watch the physical screen follow.</li>
          <li>At 13:35 a simulated energy sell-off breaches a book's drawdown limit: watch the risk screens, the review meeting in Meeting Room 1B, and the traders cutting positions.</li>
          <li>At 11:10 the technology team investigates a simulated feed incident in the server room.</li>
          <li>Ride the elevator, sit in a boardroom chair, or make a coffee in the café.</li>
        </ul>
      </div>
      <p className="small muted">Touch devices: left stick to move, drag on the right to look, ● to interact.</p>
    </Shell>
  );
}

function LogPanel() {
  useUI((s) => s.simVersion);
  const sim = getSim();
  return (
    <Shell title="Office activity log" sub="Simulated events, meetings, risk and technology updates" narrow>
      <div className="history">
        {sim.log.map((l, i) => <div key={i}><span className="t">D{l.day + 1} {fmtTime(l.t)}</span>{l.text}</div>)}
      </div>
    </Shell>
  );
}
