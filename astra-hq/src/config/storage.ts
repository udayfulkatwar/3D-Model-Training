// localStorage persistence for office configuration and viewer settings. All access is guarded:
// storage may be unavailable (private mode, blocked site data) and the app must still work.
import { defaultConfig } from './defaults';
import type { OfficeConfig } from './types';
import { validateConfig } from './validate';

const CONFIG_KEY = 'astra-hq:config:v1';
const SETTINGS_KEY = 'astra-hq:settings:v1';

export type GraphicsPreset = 'low' | 'medium' | 'high';
export type LightingMode = 'auto' | 'day' | 'night';

export interface Settings {
  graphics: GraphicsPreset;
  lighting: LightingMode;
  sound: boolean;
  labels: boolean;
  showFps: boolean;
  invertY: boolean;
  mouseSensitivity: number;
  minimap: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  graphics: 'medium',
  lighting: 'auto',
  sound: false,
  labels: true,
  showFps: false,
  invertY: false,
  mouseSensitivity: 1,
  minimap: true,
};

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function loadConfig(): { config: OfficeConfig; warning?: string } {
  const raw = read(CONFIG_KEY);
  if (!raw) return { config: defaultConfig() };
  try {
    const r = validateConfig(JSON.parse(raw));
    if (r.ok) return { config: r.config };
    return { config: defaultConfig(), warning: `Saved configuration was invalid and was ignored: ${r.errors[0]}` };
  } catch {
    return { config: defaultConfig(), warning: 'Saved configuration could not be read and was ignored.' };
  }
}

export function saveConfig(c: OfficeConfig): boolean {
  return write(CONFIG_KEY, JSON.stringify(c));
}

export function clearConfig() {
  try {
    localStorage.removeItem(CONFIG_KEY);
  } catch {
    /* storage unavailable */
  }
}

export function loadSettings(): Settings {
  const raw = read(SETTINGS_KEY);
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    const s = JSON.parse(raw) as Partial<Settings>;
    const out = { ...DEFAULT_SETTINGS };
    if (s.graphics === 'low' || s.graphics === 'medium' || s.graphics === 'high') out.graphics = s.graphics;
    if (s.lighting === 'auto' || s.lighting === 'day' || s.lighting === 'night') out.lighting = s.lighting;
    for (const k of ['sound', 'labels', 'showFps', 'invertY', 'minimap'] as const) if (typeof s[k] === 'boolean') out[k] = s[k] as boolean;
    if (typeof s.mouseSensitivity === 'number' && s.mouseSensitivity >= 0.2 && s.mouseSensitivity <= 3) out.mouseSensitivity = s.mouseSensitivity;
    return out;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): boolean {
  return write(SETTINGS_KEY, JSON.stringify(s));
}

export function exportConfigJson(c: OfficeConfig): string {
  return JSON.stringify(c, null, 2);
}
