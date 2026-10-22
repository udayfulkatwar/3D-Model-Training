// Capture named views: {name, f, x, z, look:[x,y,z]} or {name, overview}
import { chromium } from 'playwright-core';
const url = process.env.URL ?? 'http://127.0.0.1:5173/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(url + (process.env.QUERY ?? ''));
await page.waitForFunction(() => window.__astra?.sim, null, { timeout: 60000 });
await page.waitForTimeout(3000);
if (!process.env.KEEP_RESUME) await page.addStyleTag({ content: '.resume{display:none!important}' });
if (process.env.MINUTE) await page.evaluate((m) => { const s = window.__astra.sim(); s.speed = 5; const target = Number(m); while (s.minute < target) s.advance(0.5); }, process.env.MINUTE);
const views = JSON.parse(process.argv[2] ?? '[]');
for (const v of views) {
  await page.evaluate((v) => {
    const a = window.__astra;
    if (v.overview !== undefined) { a.actions.showOverview(v.overview); return; }
    a.ui.getState().closePanel();
    const yaw = Math.atan2(-(v.look[0] - v.x), -(v.look[2] - v.z));
    a.teleport({ floor: v.f, x: v.x, z: v.z, yaw });
  }, v);
  await page.waitForTimeout(v.wait ?? 2500);
  if (v.look) await page.evaluate((v) => { const p = window.__astra.player; p.pitch = Math.atan2(v.look[1] - (p.y + 1.62), Math.hypot(v.look[0] - p.x, v.look[2] - p.z)); }, v);
  if (v.panel) await page.evaluate((p) => window.__astra.ui.getState().openPanel(p), v.panel);
  await page.waitForTimeout(v.settle ?? 2500);
  await page.screenshot({ path: `e2e/output/view-${v.name}.png` });
}
console.log(errors.join('\n'));
await browser.close();
