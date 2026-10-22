// Draws an AppView onto a 2D canvas used as an in-world screen texture.
import type { AppView, Theme, Tone, Widget } from './types';

interface Pal { bg: string; panel: string; text: string; muted: string; accent: string; pos: string; neg: string; warn: string; crit: string; grid: string; header: string }

export const PALETTES: Record<Theme, Pal> = {
  dark: { bg: '#0e1117', panel: '#151a22', text: '#dde2ea', muted: '#7f8a99', accent: '#d0ab62', pos: '#3fd08f', neg: '#ff6262', warn: '#ffb648', crit: '#ff4747', grid: '#232a35', header: '#1a2029' },
  light: { bg: '#f3f2ee', panel: '#ffffff', text: '#1f2329', muted: '#767c85', accent: '#8f6f2e', pos: '#1a9a5f', neg: '#cf3434', warn: '#b7770c', crit: '#cf2a2a', grid: '#dedbd4', header: '#e6e3dc' },
  terminal: { bg: '#0a0d0b', panel: '#0f1411', text: '#b9f2c9', muted: '#5f7d69', accent: '#7fd1ff', pos: '#5df29a', neg: '#ff6f6f', warn: '#ffd166', crit: '#ff5a5a', grid: '#1a241d', header: '#121813' },
  whiteboard: { bg: '#f7f7f4', panel: '#f7f7f4', text: '#1d3c86', muted: '#4b5563', accent: '#b3261e', pos: '#1c7a3e', neg: '#b3261e', warn: '#b26b00', crit: '#b3261e', grid: '#e4e4df', header: '#f7f7f4' },
  signage: { bg: '#17191d', panel: '#1f2226', text: '#efe9df', muted: '#9a958c', accent: '#d0ab62', pos: '#6fd39c', neg: '#ff7b7b', warn: '#ffc46b', crit: '#ff6b6b', grid: '#2b2f35', header: '#1f2226' },
};

const FONT = '"Inter", "Segoe UI", "Helvetica Neue", Arial, sans-serif';
const MONO = '"JetBrains Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace';

function toneColor(p: Pal, t?: Tone): string {
  switch (t) {
    case 'pos': return p.pos;
    case 'neg': return p.neg;
    case 'warn': return p.warn;
    case 'crit': return p.crit;
    case 'muted': return p.muted;
    case 'accent': return p.accent;
    default: return p.text;
  }
}

function clip(g: CanvasRenderingContext2D, s: string, w: number): string {
  if (g.measureText(s).width <= w) return s;
  let lo = 0, hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (g.measureText(s.slice(0, mid) + '…').width <= w) lo = mid; else hi = mid - 1;
  }
  return s.slice(0, lo) + '…';
}

interface Box { x: number; y: number; w: number; h: number }

