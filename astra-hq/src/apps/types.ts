// View model shared by the in-world canvas screens and the expanded HTML panels.
// Both renderers draw exactly this structure, so a monitor and its panel can never disagree.
import type { AppId } from '../sim/apps';

export type Tone = 'pos' | 'neg' | 'warn' | 'muted' | 'accent' | 'crit';

export type Widget =
  | { type: 'kpis'; items: { label: string; value: string; tone?: Tone }[] }
  | { type: 'table'; title?: string; columns: string[]; rows: string[][]; tones?: (Tone | undefined)[][]; align?: ('l' | 'r')[]; maxRows?: number }
  | { type: 'chart'; title: string; series: number[]; color?: string; baseline?: number; footer?: string }
  | { type: 'bars'; title: string; items: { label: string; value: number; max: number; text: string; tone?: Tone }[] }
  | { type: 'text'; title?: string; lines: string[]; cursor?: boolean; large?: boolean }
  | { type: 'code'; title?: string; lines: { n: number; text: string; tone?: Tone }[]; cursorLine?: number }
  | { type: 'alerts'; title?: string; items: { level: 'info' | 'warn' | 'crit'; text: string; time: string }[] };

export type Theme = 'dark' | 'light' | 'terminal' | 'whiteboard' | 'signage';

export interface AppView {
  key: string; // monitor or panel id
  appId: AppId | 'panel';
  title: string;
  tabs: string[];
  tab: number;
  employeeName: string;
  employeeId?: string;
  workstationLabel: string;
  time: string;
  minute: number;
  theme: Theme;
  layout: 'stack' | 'split' | 'grid';
  banner?: { text: string; tone: Tone };
  /** Data provenance tag shown in the header ('Simulated Data', or live prices with paper trading). */
  dataTag?: string;
  status?: string;
  widgets: Widget[];
}
