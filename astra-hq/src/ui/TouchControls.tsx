// On-screen joystick (move), drag area (look) and an interact button for touch devices.
import { useRef } from 'react';
import { input } from '../store/player';
import { useUI } from '../store/ui';

export function TouchControls({ onInteract }: { onInteract: () => void }) {
  const touch = useUI((s) => s.touch);
  const mode = useUI((s) => s.mode);
  const panel = useUI((s) => s.panel);
  const knob = useRef<HTMLDivElement>(null);
  const stickId = useRef<number | null>(null);
  const lookId = useRef<number | null>(null);
  const lookLast = useRef({ x: 0, y: 0 });
  if (!touch || (mode !== 'walk' && mode !== 'seated') || panel) return null;
  const capture = (e: React.PointerEvent<HTMLDivElement>) => {
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic or already released pointer */ }
  };

  const moveStick = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    let dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    let dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    const l = Math.hypot(dx, dy);
    if (l > 1) { dx /= l; dy /= l; }
    input.touchMove.x = dx;
    input.touchMove.y = -dy;
    if (knob.current) knob.current.style.transform = `translate(${dx * 34}px, ${dy * 34}px)`;
  };
  const endStick = () => {
    stickId.current = null;
    input.touchMove.x = input.touchMove.y = 0;
    if (knob.current) knob.current.style.transform = '';
  };
  return (
    <>
      {mode === 'walk' && (
        <div
          className="touch-stick"
          onPointerDown={(e) => { stickId.current = e.pointerId; capture(e); moveStick(e); }}
          onPointerMove={(e) => { if (stickId.current === e.pointerId) moveStick(e); }}
          onPointerUp={endStick}
          onPointerCancel={endStick}
          aria-label="Move joystick"
        >
          <div className="touch-knob" ref={knob} />
        </div>
      )}
      <div
        className="touch-look"
        onPointerDown={(e) => { lookId.current = e.pointerId; lookLast.current = { x: e.clientX, y: e.clientY }; capture(e); }}
        onPointerMove={(e) => {
          if (lookId.current !== e.pointerId) return;
          input.lookDX += (e.clientX - lookLast.current.x) * 1.4;
          input.lookDY += (e.clientY - lookLast.current.y) * 1.4;
          lookLast.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerUp={() => { lookId.current = null; }}
        onPointerCancel={() => { lookId.current = null; }}
        aria-label="Look area"
      />
      <button className="touch-act" onClick={onInteract} aria-label="Interact">●</button>
    </>
  );
}