export function drawAppView(g: CanvasRenderingContext2D, v: AppView, W: number, H: number) {
  const p = PALETTES[v.theme];
  const fs = Math.max(9, Math.round(H / 22));
  g.textBaseline = 'middle';
  g.fillStyle = p.bg;
  g.fillRect(0, 0, W, H);
  // header
  const hh = Math.round(fs * 1.9);
  g.fillStyle = p.header;
  g.fillRect(0, 0, W, hh);
  g.fillStyle = p.accent;
  g.fillRect(0, hh - 2, W, 2);
  g.font = `600 ${fs}px ${FONT}`;
  g.fillStyle = p.text;
  const title = clip(g, v.title, W * 0.42);
  g.fillText(title, fs * 0.6, hh / 2);
  // tabs
  let tx = fs * 0.6 + g.measureText(title).width + fs;
  g.font = `500 ${Math.round(fs * 0.85)}px ${FONT}`;
  v.tabs.forEach((t, i) => {
    const tw = g.measureText(t).width + fs * 0.9;
    if (tx + tw > W * 0.78) return;
    if (i === v.tab) {
      g.fillStyle = p.accent;
      g.globalAlpha = 0.18;
      g.fillRect(tx, hh * 0.18, tw, hh * 0.64);
      g.globalAlpha = 1;
      g.fillStyle = p.accent;
      g.fillRect(tx, hh * 0.82 - 2, tw, 2);
    }
    g.fillStyle = i === v.tab ? p.text : p.muted;
    g.fillText(t, tx + fs * 0.45, hh / 2);
    tx += tw + 4;
  });
  g.font = `600 ${Math.round(fs * 0.72)}px ${FONT}`;
  const sim = 'SIMULATED';
  const sw = g.measureText(sim).width + fs * 0.6;
  g.fillStyle = p.warn;
  g.globalAlpha = 0.85;
  g.fillRect(W - sw - fs * 0.4, hh * 0.25, sw, hh * 0.5);
  g.globalAlpha = 1;
  g.fillStyle = '#111';
  g.fillText(sim, W - sw - fs * 0.1, hh / 2);
  g.fillStyle = p.muted;
  g.font = `500 ${Math.round(fs * 0.85)}px ${MONO}`;
  const tm = g.measureText(v.time).width;
  g.fillText(v.time, W - sw - fs * 0.8 - tm, hh / 2);

  let y = hh + 2;
  if (v.banner) {
    const bh = Math.round(fs * 1.5);
    g.fillStyle = toneColor(p, v.banner.tone);
    g.globalAlpha = 0.22;
    g.fillRect(0, y, W, bh);
    g.globalAlpha = 1;
    g.fillRect(0, y, 4, bh);
    g.fillStyle = toneColor(p, v.banner.tone);
    g.font = `700 ${Math.round(fs * 0.82)}px ${FONT}`;
    g.fillText(clip(g, v.banner.text, W - fs * 1.5), fs * 0.7, y + bh / 2);
    y += bh + 2;
  }
  let bottom = H - 2;
  if (v.status) {
    const sh = Math.round(fs * 1.3);
    bottom = H - sh;
    g.fillStyle = p.header;
    g.fillRect(0, bottom, W, sh);
    g.fillStyle = p.muted;
    g.font = `500 ${Math.round(fs * 0.75)}px ${FONT}`;
    g.fillText(clip(g, `● ${v.status}`, W - fs), fs * 0.6, bottom + sh / 2);
  }
  const area: Box = { x: fs * 0.5, y: y + fs * 0.3, w: W - fs, h: bottom - y - fs * 0.5 };
  layout(g, p, v, area, fs);
}

function weight(w: Widget): number {
  switch (w.type) {
    case 'kpis': return 0.55;
    case 'bars': return Math.min(2.2, 0.5 + w.items.length * 0.32);
    case 'text': return Math.min(3, 0.5 + w.lines.length * 0.3);
    default: return 2.2;
  }
}

function layout(g: CanvasRenderingContext2D, p: Pal, v: AppView, a: Box, fs: number) {
  const ws = v.widgets;
  if (!ws.length) return;
  if (v.layout === 'grid' && ws.length > 1) {
    // first widget on the left half, the rest stacked on the right
    const left: Box = { x: a.x, y: a.y, w: a.w * 0.48, h: a.h };
    drawWidget(g, p, ws[0], left, fs);
    stack(g, p, ws.slice(1), { x: a.x + a.w * 0.51, y: a.y, w: a.w * 0.49, h: a.h }, fs);
    return;
  }
  stack(g, p, ws, a, fs);
}

function stack(g: CanvasRenderingContext2D, p: Pal, ws: Widget[], a: Box, fs: number) {
  const total = ws.reduce((s, w) => s + weight(w), 0);
  let y = a.y;
  for (const w of ws) {
    const h = (a.h * weight(w)) / total;
    drawWidget(g, p, w, { x: a.x, y, w: a.w, h: h - fs * 0.35 }, fs);
    y += h;
  }
}

function sectionTitle(g: CanvasRenderingContext2D, p: Pal, t: string | undefined, b: Box, fs: number): number {
  if (!t) return 0;
  g.font = `600 ${Math.round(fs * 0.8)}px ${FONT}`;
  g.fillStyle = p.muted;
  g.fillText(clip(g, t.toUpperCase(), b.w), b.x, b.y + fs * 0.5);
  return fs * 1.15;
}

