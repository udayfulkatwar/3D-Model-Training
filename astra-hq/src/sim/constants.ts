// One simulation clock drives everything: schedules, events, markets, screens and movement.
// At 1x speed one real second advances the office clock by 20 simulated seconds.
export const SIM_MIN_PER_REAL_SEC = 1 / 3;
export const DAY_START = 7 * 60 + 40; // 07:40
export const DAY_END = 19 * 60 + 30; // 19:30
export const MARKET_OPEN = 8 * 60 + 30;
export const MARKET_CLOSE = 17 * 60;
export const SPEEDS = [1, 2, 5] as const;
export type Speed = (typeof SPEEDS)[number];
/** Walking speed in metres per real second (scaled by the speed multiplier like everything else). */
export const WALK_SPEED = 1.3;
