// Readable HTML rendering of the same AppView the in-world canvas draws.
import type { AppView, Tone, Widget } from './types';

const toneClass = (t?: Tone) => (t ? `tone-${t}` : '');

function WidgetView({ w }: { w: Widget }) {
  switch (w.type) {
    case 'kpis':
      return (
        <div className="w-kpis">
          {w.items.map((k) => (
            <div className="kpi" key={k.label}>
              <span className="kpi-label">{k.label}</span>
              <span className={`kpi-value ${toneClass(k.tone)}`}>{k.value}</span>
            </div>
          ))}
        </div>
      );
    case 'table':
      return (
        <div className="w-table">
          {w.title && <h4>{w.title}</h4>}
          <div className="table-scroll">
            <table>
              <thead><tr>{w.columns.map((c, i) => <th key={i} className={w.align?.[i] === 'r' ? 'r' : ''}>{c}</th>)}</tr></thead>
              <tbody>
                {w.rows.length === 0 && <tr><td colSpan={w.columns.length} className="tone-muted">No rows yet</td></tr>}
                {w.rows.map((r, ri) => (
                  <tr key={ri}>{r.map((c, ci) => <td key={ci} className={`${w.align?.[ci] === 'r' ? 'r' : ''} ${toneClass(w.tones?.[ri]?.[ci])}`}>{c}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    case 'chart': {
      const s = w.series.length ? w.series : [0];
      let lo = Math.min(...s), hi = Math.max(...s);
      if (w.baseline !== undefined) { lo = Math.min(lo, w.baseline); hi = Math.max(hi, w.baseline); }
      if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
      const W = 600, H = 180;
      const X = (i: number) => (i / Math.max(1, s.length - 1)) * W;
      const Y = (v: number) => H - ((v - lo) / (hi - lo)) * (H - 10) - 5;
      const d = s.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
      const up = s[s.length - 1] >= (w.baseline ?? s[0]);
      return (
        <div className="w-chart">
          <h4>{w.title}</h4>
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={w.title}>
            {w.baseline !== undefined && <line x1="0" x2={W} y1={Y(w.baseline)} y2={Y(w.baseline)} className="baseline" />}
            <path d={`${d} L${W},${H} L0,${H} Z`} className={up ? 'area-pos' : 'area-neg'} />
            <path d={d} className={up ? 'line-pos' : 'line-neg'} />
          </svg>
          <div className="chart-axis"><span>low {fmt(lo)}</span><span>high {fmt(hi)}</span><span>last {fmt(s[s.length - 1])}</span></div>
          {w.footer && <div className="tone-muted small">{w.footer}</div>}
        </div>
      );
    }
    case 'bars':
      return (
        <div className="w-bars">
          <h4>{w.title}</h4>
          {w.items.map((it) => (
            <div className="bar-row" key={it.label}>
              <span className="bar-label">{it.label}</span>
              <span className="bar-track"><span className={`bar-fill ${toneClass(it.tone ?? 'accent')}`} style={{ width: `${Math.max(1, Math.min(100, (it.value / it.max) * 100))}%` }} /></span>
              <span className="bar-value">{it.text}</span>
            </div>
          ))}
        </div>
      );
    case 'text':
      return (
        <div className={`w-text ${w.large ? 'large' : ''}`}>
          {w.title && <h4>{w.title}</h4>}
          {w.lines.map((l, i) => <p key={i} className={l.startsWith('>') ? 'tone-accent' : ''}>{l || ' '}</p>)}
          {w.cursor && <span className="cursor" aria-hidden>▍</span>}
        </div>
      );
    case 'code':
      return (
        <div className="w-code">
          {w.title && <h4>{w.title}</h4>}
          <pre>
            {w.lines.map((l) => (
              <div key={l.n} className={l.n === w.cursorLine ? 'cur' : ''}><span className="ln">{String(l.n).padStart(4, ' ')}</span> <span className={toneClass(l.tone)}>{l.text}</span></div>
            ))}
          </pre>
        </div>
      );
    case 'alerts':
      return (
        <div className="w-alerts">
          {w.title && <h4>{w.title}</h4>}
          {w.items.map((a, i) => (
            <div key={i} className={`alert-row lvl-${a.level}`}><span className="dot" /> <span className="tone-muted">{a.time}</span> <span>{a.text}</span></div>
          ))}
        </div>
      );
  }
}

function fmt(v: number) {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}m`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return a >= 10 ? v.toFixed(2) : v.toFixed(4);
}

export function HtmlApp({ view, onTab }: { view: AppView; onTab?: (i: number) => void }) {
  return (
    <div className={`app-view theme-${view.theme}`} data-testid="app-view" data-minute={view.minute} data-tab={view.tab}>
      <div className="app-head">
        <strong>{view.title}</strong>
        {view.tabs.length > 0 && (
          <div className="app-tabs" role="tablist">
            {view.tabs.map((t, i) => (
              <button key={t} role="tab" aria-selected={i === view.tab} className={i === view.tab ? 'active' : ''} onClick={() => onTab?.(i)} disabled={!onTab}>{t}</button>
            ))}
          </div>
        )}
        <span className="app-time">{view.time}</span>
        <span className="sim-tag">{view.dataTag ?? 'Simulated Data'}</span>
      </div>
      {view.banner && <div className={`app-banner ${toneClass(view.banner.tone)}`}>{view.banner.text}</div>}
      <div className={`app-body layout-${view.layout}`}>
        {view.widgets.map((w, i) => <WidgetView key={i} w={w} />)}
      </div>
      {view.status && <div className="app-status">● {view.status}</div>}
    </div>
  );
}
