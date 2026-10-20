// Browser evidence for a plan3d build: load model.glb with three.js inside
// headless Chromium, compare what three.js sees with manifest.json, and save
// screenshots. Usage: node check.mjs [out_dir relative to repo root]
// Software rendering (SwiftShader) proves loading and correctness only; it
// says nothing about frame rate on real phones.
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright-core';

const root = path.resolve(import.meta.dirname, '..');
const outRel = process.argv[2] ?? 'out/t01';
const outDir = path.join(root, outRel);
const chrome = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
                '.json': 'application/json', '.glb': 'model/gltf-binary' };
const server = http.createServer(async (req, res) => {
  const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    const body = await fs.readFile(file);
    res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const manifest = JSON.parse(await fs.readFile(path.join(outDir, 'manifest.json'), 'utf8'));
const browser = await chromium.launch({
  executablePath: chrome,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];
const evidence = { date: new Date().toISOString(), browser: `Chromium ${browser.version()}`,
                   renderer: 'SwiftShader (software)', views: {} };
let seen;
for (const view of ['dollhouse', 'exterior']) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('console', m => m.type() === 'error' && errors.push(`${view}: ${m.text()}`));
  page.on('pageerror', e => errors.push(`${view}: ${e.message}`));
  const t0 = Date.now();
  await page.goto(`${base}/viewer/index.html?model=/${outRel}/model.glb` +
                  `&manifest=/${outRel}/manifest.json&view=${view}`);
  await page.waitForFunction(() => window.__viewer?.ready, null, { timeout: 60000 });
  evidence.views[view] = { load_ms_software: Date.now() - t0 };
  seen = await page.evaluate(() => window.__viewer);
  const shot = path.join(outDir, `browser_${view}.png`);
  await page.screenshot({ path: shot });
  evidence.views[view].screenshot = path.relative(root, shot);
  await page.close();
}
await browser.close();
server.close();

// What three.js loaded must equal what plan3d built.
const built = Object.fromEntries(manifest.meshes.map(m => [m.name, m]));
const loaded = Object.fromEntries(seen.meshes.map(m => [m.name, m]));
const problems = [...errors];
for (const name of Object.keys(built)) {
  const l = loaded[name];
  if (!l) { problems.push(`${name}: not loaded by three.js`); continue; }
  if (l.triangles !== built[name].triangles) problems.push(`${name}: ${l.triangles} tris, built ${built[name].triangles}`);
  if (!l.hasUV) problems.push(`${name}: no UV attribute in three.js`);
  if (l.material !== built[name].role) problems.push(`${name}: material '${l.material}', expected '${built[name].role}'`);
  if ((built[name].role === 'glass') !== l.transparent) problems.push(`${name}: transparency mismatch`);
}
for (const name of Object.keys(loaded)) if (!built[name]) problems.push(`${name}: unexpected mesh`);
const [lo, hi] = seen.bounds;
// the walls of all levels together span the whole building
const wallBounds = Object.values(built).filter(m => m.name.endsWith('_WALLS')).map(m => m.bounds_zup_m);
const walls = wallBounds.length ? [[0, 1, 2].map(i => Math.min(...wallBounds.map(b => b[0][i]))),
                                   [0, 1, 2].map(i => Math.max(...wallBounds.map(b => b[1][i])))] : null;
if (walls) {
  // plan (x, y, z) -> glTF (x, z, -y)
  const expectLo = [walls[0][0], walls[0][2], -walls[1][1]], expectHi = [walls[1][0], walls[1][2], -walls[0][1]];
  if (![...expectLo, ...expectHi].every((v, i) => Math.abs(v - [...lo, ...hi][i]) < 1e-4))
    problems.push(`scene bounds ${JSON.stringify(seen.bounds)} differ from expected ${JSON.stringify([expectLo, expectHi])}`);
}

Object.assign(evidence, { three_revision: seen.three, meshes_loaded: seen.meshes.length,
                          meshes_built: manifest.meshes.length, problems, pass: problems.length === 0 });
await fs.writeFile(path.join(outDir, 'browser_check.json'), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
process.exit(problems.length ? 1 : 0);
