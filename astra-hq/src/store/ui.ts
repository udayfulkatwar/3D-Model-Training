import type { LiveStatus } from '../live/feed';
// UI state (zustand). Simulation state lives in the Simulation object; this store only holds what
// React needs to render menus, panels and HUD.
import { create } from 'zustand';
import { loadSettings, saveSettings, type Settings } from '../config/storage';

export type Mode = 'intro' | 'walk' | 'overview' | 'follow' | 'inspect' | 'seated';

export type OwnerTab = 'office' | 'work' | 'strategies' | 'system' | 'meeting' | 'requests' | 'training' | 'workflow' | 'report' | 'messages';

export type Panel =
  | { kind: 'employee'; id: string }
  | { kind: 'monitor'; monitorId: string }
  | { kind: 'wall'; panelId: string }
  | { kind: 'directory' }
  | { kind: 'navigation' }
  | { kind: 'settings'; tab?: 'simulation' | 'graphics' | 'editor' | 'about' }
  | { kind: 'elevator' }
  | { kind: 'coffee'; where: 'cafe' | 'lounge'; drink: string }
  | { kind: 'help' }
  | { kind: 'log' }
  | { kind: 'owner'; tab?: OwnerTab; pc?: boolean }
  | { kind: 'talk'; id: string }
  | { kind: 'cctv'; cam: number };

export interface InspectTarget { x: number; y: number; z: number; radius: number; label: string }

interface UIState {
  mode: Mode;
  panel: Panel | null;
  /** The open panel is minimised to a small bar (it keeps running; the office is visible and controllable). */
  panelMin: boolean;
  setPanelMin: (on: boolean) => void;
  /** Side cards (location, activity, minimap, occupancy) hidden for a clear view. */
  hudHidden: boolean;
  toggleHud: () => void;
  overviewFloor: number; // 0..2, or 3 = whole building
  followId: string | null;
  inspect: InspectTarget | null;
  seatedSeat: string | null;
  settings: Settings;
  pointerLocked: boolean;
  prompt: string | null;
  toast: { text: string; id: number } | null;
  simVersion: number;
  /** Live market data status (Co-Invest, read-only). */
  live: LiveStatus;
  setLive: (s: LiveStatus) => void;
  fps: number;
  renderStats: { calls: number; triangles: number; textures: number; geometries: number };
  playerFloor: number;
  playerRoom: string;
  reducedMotion: boolean;
  touch: boolean;
  fade: number;
  setMode: (m: Mode) => void;
  openPanel: (p: Panel) => void;
  closePanel: () => void;
  /** The open panel was opened from the Chairman's PC console (shows a way back to it). */
  fromPc: boolean;
  openFromPc: (p: Panel) => void;
  setOverviewFloor: (f: number) => void;
  follow: (id: string | null) => void;
  setInspect: (t: InspectTarget | null) => void;
  setSeated: (seat: string | null) => void;
  updateSettings: (s: Partial<Settings>) => void;
  setPointerLocked: (v: boolean) => void;
  setPrompt: (p: string | null) => void;
  showToast: (t: string) => void;
  bumpSim: (v: number) => void;
  setFps: (f: number) => void;
  setRenderStats: (s: UIState['renderStats']) => void;
  setPlayerPlace: (floor: number, room: string) => void;
  setFade: (f: number) => void;
}

const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const touch = typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window);

let toastSeq = 0;

export const useUI = create<UIState>((set, get) => ({
  mode: 'intro',
  panel: null,
  panelMin: false,
  setPanelMin: (panelMin) => set({ panelMin }),
  hudHidden: false,
  toggleHud: () => set({ hudHidden: !get().hudHidden }),
  overviewFloor: 3,
  followId: null,
  inspect: null,
  seatedSeat: null,
  settings: loadSettings(),
  pointerLocked: false,
  prompt: null,
  toast: null,
  simVersion: 0,
  live: { state: 'off', message: 'Simulated market (live data not connected).' },
  setLive: (live) => set({ live }),
  fps: 0,
  renderStats: { calls: 0, triangles: 0, textures: 0, geometries: 0 },
  playerFloor: 0,
  playerRoom: 'Reception & Lobby',
  reducedMotion: !!reduced,
  touch: !!touch,
  fade: 0,
  setMode: (mode) => set({ mode, prompt: null }),
  openPanel: (panel) => {
    if (document.pointerLockElement) document.exitPointerLock();
    set({ panel, prompt: null, panelMin: false, fromPc: false });
  },
  fromPc: false,
  openFromPc: (panel) => set({ panel, prompt: null, panelMin: false, fromPc: true }),
  closePanel: () => set({ panel: null, panelMin: false }),
  setOverviewFloor: (overviewFloor) => set({ overviewFloor }),
  follow: (followId) => set({ followId, mode: followId ? 'follow' : get().mode === 'follow' ? 'overview' : get().mode }),
  setInspect: (inspect) => set({ inspect, mode: inspect ? 'inspect' : 'overview' }),
  setSeated: (seatedSeat) => set({ seatedSeat }),
  updateSettings: (s) => {
    const settings = { ...get().settings, ...s };
    saveSettings(settings);
    set({ settings });
  },
  setPointerLocked: (pointerLocked) => set({ pointerLocked }),
  setPrompt: (prompt) => { if (get().prompt !== prompt) set({ prompt }); },
  showToast: (text) => set({ toast: { text, id: ++toastSeq } }),
  bumpSim: (simVersion) => set({ simVersion }),
  setFps: (fps) => set({ fps }),
  setRenderStats: (renderStats) => set({ renderStats }),
  setPlayerPlace: (playerFloor, playerRoom) => {
    const s = get();
    if (s.playerFloor !== playerFloor || s.playerRoom !== playerRoom) set({ playerFloor, playerRoom });
  },
  setFade: (fade) => set({ fade }),
}));

/** Movement and look input are ignored while a panel is open or a text field has focus. */
export function inputBlocked(): boolean {
  const s = useUI.getState();
  if (s.panel && !s.panelMin) return true;
  const a = document.activeElement as HTMLElement | null;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable)) return true;
  return false;
}
