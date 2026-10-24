// The single Simulation instance shared by the 3D scene and the UI panels.
import { loadConfig, loadTraining, saveTraining } from '../config/storage';
import type { OfficeConfig } from '../config/types';
import { Simulation } from '../sim/simulation';

const loaded = loadConfig();
let sim = new Simulation(loaded.config);
sim.loadTraining(loadTraining());
sim.onTrainingChange = saveTraining;
export const startupWarning = loaded.warning;

export function getSim(): Simulation {
  return sim;
}

/** Rebuild the simulation from a new configuration (restarts the simulated day). */
export function rebuildSim(config: OfficeConfig) {
  const speed = sim.speed;
  sim.reset(config);
  sim.speed = speed;
}

/** Testing/debug hook: replace the instance entirely. */
export function setSim(s: Simulation) {
  sim = s;
}