function drawWidget(g: CanvasRenderingContext2D, p: Pal, w: Widget, b: Box, fs: number) {
  g.save();
  g.beginPath();
  g.rect(b.x - 1, b.y - 1, b.w + 2, b.h + 2);
  g.clip();
  switch (w.type) {
    case 'kpis': {
      const n = w.items.length;
      const cw = b.w / n;
      w.items.forEach((k, i) => {
        const x = b.x + i * cw;
        g.fillStyle = p.panel;
        g.fillRect(x + 2, b.y, cw - 4, b.h);
        g.fillStyle = p.muted;
        g.font = `500 ${Math.round(fs * 0.72)}px ${FONT}`;
        g.fillText(clip(g, k.label, cw - fs), x + fs * 0.5, b.y + b.h * 0.3);
        g.fillStyle = toneColor(p, k.tone);
        g.font = `700 ${Math.round(Math.min(fs * 1.3, b.h * 0.4))}px ${FONT}`;
        g.fillText(clip(g, k.value, cw - fs), x + fs * 0.5, b.y + b.h * 0.68);
      });
      break;
    }
    case 'table': {
      let y = b.y + sectionTitle(g, p, w.title, b, fs);
      const rh = Math.round(fs * 1.25);
      g.font = `500 ${Math.round(fs * 0.82)}px ${FONT}`;
      const n = w.columns.length;
      const lens = w.columns.map((c, i) => Math.max(c.length, ...w.rows.slice(0, 12).map((r) => (r[i] ?? '').length)) + 2);
      const sum = lens.reduce((s, x) => s + x, 0);
      const cws = lens.map((l) => (b.w * l) / sum);
      g.fillStyle = p.header;
      g.fillRect(b.x, y, b.w, rh);
      let x = b.x;
      for (let i = 0; i < n; i++) {
        g.fillStyle = p.muted;
        const right = w.align?.[i] === 'r';
        const t = clip(g, w.columns[i], cws[i] - 6);
        g.textAlign = right ? 'right' : 'left';
        g.fillText(t, right ? x + cws[i] - 4 : x + 4, y + rh / 2);
        x += cws[i];
      }
      y += rh;
      g.font = `400 ${Math.round(fs * 0.85)}px ${MONO}`;
      const maxRows = Math.max(0, Math.floor((b.y + b.h - y) / rh));
      w.rows.slice(0, maxRows).forEach((r, ri) => {
        if (ri % 2) { g.fillStyle = p.panel; g.fillRect(b.x, y, b.w, rh); }
        let cx = b.x;
        for (let i = 0; i < n; i++) {
          const right = w.align?.[i] === 'r';
          g.textAlign = right ? 'right' : 'left';
          g.fillStyle = toneColor(p, w.tones?.[ri]?.[i]);
          g.fillText(clip(g, r[i] ?? '', cws[i] - 6), right ? cx + cws[i] - 4 : cx + 4, y + rh / 2);
          cx += cws[i];
        }
        y += rh;
      });
      g.textAlign = 'left';
      if (w.rows.length > maxRows && maxRows > 0) {
        g.fillStyle = p.muted;
        g.font = `500 ${Math.round(fs * 0.7)}px ${FONT}`;
        g.textAlign = 'right';
        g.fillText(`+${w.rows.length - maxRows} more`, b.x + b.w - 4, b.y + b.h - fs * 0.4);
        g.textAlign = 'left';
      }
      break;
    }
    case 'chart': {
      const th = sectionTitle(g, p, w.title, b, fs);
      const fh = w.footer ? fs * 1.1 : 0;
      const c: Box = { x: b.x, y: b.y + th, w: b.w, h: b.h - th - fh };
      g.fillStyle = p.panel;
      g.fillRect(c.x, c.y, c.w, c.h);
      const s = w.series.length ? w.series : [0];
      let lo = Math.min(...s), hi = Math.max(...s);
      if (w.baseline !== undefined) { lo = Math.min(lo, w.baseline); hi = Math.max(hi, w.baseline); }
      if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
      const pad = (hi - lo) * 0.08;
      lo -= pad; hi += pad;
      const X = (i: number) => c.x + (i / Math.max(1, s.length - 1)) * c.w;
      const Y = (v: number) => c.y + c.h - ((v - lo) / (hi - lo)) * c.h;
      g.strokeStyle = p.grid;
      g.lineWidth = 1;
      for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(c.x, c.y + (c.h * i) / 4); g.lineTo(c.x + c.w, c.y + (c.h * i) / 4); g.stroke(); }
      if (w.baseline !== undefined) {
        g.setLineDash([4, 4]);
        g.strokeStyle = p.muted;
        g.beginPath(); g.moveTo(c.x, Y(w.baseline)); g.lineTo(c.x + c.w, Y(w.baseline)); g.stroke();
        g.setLineDash([]);
      }
      const up = s[s.length - 1] >= (w.baseline ?? s[0]);
      const col = w.color ?? (up ? p.pos : p.neg);
      const grd = g.createLinearGradient(0, c.y, 0, c.y + c.h);
      grd.addColorStop(0, col + '55');
      grd.addColorStop(1, col + '00');
      g.beginPath();
      g.moveTo(X(0), c.y + c.h);
      s.forEach((v, i) => g.lineTo(X(i), Y(v)));
      g.lineTo(X(s.length - 1), c.y + c.h);
      g.fillStyle = grd;
      g.fill();
      g.beginPath();
      s.forEach((v, i) => (i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))));
      g.strokeStyle = col;
      g.lineWidth = Math.max(1.5, fs / 8);
      g.stroke();
      g.fillStyle = p.muted;
      g.font = `400 ${Math.round(fs * 0.7)}px ${MONO}`;
      g.textAlign = 'right';
      g.fillText(fmtAxis(hi - pad), c.x + c.w - 3, c.y + fs * 0.5);
      g.fillText(fmtAxis(lo + pad), c.x + c.w - 3, c.y + c.h - fs * 0.5);
      g.textAlign = 'left';
      if (w.footer) { g.font = `500 ${Math.round(fs * 0.72)}px ${FONT}`; g.fillText(clip(g, w.footer, b.w), b.x, b.y + b.h - fh / 2); }
      break;
    }
    case 'bars': {
      const th = sectionTitle(g, p, w.title, b, fs);
      const n = Math.max(1, w.items.length);
      const rh = Math.min(fs * 1.6, (b.h - th) / n);
      const lw = b.w * 0.24;
      const vw = b.w * 0.3;
      w.items.forEach((it, i) => {
        const y = b.y + th + i * rh;
        g.fillStyle = p.muted;
        g.font = `500 ${Math.round(fs * 0.78)}px ${FONT}`;
        g.fillText(clip(g, it.label, lw - 4), b.x, y + rh / 2);
        const bw = b.w - lw - vw;
        g.fillStyle = p.panel;
        g.fillRect(b.x + lw, y + rh * 0.22, bw, rh * 0.56);
        g.fillStyle = toneColor(p, it.tone ?? 'accent');
        g.fillRect(b.x + lw, y + rh * 0.22, Math.max(2, Math.min(1, it.value / it.max) * bw), rh * 0.56);
        g.fillStyle = p.text;
        g.font = `500 ${Math.round(fs * 0.78)}px ${MONO}`;
        g.fillText(clip(g, it.text, vw - 6), b.x + lw + bw + 6, y + rh / 2);
      });
      break;
    }
    case 'text': {
      let y = b.y + sectionTitle(g, p, w.title, b, fs);
      const lf = w.large ? Math.round(fs * 1.25) : Math.round(fs * 0.86);
      const lh = Math.round(lf * 1.45);
      g.font = `${w.large ? 600 : 400} ${lf}px ${FONT}`;
      for (const line of w.lines) {
        if (y + lh > b.y + b.h + 2) break;
        g.fillStyle = line.startsWith('>') ? p.accent : p.text;
        g.fillText(clip(g, line, b.w - 4), b.x, y + lh / 2);
        y += lh;
      }
      if (w.cursor && (Date.now() / 500) % 2 < 1) {
        g.fillStyle = p.accent;
        g.fillRect(b.x, Math.min(y, b.y + b.h - lh) + lh * 0.2, lf * 0.5, lh * 0.6);
      }
      break;
    }
    case 'code': {
      let y = b.y + sectionTitle(g, p, w.title, b, fs);
      const lh = Math.round(fs * 1.15);
      g.font = `400 ${Math.round(fs * 0.82)}px ${MONO}`;
      for (const l of w.lines) {
        if (y + lh > b.y + b.h) break;
        if (l.n === w.cursorLine) { g.fillStyle = p.panel; g.fillRect(b.x, y, b.w, lh); }
        g.fillStyle = p.muted;
        g.fillText(String(l.n).padStart(4, ' '), b.x, y + lh / 2);
        g.fillStyle = toneColor(p, l.tone);
        g.fillText(clip(g, l.text, b.w - fs * 3.2), b.x + fs * 3, y + lh / 2);
        if (l.n === w.cursorLine) { g.fillStyle = p.accent; g.fillRect(b.x + fs * 3 + g.measureText(l.text).width + 2, y + 2, 2, lh - 4); }
        y += lh;
      }
      break;
    }
    case 'alerts': {
      let y = b.y + sectionTitle(g, p, w.title, b, fs);
      const lh = Math.round(fs * 1.25);
      g.font = `400 ${Math.round(fs * 0.8)}px ${FONT}`;
      for (const it of w.items) {
        if (y + lh > b.y + b.h) break;
        g.fillStyle = it.level === 'crit' ? p.crit : it.level === 'warn' ? p.warn : p.muted;
        g.beginPath();
        g.arc(b.x + fs * 0.35, y + lh / 2, fs * 0.22, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = p.muted;
        g.fillText(it.time, b.x + fs * 0.9, y + lh / 2);
        g.fillStyle = it.level === 'crit' ? p.crit : p.text;
        g.fillText(clip(g, it.text, b.w - fs * 4), b.x + fs * 3.6, y + lh / 2);
        y += lh;
      }
      break;
    }
  }
  g.restore();
}

