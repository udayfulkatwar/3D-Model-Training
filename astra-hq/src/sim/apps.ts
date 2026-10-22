// Monitor application registry: which simulated application runs on which monitor, and its tabs.
import type { RoleType } from '../config/types';

export type AppId =
  | 'trade-chart' | 'trade-orders' | 'trade-blotter'
  | 'res-report' | 'res-model'
  | 'risk-exposure' | 'risk-limits'
  | 'pm-alloc' | 'pm-perf'
  | 'dev-editor' | 'dev-terminal'
  | 'ops-recon' | 'ops-tasks'
  | 'rec-visitors' | 'rec-rooms'
  | 'ceo-company' | 'ceo-portfolio'
  | 'cafe-orders'
  | 'flex-idle';

export interface AppDef { id: AppId; title: string; tabs: string[]; theme: 'dark' | 'light' | 'terminal' }

export const APPS: Record<AppId, AppDef> = {
  'trade-chart': { id: 'trade-chart', title: 'ASTRA Trader · Charts', tabs: ['Primary', 'Secondary', 'Market'], theme: 'dark' },
  'trade-orders': { id: 'trade-orders', title: 'ASTRA Trader · Orders', tabs: ['Watchlist', 'Working orders'], theme: 'dark' },
  'trade-blotter': { id: 'trade-blotter', title: 'ASTRA Trader · Blotter', tabs: ['Positions', 'Trade blotter'], theme: 'dark' },
  'res-report': { id: 'res-report', title: 'Research Writer', tabs: ['Report', 'Notes'], theme: 'light' },
  'res-model': { id: 'res-model', title: 'Valuation Model', tabs: ['Model', 'Sensitivity'], theme: 'light' },
  'risk-exposure': { id: 'risk-exposure', title: 'Risk Monitor · Exposure', tabs: ['Exposure', 'Drawdown'], theme: 'dark' },
  'risk-limits': { id: 'risk-limits', title: 'Risk Monitor · Limits', tabs: ['Limits', 'Alerts'], theme: 'dark' },
  'pm-alloc': { id: 'pm-alloc', title: 'Portfolio · Allocation', tabs: ['Allocation', 'Positions'], theme: 'dark' },
  'pm-perf': { id: 'pm-perf', title: 'Portfolio · Performance', tabs: ['Performance', 'Summary'], theme: 'dark' },
  'dev-editor': { id: 'dev-editor', title: 'Code Editor', tabs: ['Editor', 'Build'], theme: 'terminal' },
  'dev-terminal': { id: 'dev-terminal', title: 'Terminal & Metrics', tabs: ['Terminal', 'Metrics'], theme: 'terminal' },
  'ops-recon': { id: 'ops-recon', title: 'Operations · Reconciliation', tabs: ['Reconciliation', 'Breaks'], theme: 'light' },
  'ops-tasks': { id: 'ops-tasks', title: 'Operations · Tasks', tabs: ['Task queue', 'Schedule'], theme: 'light' },
  'rec-visitors': { id: 'rec-visitors', title: 'Front Desk · Visitors', tabs: ['Appointments', 'Staff directory'], theme: 'light' },
  'rec-rooms': { id: 'rec-rooms', title: 'Front Desk · Rooms', tabs: ['Room bookings', 'Floor occupancy'], theme: 'light' },
  'ceo-company': { id: 'ceo-company', title: 'Company Overview', tabs: ['Company', 'Office'], theme: 'dark' },
  'ceo-portfolio': { id: 'ceo-portfolio', title: 'Firm Portfolio', tabs: ['Portfolio', 'Risk'], theme: 'dark' },
  'cafe-orders': { id: 'cafe-orders', title: 'Café Orders', tabs: ['Orders', 'Room setup'], theme: 'light' },
  'flex-idle': { id: 'flex-idle', title: 'Flex Desk', tabs: ['Available'], theme: 'dark' },
};

export const ROLE_APPS: Record<RoleType, AppId[]> = {
  trader: ['trade-chart', 'trade-orders', 'trade-blotter'],
  researcher: ['res-report', 'res-model'],
  risk: ['risk-exposure', 'risk-limits'],
  pm: ['pm-alloc', 'pm-perf'],
  tech: ['dev-editor', 'dev-terminal'],
  ops: ['ops-recon', 'ops-tasks'],
  receptionist: ['rec-visitors', 'rec-rooms'],
  ceo: ['ceo-company', 'ceo-portfolio'],
  coordinator: ['cafe-orders'],
};

/** App for a given monitor of a workstation used by a role (fewer monitors = first apps; more = repeat). */
export function appFor(role: RoleType | null, index: number): AppId {
  if (!role) return 'flex-idle';
  const apps = ROLE_APPS[role];
  return apps[index % apps.length];
}
