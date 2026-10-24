// Owner tools: call meetings with anyone, give individual instructions, and talk to every employee.
import { useEffect, useMemo, useRef, useState } from 'react';
import { FLOOR_NAMES, ROOMS, roomById } from '../world/building';
import { PANELS, SEATS } from '../world/furniture';
import { fmtMoney, fmtTime } from '../util/math';
import { getSim } from '../store/simInstance';
import { player } from '../store/player';
import { useUI, type OwnerTab } from '../store/ui';
import { CURRICULA, PASS_MARK, TRAIN_DAYS, VALID_DAYS, certified, describeStrategy } from '../sim/training';
import { fetchIndicators } from '../live/feed';
import { runSystemCheck, type CheckResult } from '../live/systemCheck';
import { PERMANENT, askEmployee, ceoAnalysis, errorCopy, getSample, type SampleError } from '../ai/brain';

/** Set once Claude turned out to be unavailable for this view (permanent codes): scripted replies from then on. */
let aiDisabled = false;
import { ACTIVITY_COLOR, ACTIVITY_LABEL } from '../sim/simulation';
import { playSound } from '../audio/sound';
import { goToEmployee, goToRoom } from './actions';
import { BackToPc, MinimizeButton } from './Panels';

export const MEETING_ROOMS = ['f-conf', 's-board', 'g-training', 'f-m1a', 'f-m1b', 'g-interview', 's-ceo', 'g-lobby'] as const;

function capacity(roomId: string) {
  const seats = SEATS.filter((s) => s.roomId === roomId && (s.kind === 'meeting' || s.kind === 'lounge')).length;
  const stand = SEATS.filter((s) => s.roomId === roomId && s.kind === 'stand').length;
  return { seats, stand };
}

export function roomLabel(id: string) {
  if (id === 'g-lobby') return 'Reception lobby (all-hands, standing)';
  const r = roomById(id);
  const c = capacity(id);
  return `${r?.name ?? id} · ${c.seats} seats${c.stand ? ` + ${c.stand} standing` : ''}`;
}

function ownerSpot() {
  return { floor: player.floor, x: player.x, z: player.z, yaw: player.yaw };
}

function Shell({ title, sub, children, foot, testId }: { title: React.ReactNode; sub?: React.ReactNode; children: React.ReactNode; foot?: React.ReactNode; testId?: string }) {
  const close = useUI((s) => s.closePanel);
  return (
    <div className="panel-wrap" onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <aside className="panel" role="dialog" aria-modal="true" data-testid={testId}>
        <div className="panel-head">
          <div><h2>{title}</h2>{sub && <div className="sub">{sub}</div>}</div>
          <span className="spacer" />
          <BackToPc />
          <MinimizeButton />
          <button className="btn close-btn" onClick={close} data-testid="close-panel">Close ✕</button>
        </div>
        <div className="panel-body">{children}</div>
        {foot && <div className="panel-foot">{foot}</div>}
      </aside>
    </div>
  );
}

