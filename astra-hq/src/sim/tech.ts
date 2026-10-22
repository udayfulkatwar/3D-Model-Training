// Simulated infrastructure: service metrics, CI builds and the scheduled market-data incident.
import { hashRand } from '../util/rng';

export interface ServiceDef { id: string; name: string; baseCpu: number; baseLatency: number; host: string }

export const SERVICES: ServiceDef[] = [
  { id: 'md-feed', name: 'Market data feed', baseCpu: 38, baseLatency: 4, host: 'rack A2' },
  { id: 'oms', name: 'Order management', baseCpu: 31, baseLatency: 7, host: 'rack A3' },
  { id: 'risk-engine', name: 'Risk engine', baseCpu: 46, baseLatency: 55, host: 'rack B1' },
  { id: 'pricing', name: 'Pricing service', baseCpu: 27, baseLatency: 12, host: 'rack B2' },
  { id: 'recon', name: 'Reconciliation', baseCpu: 18, baseLatency: 90, host: 'rack B4' },
  { id: 'db', name: 'Position database', baseCpu: 34, baseLatency: 3, host: 'rack A1' },
];

export interface ServiceMetric { id: string; name: string; cpu: number; mem: number; latency: number; status: 'ok' | 'degraded' | 'down'; host: string }

export interface Build {
  id: number;
  t: number;
  author: string;
  branch: string;
  message: string;
  status: 'running' | 'passed' | 'failed';
  finishAt: number;
  tests: number;
}

export interface Incident {
  id: string;
  title: string;
  service: string;
  start: number;
  gatherEnd: number;
  fixAt: number;
  resolveAt: number;
  status: 'scheduled' | 'investigating' | 'fixing' | 'resolved';
  log: { t: number; text: string }[];
}

const COMMITS = [
  'Tighten order throttle checks',
  'Add retry jitter to feed reconnect',
  'Refactor position snapshot writer',
  'Speed up risk aggregation by sector',
  'Fix blotter sort on partial fills',
  'Improve recon matching tolerance logging',
  'Upgrade pricing curve interpolation',
  'Add metrics for confirmation latency',
];

export class Tech {
  builds: Build[] = [];
  incident: Incident;
  private buildSeq = 1400;

  constructor(private seed: number, incidentStart: number) {
    this.incident = {
      id: 'INC-2041', title: 'Market data feed latency', service: 'md-feed', start: incidentStart,
      gatherEnd: incidentStart + 18, fixAt: incidentStart + 32, resolveAt: incidentStart + 40, status: 'scheduled', log: [],
    };
  }

  newDay(incidentStart: number) {
    this.builds = this.builds.slice(0, 6);
    this.incident = { ...this.incident, start: incidentStart, gatherEnd: incidentStart + 18, fixAt: incidentStart + 32, resolveAt: incidentStart + 40, status: 'scheduled', log: [] };
  }

  get incidentActive(): boolean {
    return this.incident.status === 'investigating' || this.incident.status === 'fixing';
  }

  onMinute(minute: number, day: number, devsAtDesk: string[], names: Map<string, string>) {
    const inc = this.incident;
    if (inc.status === 'scheduled' && minute >= inc.start) {
      inc.status = 'investigating';
      inc.log.push({ t: minute, text: 'Alert: md-feed p99 latency above 250 ms; downstream prices delayed' });
    }
    if (inc.status === 'investigating' && minute >= inc.fixAt) {
      inc.status = 'fixing';
      inc.log.push({ t: minute, text: 'Root cause: feed handler connection pool exhausted after vendor failover. Hotfix build started.' });
      this.startBuild(minute, devsAtDesk[0] ?? 'tech', 'hotfix/feed-pool', 'Raise feed handler pool size and add backpressure');
    }
    if (inc.status === 'fixing' && minute >= inc.resolveAt) {
      inc.status = 'resolved';
      inc.log.push({ t: minute, text: 'Hotfix deployed; latency back under 10 ms. Incident resolved.' });
    }
    for (const b of this.builds) {
      if (b.status === 'running' && minute >= b.finishAt) {
        b.status = b.branch.startsWith('hotfix') || hashRand(this.seed, 'build', b.id) > 0.15 ? 'passed' : 'failed';
      }
    }
    // developers at their desks push changes now and then
    for (const dev of devsAtDesk) {
      if (hashRand(this.seed, 'commit', dev, day, minute) < 1 / 55) {
        const msg = COMMITS[Math.floor(hashRand(this.seed, 'commitmsg', dev, day, minute) * COMMITS.length)];
        this.startBuild(minute, dev, `feature/${(names.get(dev) ?? 'dev').split(' ')[0].toLowerCase()}-${minute % 97}`, msg);
      }
    }
  }

  private startBuild(minute: number, author: string, branch: string, message: string) {
    this.builds.unshift({ id: ++this.buildSeq, t: minute, author, branch, message, status: 'running', finishAt: minute + 6 + (this.buildSeq % 5), tests: 1180 + (this.buildSeq % 37) });
    if (this.builds.length > 20) this.builds.pop();
  }

  metrics(minute: number): ServiceMetric[] {
    const inc = this.incident;
    return SERVICES.map((s, i) => {
      const wobble = Math.sin(minute / 7 + i * 1.3) * 6 + (hashRand(this.seed, 'cpu', i, Math.floor(minute)) - 0.5) * 8;
      let cpu = s.baseCpu + wobble;
      let latency = s.baseLatency * (1 + (hashRand(this.seed, 'lat', i, Math.floor(minute)) - 0.5) * 0.3);
      let status: ServiceMetric['status'] = 'ok';
      if (this.incidentActive && s.id === inc.service) {
        const into = minute - inc.start;
        latency = inc.status === 'fixing' ? 120 - (minute - inc.fixAt) * 12 : 260 + into * 9;
        cpu = 88 + Math.sin(minute) * 5;
        status = 'degraded';
      } else if (this.incidentActive && (s.id === 'pricing' || s.id === 'risk-engine')) {
        latency *= 1.8;
        cpu += 9;
      }
      return { id: s.id, name: s.name, cpu: Math.max(3, Math.min(99, cpu)), mem: 42 + ((i * 13 + Math.floor(minute / 15)) % 30), latency: Math.max(1, latency), status, host: s.host };
    });
  }
}
