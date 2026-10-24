// Owner tools: call meetings with anyone, give individual instructions, and talk to every employee.
import { useEffect, useMemo, useRef, useState } from 'react';
import { FLOOR_NAMES, ROOMS, roomById } from '../world/building';
import { SEATS } from '../world/furniture';
import { fmtTime } from '../util/math';
import { getSim } from '../store/simInstance';
import { player } from '../store/player';
import { useUI, type OwnerTab } from '../store/ui';
import { CURRICULA, PASS_MARK, TRAIN_DAYS, VALID_DAYS, certified, describeStrategy } from '../sim/training';
import { ACTIVITY_COLOR, ACTIVITY_LABEL } from '../sim/simulation';
import { playSound } from '../audio/sound';
import { goToEmployee, goToRoom } from './actions';

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

export function OwnerPanel({ tab: initial }: { tab?: OwnerTab }) {
  useUI((s) => s.simVersion);
  const sim = getSim();
  const [tab, setTab] = useState<OwnerTab>(initial ?? 'meeting');
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
    <Shell testId="owner-panel" title="Owner" sub="Call people to meetings, give instructions, and read their replies (Office Simulation)">
      <div className="tabs">
        <button className={tab === 'meeting' ? 'active' : ''} onClick={() => setTab('meeting')} data-testid="owner-tab-meeting">Call a meeting</button>
        <button className={tab === 'requests' ? 'active' : ''} onClick={() => setTab('requests')} data-testid="owner-tab-requests">Call / send people</button>
        <button className={tab === 'training' ? 'active' : ''} onClick={() => setTab('training')} data-testid="owner-tab-training">Training</button>
        <button className={tab === 'report' ? 'active' : ''} onClick={() => setTab('report')} data-testid="owner-tab-report">CEO report</button>
        <button className={tab === 'messages' ? 'active' : ''} onClick={() => setTab('messages')} data-testid="owner-tab-messages">Messages ({sim.ownerMessages.length})</button>
      </div>
      {tab === 'training' && <TrainingTab />}
      {tab === 'report' && <ReportTab />}
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
          <button className="btn primary" data-testid="start-training" onClick={() => {
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
          <thead><tr><th>Trader</th><th>Symbols</th><th>Strategy</th><th>In-sample Sharpe</th><th>Unseen Sharpe</th><th>Status</th></tr></thead>
          <tbody>
            {recs.filter((x) => x.e.cfg.roleType === 'trader').map(({ e, r }) => (
              <tr key={e.cfg.id}>
                <td>{e.cfg.name}</td>
                <td>{sim.finance.traders.get(e.cfg.id)?.coverage.join(', ')}</td>
                <td>{r.strategy ? describeStrategy(r.strategy.strategy) : e.order?.kind === 'task' && e.order.training ? `In the lab (until ${fmtTime(e.order.until)})` : 'Not trained'}</td>
                <td>{r.strategy ? r.strategy.train.sharpe.toFixed(2) : '-'}</td>
                <td>{r.strategy ? r.strategy.valid.sharpe.toFixed(2) : '-'}</td>
                <td style={{ color: r.strategy ? (r.strategy.active ? 'var(--pos)' : 'var(--warn)') : undefined }}>{r.strategy ? (r.strategy.active ? 'Live' : 'Rejected') : '-'}</td>
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

function ReportTab() {
  const sim = getSim();
  const r = sim.ceoReport();
  return (
    <div data-testid="ceo-report">
      <div className="section">
        <h3>{r.title}</h3>
        <p className="small muted">Prepared by {sim.employees.find((e) => e.cfg.roleType === 'ceo')?.cfg.name ?? 'the CEO'} from the live office state. Paper trading only: simulated money, fictional instruments.</p>
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
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    sim.setTalking(id);
    return () => sim.setTalking(null);
  }, [sim, id]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [e?.chat.length]);
  if (!e) return <Shell title="Employee not found"><p>This employee no longer exists.</p></Shell>;
  const mode = sim.talkMode(id);
  const say = (t: string) => {
    if (!t.trim()) return;
    sim.talk(id, t);
    playSound('click');
    setText('');
    force((x) => x + 1);
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
        {!e.chat.length && <div className="muted small">{mode === 'in person' ? `${e.cfg.name.split(' ')[0]} turns to you.` : `You call ${e.cfg.name.split(' ')[0]} on the internal line.`} Ask anything, or use the suggestions below. Replies come from their simulated work (scripted locally, no AI service).</div>}
        {e.chat.map((c, i) => (
          <div key={i} className={`bubble ${c.from}`}>
            <span className="t">{fmtTime(c.t)}</span> {c.text}
          </div>
        ))}
        <div ref={end} />
      </div>
      <div className="row" style={{ margin: '10px 0' }}>
        {QUICK.map((q) => <button key={q} className="btn small" onClick={() => say(q)}>{q}</button>)}
      </div>
      <form className="row" onSubmit={(ev) => { ev.preventDefault(); say(text); }}>
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
