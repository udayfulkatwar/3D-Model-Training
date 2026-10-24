// The single Simulation instance shared by the 3D scene and the UI panels.
import { loadConfig, loadTraining, saveTraining } from '../config/storage';
import type { OfficeConfig } from '../config/types';
import { Simulation } from '../sim/simulation';

const loaded = loadConfig();
let sim = new Simulation(loaded.config);
// The app is a real office: wall-clock time, 24/7, live data only. `?office=test-sim` is the automated
// browser tests' harness only (accelerated, seeded day); it is not linked from anywhere in the app.
const testHarness = typeof location !== 'undefined' && new URLSearchParams(location.search).get('office') === 'test-sim';
if (!testHarness) sim.setRealMode(true);
const OFFICE_KEY = 'astra-hq:office:v1';
try {
  const raw = testHarness ? null : localStorage.getItem(OFFICE_KEY);
  if (raw) sim.restoreState(JSON.parse(raw));
} catch {
  /* nothing saved, or storage unavailable */
}
function saveOffice() {
  if (testHarness) return;
  try {
    localStorage.setItem(OFFICE_KEY, JSON.stringify(getSim().persistState()));
  } catch {
    /* storage full or unavailable: the office keeps running, it just won't remember */
  }
}
sim.onPersist = saveOffice;
if (typeof window !== 'undefined') window.addEventListener('beforeunload', saveOffice);
sim.loadTraining(loadTraining());
sim.onTrainingChange = saveTraining;
export const startupWarning = loaded.warning;

export function getSim(): Simulation {
  return sim;
}

/** Rebuild the simulation from a new configuration (restarts the simulated day). */
export function rebuildSim(config: OfficeConfig) {
  sim.reset(config);
}

/** Testing/debug hook: replace the instance entirely. */
export function setSim(s: Simulation) {
  sim = s;
}
