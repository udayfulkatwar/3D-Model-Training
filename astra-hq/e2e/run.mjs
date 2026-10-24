// Browser acceptance checks against the production build (dist/), in headless Chromium.
// Usage: npm run build && node e2e/run.mjs
// Rendering uses SwiftShader (software GL), so frame rates here say nothing about real GPUs.
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright-core';

const root = path.resolve(import.meta.dirname, '..', 'dist');
const out = path.resolve(import.meta.dirname, 'output');
await fs.mkdir(out, { recursive: true });
const exe = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = http.createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(root, p === '/' ? 'index.html' : p);
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    const body = await fs.readFile(file);
    res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = [];
const pageErrors = [];
let current = '';
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
// ONLY=load,enter,chairman runs just the steps whose names contain one of these (quick local iteration)
const only = process.env.ONLY?.split(',');
const step = async (name, fn) => {
  if (only && !only.some((o) => name.includes(o))) return;
  current = name;
  try { await fn(); } catch (e) { check(name, false, `exception: ${e.message.split('\n')[0]}`); }
};

const ctx = await browser.newContext({ viewport: { width: Number(process.env.W ?? 960), height: Number(process.env.H ?? 570) }, acceptDownloads: true });
// Low preset keeps software rendering responsive enough for interaction tests.
await ctx.addInitScript(() => {
  try {
    if (!localStorage.getItem('astra-hq:settings:v1')) localStorage.setItem('astra-hq:settings:v1', JSON.stringify({ graphics: 'low', showFps: true }));
  } catch { /* about:blank has no storage */ }
});
const page = await ctx.newPage();
page.on('pageerror', (e) => pageErrors.push(`[${current}] ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(`[${current}] console: ${m.text()}`); });
page.on('dialog', (d) => d.accept());
const external = [];
ctx.on('request', (r) => { const u = new URL(r.url()); if (!['127.0.0.1', 'localhost'].includes(u.hostname) && !u.protocol.startsWith('data') && !u.protocol.startsWith('blob')) external.push(r.url()); });

const A = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
const P = () => A(() => { const p = window.__astra.player; return { x: p.x, y: p.y, z: p.z, floor: p.floor }; });
async function teleport(f, x, z, yaw = 0, pitch = 0) {
  const seq = await A(([f, x, z, yaw]) => { const a = window.__astra; a.ui.getState().closePanel(); a.teleport({ floor: f, x, z, yaw }); return a.player.teleportSeq; }, [f, x, z, yaw]);
  await waitTeleport(seq);
  await A((p) => { window.__astra.player.pitch = p; }, pitch);
}
async function waitTeleport(seq) {
  await page.waitForFunction((s) => window.__astra.player.teleportSeq > s && window.__astra.ui.getState().fade === 0, seq, { timeout: 60000 });
  await wait(300);
}
async function hold(key, ms) {
  await page.keyboard.down(key);
  await wait(ms);
  await page.keyboard.up(key);
  await wait(200);
}
/** Walk forward until the player stops moving or the time budget is used. */
async function walkUntilStopped(key, maxMs) {
  await page.keyboard.down(key);
  let last = await P();
  let still = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    await wait(1500);
    const p = await P();
    // ~1 fps under software rendering with occasional multi-second frame stalls: require 4.5 s without movement
    if (Math.hypot(p.x - last.x, p.z - last.z) < 0.01) { if (++still >= 3) break; } else still = 0;
    last = p;
  }
  await page.keyboard.up(key);
  return last;
}
/** Wait until the centre-of-view prompt matches, then press E. */
async function useWhenPrompt(re, timeout = 30000) {
  await page.waitForFunction((src) => new RegExp(src).test(window.__astra.ui.getState().prompt ?? ''), re.source, { timeout });
  await page.keyboard.press('KeyE');
}
async function shot(name) {
  await page.screenshot({ path: path.join(out, `${name}.png`) });
}

await step('load', async () => {
  // the accelerated, seeded test harness for the legacy behaviour checks; the real office is checked further down
  await page.goto(`${base}?office=test-sim`);
  await page.waitForFunction(() => window.__astra?.sim && document.querySelector('canvas'), null, { timeout: 60000 });
  await wait(3000);
  const txt = await page.textContent('body');
  check('App loads with intro, Office Simulation and Simulated Data labels', txt.includes('OFFICE SIMULATION') && txt.includes('Simulated Data') && await page.isVisible('[data-testid=intro]'));
  const n = await A(() => window.__astra.sim().employees.length);
  check('30 employees exist', n === 30, `${n}`);
  await shot('01-intro-exterior');
});

await step('enter office', async () => {
  await page.click('[data-testid=enter-office]');
  await wait(1500);
  const s = await A(() => ({ mode: window.__astra.ui.getState().mode, locked: window.__astra.ui.getState().pointerLocked }));
  check('Enter Office switches to walkthrough', s.mode === 'walk', `pointer lock ${s.locked ? 'granted' : 'not granted in headless; drag-look fallback active'}`);
  const p = await P();
  check('Spawn point is at reception, on the floor', Math.abs(p.y) < 0.01 && Math.hypot(p.x - 19, p.z - 17.6) < 0.5, JSON.stringify(p));
  const valid = await A(() => { const a = window.__astra; return true; });
  void valid;
  await page.addStyleTag({ content: '.resume{display:none!important}' });
  await wait(2500);
  await shot('02-reception');
});

await step('movement and collision', async () => {
  await teleport(0, 19, 17.6, 0);
  const p0 = await P();
  await hold('KeyW', 4000);
  const p1 = await P();
  check('W moves the player forward (north)', p1.z < p0.z - 0.3, `${p0.z.toFixed(2)} -> ${p1.z.toFixed(2)}`);
  const p2 = await walkUntilStopped('KeyW', 20000);
  // reception desk front edge at z = 14.45; player radius 0.27
  check('Collision stops the player at the reception desk', p2.z > 14.6 && p2.z < 15.3, `stopped at z=${p2.z.toFixed(2)}`);
  // walls: walk west in the café into the exterior wall
  await teleport(0, 3.0, 15.0, Math.PI / 2);
  const w = await walkUntilStopped('KeyW', 20000);
  check('Exterior wall blocks movement', w.x > 0.3 && w.x < 2.2, `stopped at x=${w.x.toFixed(2)}`);
  const valid = await A(() => window.__astra.player.invalidTime === 0);
  check('Player position stays valid', valid);
});

await step('doors', async () => {
  // utility room door is closed by default
  await teleport(0, 2.2, 7.3, 0, -0.05);
  const closed = await A(() => !window.__astra.sim().dyn.doors.get('g-d-utility').open);
  const p = await walkUntilStopped('KeyW', 12000);
  check('Closed door blocks the player', closed && p.z > 6.0, `z=${p.z.toFixed(2)}`);
  await teleport(0, 2.2, 7.0, 0, -0.1);
  await useWhenPrompt(/Open Utility/);
  const prompt = await page.textContent('[data-testid=prompt]').catch(() => '');
  await page.waitForFunction(() => window.__astra.sim().dyn.doors.get('g-d-utility').t > 0.95, null, { timeout: 20000 }).catch(() => {});
  const open = await A(() => window.__astra.sim().dyn.doors.get('g-d-utility').open);
  check('Door opens with E when aimed at (prompt shown)', open && /Open/.test(prompt), prompt);
  const p2 = await walkUntilStopped('KeyW', 15000);
  check('Open door lets the player through', p2.z < 5.6, `z=${p2.z.toFixed(2)}`);
});

await step('stairs', async () => {
  // staff now arrive from 06:45 and use the same stairs; keep them off-site so nobody blocks the flight
  await A(() => { const s = window.__astra.sim(); s.reset(); s.paused = true; });
  await teleport(0, 18.45, 5.1, 0);
  await walkUntilStopped('KeyW', 20000);
  let p = await P();
  check('Flight A climbs to the mid landing', Math.abs(p.y - 2) < 0.15, `y=${p.y.toFixed(2)} z=${p.z.toFixed(2)}`);
  await A(() => { window.__astra.player.yaw = -Math.PI / 2; });
  await walkUntilStopped('KeyW', 15000);
  await A(() => { window.__astra.player.yaw = Math.PI; });
  for (let i = 0; i < 4; i++) {
    await walkUntilStopped('KeyW', 20000);
    p = await P();
    if (p.floor === 1) break;
  }
  p = await P();
  check('Flight B reaches the first floor', Math.abs(p.y - 4) < 0.05 && p.floor === 1, `y=${p.y.toFixed(2)} floor=${p.floor}`);
  await A(() => { window.__astra.player.yaw = 0; window.__astra.player.pitch = 0; });
  await wait(1500);
  await shot('03-stairwell');
  await A(() => { window.__astra.sim().paused = false; });
});

await step('elevator', async () => {
  await teleport(0, 22.1, 7.4, 0);
  await A(() => window.__astra.sim().dyn.callLift(0));
  await page.waitForFunction(() => window.__astra.sim().dyn.liftDoorOpenAt(0), null, { timeout: 30000 });
  await walkUntilStopped('KeyW', 15000);
  let p = await P();
  check('Player can walk into the elevator car', p.z < 5.6 && p.z > 3.4, `z=${p.z.toFixed(2)}`);
  await A(() => window.__astra.ui.getState().openPanel({ kind: 'elevator' }));
  await page.click('[data-testid=lift-2]');
  await page.waitForFunction(() => { const l = window.__astra.sim().dyn.lift; return l.floor === 2 && l.phase !== 'moving' && l.doorT > 0.9; }, null, { timeout: 90000 });
  await wait(500);
  p = await P();
  check('Elevator carries the player to the second floor', Math.abs(p.y - 8) < 0.05, `y=${p.y.toFixed(2)}`);
  await A(() => { window.__astra.player.yaw = Math.PI; });
  await hold('KeyS', 10);
  await walkUntilStopped('KeyW', 15000);
  p = await P();
  check('Player exits the elevator on the second floor', p.z > 6.2 && Math.abs(p.y - 8) < 0.05, `z=${p.z.toFixed(2)} y=${p.y.toFixed(2)}`);
});

await step('overview and floor selection', async () => {
  await page.click('text=Overview');
  await wait(1500);
  for (const f of [0, 1, 2]) {
    await page.click(`.left-dock .floor-buttons button:nth-child(${f + 1})`);
    await wait(1200);
    const st = await A(() => ({ mode: window.__astra.ui.getState().mode, f: window.__astra.ui.getState().overviewFloor, vis: window.__astra.vis ? [...window.__astra.vis.floors] : null }));
    check(`Overview cutaway selects floor ${f}`, st.mode === 'overview' && st.f === f && (!st.vis || (st.vis[f] && (f === 2 || !st.vis[f + 1]))), JSON.stringify(st));
  }
  await wait(2500);
  await shot('04-overview-floor2');
  await page.click('.left-dock .floor-buttons button:nth-child(2)');
  await wait(3500);
  await shot('05-overview-floor1');
});

await step('morning arrivals through the entrance', async () => {
  await page.keyboard.press('Escape');
  const empty = await A(() => { const s = window.__astra.sim(); s.reset(); return { onSite: s.employees.filter((e) => s.onSite(e)).length, minute: s.minute }; });
  check('The day starts with an empty building (everyone off-site)', empty.onSite === 0, JSON.stringify(empty));
  // real-time clock option: one simulated minute per real minute
  await A(() => window.__astra.ui.getState().updateSettings({ realtimeClock: true }));
  const r0 = await A(() => window.__astra.sim().minute);
  await wait(3000);
  const r1 = await A(() => window.__astra.sim().minute);
  await A(() => window.__astra.ui.getState().updateSettings({ realtimeClock: false }));
  check('Real-time clock runs 1 simulated minute per real minute', r1 > r0 && r1 - r0 < 0.15, `${((r1 - r0) * 60).toFixed(1)} simulated s in 3 real s`);
  await teleport(0, 19, 16.4, Math.PI, 0.02);
  await A(() => { const s = window.__astra.sim(); s.speed = 5; while (s.minute < 6 * 60 + 58) s.advance(0.5); s.speed = 1; });
  await wait(4000);
  await shot('19-morning-arrivals');
  await A(() => { const s = window.__astra.sim(); s.speed = 5; while (s.minute < 7 * 60 + 50) s.advance(0.5); s.speed = 1; });
  const st = await A(() => { const s = window.__astra.sim(); return { onSite: s.employees.filter((e) => s.onSite(e)).length, badged: s.employees.filter((e) => e.badge.in !== null).length, lift: s.employees.filter((e) => e.history.some((h) => /by lift/.test(h.text))).length }; });
  check('Staff badge in at the entrance and walk to their floors (stairs and lift)', st.onSite >= 20 && st.badged === st.onSite && st.lift > 0, JSON.stringify(st));
});

await step('directory search and go to employee', async () => {
  await page.keyboard.press('Escape');
  await A(() => window.__astra.ui.getState().openPanel({ kind: 'directory' }));
  await page.fill('[data-testid=directory-search]', 'Kenji');
  const count = await page.locator('[data-testid^=dir-]').count();
  check('Directory search filters employees', count === 1, `${count} result(s)`);
  // typing in the search box must not move the player
  const before = await P();
  await page.type('[data-testid=directory-search]', 'wwwwsss');
  await wait(800);
  const after = await P();
  check('Typing in menus does not move the player', Math.hypot(after.x - before.x, after.z - before.z) < 0.01);
  await page.fill('[data-testid=directory-search]', 'Kenji');
  const seq0 = await A(() => window.__astra.player.teleportSeq);
  await page.click('[data-testid=goto-e06]');
  await waitTeleport(seq0);
  await wait(800);
  const d = await A(() => { const e = window.__astra.sim().byId.get('e06'); const p = window.__astra.player; return { d: Math.hypot(e.x - p.x, e.z - p.z), sameFloor: Math.floor((e.y + 0.3) / 4) === p.floor }; });
  check('Go to Employee places the player next to them', d.d < 2.8 && d.sameFloor, `distance ${d.d.toFixed(2)} m`);
});

await step('employee profile actions', async () => {
  await A(() => window.__astra.ui.getState().openPanel({ kind: 'employee', id: 'e03' }));
  const txt = await page.textContent('[data-testid=employee-panel]');
  check('Profile shows task, activity, department and workstation', txt.includes('Current task') && txt.includes('Trading') && txt.includes('ws-trade-02'));
  await page.click('[data-testid=inspect-monitors]');
  await wait(1500);
  const mon = await page.textContent('[data-testid=monitor-id]');
  check('Inspect Monitors opens the employee monitor panel', mon.startsWith('ws-trade-02-m'), mon);
  await A(() => window.__astra.ui.getState().openPanel({ kind: 'employee', id: 'e03' }));
  const seq1 = await A(() => window.__astra.player.teleportSeq);
  await page.click('[data-testid=go-desk]');
  await waitTeleport(seq1);
  await wait(600);
  const nd = await A(() => { const p = window.__astra.player; return Math.hypot(p.x - 8.6, p.z - 11.8); });
  check('Go to Desk moves the player to the workstation', nd < 2.6, `${nd.toFixed(2)} m from desk`);
  await A(() => window.__astra.ui.getState().openPanel({ kind: 'employee', id: 'e03' }));
  await page.click('[data-testid=follow]');
  await wait(2500);
  const m = await A(() => window.__astra.ui.getState().mode);
  check('Follow Employee switches to follow camera', m === 'follow');
});

await step('monitor panel sync', async () => {
  await A(() => window.__astra.ui.getState().openPanel({ kind: 'monitor', monitorId: 'ws-trade-02-m3' }));
  await wait(1500);
  await page.click('[data-testid=app-view] .app-tabs button:nth-child(1)');
  await page.waitForFunction(() => document.querySelector('[data-testid=drawn-tab]')?.textContent === document.querySelector('[data-testid=panel-tab]')?.textContent, null, { timeout: 20000 });
  const tabs = await A(() => ({ sim: window.__astra.sim().monitorState('ws-trade-02-m3').tab, drawn: document.querySelector('[data-testid=drawn-tab]').textContent, panel: document.querySelector('[data-testid=panel-tab]').textContent }));
  check('Switching a panel tab switches the in-world monitor (same state)', tabs.sim === 0 && tabs.drawn === tabs.panel, JSON.stringify(tabs));
  await page.click('[data-testid=app-view] .app-tabs button:nth-child(2)');
  await page.waitForFunction(() => document.querySelector('[data-testid=drawn-tab]')?.textContent === 'Trade blotter', null, { timeout: 20000 });
  check('In-world screen redraws to the selected tab', true);
  await page.click('[data-testid=switch-ws-trade-02-m1]');
  await wait(800);
  check('Monitor switching within the workstation works', (await page.textContent('[data-testid=monitor-id]')) === 'ws-trade-02-m1');
  // every assigned monitor produces a role application with content
  const all = await A(() => {
    const s = window.__astra.sim();
    const bad = [];
    for (const e of s.employees) for (const m of e.ws.monitors) {
      const st = s.monitorState(m.id);
      if (!st || st.appId === 'flex-idle') bad.push(m.id);
    }
    return { bad, n: s.employees.reduce((k, e) => k + e.ws.monitors.length, 0) };
  });
  check('Every assigned monitor runs a role application', all.bad.length === 0, `${all.n} monitors`);
  await shot('06-monitor-inspection');
  await page.click('[data-testid=close-panel]');
});

await step('meetings and room displays', async () => {
  await A(() => { const s = window.__astra.sim(); s.speed = 5; while (s.minute < 8 * 60 + 12) s.advance(0.5); });
  await A(() => window.__astra.ui.getState().openPanel({ kind: 'wall', panelId: 'p-disp-f-conf' }));
  await wait(1200);
  const txt = await page.textContent('[data-testid=wall-panel]');
  const present = await A(() => { const s = window.__astra.sim(); const ev = s.events.find((e) => e.kind === 'briefing'); return { present: s.presentAttendees(ev).length, total: ev.attendeeIds.length }; });
  check('Conference room display shows the live briefing and attendees', txt.includes('Morning Market Briefing') && txt.includes('IN USE') && present.present >= 10, `${present.present}/${present.total} present`);
  await page.click('[data-testid=close-panel]');
  await teleport(1, 30.5, 5.1, 0.95, -0.25);
  await wait(2500);
  await shot('07-conference-briefing');
});

await step('risk breach chain', async () => {
  await A(() => { const s = window.__astra.sim(); while (s.minute < 14 * 60 + 25) s.advance(0.5); });
  const r = await A(() => {
    const s = window.__astra.sim();
    const a = s.finance.alerts.find((x) => x.metric === 'drawdown');
    const ev = a && s.events.find((e) => e.alertId === a.id);
    return { alert: a ? a.status : null, review: ev ? ev.status : null, pm: ev ? ev.attendeeIds.includes(s.finance.pmByBook.get(a.bookId)) : false, room: ev?.roomId };
  });
  check('Simulated breach creates an alert and a review meeting with the PM', r.alert && r.review && r.pm, JSON.stringify(r));
  await A(() => window.__astra.ui.getState().openPanel({ kind: 'monitor', monitorId: 'ws-risk-01-m2' }));
  await wait(1200);
  for (let i = 0; i < 3 && !(await A(() => window.__astra.sim().monitorState('ws-risk-01-m2').tab === 1)); i++) {
    await page.click('[data-testid=app-view] .app-tabs button:nth-child(2)');
    await wait(1500);
  }
  const t = await page.textContent('[data-testid=app-view]');
  check('Risk application lists the alert lifecycle', /RA\d+/.test(t) && /(drawdown)/i.test(t), t.slice(0, 120));
  await page.click('[data-testid=close-panel]');
});

await step('clock controls (test harness only; the real office has none)', async () => {
  const ui = await A(() => document.querySelectorAll('[data-testid=pause], [data-testid^=speed-], [data-testid=reset]').length);
  check('No pause, speed or reset controls in the UI', ui === 0, `${ui} controls`);
  await A(() => { window.__astra.sim().paused = true; });
  const m0 = await A(() => window.__astra.sim().minute);
  await wait(2500);
  const m1 = await A(() => window.__astra.sim().minute);
  check('Harness pause freezes the clock', m1 === m0);
  await A(() => { const s = window.__astra.sim(); s.paused = false; s.reset(); });
  const after = await A(() => ({ minute: window.__astra.sim().minute, trades: window.__astra.sim().finance.trades.length, alerts: window.__astra.sim().finance.alerts.length }));
  check('Harness reset restarts the seeded day', after.minute < 7 * 60 + 42 && after.trades === 0 && after.alerts === 0, JSON.stringify(after));
});

await step('interactions: chair, coffee, CEO desk', async () => {
  // boardroom chair s-board-s1 at (12.93, 12.92) heading 0 (faces +z); stand behind it facing it
  const seat = await A(() => { const s = window.__astra.sim(); return null; });
  void seat;
  await teleport(2, 13.0, 11.3, Math.PI, -0.55);
  await useWhenPrompt(/Sit down/);
  await page.waitForFunction(() => window.__astra.ui.getState().mode === 'seated', null, { timeout: 20000 }).catch(() => {});
  const seated = await A(() => ({ mode: window.__astra.ui.getState().mode, seat: window.__astra.ui.getState().seatedSeat }));
  check('Selected chairs offer a seated viewpoint', seated.mode === 'seated' && !!seated.seat, JSON.stringify(seated));
  await wait(1500);
  await shot('08-boardroom-seated');
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => window.__astra.ui.getState().mode === 'walk', null, { timeout: 20000 }).catch(() => {});
  check('Standing up returns to walkthrough', (await A(() => window.__astra.ui.getState().mode)) === 'walk');
  await teleport(0, 3.2, 10.0, 0, -0.4);
  await useWhenPrompt(/coffee/i);
  await page.waitForSelector('[data-testid=coffee-panel]', { timeout: 20000 }).catch(() => {});
  check('Coffee machine gives a brief interaction', await page.isVisible('[data-testid=coffee-panel]'));
  await page.click('[data-testid=close-panel]');
  // approach the CEO desk from the visitor side, looking at the desk top
  await teleport(2, 6.6, 13.9, Math.atan2(-(5.6 - 6.6), -(14.9 - 13.9)), Math.atan2(0.78 - 1.62, Math.hypot(1.0, 1.0)));
  await useWhenPrompt(/company overview/i);
  await page.waitForSelector('[data-testid=wall-panel]', { timeout: 20000 }).catch(() => {});
  const wall = await page.textContent('[data-testid=wall-panel]').catch(() => '');
  check('CEO desk opens the company overview', wall.includes('Company overview'));
  await page.click('[data-testid=close-panel]').catch(() => {});
});

await step('screenshots', async () => {
  await A(() => { const s = window.__astra.sim(); s.speed = 5; while (s.minute < 9 * 60 + 40) s.advance(0.5); s.speed = 1; });
  await teleport(1, 17.5, 18.2, Math.atan2(-(9 - 17.5), -(11 - 18.2)), -0.08);
  await wait(4000);
  await shot('09-trading-floor');
  await teleport(1, 12.0, 13.9, 0, 0.1);
  await wait(4000);
  await shot('10-market-wall');
  await A(() => { const s = window.__astra.sim(); while (s.minute < 12 * 60 + 25) s.advance(0.5); });
  await teleport(0, 10.0, 18.6, Math.atan2(-(3 - 10), -(11 - 18.6)), -0.12);
  await wait(4000);
  await shot('11-cafe-lunch');
  await teleport(2, 20.2, 18.6, Math.atan2(-(13 - 20.2), -(12 - 18.6)), -0.18);
  await wait(4000);
  await shot('12-boardroom');
  await A(() => window.__astra.ui.getState().updateSettings({ lighting: 'night' }));
  await A(() => window.__astra.actions.showOverview(3));
  await wait(5000);
  await shot('13-night-overview');
  await A(() => window.__astra.ui.getState().updateSettings({ lighting: 'auto' }));
});

await step('owner tools', async () => {
  await A(() => { const s = window.__astra.sim(); s.reset(); s.speed = 1; });
  await teleport(0, 19, 17.6, 0);
  await page.keyboard.press('KeyO');
  await page.waitForSelector('[data-testid=owner-panel]');
  await page.fill('[data-testid=meeting-topic]', 'Quarterly plan');
  await page.click('[data-testid=call-meeting]');
  const note = await page.textContent('[data-testid=owner-note]');
  await page.click('[data-testid=close-panel]');
  await A(() => { const s = window.__astra.sim(); s.speed = 5; const end = s.minute + 25; while (s.minute < end) s.advance(0.5); });
  const pres = await A(() => { const s = window.__astra.sim(); const ev = s.ownerMeetings()[0]; return { present: s.presentAttendees(ev).length, total: ev.attendeeIds.length, ok: s.validate().length === 0 }; });
  check('Owner calls all 30 to the Conference Room and all fit', /Called 30 people/.test(note) && pres.present === 30 && pres.ok, JSON.stringify(pres));
  await A(() => { const s = window.__astra.sim(); s.endMeeting(s.ownerMeetings()[0].id); s.speed = 1; });
  await A(() => window.__astra.ui.getState().openPanel({ kind: 'talk', id: 'e02' }));
  await page.fill('[data-testid=talk-input]', 'How is your P&L today?');
  await page.click('[data-testid=talk-send]');
  await wait(600);
  const chat = await page.textContent('[data-testid=chat]');
  check('Talking to an employee gets a reply from live data', /My positions are/.test(chat), chat.slice(-90));
  await page.click('[data-testid=talk-come]');
  await page.click('[data-testid=close-panel]');
  // walking down from the first floor may include waiting for and riding the lift
  await A(() => { const s = window.__astra.sim(); s.speed = 5; const end = s.minute + 25; while (s.minute < end) s.advance(0.5); s.speed = 1; });
  const came = await A(() => { const e = window.__astra.sim().byId.get('e02'); const p = window.__astra.player; return { d: Math.hypot(e.x - p.x, e.z - p.z), floor: e.floor, phase: e.phase }; });
  check('"Come to me" brings the employee to the owner', came.d < 3.5 && came.floor === 0 && came.phase === 'standing', JSON.stringify(came));
  await A(() => { const s = window.__astra.sim(); s.dismiss(['e02']); s.reset(); const ceo = s.employees.find((e) => e.cfg.roleType === 'ceo'); s.speed = 5; while (!s.atDesk(ceo) && s.minute < 10 * 60) s.advance(0.5); s.speed = 1; });
  await teleport(2, 8.0, 10.6, Math.atan2(-(5 - 8), -(15.6 - 10.6)));
  await page.waitForFunction(() => window.__astra.sim().employees.find((e) => e.cfg.roleType === 'ceo').greet?.stage === 'hold', null, { timeout: 60000 }).catch(() => {});
  const greet = await A(() => { const c = window.__astra.sim().employees.find((e) => e.cfg.roleType === 'ceo'); return { stage: c.greet?.stage ?? null, phase: c.phase }; });
  check('CEO stands to greet the owner entering the office', greet.stage === 'hold' && greet.phase === 'standing', JSON.stringify(greet));
  await A(() => { window.__astra.sim().playerSit('ceo-guest-s1'); });
  await page.waitForFunction(() => window.__astra.sim().employees.find((e) => e.cfg.roleType === 'ceo').phase === 'seated', null, { timeout: 60000 }).catch(() => {});
  check('CEO sits down after the owner takes a seat', await A(() => window.__astra.sim().employees.find((e) => e.cfg.roleType === 'ceo').phase === 'seated'));
  await A(() => window.__astra.sim().playerStand());
});

await step('training and CEO report', async () => {
  await A(() => { const s = window.__astra.sim(); s.speed = 5; while (s.minute < 9 * 60 + 40) s.advance(0.5); s.speed = 1; });
  await page.keyboard.press('Escape');
  await A(() => window.__astra.ui.getState().openPanel({ kind: 'owner', tab: 'training' }));
  await page.waitForSelector('[data-testid=start-training]');
  await page.click('[data-testid=start-training]');
  const note = await page.textContent('[data-testid=training-note]');
  check('Owner starts the training programme (strategy lab + Training Room sessions)', /10 traders started the strategy lab/.test(note) && /session/.test(note), note);
  await A(() => { const s = window.__astra.sim(); s.speed = 5; const end = s.minute + 45; while (s.minute < end) s.advance(0.5); s.speed = 1; });
  await wait(1500);
  const table = await page.textContent('[data-testid=strategy-table]');
  const st = await A(() => { const s = window.__astra.sim(); const r = [...s.training.values()].filter((x) => x.strategy); return { trained: r.length, live: r.filter((x) => x.strategy.active).length, saved: !!localStorage.getItem('astra-hq:training:v1') }; });
  check('Every trader backtested and validated a strategy; only validated ones go live', st.trained === 10 && /Live|Rejected/.test(table) && st.saved, JSON.stringify(st));
  await shot('20-training');
  await page.click('[data-testid=owner-tab-report]');
  await wait(800);
  const rep = await page.textContent('[data-testid=ceo-report]');
  check('CEO report shows paper account, books, risk, ops, tech, people and training', ['Paper trading account', 'Books', 'Risk', 'Operations', 'Technology', 'People', 'Training'].every((t) => rep.includes(t)), rep.slice(0, 120));
  await shot('21-ceo-report');
  await page.click('[data-testid=owner-tab-workflow]');
  await wait(800);
  const wf = await page.textContent('[data-testid=workflow]');
  check('Workflow tab shows the research → PM → trader → risk → ops chain, tickets and mistakes', /How work flows/.test(wf) && /Tickets/.test(wf) && /Mistakes/.test(wf) && rep.includes('Workflow and mistakes'), wf.slice(0, 100));
  await page.click('[data-testid=close-panel]');
});

await step('minimise panels and hide side panels', async () => {
  await A(() => window.__astra.ui.getState().openPanel({ kind: 'owner', tab: 'messages' }));
  await page.waitForSelector('[data-testid=minimize-panel]');
  await page.click('[data-testid=minimize-panel]');
  await wait(400);
  const m = await A(() => ({ bar: !!document.querySelector('[data-testid=min-bar]'), panelVisible: !!document.querySelector('[data-testid=owner-panel]')?.offsetParent, open: !!window.__astra.ui.getState().panel }));
  check('Minimise keeps the panel open but out of the way (small bar)', m.bar && !m.panelVisible && m.open, JSON.stringify(m));
  await page.click('[data-testid=restore-panel]');
  await wait(400);
  check('Restore brings the panel back', await A(() => !!document.querySelector('[data-testid=owner-panel]')?.offsetParent));
  await page.click('[data-testid=close-panel]');
  await page.click('[data-testid=toggle-hud]');
  await wait(400);
  const hidden = await A(() => !document.querySelector('.left-dock') && !document.querySelector('.right-dock'));
  await page.click('[data-testid=toggle-hud]');
  await wait(400);
  const shown = await A(() => !!document.querySelector('.left-dock') && !!document.querySelector('.right-dock'));
  check('Hide panels clears the side cards and shows them again', hidden && shown);
});

await step('configuration editor persistence', async () => {
  await A(() => window.__astra.ui.getState().openPanel({ kind: 'settings', tab: 'editor' }));
  await page.click('[data-testid=settings-tab-editor]');
  await page.fill('[data-testid=company-name]', 'ORION');
  await page.fill('[data-testid=edit-name-e01]', 'Test Receptionist');
  // reassign e02 to e03's desk (swap)
  await page.selectOption('[data-testid=edit-desk-e02]', 'ws-trade-02');
  await page.click('[data-testid=save-config]');
  await wait(800);
  const msg = await page.textContent('[data-testid=config-message]');
  check('Editor saves locally', msg.includes('Saved'), msg);
  await page.reload();
  await page.waitForFunction(() => window.__astra?.sim, null, { timeout: 60000 });
  const cfg = await A(() => { const c = window.__astra.sim().config; return { name: c.companyName, e01: c.employees[0].name, e02: c.employees[1].workstationId, e03: c.employees[2].workstationId }; });
  check('Configuration changes survive reload (name, company, desk swap)', cfg.name === 'ORION' && cfg.e01 === 'Test Receptionist' && cfg.e02 === 'ws-trade-02' && cfg.e03 === 'ws-trade-01', JSON.stringify(cfg));
  const brand = await page.textContent('.brand-name');
  check('Company display name appears in the UI', brand === 'ORION');
});

await step('export / import', async () => {
  await A(() => window.__astra.ui.getState().openPanel({ kind: 'settings', tab: 'editor' }));
  await page.click('[data-testid=settings-tab-editor]');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=export-config]')]);
  const file = path.join(out, 'exported-config.json');
  await dl.saveAs(file);
  const data = JSON.parse(await fs.readFile(file, 'utf8'));
  check('Export produces valid configuration JSON', data.schemaVersion === 1 && data.employees.length === 30 && data.companyName === 'ORION');
  // malformed JSON
  await page.setInputFiles('[data-testid=import-file]', { name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{ "schemaVersion": 1, ') });
  await page.waitForSelector('[data-testid=config-errors]');
  let err = await page.textContent('[data-testid=config-errors]');
  let still = await A(() => window.__astra.sim().config.companyName);
  check('Malformed JSON import is rejected with a useful error and config kept', /Not valid JSON/.test(err) && still === 'ORION', err.slice(0, 120));
  // schema-invalid: duplicate desk + bad role
  const bad = structuredClone(data);
  bad.employees[1].workstationId = bad.employees[0].workstationId;
  bad.employees[2].roleType = 'wizard';
  await page.setInputFiles('[data-testid=import-file]', { name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bad)) });
  await wait(600);
  err = await page.textContent('[data-testid=config-errors]');
  still = await A(() => window.__astra.sim().config.employees[1].workstationId);
  check('Schema-invalid import is rejected and previous config kept', /already assigned/.test(err) && /roleType/.test(err) && still === 'ws-trade-02', err.slice(0, 160));
  // valid import
  const good = structuredClone(data);
  good.companyName = 'ASTRA';
  good.employees[3].name = 'Imported Person';
  await page.setInputFiles('[data-testid=import-file]', { name: 'good.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(good)) });
  await page.waitForSelector('[data-testid=config-message]');
  const applied = await A(() => ({ c: window.__astra.sim().config.companyName, n: window.__astra.sim().config.employees[3].name }));
  check('Valid import is applied', applied.c === 'ASTRA' && applied.n === 'Imported Person', JSON.stringify(applied));
  await page.click('[data-testid=restore-defaults]');
  await wait(800);
  const def = await A(() => ({ c: window.__astra.sim().config.companyName, e01: window.__astra.sim().config.employees[0].name }));
  check('Restore defaults works', def.c === 'ASTRA' && def.e01 === 'Maya Chen');
  await page.click('[data-testid=close-panel]');
});

await step('room accessibility in browser', async () => {
  const rooms = await A(() => window.__astra.sim().roomsList().map((r) => ({ id: r.id, f: r.floor, x: r.entry.x, z: r.entry.z })));
  const bad = [];
  for (const r of rooms) {
    const sq = await A((r) => { window.__astra.teleport({ floor: r.f, x: r.x, z: r.z }); return window.__astra.player.teleportSeq; }, r);
    await waitTeleport(sq);
    const p = await P();
    if (p.floor !== r.f || Math.hypot(p.x - r.x, p.z - r.z) > 1.0) bad.push(`${r.id}:${JSON.stringify(p)}`);
  }
  check(`Every room has a valid standing spot (${rooms.length} rooms)`, bad.length === 0, bad.join(' '));
});

await step("chairman's office", async () => {
  await teleport(2, 29.4, 6.6, Math.PI, 0.16);
  await wait(1500);
  const plate = await A(() => { let hit = null; window.__astra.scene?.traverse((o) => { if (o.userData?.doorPlate) hit = o.userData.doorPlate; }); return hit; });
  const signAbove = await A(() => { let hit = false; window.__astra.scene?.traverse((o) => { if (o.userData?.doorSign === 's-d-chair') hit = true; }); return hit; });
  check('Chairman door carries the Uday Fulkatwar plate on the door, no sign above it', plate === 'Uday Fulkatwar' && !signAbove, `plate=${plate} above=${signAbove}`);
  await shot('30-chairman-door');
  await teleport(2, 29.2, 9.3, Math.PI * 1.08, -0.08);
  await wait(1200);
  await shot('31-chairman-office');
  // the Chairman's PC on the desk opens the console with access to the whole office
  await teleport(2, 31.1, 16.75, 0.2, -0.3);
  await wait(1200);
  await shot('32-chairman-pc');
  await useWhenPrompt(/Chairman's PC/);
  await page.waitForSelector('[data-testid="office-tab"]', { timeout: 20000 });
  const counts = await page.evaluate(() => ({ people: document.querySelectorAll('[data-testid^="office-person-"]').length, screens: document.querySelectorAll('[data-testid^="office-screen-"]').length, displays: document.querySelectorAll('[data-testid^="office-display-"]').length }));
  const staff = await A(() => window.__astra.sim().employees.length);
  check("Chairman's PC opens a console listing every person, their screens and every display", counts.people === staff && counts.screens >= staff && counts.displays > 20, JSON.stringify(counts));
  await shot('33-chairman-pc-console');
  await page.locator('[data-testid^="office-screen-"]').first().click();
  await page.waitForSelector('[data-testid="back-to-pc"]', { timeout: 10000 });
  const onMonitor = await A(() => window.__astra.ui.getState().panel?.kind);
  await page.click('[data-testid="back-to-pc"]');
  await page.waitForSelector('[data-testid="office-tab"]', { timeout: 10000 });
  check("A staff screen opened from the Chairman's PC, with a way back to the console", onMonitor === 'monitor', `panel=${onMonitor}`);
  await A(() => window.__astra.ui.getState().closePanel());
  // CCTV wall TV: live grid of the offices, and the full-screen camera view
  await teleport(2, 30.7, 11.6, Math.PI / 2, 0);
  await wait(9000);
  await shot('34-chairman-cctv-wall');
  await useWhenPrompt(/CCTV/);
  await page.waitForSelector('[data-testid="cctv-view"]', { timeout: 15000 });
  await wait(2500);
  const lab1 = await page.textContent('[data-testid="cctv-label"]');
  const cam1 = await A(() => ({ y: window.__astra.player.camY, f: window.__astra.player.floor }));
  await shot('35-cctv-full-view');
  await page.click('[data-testid="cctv-next"]');
  await wait(2500);
  const lab2 = await page.textContent('[data-testid="cctv-label"]');
  await shot('35b-cctv-ceo-office');
  for (let i = 0; i < 4; i++) await page.click('[data-testid="cctv-next"]');
  await wait(2500);
  await shot('36-cctv-trading-floor');
  check('CCTV TV opens a full-screen live room camera and switches cameras', lab1 !== lab2 && /CAM-\d\d/.test(lab1 ?? '') && cam1.y > 8, `${lab1} -> ${lab2} camY=${cam1.y}`);
  await page.click('[data-testid="close-panel"]');
  const back = await P();
  check('Closing CCTV returns to where you stood', back.floor === 2 && Math.abs(back.x - 30.7) < 0.8, JSON.stringify(back));
});

if (process.env.CCTV_ALL) await step('chairman cctv every camera', async () => {
  await teleport(2, 30.7, 11.6, Math.PI / 2, 0);
  for (let i = 0; i < 18; i++) {
    await A((i) => window.__astra.ui.getState().openPanel({ kind: 'cctv', cam: i }), i);
    await wait(2200);
    await shot(`cctv-all-${String(i + 1).padStart(2, '0')}`);
  }
  await A(() => window.__astra.ui.getState().closePanel());
});

await step('performance probe (software renderer)', async () => {
  const stats = {};
  for (const preset of ['low', 'medium', 'high']) {
    await A((p) => window.__astra.ui.getState().updateSettings({ graphics: p }), preset);
    await wait(15000);
    stats[preset] = await A(() => ({ fps: window.__astra.ui.getState().fps, ...window.__astra.ui.getState().renderStats }));
  }
  await A(() => window.__astra.ui.getState().updateSettings({ graphics: 'low' }));
  check('Renderer statistics collected for each preset', true, JSON.stringify(stats));
  await fs.writeFile(path.join(out, 'perf-swiftshader.json'), JSON.stringify(stats, null, 2));
});

 // park the desktop page so software rendering does not starve the mobile page
await page.goto('about:blank').catch(() => {});

await step('live prices and Claude replies (stubbed claude.ai runtime)', async () => {
  // A stand-in for the claude.ai runtime: made-up quotes in the Co-Invest payload shape and a fake Claude
  // that uses one page tool. Proves the page wiring; real data/Claude only exist inside claude.ai.
  const c = await browser.newContext({ viewport: { width: 960, height: 570 } });
  await c.addInitScript(() => {
    localStorage.setItem('astra-hq:settings:v1', JSON.stringify({ graphics: 'low' }));
    const feeds = ['xyz:NVDA', 'xyz:MU', 'xyz:AAPL', 'xyz:TSLA', 'xyz:SNDK', 'xyz:SKHX', 'xyz:SP500', 'xyz:GOLD', 'xyz:XYZ100', 'xyz:CL', 'BTC', 'ETH'];
    const calls = [];
    window.__stubCalls = calls;
    const payload = (symbols) => ({ snapshots: symbols.map((s) => ({ symbol: s, markPx: String(100 + feeds.indexOf(s) * 50 + Math.random()), change24h: 0.5 })) });
    const mcp = {
      callTool: async (server, tool, input) => {
        calls.push(`${server}/${tool}`);
        if (tool === 'show_chart') {
          // made-up but well-formed candles: a steady trend with noise
          const step = { '1h': 3600e3, '4h': 14400e3, '1d': 86400e3 }[input.interval];
          const end = Math.floor(Date.now() / step) * step - step;
          let px = 100 + feeds.indexOf(input.symbol) * 50;
          const candles = Array.from({ length: input.limit }, (_, i) => { const o = px; px *= 1 + 0.002 + 0.006 * Math.sin(i * 1.7) ; return { timestamp: end - (input.limit - 1 - i) * step, open: String(o), high: String(Math.max(o, px) * 1.002), low: String(Math.min(o, px) * 0.998), close: String(px), volume: '10' }; });
          return { payload: { symbol: input.symbol, interval: input.interval, candles } };
        }
        return { payload: tool === 'analyze_markets_batch' ? payload(input.symbols) : { currentPrice: 100, indicators: { rsi14: 55, sma: { sma20: 99, sma50: 98, sma200: 97 } } } };
      },
      watchTool: (server, tool, input, handler) => {
        calls.push(`${server}/${tool}`);
        const fire = () => handler({ type: 'data', result: { payload: tool === 'get_news' ? { text: 'Headlines:\n1. Test headline one — Wire (https://x.test/1)\n' } : payload(input.symbols) } });
        setTimeout(fire, 50);
        const t = setInterval(fire, 2000);
        return () => clearInterval(t);
      },
    };
    const sample = async (turns, opts) => {
      const last = Array.isArray(turns) ? turns[turns.length - 1].content : turns;
      let text = 'Stub reply from Claude.';
      if (/CLAUDE OK/.test(last)) text = 'CLAUDE OK';
      const ping = opts?.tools?.find((x) => x.name === 'ping');
      if (ping) { await ping.execute({}, { signal: new AbortController().signal }); text = 'DONE'; }
      if (/boardroom/i.test(last) && opts?.tools) {
        const t = opts.tools.find((x) => x.name === 'go_to_room');
        await t.execute({ room: 'Boardroom' }, { signal: new AbortController().signal });
        text = 'Going to the Boardroom now.';
      }
      opts?.onText?.({ text, delta: text });
      return { text, truncated: false, modelTierApplied: 'quick' };
    };
    sample.limits = async () => ({ maxPromptBytes: 262144, tools: { maxCount: 8 } });
    window.claude = { use: async (n) => (n === 'mcp' ? mcp : n === 'sample' ? sample : null) };
  });
  const lp = await c.newPage();
  lp.on('pageerror', (e) => pageErrors.push(`[live] ${e.message}`));
  await lp.goto(base);
  await lp.waitForFunction(() => window.__astra?.sim?.().live, null, { timeout: 60000 });
  const st = await lp.evaluate(() => { const s = window.__astra.sim(); return { live: s.live, syms: s.market.prices.length, nvda: s.market.price('NVDA'), chip: document.querySelector('[data-testid=live-chip]')?.textContent, calls: [...new Set(window.__stubCalls)] }; });
  const allowed = ['Co-Invest/analyze_markets_batch', 'Co-Invest/get_news', 'Co-Invest/get_technical_indicators', 'Co-Invest/show_chart'];
  check('Live mode: real instrument symbols with feed prices, LIVE chip, read-only tools only', st.live && st.nvda >= 100 && /LIVE PRICES/.test(st.chip) && st.calls.every((x) => allowed.includes(x)), JSON.stringify(st));
  await lp.evaluate(() => window.__astra.ui.getState().openPanel({ kind: 'wall', panelId: 'p-market-wall' }));
  await lp.waitForTimeout(800);
  const wall = await lp.textContent('[data-testid=wall-panel]').catch(() => '');
  check('Market wall shows live-priced instruments and headlines (paper trading tag)', /NVDA/.test(wall) && /Live prices · Paper/.test(wall) && /Test headline one/.test(wall), wall.slice(0, 140));
  // the real office: wall clock, 24/7, no speed controls, everyone on site and working on tasks from their seniors
  await lp.waitForFunction(() => window.__astra.sim().work.tasks.length > 25, null, { timeout: 60000 }).catch(() => {});
  const real = await lp.evaluate(() => {
    const s = window.__astra.sim();
    const d = new Date();
    return {
      realMode: s.realMode,
      clockOk: Math.abs(s.minute - (d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60)) < 1,
      speedButtons: document.querySelectorAll('[data-testid^=speed-], [data-testid=pause], [data-testid=reset]').length,
      onSite: s.employees.filter((e) => s.onSite(e)).length,
      withTask: s.employees.filter((e) => s.work.current(e.cfg.id)).length,
      assignedBySenior: s.work.tasks.filter((t) => t.by === s.work.managerOf(t.owner) || !s.work.managerOf(t.owner)).length === s.work.tasks.length,
      objectives: s.work.objectives.length,
      charts: window.__stubCalls.filter((x) => x.endsWith('show_chart')).length,
    };
  });
  check('Real office: wall-clock time, no speed/pause/reset, all 30 on site, everyone working on a task from their senior', real.realMode && real.clockOk && real.speedButtons === 0 && real.onSite === 30 && real.withTask >= 25 && real.assignedBySenior && real.objectives >= 4 && real.charts > 0, JSON.stringify(real));
  await lp.evaluate(() => window.__astra.ui.getState().openPanel({ kind: 'owner', tab: 'work' }));
  await lp.waitForSelector('[data-testid=work-board]', { timeout: 10000 });
  const board = await lp.textContent('[data-testid=work-board]');
  check('Owner work board shows objectives, the reporting lines and tasks', /objectives/i.test(board) && /Alexander Reed/.test(board) && /Elena Petrova/.test(board), board.slice(0, 120));
  await lp.screenshot({ path: path.join(out, '25-work-board.png') });
  // test-only: run the office clock fast (a minute every 150 ms) so 35-minute research tasks finish within the test
  await lp.evaluate(() => { const s = window.__astra.sim(); let off = 0; setInterval(() => { off += 60000; }, 150); s.clock = () => new Date(Date.now() + off); s.frameClamp = 20; });
  await lp.waitForFunction(() => window.__astra.sim().work.tested.size > 0, null, { timeout: 240000 }).catch(() => {});
  const res = await lp.evaluate(() => { const s = window.__astra.sim(); return { tested: s.work.tested.size, strats: s.work.strats.length }; });
  check('Traders test strategies on (stubbed) Co-Invest candles with the walk-forward engine', res.tested > 0, JSON.stringify(res));
  await lp.evaluate(() => window.__astra.ui.getState().openPanel({ kind: 'monitor', monitorId: 'ws-trade-02-m1' }));
  await lp.waitForTimeout(1200);
  const mon = await lp.textContent('[data-testid=app-view]');
  check('A trader monitor shows the current task, who assigned it and real candles', /Current task/.test(mon) && /Assigned by/.test(mon) && /real candles|Waiting for Co-Invest/.test(mon), mon.slice(0, 160));
  await lp.screenshot({ path: path.join(out, '26-trader-monitor.png') });
  await lp.evaluate(() => window.__astra.ui.getState().closePanel());
  await lp.evaluate(() => window.__astra.ui.getState().openPanel({ kind: 'talk', id: 'e03' }));
  await lp.fill('[data-testid=talk-input]', 'Please go to the boardroom');
  await lp.click('[data-testid=talk-send]');
  await lp.waitForFunction(() => window.__astra.sim().byId.get('e03').chat.length >= 2, null, { timeout: 20000 });
  const talk = await lp.evaluate(() => { const e = window.__astra.sim().byId.get('e03'); return { reply: e.chat[e.chat.length - 1].text, order: e.order?.kind, room: e.order?.roomId }; });
  check('Claude reply is shown and its tool call acts in the office (sent to the Boardroom)', talk.reply === 'Going to the Boardroom now.' && talk.order === 'room' && talk.room === 's-board', JSON.stringify(talk));
  await lp.screenshot({ path: path.join(out, '22-live-talk.png') });
  await lp.evaluate(() => window.__astra.ui.getState().openPanel({ kind: 'owner', tab: 'system' }));
  await lp.click('[data-testid=run-system-check]');
  await lp.waitForFunction(() => document.querySelectorAll('[data-testid=system-results] tbody tr').length >= 7, null, { timeout: 30000 }).catch(() => {});
  const sys = await lp.textContent('[data-testid=system-results]').catch(() => '');
  check('System check runs every live connection (stubbed runtime: all pass)', (sys.match(/PASS/g) ?? []).length === 7 && !/FAIL/.test(sys), sys.slice(0, 200));
  await c.close();
});

await step('touch controls (mobile emulation)', async () => {
  const m = await browser.newContext({ viewport: { width: 412, height: 860 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await m.addInitScript(() => localStorage.setItem('astra-hq:settings:v1', JSON.stringify({ graphics: 'low' })));
  const mp = await m.newPage();
  mp.on('pageerror', (e) => pageErrors.push(`[mobile] ${e.message}`));
  await mp.goto(`${base}?office=test-sim`);
  await mp.waitForFunction(() => window.__astra?.sim, null, { timeout: 60000 });
  await mp.tap('[data-testid=enter-office]', { timeout: 90000 });
  await mp.waitForSelector('.touch-stick', { timeout: 10000 });
  const p0 = await mp.evaluate(() => ({ ...window.__astra.player }));
  const box = await mp.locator('.touch-stick').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await mp.dispatchEvent('.touch-stick', 'pointerdown', { pointerId: 7, clientX: cx, clientY: cy - 50, isPrimary: true, pointerType: 'touch' });
  await mp.waitForTimeout(3000);
  await mp.dispatchEvent('.touch-stick', 'pointerup', { pointerId: 7, pointerType: 'touch' });
  const p1 = await mp.evaluate(() => ({ ...window.__astra.player }));
  check('Touch joystick moves the player', Math.hypot(p1.x - p0.x, p1.z - p0.z) > 0.2, `${Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(2)} m`);
  await mp.screenshot({ path: path.join(out, '14-mobile.png') });
  await m.close();
});

check('No blocking runtime errors', pageErrors.length === 0, pageErrors.slice(0, 5).join(' | '));
check('No external network requests (all assets local)', external.length === 0, external.slice(0, 3).join(' '));
await fs.writeFile(path.join(out, 'results.json'), JSON.stringify({ date: new Date().toISOString(), browser: `Chromium ${browser.version()} headless`, renderer: 'SwiftShader (software)', results, pageErrors }, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
await browser.close();
server.close();
process.exit(failed.length ? 1 : 0);
