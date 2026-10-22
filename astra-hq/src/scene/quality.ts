// Graphics presets. Differences are meaningful: resolution, anti-aliasing, shadows, ambient occlusion,
// monitor texture resolution and refresh budget, animation rates and city density.
import type { GraphicsPreset } from '../config/storage';

export interface Quality {
  dpr: number;
  antialias: boolean;
  shadows: boolean;
  shadowMapSize: number;
  post: boolean;
  monitorRes: [number, number];
  /** Monitors closer than this (m) refresh at the near interval; farther ones at the far interval. */
  monitorNear: number;
  monitorMax: number;
  monitorNearInterval: number;
  monitorFarInterval: number;
  monitorUpdatesPerFrame: number;
  peopleFarHz: number;
  cityCount: number;
  envResolution: number;
  labelRadius: number;
}

export const PRESETS: Record<GraphicsPreset, Quality> = {
  low: {
    dpr: 1, antialias: false, shadows: false, shadowMapSize: 0, post: false,
    monitorRes: [256, 160], monitorNear: 6, monitorMax: 14, monitorNearInterval: 1.5, monitorFarInterval: 12, monitorUpdatesPerFrame: 1,
    peopleFarHz: 6, cityCount: 40, envResolution: 64, labelRadius: 12,
  },
  medium: {
    dpr: 1.5, antialias: true, shadows: false, shadowMapSize: 0, post: false,
    monitorRes: [384, 240], monitorNear: 9, monitorMax: 22, monitorNearInterval: 1.0, monitorFarInterval: 6, monitorUpdatesPerFrame: 2,
    peopleFarHz: 15, cityCount: 70, envResolution: 128, labelRadius: 18,
  },
  high: {
    dpr: 2, antialias: true, shadows: true, shadowMapSize: 2048, post: true,
    monitorRes: [512, 320], monitorNear: 12, monitorMax: 30, monitorNearInterval: 0.75, monitorFarInterval: 4, monitorUpdatesPerFrame: 3,
    peopleFarHz: 30, cityCount: 110, envResolution: 256, labelRadius: 24,
  },
};
