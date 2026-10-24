// One simulation clock drives everything: schedules, events, markets, screens and movement.
// At 1x speed one real second advances the office clock by 20 simulated seconds.
export const SIM_MIN_PER_REAL_SEC = 1 / 3;
// The building opens at 06:30; staff arrive through the entrance from ~06:45 and leave from ~17:10.
export const DAY_START = 6 * 60 + 30; // 06:30
export const DAY_END = 19 * 60 + 30; // 19:30
export const MARKET_OPEN = 8 * 60 + 30;
export const MARKET_CLOSE = 17 * 60;
/** Clock rate when the real-time option is on: one simulated minute per real minute. */
export const REALTIME_MIN_PER_SEC = 1 / 60;
export const SPEEDS = [1, 2, 5] as const;
export type Speed = (typeof SPEEDS)[number];
/** Walking speed in metres per real second (scaled by the speed multiplier like everything else). */
export const WALK_SPEED = 1.3;