function fmtAxis(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}m`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  if (a >= 10) return v.toFixed(1);
  return v.toFixed(3);
}

/** Company wordmark used on signage. */
export function drawLogo(g: CanvasRenderingContext2D, W: number, H: number, name: string, opts: { bg?: string; color?: string; sub?: string } = {}) {
  if (opts.bg) { g.fillStyle = opts.bg; g.fillRect(0, 0, W, H); } else g.clearRect(0, 0, W, H);
  const color = opts.color ?? '#d0ab62';
  const mark = H * 0.62;
  g.font = `600 ${Math.round(H * 0.42)}px ${FONT}`;
  const label = name.toUpperCase().split('').join(' ');
  const tw = g.measureText(label).width;
  const total = mark * 0.9 + H * 0.18 + tw;
  let x = (W - total) / 2;
  const cy = opts.sub ? H * 0.42 : H / 2;
  // triangle mark
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(x + mark * 0.45, cy - mark / 2);
  g.lineTo(x + mark * 0.9, cy + mark / 2);
  g.lineTo(x + mark * 0.68, cy + mark / 2);
  g.lineTo(x + mark * 0.45, cy - mark * 0.05);
  g.lineTo(x + mark * 0.22, cy + mark / 2);
  g.lineTo(x, cy + mark / 2);
  g.closePath();
  g.fill();
  x += mark * 0.9 + H * 0.18;
  g.textBaseline = 'middle';
  g.fillText(label, x, cy + H * 0.02);
  if (opts.sub) {
    g.font = `500 ${Math.round(H * 0.13)}px ${FONT}`;
    g.globalAlpha = 0.75;
    const sw = g.measureText(opts.sub).width;
    g.fillText(opts.sub, (W - sw) / 2, H * 0.86);
    g.globalAlpha = 1;
  }
}
