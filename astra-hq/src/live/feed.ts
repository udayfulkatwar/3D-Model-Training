// Live market data from the viewer's Co-Invest connector (claude.ai artifact runtime, `mcp` capability).
// READ-ONLY: only analyze_markets_batch, get_news and get_technical_indicators are declared and called.
// No order tool is in the page's manifest, so the page cannot place real or paper orders on Co-Invest;
// all trading stays inside the office simulation's paper books.
import { LIVE_UNIVERSE, type LiveQuote } from '../sim/market';
import type { Simulation } from '../sim/simulation';

export const SERVER = 'Co-Invest';
export const REFRESH_MS = 30_000;
const NEWS_MS = 300_000;

export type LiveState = 'off' | 'connecting' | 'live' | 'stale' | 'needs-approval' | 'not-connected' | 'reconnect' | 'blocked' | 'error';

export interface LiveStatus {
  state: LiveState;
  message: string;
  /** When the shown prices were produced (epoch ms), from the result's cache marker when present. */
  updatedAt?: number;
}

interface McpError { code: string; message?: string; retryable?: boolean; retryAfterMs?: number }
interface CallToolResult { payload?: unknown; cache?: { storedAt: number; revalidating: boolean } }
interface McpNs {
  callTool(server: string, tool: string, input?: unknown, options?: unknown): Promise<CallToolResult>;
  watchTool(server: string, tool: string, input: unknown, handler: (ev: { type: 'data'; result: CallToolResult } | { type: 'error'; error: McpError }) => void, options?: { refetchInterval?: number }): () => void;
}

declare global {
  interface Window { claude?: { use(name: string): Promise<unknown> } }
}

let mcpPromise: Promise<McpNs | null> | null = null;
export function getMcp(): Promise<McpNs | null> {
  if (!mcpPromise) mcpPromise = (window.claude?.use('mcp') as Promise<McpNs | null> | undefined)?.catch(() => null) ?? Promise.resolve(null);
  return mcpPromise;
}

/** Batches of at most 10 symbols (the tool's limit). */
const BATCHES = [LIVE_UNIVERSE.slice(0, 10).map((s) => s.feed), LIVE_UNIVERSE.slice(10).map((s) => s.feed)];
const BY_FEED = new Map(LIVE_UNIVERSE.map((s) => [s.feed, s]));

/** analyze_markets_batch payload → quotes keyed by office symbol (NVDA, GOLD, BTC, ...). */
export function parseSnapshots(payload: unknown): Map<string, LiveQuote> {
  const out = new Map<string, LiveQuote>();
  const snaps = (payload as { snapshots?: unknown })?.snapshots;
  if (!Array.isArray(snaps)) return out;
  for (const s of snaps as { symbol?: unknown; markPx?: unknown; change24h?: unknown }[]) {
    const slot = BY_FEED.get(String(s.symbol)) ?? LIVE_UNIVERSE.find((x) => x.feed.replace(/^xyz:/, '') === String(s.symbol).replace(/^xyz:/, ''));
    const px = Number(s.markPx);
    if (!slot || !(px > 0)) continue;
    const chg = Number(s.change24h);
    out.set(slot.sym, { px, change24h: Number.isFinite(chg) ? chg : 0 });
  }
  return out;
}

/** get_news payload ({text}) → headlines without links. */
export function parseNews(payload: unknown): { title: string; source: string }[] {
  const text = typeof payload === 'string' ? payload : String((payload as { text?: unknown })?.text ?? '');
  const head = text.split(/\n\s*Unusual Activity/i)[0];
  const out: { title: string; source: string }[] = [];
  for (const line of head.split('\n')) {
    const m = /^\s*\d+\.\s+(.*?)\s+—\s+(.*?)\s*(\(https?:[^)]*\))?\s*$/.exec(line);
    if (m) out.push({ title: m[1].slice(0, 140), source: m[2].slice(0, 40) });
  }
  return out;
}

function describe(e: McpError): LiveStatus {
  switch (e.code) {
    case 'needs_reauth': return { state: 'reconnect', message: 'Reconnect Co-Invest in claude.ai Settings → Connectors to get live prices.' };
    case 'server_not_connected':
    case 'server_not_found':
    case 'selection_required': return { state: 'not-connected', message: 'Add (or choose) the Co-Invest connector in claude.ai Settings → Connectors for live prices.' };
    case 'approval_required': return { state: 'needs-approval', message: 'Live prices need your approval to read Co-Invest market data.' };
    case 'not_in_manifest': return { state: 'blocked', message: 'Live prices are turned off for this page (Co-Invest not allowed).' };
    case 'blocked_by_policy': return { state: 'blocked', message: 'Your organisation blocks this Co-Invest tool.' };
    case 'not_granted':
    case 'capability_disabled':
    case 'capability_removed': return { state: 'off', message: 'Live data is not available in this view; showing the simulated market.' };
    case 'server_unavailable':
    case 'rate_limited': return { state: 'stale', message: 'Co-Invest is not answering right now; showing the last prices.' };
    default: return { state: 'error', message: `Live prices failed (${e.code}); showing the last prices.` };
  }
}