/** Who to address: everyone, departments, or picked people. */
function PeoplePicker({ selected, setSelected }: { selected: Set<string>; setSelected: (s: Set<string>) => void }) {
  const sim = getSim();
  const [q, setQ] = useState('');
  const departments = useMemo(() => [...new Set(sim.employees.map((e) => e.cfg.department))].sort(), [sim.employees]);
  const all = sim.employees.map((e) => e.cfg.id);
  const toggle = (ids: string[], on: boolean) => {
    const s = new Set(selected);
    for (const id of ids) { if (on) s.add(id); else s.delete(id); }
    setSelected(s);
  };
  const list = sim.employees.filter((e) => `${e.cfg.name} ${e.cfg.department} ${e.cfg.title}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      <div className="row" style={{ marginBottom: 8 }}>
        <button className={`btn small ${selected.size === all.length ? 'active' : ''}`} onClick={() => setSelected(new Set(selected.size === all.length ? [] : all))} data-testid="pick-everyone">Everyone ({all.length})</button>
        {departments.map((d) => {
          const ids = sim.employees.filter((e) => e.cfg.department === d).map((e) => e.cfg.id);
          const on = ids.every((id) => selected.has(id));
          return <button key={d} className={`btn small ${on ? 'active' : ''}`} onClick={() => toggle(ids, !on)} data-testid={`pick-dept-${d}`}>{d} ({ids.length})</button>;
        })}
      </div>
      <input type="search" placeholder="Find a person…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a person" />
      <div className="list" style={{ maxHeight: 230, overflow: 'auto', marginTop: 6 }}>
        {list.map((e) => (
          <label key={e.cfg.id} className="list-item" style={{ cursor: 'pointer', padding: '4px 8px' }}>
            <input type="checkbox" checked={selected.has(e.cfg.id)} onChange={(ev) => toggle([e.cfg.id], ev.target.checked)} data-testid={`pick-${e.cfg.id}`} />
            <span className="dot" style={{ background: ACTIVITY_COLOR[e.activity] }} />
            <span>{e.cfg.name}</span>
            <span className="muted small">{e.cfg.department} · {sim.roomName(e)}</span>
          </label>
        ))}
      </div>
      <div className="small muted" style={{ marginTop: 4 }}>{selected.size} selected</div>
    </div>
  );
}

export function OwnerPanel({ tab: initial, pc }: { tab?: OwnerTab; pc?: boolean }) {
  useUI((s) => s.simVersion);
  const sim = getSim();
  const [tab, setTab] = useState<OwnerTab>(initial ?? (getSim().realMode ? 'work' : 'meeting'));
  const [selected, setSelected] = useState<Set<string>>(() => new Set(sim.employees.map((e) => e.cfg.id)));
  const [room, setRoom] = useState<string>('f-conf');
  const [minutes, setMinutes] = useState(30);
  const [topic, setTopic] = useState('');
  const [sendRoom, setSendRoom] = useState<string>('s-ceo');
  const [note, setNote] = useState<string | null>(null);
  const meetings = sim.ownerMeetings();
  const withOrders = sim.employees.filter((e) => e.order);
  const ids = [...selected];
  const c = capacity(room);
  const over = ids.length > c.seats + c.stand;
  return (
    <Shell testId="owner-panel" title={pc ? "Chairman's PC · Uday Fulkatwar" : 'Owner'} sub={pc ? 'Full access: every screen and display in the office, every person, and all owner controls' : sim.realMode ? 'Your firm: work, strategies, meetings, instructions and reports' : 'Call people to meetings, give instructions, and read their replies (Office Simulation)'}>
      <div className="tabs">
        <button className={tab === 'office' ? 'active' : ''} onClick={() => setTab('office')} data-testid="owner-tab-office">Whole office</button>
        {sim.realMode && <button className={tab === 'work' ? 'active' : ''} onClick={() => setTab('work')} data-testid="owner-tab-work">Work board</button>}
        {sim.realMode && <button className={tab === 'strategies' ? 'active' : ''} onClick={() => setTab('strategies')} data-testid="owner-tab-strategies">Strategies</button>}
        <button className={tab === 'meeting' ? 'active' : ''} onClick={() => setTab('meeting')} data-testid="owner-tab-meeting">Call a meeting</button>
        <button className={tab === 'requests' ? 'active' : ''} onClick={() => setTab('requests')} data-testid="owner-tab-requests">Call / send people</button>
        <button className={tab === 'training' ? 'active' : ''} onClick={() => setTab('training')} data-testid="owner-tab-training">Training</button>
        <button className={tab === 'workflow' ? 'active' : ''} onClick={() => setTab('workflow')} data-testid="owner-tab-workflow">Workflow</button>
        <button className={tab === 'report' ? 'active' : ''} onClick={() => setTab('report')} data-testid="owner-tab-report">CEO report</button>
        <button className={tab === 'messages' ? 'active' : ''} onClick={() => setTab('messages')} data-testid="owner-tab-messages">Messages ({sim.ownerMessages.length})</button>
        <button className={tab === 'system' ? 'active' : ''} onClick={() => setTab('system')} data-testid="owner-tab-system">System check</button>
      </div>
      {tab === 'office' && <OfficeTab />}
      {tab === 'work' && <WorkTab />}
      {tab === 'system' && <SystemTab />}
      {tab === 'strategies' && <StrategiesTab />}
      {tab === 'training' && <TrainingTab />}
      {tab === 'report' && <ReportTab />}
      {tab === 'workflow' && <WorkflowTab />}
      {(tab === 'meeting' || tab === 'requests') && <div className="section"><h3>Who</h3><PeoplePicker selected={selected} setSelected={setSelected} /></div>}
      {tab === 'meeting' && (
        <>
          <div className="section">
            <h3>Where & what</h3>
            <div className="row">
              <select value={room} onChange={(e) => setRoom(e.target.value)} aria-label="Meeting room" data-testid="meeting-room" style={{ flex: 2, minWidth: 220 }}>
                {MEETING_ROOMS.map((r) => <option key={r} value={r}>{roomLabel(r)}</option>)}
              </select>
              <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} aria-label="Duration" style={{ flex: 1, minWidth: 110 }}>
                {[15, 30, 45, 60].map((m) => <option key={m} value={m}>{m} min</option>)}
              </select>
            </div>
            <input type="text" placeholder="Topic (e.g. Quarterly results)" value={topic} maxLength={80} onChange={(e) => setTopic(e.target.value)} style={{ marginTop: 6 }} data-testid="meeting-topic" aria-label="Meeting topic" />
            {over && <div className="small" style={{ color: 'var(--warn)', marginTop: 6 }}>{ids.length} people for {c.seats + c.stand} places: the rest will join by video from their desks.</div>}
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn primary" disabled={!ids.length} data-testid="call-meeting" onClick={() => {
                const ev = sim.callMeeting({ attendeeIds: ids, roomId: room, minutes, topic });
                if (ev) { playSound('ui'); setNote(`Called ${ids.length} ${ids.length === 1 ? 'person' : 'people'} to ${roomById(room)?.name}. They are on their way.`); useUI.getState().showToast(`${ev.title} · ${roomById(room)?.name}`); }
              }}>Call meeting now</button>
              <button className="btn" onClick={() => goToRoom(room)}>Go to the room</button>
            </div>
            {note && <div className="ok-box" style={{ marginTop: 8 }} data-testid="owner-note">{note}</div>}
          </div>
          <div className="section">
            <h3>Your meetings today</h3>
            {!meetings.length && <div className="muted small">None yet.</div>}
            <div className="list">
              {meetings.map((ev) => (
                <div className="list-item" key={ev.id}>
                  <div style={{ flex: 1 }}>
                    <div>{ev.title}</div>
                    <div className="small muted">{fmtTime(ev.start)}-{fmtTime(ev.end)} · {roomById(ev.roomId)?.name} · {sim.presentAttendees(ev).length}/{ev.attendeeIds.length} in the room{sim.remoteAttendees(ev).length ? ` · ${sim.remoteAttendees(ev).length} by video` : ''} · {ev.status}</div>
                  </div>
                  {ev.status !== 'completed' && ev.status !== 'cancelled' && <button className="btn small" onClick={() => sim.endMeeting(ev.id)} data-testid={`end-${ev.id}`}>End meeting</button>}
                  <button className="btn small" onClick={() => goToRoom(ev.roomId)}>Go</button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
      {tab === 'requests' && (
        <>
          <div className="section">
            <h3>Instruction</h3>
            <div className="row">
              <button className="btn primary" disabled={!ids.length} data-testid="order-come" onClick={() => {
                const n = sim.orderCome(ids, ownerSpot());
                playSound('ui');
                setNote(`${n} ${n === 1 ? 'person is' : 'people are'} coming to you (${FLOOR_NAMES[player.floor]}).`);
              }}>Come to me</button>
              <select value={sendRoom} onChange={(e) => setSendRoom(e.target.value)} aria-label="Send to room" style={{ width: 'auto', minWidth: 200 }}>
                {ROOMS.filter((r) => !r.hidden && r.kind !== 'restroom' && r.kind !== 'utility').map((r) => <option key={r.id} value={r.id}>{r.name} ({FLOOR_NAMES[r.floor].split(' ')[0]})</option>)}
              </select>
              <button className="btn" disabled={!ids.length} data-testid="order-room" onClick={() => { const n = sim.orderRoom(ids, sendRoom); setNote(`${n} sent to ${roomById(sendRoom)?.name}.`); }}>Send there</button>
              <button className="btn" disabled={!ids.length} onClick={() => { sim.dismiss(ids); setNote('Released; they return to their normal routine.'); }}>Back to desks</button>
            </div>
            <p className="small muted">"Come to me" uses the spot where you are standing in the walkthrough (or last stood). Instructions last 30 simulated minutes unless you release people earlier.</p>
            {note && <div className="ok-box" data-testid="owner-note">{note}</div>}
          </div>
          <div className="section">
            <h3>Active instructions</h3>
            {!withOrders.length && <div className="muted small">None.</div>}
            <div className="list">
              {withOrders.map((e) => (
                <div className="list-item" key={e.cfg.id}>
                  <span style={{ flex: 1 }}>{e.cfg.name} <span className="muted small">· {e.order?.kind === 'come' ? `come to you (${e.order.place})` : e.order?.kind === 'room' ? `wait in ${roomById(e.order.roomId)?.name}` : `task: ${e.order?.text}`} · until {fmtTime(e.order!.until)}</span></span>
                  <button className="btn small" onClick={() => useUI.getState().openPanel({ kind: 'talk', id: e.cfg.id })}>Talk</button>
                  <button className="btn small" onClick={() => sim.dismiss([e.cfg.id])}>Release</button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
      {tab === 'messages' && (
        <div className="history" data-testid="owner-messages">
          {!sim.ownerMessages.length && <div className="muted">No messages yet. Talk to someone or give an instruction.</div>}
          {sim.ownerMessages.map((m) => (
            <div key={m.id} className="list-item" style={{ alignItems: 'flex-start' }}>
              <span className="t">D{m.day + 1} {fmtTime(m.t)}</span>
              <div style={{ flex: 1 }}><b>{m.name}</b>: {m.text}</div>
              <button className="btn small" onClick={() => useUI.getState().openPanel({ kind: 'talk', id: m.empId })}>Reply</button>
            </div>
          ))}
        </div>
      )}
    </Shell>
  );
}

const QUICK = ['Hello!', 'Give me a status update', 'How is your P&L?', 'Any risk alerts?', 'Any problems or blockers?', "What's your next meeting?", 'How is your training going?', 'Great work, thank you'];

function TrainingTab() {
  const sim = getSim();
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const recs = sim.employees.map((e) => ({ e, r: sim.trainingRecord(e.cfg.id) }));
  const sessions = sim.events.filter((ev) => ev.academy);
  const nCert = recs.filter((x) => certified(x.r)).length;
  const avg = recs.reduce((a, x) => a + x.r.skill, 0) / Math.max(1, recs.length);
  const inLab = sim.employees.filter((e) => e.order?.kind === 'task' && e.order.training);
  return (
    <>
      <div className="section">
        <h3>ASTRA Academy</h3>
        <p className="small muted">
          Traders run a strategy lab: {TRAIN_DAYS} practice sessions to pick a strategy, {VALID_DAYS} unseen sessions to check it. Only strategies that hold up
          on the unseen sessions trade (paper money). Other departments attend 40-minute Training Room sessions (12 seats); passing a module (≥{PASS_MARK}%)
          raises their skill, which speeds up their simulated work. Results are saved in this browser.
        </p>
        <div className="row">
          <button className="btn primary" data-testid="start-training" disabled={busy} onClick={async () => {
            if (sim.live) {
              setBusy(true);
              setNote('Reading live indicators (RSI, 20/50/200-hour averages) from Co-Invest for the strategy lab…');
              const n = await fetchIndicators(sim);
              setBusy(false);
              if (!n) setNote('Could not read live indicators; traders will hold core positions until they can.');
            }
            const r = sim.startTrainingProgramme();
            playSound('ui');
            setNote(r.lab || r.sessions.length || r.waiting
              ? `${r.lab} traders started the strategy lab. ${r.sessions.length} Training Room session${r.sessions.length === 1 ? '' : 's'} booked${r.waiting ? `, ${r.waiting} cohort${r.waiting === 1 ? '' : 's'} first thing tomorrow` : ''}.`
              : 'Nothing to schedule: everyone is certified or already booked.');
          }}>{nCert === recs.length ? 'Everyone is certified' : 'Start / continue training'}</button>
          <button className="btn" onClick={() => goToRoom('g-training')}>Go to the Training Room</button>
        </div>
        {note && <div className="ok-box" style={{ marginTop: 8 }} data-testid="training-note">{note}</div>}
        <div className="small" style={{ marginTop: 8 }} data-testid="training-summary">{nCert}/{recs.length} certified · average skill {avg.toFixed(0)}/100 · {inLab.length} in the strategy lab now</div>
      </div>
      {!!sessions.length && (
        <div className="section">
          <h3>Sessions today</h3>
          <div className="list">
            {sessions.map((ev) => (
              <div className="list-item" key={ev.id}>
                <div style={{ flex: 1 }}>
                  <div>{ev.title} <span className="muted small">· {fmtTime(ev.start)}-{fmtTime(ev.end)} · {ev.status}</span></div>
                  <div className="small muted">{ev.agenda.join('; ')} · {ev.attendeeIds.length} people{ev.status === 'in-progress' ? ` · ${sim.presentAttendees(ev).length} in the room` : ''}</div>
                  {ev.notes.filter((n) => n.includes('Assessment')).map((n) => <div className="small" key={n}>{n}</div>)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="section">
        <h3>Trader strategies (paper)</h3>
        <table className="tbl" data-testid="strategy-table">
          <thead><tr><th>Trader</th><th>Symbols</th><th>Strategy</th><th>Test</th><th>Live paper result</th><th>Status</th></tr></thead>
          <tbody>
            {recs.filter((x) => x.e.cfg.roleType === 'trader').map(({ e, r }) => (
              <tr key={e.cfg.id}>
                <td>{e.cfg.name}</td>
                <td>{sim.finance.traders.get(e.cfg.id)?.coverage.join(', ')}</td>
                <td>{r.strategy ? describeStrategy(r.strategy.strategy) : e.order?.kind === 'task' && e.order.training ? `In the lab (until ${fmtTime(e.order.until)})` : 'Not trained'}</td>
                <td>{!r.strategy ? '-' : r.strategy.mode === 'forward' ? 'Live regime read' : `Sharpe ${r.strategy.train.sharpe.toFixed(2)} in-sample / ${r.strategy.valid.sharpe.toFixed(2)} unseen`}</td>
                <td>{(() => { const f = sim.finance.strategies.get(e.cfg.id)?.forward ?? r.strategy?.forward; return f && f.trades ? `${f.trades} trades, ${f.wins} wins, ${fmtMoney(f.pnl)}` : '-'; })()}</td>
                <td style={{ color: r.strategy ? (r.strategy.active ? 'var(--pos)' : 'var(--warn)') : undefined }}>{!r.strategy ? '-' : r.strategy.active ? (sim.finance.strategies.get(e.cfg.id)?.size ?? 0.25) < 0.25 ? 'Forward test (10%)' : 'Live' : r.strategy.forward?.trades ? 'Suspended' : 'Rejected'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="section">
        <h3>Everyone</h3>
        <div className="list" style={{ maxHeight: 260, overflow: 'auto' }}>
          {recs.map(({ e, r }) => {
            const total = CURRICULA[r.role].length;
            const passed = CURRICULA[r.role].filter((m) => r.modules.some((x) => x.id === m.id && x.passed)).length;
            return (
              <div className="list-item" key={e.cfg.id}>
                <span style={{ flex: 1 }}>{e.cfg.name} <span className="muted small">· {e.cfg.department}</span></span>
                <span className="small">{passed}/{total} modules</span>
                <span className="small" style={{ width: 90, textAlign: 'right' }}>skill {r.skill}</span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function SystemTab() {
  const [results, setResults] = useState<CheckResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div data-testid="system-check">
      <div className="section">
        <h3>System check</h3>
        <p className="small muted">Runs real calls from this page: Co-Invest live prices, price history and headlines (read-only), then a short Claude reply and a Claude tool call. Each Claude step uses a tiny amount of your Claude plan. Run it after opening the office in claude.ai.</p>
        <button className="btn primary" disabled={busy} data-testid="run-system-check" onClick={async () => {
          setBusy(true);
          setResults([]);
          const r = await runSystemCheck(setResults);
          setBusy(false);
          const ok = r.filter((x) => x.ok).length;
          useUI.getState().showToast(`System check: ${ok}/${r.length} passed`);
        }}>{busy ? 'Checking…' : 'Run system check'}</button>
      </div>
      {results && (
        <div className="section">
          <table className="tbl" data-testid="system-results">
            <thead><tr><th>Check</th><th>Result</th><th>Details</th><th>Time</th></tr></thead>
            <tbody>{results.map((r) => (
              <tr key={r.name}><td>{r.name}</td><td style={{ color: r.ok ? 'var(--pos)' : 'var(--neg)' }}>{r.ok ? 'PASS' : 'FAIL'}</td><td>{r.detail}</td><td>{r.ms ? `${r.ms} ms` : ''}</td></tr>
            ))}</tbody>
          </table>
          {busy && <div className="small muted" style={{ marginTop: 6 }}>Running… (Claude may ask you to allow it first)</div>}
        </div>
      )}
    </div>
  );
}

/** Everything in the office from one place: each person's screens, every room and wall display, talk, find or locate. */
function OfficeTab() {
  const sim = getSim();
  const [q, setQ] = useState('');
  const ui = useUI.getState();
  const match = (s: string) => !q || s.toLowerCase().includes(q.toLowerCase());
  const people = sim.employees.filter((e) => match(`${e.cfg.name} ${e.cfg.title} ${e.cfg.department}`));
  const displays = PANELS.filter((p) => p.kind !== 'logo' && p.kind !== 'chairmanPc' && match(`${p.label} ${roomById(p.roomId)?.name ?? ''}`));
  const rooms = ROOMS.filter((r) => !r.hidden && match(r.name));
  return (
    <div data-testid="office-tab">
      <div className="section">
        <input placeholder="Search people, screens, rooms…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="office-search" style={{ width: '100%' }} />
        <div className="small muted" style={{ marginTop: 4 }}>View-only access to every screen; instructions to people go through Talk, Call a meeting or Call / send people. Paper trading only: nothing here can place a real order.</div>
      </div>
      <div className="section">
        <h3>People and their screens ({people.length})</h3>
        {people.map((e) => {
          const t = sim.realMode ? sim.work.current(e.cfg.id) : undefined;
          return (
            <div key={e.cfg.id} className="list-item" data-testid={`office-person-${e.cfg.id}`}>
              <span className="dot" style={{ background: ACTIVITY_COLOR[e.activity] }} />
              <span style={{ minWidth: 150 }}><b>{e.cfg.name}</b> <span className="muted small">{e.cfg.title}</span></span>
              <span className="small" style={{ flex: 1 }}>{sim.roomName(e)} · {t ? t.title : ACTIVITY_LABEL[e.activity]}</span>
              {e.ws.monitors.map((m, i) => <button key={m.id} className="btn small" data-testid={`office-screen-${m.id}`} onClick={() => ui.openFromPc({ kind: 'monitor', monitorId: m.id })}>Screen {i + 1}</button>)}
              <button className="btn small" onClick={() => ui.openFromPc({ kind: 'employee', id: e.cfg.id })}>Profile</button>
              <button className="btn small" onClick={() => ui.openFromPc({ kind: 'talk', id: e.cfg.id })}>Talk</button>
              <button className="btn small" onClick={() => goToEmployee(e.cfg.id)}>Find</button>
            </div>
          );
        })}
      </div>
      <div className="section">
        <h3>Room and wall displays ({displays.length})</h3>
        {displays.map((p) => (
          <div key={p.id} className="list-item">
            <span style={{ flex: 1 }}>{p.label} <span className="muted small">· {roomById(p.roomId)?.name ?? ''} · {FLOOR_NAMES[p.floor]}</span></span>
            <button className="btn small" data-testid={`office-display-${p.id}`} onClick={() => p.kind === 'directory' ? ui.openFromPc({ kind: 'navigation' }) : ui.openFromPc({ kind: 'wall', panelId: p.id })}>Open</button>
          </div>
        ))}
      </div>
      <div className="section">
        <h3>Rooms</h3>
        <div className="row wrap">{rooms.map((r) => <button key={r.id} className="btn small" onClick={() => goToRoom(r.id)}>{r.name}</button>)}</div>
      </div>
      <div className="section">
        <h3>Office records</h3>
        <div className="row wrap">
          <button className="btn small" data-testid="office-cctv" onClick={() => ui.openFromPc({ kind: 'cctv', cam: 0 })}>CCTV: every office live</button>
          <button className="btn small" onClick={() => ui.openFromPc({ kind: 'directory' })}>Staff directory</button>
          <button className="btn small" onClick={() => ui.openFromPc({ kind: 'log' })}>Full activity log</button>
          <button className="btn small" onClick={() => ui.openFromPc({ kind: 'settings', tab: 'about' })}>Settings</button>
        </div>
      </div>
    </div>
  );
}

function WorkTab() {
  const sim = getSim();
  const w = sim.work;
  const ceo = sim.employees.find((e) => e.cfg.roleType === 'ceo');
  const heads = ceo ? w.reportsOf(ceo.cfg.id) : [];
  const row = (id: string, depth: number): React.ReactNode => {
    const e = sim.byId.get(id)!;
    const t = w.current(id);
    return (
      <div key={id}>
        <div className="list-item" style={{ paddingLeft: 8 + depth * 18 }}>
          <span className="dot" style={{ background: ACTIVITY_COLOR[e.activity] }} />
          <span style={{ minWidth: 150 }}><b>{e.cfg.name}</b> <span className="muted small">{e.cfg.title}</span></span>
          <span className="small" style={{ flex: 1 }}>{t ? `${t.title} · ${t.status === 'waiting' ? 'waiting for data' : `${Math.round(t.progress * 100)}%`}` : <span className="muted">between tasks</span>}</span>
        </div>
        {w.reportsOf(id).map((r) => row(r, depth + 1))}
      </div>
    );
  };
  return (
    <div data-testid="work-board">
      <div className="section">
        <h3>Today's objectives (set by the CEO)</h3>
        {!w.objectives.length && <div className="muted small">The CEO sets objectives at the start of the day.</div>}
        {w.objectives.map((o) => { const p = w.objectiveProgress(o); return <div key={o.id} className="small"><span style={{ color: p.ok ? 'var(--pos)' : 'var(--warn)' }}>●</span> {o.text} · <b>{p.text}</b></div>; })}
        {w.kill.on && <div className="small" style={{ color: 'var(--neg)', marginTop: 6 }}>Kill switch on: {w.kill.reason}. All strategies are flat and paused until tomorrow.</div>}
      </div>
      <div className="section">
        <h3>Who is doing what (reporting lines)</h3>
        <div className="list" style={{ maxHeight: 320, overflow: 'auto' }}>{ceo && row(ceo.cfg.id, 0)}{heads.length === 0 && <div className="muted small">No CEO in the roster.</div>}</div>
      </div>
      <div className="section">
        <h3>Reports to seniors ({w.reports.length})</h3>
        <div className="list" style={{ maxHeight: 240, overflow: 'auto' }}>
          {w.reports.slice(0, 30).map((r) => (
            <div className="list-item" key={r.id} style={{ alignItems: 'flex-start' }}>
              <span className="t">{fmtTime(r.t % 1440)}</span>
              <span style={{ flex: 1 }} className="small"><b>{sim.name(r.from)}</b> → {sim.name(r.to)}: {r.text}</span>
              <span className="small" style={{ color: r.ok ? 'var(--pos)' : 'var(--warn)' }}>{r.ok ? 'ok' : 'issue'}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="section">
        <h3>Problem-solving meetings</h3>
        {sim.events.filter((ev) => ev.kind === 'workshop').map((ev) => <div key={ev.id} className="small">{fmtTime(ev.start)} {ev.title} · {ev.status}{ev.notes.find((n) => n.startsWith('Decision')) ? ` · ${ev.notes.find((n) => n.startsWith('Decision'))}` : ''}</div>)}
        {!sim.events.some((ev) => ev.kind === 'workshop') && <div className="muted small">None today. Meetings are called when something goes wrong (failed research streaks, loss limit, data incidents).</div>}
      </div>
    </div>
  );
}

function StrategiesTab() {
  const sim = getSim();
  const w = sim.work;
  const tested = [...w.tested.values()].sort((a, b) => b.t - a.t);
  const passRate = tested.length ? tested.filter((x) => x.pass).length / tested.length : 0;
  const live = w.strats.filter((s) => s.status === 'live');
  const fwd = live.reduce((a, s) => a + s.fwd.pnl, 0);
  return (
    <div data-testid="strategies-tab">
      <div className="section">
        <h3>Strategy desk (paper)</h3>
        <p className="small muted">Every set-up is tested on real Co-Invest candles: parameters chosen on the first 65 % of the history, judged on the last 35 % it never saw, with fees and slippage. Passing needs out-of-sample Sharpe ≥ 1, profit factor ≥ 1.2, drawdown ≤ 12 % and a robust parameter grid; then Risk stress-tests it with double costs and the PM allocates paper capital (volatility-targeted, max 25 % per strategy, 35 % per market, 20 % cash reserve). Losers are retired; a 2 % daily loss stops everything. This raises the odds and limits losses; it does not guarantee profit.</p>
        <div className="row small"><b>{tested.length}</b> tests · pass rate <b>{(passRate * 100).toFixed(1)}%</b> · <b>{live.length}</b> live · forward P&L <b style={{ color: fwd >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{fmtMoney(fwd)}</b> · paper capital {fmtMoney(sim.finance.firm(Math.floor(sim.minute)).capital)}</div>
      </div>
      <div className="section">
        <h3>Strategies</h3>
        <table className="tbl"><thead><tr><th>#</th><th>Market</th><th>Strategy</th><th>Owner</th><th>Status</th><th>Out-of-sample</th><th>Alloc</th><th>Forward</th></tr></thead>
          <tbody>{w.strats.slice(0, 40).map((s) => (
            <tr key={s.id}>
              <td>{s.id}</td><td>{s.sym} {s.r.interval}</td><td>{s.r.family}</td><td>{sim.name(s.owner)}</td><td>{s.status}</td>
              <td>{(s.r.test.ret * 100).toFixed(2)}% · Sharpe {s.r.test.sharpe.toFixed(2)} · DD {(s.r.test.maxDD * 100).toFixed(1)}%</td>
              <td>{fmtMoney(s.alloc)}</td><td style={{ color: s.fwd.pnl >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{fmtMoney(s.fwd.pnl)} ({s.fwd.trades})</td>
            </tr>
          ))}</tbody>
        </table>
        {!w.strats.length && <div className="muted small">No strategy has passed yet. The traders keep testing.</div>}
      </div>
      <div className="section">
        <h3>Latest tests</h3>
        <div className="list" style={{ maxHeight: 260, overflow: 'auto' }}>
          {tested.slice(0, 40).map((x, i) => <div key={i} className="small">{fmtTime(x.t % 1440)} {x.sym} {x.family} {x.interval}: Sharpe {x.sharpe.toFixed(2)} <b style={{ color: x.pass ? 'var(--pos)' : 'var(--muted)' }}>{x.pass ? 'PASS' : 'fail'}</b></div>)}
        </div>
      </div>
    </div>
  );
}

const TICKET_KIND: Record<string, string> = { idea: 'Research idea', 'error-trade': 'Error trade', 'build-fix': 'Build fix' };

function WorkflowTab() {
  const sim = getSim();
  const name = (id: string) => sim.byId.get(id)?.cfg.name ?? id;
  const coaching = sim.employees.flatMap((e) => (sim.training.get(e.cfg.id)?.coaching ?? []).map((c) => ({ e, c }))).reverse();
  return (
    <div data-testid="workflow">
      <div className="section">
        <h3>How work flows</h3>
        <p className="small muted">Researchers publish notes → the PM of the book approves or rejects the idea → the covering trader executes it (paper) → the risk pre-trade check screens every order → Operations confirms and fixes breaks. Mistakes happen (wrong order size, failed builds, late arrivals); each is caught or corrected, and work mistakes lead to a one-to-one with the manager.</p>
      </div>
      <div className="section">
        <h3>Tickets ({sim.tickets.length})</h3>
        {!sim.tickets.length && <div className="muted small">Nothing yet. Ideas appear as researchers finish notes; errors when they happen.</div>}
        <div className="list" style={{ maxHeight: 300, overflow: 'auto' }}>
          {sim.tickets.slice(0, 40).map((k) => (
            <div className="list-item" key={k.id} style={{ alignItems: 'flex-start' }}>
              <span className="t">D{k.day + 1} {fmtTime(k.t)}</span>
              <div style={{ flex: 1 }}>
                <div><b>{TICKET_KIND[k.kind]}</b> #{k.id}: {k.title} <span className="chip small">{k.status}</span>{k.result !== undefined && <span style={{ color: k.result >= 0 ? 'var(--pos)' : 'var(--neg)' }}> {(k.result * 100).toFixed(2)}%</span>}</div>
                <div className="small muted">{name(k.from)} → {name(k.to)} · {k.log[k.log.length - 1].text}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="section">
        <h3>Mistakes ({sim.mistakes.length})</h3>
        {!sim.mistakes.length && <div className="muted small">None so far today.</div>}
        <div className="list" style={{ maxHeight: 220, overflow: 'auto' }}>
          {sim.mistakes.slice(0, 30).map((x) => (
            <div className="list-item" key={x.id}>
              <span className="t">D{x.day + 1} {fmtTime(x.t)}</span>
              <span style={{ flex: 1 }}><b>{name(x.empId)}</b>: {x.text}</span>
              <span className="small" style={{ color: x.caught ? 'var(--pos)' : 'var(--neg)' }}>{x.caught ? 'caught' : `cost ${fmtMoney(x.cost)}`}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="section">
        <h3>Coaching</h3>
        {!coaching.length && <div className="muted small">No coaching needed yet.</div>}
        {coaching.slice(0, 20).map(({ e, c }, i) => <div className="small" key={i}>{e.cfg.name}: {c.text} · <b>{c.status}</b></div>)}
      </div>
    </div>
  );
}

function ReportTab() {
  const sim = getSim();
  const r = sim.ceoReport();
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [canAi, setCanAi] = useState(false);
  useEffect(() => { void getSample().then((s) => setCanAi(!!s && !aiDisabled)); }, []);
  return (
    <div data-testid="ceo-report">
      <div className="section">
        <h3>{r.title}</h3>
        <p className="small muted">Prepared by {sim.employees.find((e) => e.cfg.roleType === 'ceo')?.cfg.name ?? 'the CEO'} from the live office state. {sim.live ? 'Prices are live (Co-Invest, read-only); all trading is paper.' : 'Paper trading only: simulated money, fictional instruments.'}</p>
        {canAi && (
          <button className="btn primary" disabled={busy} data-testid="ceo-analysis" onClick={async () => {
            setBusy(true);
            setAnalysis('');
            try {
              setAnalysis(await ceoAnalysis(sim, { onText: setAnalysis }));
            } catch (err) {
              const code = (err as SampleError)?.code ?? 'upstream_error';
              if (PERMANENT.has(code)) { aiDisabled = true; setCanAi(false); }
              setAnalysis(`${(err as SampleError)?.text ?? ''}${errorCopy(code) ? `\n(${errorCopy(code)})` : ''}` || null);
            } finally {
              setBusy(false);
            }
          }}>{busy ? 'The CEO is writing…' : 'Ask the CEO for an analysis (Claude)'}</button>
        )}
        {analysis !== null && <div className="ok-box" style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>{analysis || 'Thinking…'}</div>}
      </div>
      {r.sections.map((s) => (
        <div className="section" key={s.title}>
          <h3>{s.title}</h3>
          {s.lines.map((l, i) => <div className="small" key={i}>{l}</div>)}
        </div>
      ))}
    </div>
  );
}

export function TalkPanel({ id }: { id: string }) {
  useUI((s) => s.simVersion);
  const sim = getSim();
  const e = sim.byId.get(id);
  const [text, setText] = useState('');
  const [task, setTask] = useState('');
  const [room, setRoom] = useState<string>('s-ceo');
  const [, force] = useState(0);
  const [pending, setPending] = useState<string | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [ai, setAi] = useState<boolean | null>(aiDisabled ? false : null);
  const ctl = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    sim.setTalking(id);
    let live = true;
    void getSample().then((s) => { if (live) setAi(!!s && !aiDisabled); });
    return () => { live = false; ctl.current?.abort(); sim.setTalking(null); };
  }, [sim, id]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [e?.chat.length, pending]);
  if (!e) return <Shell title="Employee not found"><p>This employee no longer exists.</p></Shell>;
  const mode = sim.talkMode(id);
  const say = async (t: string) => {
    if (!t.trim() || pending !== null) return;
    playSound('click');
    setText('');
    setAiNote(null);
    const useAi = !aiDisabled && !!(await getSample());
    if (!useAi) {
      sim.talk(id, t);
      force((x) => x + 1);
      return;
    }
    sim.ownerSaid(id, t);
    setPending('');
    const c = new AbortController();
    ctl.current = c;
    try {
      const reply = await askEmployee(sim, id, t, { onText: (x) => setPending(x), signal: c.signal, ownerSpot });
      sim.employeeSays(id, reply);
    } catch (err) {
      const code = (err as SampleError)?.code ?? 'upstream_error';
      if (PERMANENT.has(code)) {
        aiDisabled = true;
        setAi(false);
        sim.employeeSays(id, sim.scriptedReply(id, t));
      } else if (code !== 'cancelled') {
        if ((err as SampleError).text) sim.employeeSays(id, `${(err as SampleError).text} …`);
        setAiNote(errorCopy(code));
      }
    } finally {
      if (ctl.current === c) ctl.current = null;
      setPending(null);
      force((x) => x + 1);
    }
  };
  return (
    <Shell
      testId="talk-panel"
      title={<>Talk to {e.cfg.name}</>}
      sub={<>{e.cfg.title} · {e.cfg.department} · <span style={{ color: ACTIVITY_COLOR[e.activity] }}>● {ACTIVITY_LABEL[e.activity]}</span> · {sim.roomName(e)} · <b data-testid="talk-mode">{mode}</b></>}
      foot={
        <>
          <button className="btn primary" data-testid="talk-come" onClick={() => { sim.orderCome([id], ownerSpot()); force((x) => x + 1); }}>Come to me</button>
          <select value={room} onChange={(ev) => setRoom(ev.target.value)} aria-label="Send to room" style={{ width: 'auto' }}>
            {ROOMS.filter((r) => !r.hidden && r.kind !== 'restroom' && r.kind !== 'utility').map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <button className="btn" onClick={() => { sim.orderRoom([id], room); force((x) => x + 1); }}>Send there</button>
          <button className="btn" disabled={!e.order} onClick={() => { sim.dismiss([id]); force((x) => x + 1); }}>Back to work</button>
          <span className="spacer" />
          <button className="btn" onClick={() => goToEmployee(id)}>Walk to them</button>
          <button className="btn" onClick={() => useUI.getState().openPanel({ kind: 'employee', id })}>Profile</button>
        </>
      }
    >
      <div className="chat" data-testid="chat">
        {!e.chat.length && <div className="muted small">{mode === 'in person' ? `${e.cfg.name.split(' ')[0]} turns to you.` : `You call ${e.cfg.name.split(' ')[0]} on the internal line.`} Ask anything in Hindi or English, or give an instruction. {ai ? 'Replies are written by Claude from their live work data (uses your Claude plan) and they can act on your instructions.' : 'Replies come from their live work data (scripted).'}</div>}
        {e.chat.map((c, i) => (
          <div key={i} className={`bubble ${c.from}`}>
            <span className="t">{fmtTime(c.t)}</span> {c.text}
          </div>
        ))}
        {pending !== null && <div className="bubble employee" data-testid="pending-reply">{pending || 'Thinking…'} <button className="btn small" onClick={() => ctl.current?.abort()}>Stop</button></div>}
        {aiNote && <div className="small" style={{ color: 'var(--warn)' }}>{aiNote}</div>}
        <div ref={end} />
      </div>
      <div className="row" style={{ margin: '10px 0' }}>
        {(e.cfg.roleType === 'ceo' ? ['Give me the full report', 'What should we improve?', ...QUICK] : QUICK).map((q) => <button key={q} className="btn small" disabled={pending !== null} onClick={() => void say(q)}>{q}</button>)}
      </div>
      <form className="row" onSubmit={(ev) => { ev.preventDefault(); void say(text); }}>
        <input type="text" value={text} onChange={(ev) => setText(ev.target.value)} placeholder={`Message ${e.cfg.name.split(' ')[0]}…`} maxLength={300} style={{ flex: 1 }} data-testid="talk-input" aria-label="Message" autoFocus />
        <button className="btn primary" type="submit" data-testid="talk-send">Send</button>
      </form>
      <div className="section" style={{ marginTop: 14 }}>
        <h3>Assign a task</h3>
        <form className="row" onSubmit={(ev) => { ev.preventDefault(); if (task.trim()) { sim.assignTask(id, task); setTask(''); force((x) => x + 1); } }}>
          <input type="text" value={task} onChange={(ev) => setTask(ev.target.value)} placeholder="e.g. Prepare a one-page summary of energy exposure" maxLength={140} style={{ flex: 1 }} data-testid="task-input" aria-label="Task" />
          <button className="btn" type="submit" data-testid="task-send">Assign</button>
        </form>
        {e.order && <div className="small muted" style={{ marginTop: 6 }}>Current instruction: {e.order.kind === 'task' ? `task "${e.order.text}"` : e.order.kind === 'come' ? `come to you (${e.order.place})` : `wait in ${roomById(e.order.roomId)?.name}`} · until {fmtTime(e.order.until)}</div>}
      </div>
    </Shell>
  );
}
