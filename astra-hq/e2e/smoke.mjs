// Quick smoke: load the app, collect console errors, take screenshots.
import { chromium } from 'playwright-core';
const url = process.argv[2] ?? 'http://127.0.0.1:5173/';
const exe = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
await page.goto(url);
await page.waitForTimeout(8000);
await page.screenshot({ path: 'e2e/output/smoke-intro.png' });
await page.click('[data-testid=enter-office]').catch((e) => errors.push('click: ' + e.message));
await page.waitForTimeout(5000);
await page.screenshot({ path: 'e2e/output/smoke-walk.png' });
const info = await page.evaluate(() => { const a = window.__astra; const s = a.sim(); return { minute: s.minute, mode: a.ui.getState().mode, fps: a.ui.getState().fps, stats: a.ui.getState().renderStats }; });
console.log(JSON.stringify(info));
console.log(errors.slice(0, 30).join('\n'));
await browser.close();
