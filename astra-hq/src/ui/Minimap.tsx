// 2D floor plan of the current (or selected) floor with rooms, doors, desks, people and the player.
import { useEffect, useRef, useState } from 'react';
import { BLD, DOORS, FLOOR_NAMES, ROOMS, STAIR, WALLS, roomAt, wallPieces } from '../world/building';
import { FURNITURE, footprint } from '../world/furniture';
import { getSim } from '../store/simInstance';
import { player } from '../store/player';
import { useUI } from '../store/ui';
import { ACTIVITY_COLOR } from '../sim/simulation';
import { goToRoom } from './actions';

const ROOM_COLORS: Record<string, string> = {
  trading: '#2a3240', research: '#2b3530', risk: '#3a2d2d', pm: '#33302a', tech: '#25303a', ops: '#2f2d38', office: '#3a3226',
  boardroom: '#33292d', conference: '#2f2a36', meeting: '#2d2a33', cafe: '#3a3024', reception: '#2e2c28', lounge: '#2c2a33',
  'staff-lounge': '#35302a', server: '#1f2a33', restroom: '#2a2f33', utility: '#2a2a2a', training: '#2b2f2a', interview: '#2f2b2b',
  corridor: '#202226', stair: '#262626', elevator: '#262626',
};

export function Minimap() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const playerFloor = useUI((s) => s.playerFloor);
  const mode = useUI((s) => s.mode);
  const overviewFloor = useUI((s) => s.overviewFloor);
  const [pinned, setPinned] = useState<number | null>(null);
  const floor = pinned ?? (mode === 'overview' && overviewFloor < 3 ? overviewFloor : playerFloor);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (t - last < 180) return;
      last = t;
      const c = canvas.current;
      if (!c) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = c.clientWidth * dpr;
      const H = c.clientHeight * dpr;
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
      const g = c.getContext('2d')!;
      const s = W / (BLD.x1 + 0.6);
      const ox = 0.3 * s;
      const oz = 0.3 * s;
      const X = (x: number) => ox + x * s;
      const Z = (z: number) => oz + z * s;
      g.fillStyle = '#0d0f12';
      g.fillRect(0, 0, W, H);
      for (const r of ROOMS) {
        if (r.floor !== floor) continue;
        g.fillStyle = ROOM_COLORS[r.kind] ?? '#2a2a2a';
        g.fillRect(X(r.rect.x0), Z(r.rect.z0), (r.rect.x1 - r.rect.x0) * s, (r.rect.z1 - r.rect.z0) * s);
      }
      // stairs
      g.strokeStyle = '#555';
      g.lineWidth = 1;
      for (let i = 0; i < 10; i++) {
        const z = STAIR.flightZ0 + (i * (STAIR.flightZ1 - STAIR.flightZ0)) / 10;
        g.beginPath(); g.moveTo(X(STAIR.x0), Z(z)); g.lineTo(X(STAIR.x1), Z(z)); g.stroke();
      }
      // furniture footprints
      g.fillStyle = 'rgba(255,255,255,0.10)';
      for (const f of FURNITURE) {
        if (f.floor !== floor || f.type === 'rug') continue;
        const fp = footprint(f);
        g.fillRect(X(fp.x0), Z(fp.z0), (fp.x1 - fp.x0) * s, (fp.z1 - fp.z0) * s);
      }
      // walls
      for (const w of WALLS) {
        if (w.floor !== floor) continue;
        const { pieces } = wallPieces(w);
        g.strokeStyle = w.kind === 'glass' ? '#7fa8bf' : w.kind === 'ext' ? '#8a8f98' : '#b8b2a7';
        g.lineWidth = Math.max(1.2, (w.kind === 'ext' ? 0.3 : w.thickness) * s);
        for (const p of pieces) {
          if (p.bottom > 0) continue;
          g.beginPath();
          if (w.axis === 'x') { g.moveTo(X(p.from), Z(w.at)); g.lineTo(X(p.to), Z(w.at)); } else { g.moveTo(X(w.at), Z(p.from)); g.lineTo(X(w.at), Z(p.to)); }
          g.stroke();
        }
      }
      const sim = getSim();
      // doors: green when open, red when closed
      for (const d of DOORS) {
        if (d.floor !== floor) continue;
        const open = d.kind === 'elevator' ? sim.dyn.liftDoorOpenAt(floor) : sim.dyn.doors.get(d.id)?.open;
        g.strokeStyle = open ? '#4fd096' : '#ff6b6b';
        g.lineWidth = 2 * dpr;
        g.beginPath();
        if (d.axis === 'x') { g.moveTo(X(d.center - d.width / 2), Z(d.at)); g.lineTo(X(d.center + d.width / 2), Z(d.at)); } else { g.moveTo(X(d.at), Z(d.center - d.width / 2)); g.lineTo(X(d.at), Z(d.center + d.width / 2)); }
        g.stroke();
      }
      // labels
      g.fillStyle = 'rgba(236,232,225,0.55)';
      g.font = `${Math.round(8.5 * dpr)}px sans-serif`;
      g.textAlign = 'center';
      for (const r of ROOMS) {
        if (r.floor !== floor || r.hidden) continue;
        g.fillText(r.name.replace('Founder / CEO Office', 'CEO Office').replace('Portfolio Management', 'Portfolio Mgmt'), X((r.rect.x0 + r.rect.x1) / 2), Z((r.rect.z0 + r.rect.z1) / 2));
      }
      // people
      for (const e of sim.employees) {
        if (e.phase === 'away') continue;
        const f = Math.max(0, Math.min(2, Math.floor((e.y + 0.3) / 4)));
        if (f !== floor) continue;
        g.fillStyle = ACTIVITY_COLOR[e.activity];
        g.beginPath();
        g.arc(X(e.x), Z(e.z), 2.6 * dpr, 0, Math.PI * 2);
        g.fill();
      }
      // player
      const ui = useUI.getState();
      if ((ui.mode === 'walk' || ui.mode === 'seated') && player.floor === floor) {
        const px = X(player.x), pz = Z(player.z);
        g.save();
        g.translate(px, pz);
        g.rotate(-player.yaw);
        g.fillStyle = '#d0ab62';
        g.beginPath();
        g.moveTo(0, -7 * dpr);
        g.lineTo(5 * dpr, 5 * dpr);
        g.lineTo(0, 2.5 * dpr);
        g.lineTo(-5 * dpr, 5 * dpr);
        g.closePath();
        g.fill();
        g.restore();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [floor]);

  const onClick = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    const c = canvas.current!;
    const r = c.getBoundingClientRect();
    const s = r.width / (BLD.x1 + 0.6);
    const x = (ev.clientX - r.left) / s - 0.3;
    const z = (ev.clientY - r.top) / s - 0.3;
    const room = roomAt(floor, x, z);
    if (room && !room.hidden) goToRoom(room.id);
  };

  return (
    <div className="card" data-testid="minimap">
      <div className="row" style={{ marginBottom: 6 }}>
        <h3 style={{ margin: 0 }}>{FLOOR_NAMES[floor]}</h3>
        <span className="spacer" />
        {[0, 1, 2].map((f) => (
          <button key={f} className={`btn small ${floor === f ? 'active' : ''}`} onClick={() => setPinned(pinned === f ? null : f)} title={`Show ${FLOOR_NAMES[f]} on the map`}>{['G', '1', '2'][f]}</button>
        ))}
      </div>
      <canvas ref={canvas} className="minimap" onClick={onClick} title="Click a room to go there" />
      <div className="small muted" style={{ marginTop: 4 }}>{pinned !== null ? 'Map pinned · click the floor again to follow you' : 'Click a room to go there'}</div>
    </div>
  );
}
