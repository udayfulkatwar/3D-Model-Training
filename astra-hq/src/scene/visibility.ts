// Which floors / ceilings are rendered this frame. Walkthrough keeps the full interior (ceilings on)
// and renders only the floors the camera can see; overview and orbit inspection use a cutaway.
import { FLOOR_COUNT, FLOOR_H } from '../world/building';
import { inStairwell } from '../world/physics';
import type { Mode } from '../store/ui';

export const vis = {
  floors: [true, true, true] as boolean[],
  ceilings: [true, true, true] as boolean[],
  roof: true,
  focusFloor: 0,
  interior: false,
  /** A floor the CCTV wall needs drawn this frame as well (-1: none). Not seen from inside: slabs and ceilings hide it. */
  extraFloor: -1,
};

export function computeVisibility(mode: Mode, overviewFloor: number, camX: number, camY: number, camZ: number, focusFloor: number) {
  const outside = camZ > 19.75 || camZ < -0.2 || camX < -0.2 || camX > 34.2 || camY > FLOOR_COUNT * FLOOR_H + 0.5;
  if (mode === 'overview' || mode === 'intro') {
    const all = overviewFloor >= FLOOR_COUNT;
    for (let f = 0; f < FLOOR_COUNT; f++) {
      vis.floors[f] = all || f <= overviewFloor;
      vis.ceilings[f] = all;
    }
    vis.roof = all;
    vis.interior = false;
    vis.focusFloor = all ? 0 : overviewFloor;
    return;
  }
  if (mode === 'inspect' || mode === 'follow') {
    for (let f = 0; f < FLOOR_COUNT; f++) {
      vis.floors[f] = f <= focusFloor;
      vis.ceilings[f] = false;
    }
    vis.roof = false;
    vis.interior = false;
    vis.focusFloor = focusFloor;
    return;
  }
  // walkthrough / seated
  if (outside) {
    for (let f = 0; f < FLOOR_COUNT; f++) { vis.floors[f] = true; vis.ceilings[f] = true; }
    vis.roof = true;
    vis.interior = false;
    vis.focusFloor = 0;
    return;
  }
  const f = Math.max(0, Math.min(FLOOR_COUNT - 1, Math.floor((camY - 0.2) / FLOOR_H)));
  const stair = inStairwell(camX, camZ) || (camX > 17.6 && camX < 21 && camZ < 7.5);
  for (let k = 0; k < FLOOR_COUNT; k++) {
    vis.floors[k] = k === f || (stair && Math.abs(k - f) === 1);
    vis.ceilings[k] = true;
  }
  if (vis.extraFloor >= 0) vis.floors[vis.extraFloor] = true;
  vis.roof = false;
  vis.interior = true;
  vis.focusFloor = f;
}
