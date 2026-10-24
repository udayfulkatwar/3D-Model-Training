// One-click system check, run by the owner inside claude.ai: proves the live connections work in the real
// viewer (Co-Invest prices, candles, headlines; Claude replies and tool use) and reports exactly what failed.
import { LIVE_UNIVERSE } from '../sim/market';
import { getSample, type SampleError } from '../ai/brain';
import { SERVER, getMcp, parseNews, parseSnapshots } from './feed';
import { parseCandles } from './candles';

export interface CheckResult { name: string; ok: boolean; detail: string; ms: number }

async function timed(name: string, fn: () => Promise<string>): Promise<CheckResult> {
  const t0 = performance.now();
  try {
    const detail = await fn();
    return { name, ok: true, detail, ms: Math.round(performance.now() - t0) };
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return { name, ok: false, detail: `${err.code ?? 'error'}${err.message ? `: ${err.message}` : ''}`, ms: Math.round(performance.now() - t0) };
  }
}

export async function runSystemCheck(onStep?: (r: CheckResult[]) => void): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const push = (r: CheckResult) => { out.push(r); onStep?.([...out]); };
  const mcp = await getMcp();
  push({ name: 'Connector runtime', ok: !!mcp, detail: mcp ? 'available in this view' : 'not available (open the page in claude.ai)', ms: 0 });
  if (mcp) {
    push(await timed('Live prices (analyze_markets_batch)', async () => {
      const r = await mcp.callTool(SERVER, 'analyze_markets_batch', { symbols: LIVE_UNIVERSE.slice(0, 10).map((s) => s.feed) }, { cache: false });
      const q = parseSnapshots(r.payload);
      if (!q.size) throw { code: 'empty', message: 'no prices in the reply' };
      const btc = await mcp.callTool(SERVER, 'analyze_markets_batch', { symbols: LIVE_UNIVERSE.slice(10).map((s) => s.feed) }, { cache: false });
      const q2 = parseSnapshots(btc.payload);
      return `${q.size + q2.size}/${LIVE_UNIVERSE.length} markets priced (e.g. ${[...q.entries()].slice(0, 2).map(([k, v]) => `${k} ${v.px}`).join(', ')})`;
    }));
    push(await timed('Price history (show_chart)', async () => {
      const r = await mcp.callTool(SERVER, 'show_chart', { symbol: 'BTC', interval: '1h', limit: 200 }, { cache: false });
      const cs = parseCandles(r.payload, '1h');
      if (!cs.length) throw { code: 'empty', message: 'no candles in the reply' };
      const ageMin = Math.round((Date.now() - cs[cs.length - 1].t) / 60000);
      return `${cs.length} completed BTC 1h candles, newest ${ageMin} min old`;
    }));
    push(await timed('Headlines (get_news)', async () => {
      const r = await mcp.callTool(SERVER, 'get_news', {}, { cache: false });
      const n = parseNews(r.payload);
      return `${n.length} headlines${n[0] ? ` (e.g. "${n[0].title.slice(0, 60)}")` : ''}`;
    }));
  }
  const sample = await getSample();
  push({ name: 'Claude runtime', ok: !!sample, detail: sample ? 'available in this view' : 'not available (open the page in claude.ai)', ms: 0 });
  if (sample) {
    push(await timed('Claude reply', async () => {
      try {
        const r = await sample('System check for an office app. Reply with exactly the two words: CLAUDE OK', { modelTier: 'quick', cache: false });
        if (!/CLAUDE OK/i.test(r.text)) throw { code: 'unexpected', message: r.text.slice(0, 60) };
        return `answered "${r.text.trim().slice(0, 40)}"`;
      } catch (e) {
        throw { code: (e as SampleError).code ?? 'error', message: (e as SampleError).message };
      }
    }));
    push(await timed('Claude can act (page tools)', async () => {
      const lim = await sample.limits();
      if (!lim.tools) throw { code: 'tools_unavailable', message: 'replies work, but instructions cannot be carried out from chat in this view' };
      let called = false;
      await sample('System check. Call the tool named ping once, then reply DONE.', {
        modelTier: 'quick',
        tools: [{ name: 'ping', description: 'Returns pong. Call it once.', execute: () => { called = true; return 'pong'; } }],
      });
      if (!called) throw { code: 'not_called', message: 'Claude did not call the tool' };
      return 'tool call carried out';
    }));
  }
  return out;
}