/**
 * Start the read-only feed. The first call asks the viewer's permission for Co-Invest; after that two
 * price watches refresh every 30 s and headlines every 5 min. Returns a stop function.
 */
export async function startLiveFeed(getSim: () => Simulation, onStatus: (s: LiveStatus) => void): Promise<() => void> {
  const mcp = await getMcp();
  if (!mcp) {
    onStatus({ state: 'off', message: 'Live data is not available outside claude.ai; showing the simulated market.' });
    return () => {};
  }
  onStatus({ state: 'connecting', message: 'Connecting to Co-Invest market data…' });
  const quotes = new Map<string, LiveQuote>();
  const unsub: (() => void)[] = [];
  let stopped = false;
  const apply = (q: Map<string, LiveQuote>, storedAt?: number) => {
    for (const [k, v] of q) quotes.set(k, v);
    const sim = getSim();
    if (!sim.live) {
      if (quotes.size < LIVE_UNIVERSE.length) return; // wait for every slot before switching the books over
      sim.goLive(quotes);
    } else {
      sim.updateLive(q);
    }
    onStatus({ state: 'live', message: `Live prices from Co-Invest (${quotes.size} markets). Trading is paper only.`, updatedAt: storedAt ?? Date.now() });
  };
  const watch = (tool: string, input: unknown, every: number, onData: (r: CallToolResult) => void) => {
    unsub.push(mcp.watchTool(SERVER, tool, input, (ev) => {
      if (stopped) return;
      if (ev.type === 'data') onData(ev.result);
      else {
        const s = describe(ev.error);
        // transient problems keep the last prices; denials stop live updates (prices stay at their last value)
        onStatus(getSim().live && (s.state === 'stale' || s.state === 'error') ? { ...s, updatedAt: getSim().liveUpdatedAt } : s);
      }
    }, { refetchInterval: every }));
  };
  try {
    // one explicit call first: it carries the viewer's consent prompt (watches never ask)
    const first = await mcp.callTool(SERVER, 'analyze_markets_batch', { symbols: BATCHES[0] });
    apply(parseSnapshots(first.payload), first.cache?.storedAt);
  } catch (e) {
    const s = describe(e as McpError);
    onStatus(s);
    if (s.state !== 'stale' && s.state !== 'error') return () => {};
  }
  for (const symbols of BATCHES) watch('analyze_markets_batch', { symbols }, REFRESH_MS, (r) => apply(parseSnapshots(r.payload), r.cache?.storedAt));
  watch('get_news', {}, NEWS_MS, (r) => {
    const news = parseNews(r.payload);
    if (news.length) { getSim().news = news; getSim().version++; }
  });
  return () => { stopped = true; for (const u of unsub) u(); };
}

/** Latest indicators for the live strategy lab (one call per symbol, on the owner's click). */
export async function fetchIndicators(sim: Simulation): Promise<number> {
  const mcp = await getMcp();
  if (!mcp || !sim.live) return 0;
  let n = 0;
  await Promise.all(LIVE_UNIVERSE.map(async (s) => {
    try {
      const r = await mcp.callTool(SERVER, 'get_technical_indicators', { symbol: s.feed, interval: '1h', indicators: ['rsi', 'sma'] }, { cache: { staleTime: 600_000, gcTime: 600_000 } });
      const p = r.payload as { currentPrice?: unknown; indicators?: { rsi14?: unknown; sma?: { sma20?: unknown; sma50?: unknown; sma200?: unknown } } };
      const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);
      const price = num(p?.currentPrice);
      if (!price) return;
      sim.indicators.set(s.sym, { price, rsi: num(p.indicators?.rsi14), sma20: num(p.indicators?.sma?.sma20), sma50: num(p.indicators?.sma?.sma50), sma200: num(p.indicators?.sma?.sma200) });
      n++;
    } catch {
      /* this symbol keeps no indicators; the lab treats it as "no regime read" */
    }
  }));
  return n;
}

let current: (() => void) | null = null;

/** (Re)connect the feed: the button behind "needs approval" makes the consent-carrying call again. */
export async function connectLive(getSim: () => Simulation, onStatus: (s: LiveStatus) => void): Promise<void> {
  current?.();
  current = await startLiveFeed(getSim, onStatus);
}

export function disconnectLive() {
  current?.();
  current = null;
}
