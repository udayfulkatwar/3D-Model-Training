// CCTV full view controls: the main view shows the chosen room camera (CameraController); this overlay names
// the camera, lists who is in the room, and switches cameras (buttons, arrow keys, or auto-cycle).
import { useEffect, useState } from 'react';
import { roomAt } from '../world/building';
import { CCTV_CAMERAS } from '../world/cctv';
import { getSim } from '../store/simInstance';
import { useUI } from '../store/ui';
import { ACTIVITY_LABEL } from '../sim/simulation';
import { BackToPc } from './Panels';

export function CctvPanel({ cam }: { cam: number }) {
  useUI((s) => s.simVersion);
  const [auto, setAuto] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const ui = useUI.getState();
  const n = CCTV_CAMERAS.length;
  const go = (i: number) => { const s = useUI.getState(); s.panel?.kind === 'cctv' && useUI.setState({ panel: { kind: 'cctv', cam: ((i % n) + n) % n } }); };
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => {
    if (!auto) return;
    const t = window.setInterval(() => go((useUI.getState().panel as { cam: number }).cam + 1), 8000);
    return () => window.clearInterval(t);
  }, [auto]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'ArrowRight') go(cam + 1);
      else if (e.code === 'ArrowLeft') go(cam - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cam]);
  const c = CCTV_CAMERAS[cam];
  const sim = getSim();
  const people = sim.employees.filter((e) => e.phase !== 'away' && roomAt(e.floor, e.x, e.z)?.id === c.roomId);
  return (
    <div className="cctv" data-testid="cctv-view">
      <div className="cctv-top">
        <span className="cctv-rec">● REC</span>
        <b data-testid="cctv-label">{c.id.toUpperCase()} · {c.label}</b>
        <span className="muted">{now.toLocaleDateString()} {now.toLocaleTimeString()}</span>
      </div>
      <div className="cctv-people">
        <b>{people.length} in this room</b>
        {people.slice(0, 12).map((e) => <div key={e.cfg.id} className="small">{e.cfg.name} · <span className="muted">{ACTIVITY_LABEL[e.activity]}</span></div>)}
        {people.length > 12 && <div className="small muted">+{people.length - 12} more</div>}
      </div>
      <div className="cctv-bar">
        <button className="btn" onClick={() => go(cam - 1)} data-testid="cctv-prev">‹ Prev</button>
        <button className="btn" onClick={() => go(cam + 1)} data-testid="cctv-next">Next ›</button>
        <button className={`btn ${auto ? 'active' : ''}`} onClick={() => setAuto(!auto)}>{auto ? 'Auto-cycle on' : 'Auto-cycle'}</button>
        <div className="cctv-cams">
          {CCTV_CAMERAS.map((x, i) => <button key={x.id} className={`btn small ${i === cam ? 'active' : ''}`} onClick={() => go(i)} title={x.label}>{x.label.split(' · ')[0]}</button>)}
        </div>
        <span className="spacer" />
        <BackToPc />
        <button className="btn close-btn" onClick={() => ui.closePanel()} data-testid="close-panel">Close ✕</button>
      </div>
    </div>
  );
}
