// Default roster: 30 FICTIONAL placeholder employees. Replace names, titles and desks with your own team
// via the in-app editor or an imported JSON file. No real people are represented.
import type { Appearance, BookId, EmployeeConfig, HairStyle, OfficeConfig, RoleType, TopStyle } from './types';

const SKIN = ['#f1d3bc', '#e0b593', '#c99a74', '#a6714d', '#8a5a3c', '#6b4229', '#4f3020'];
const HAIR = ['#1b1512', '#3a2a1f', '#5a3d2a', '#8a6a48', '#b89a6c', '#9c9c9c', '#2d2d33', '#6e3b22'];

function look(skin: number, hair: number, hairStyle: HairStyle, top: string, topStyle: TopStyle, bottom: string, height = 1, build = 1, glasses = false, shoes = '#1d1b1a'): Appearance {
  return { skin: SKIN[skin], hair: HAIR[hair], hairStyle, top, topStyle, bottom, shoes, height, build, glasses };
}

type Row = [id: string, name: string, role: RoleType, title: string, department: string, ws: string, appearance: Appearance, book?: BookId];

const ROWS: Row[] = [
  ['e01', 'Maya Chen', 'receptionist', 'Receptionist', 'Front Office', 'ws-reception', look(1, 0, 'bun', '#2f3b52', 'blazer', '#24252b', 0.96, 0.95)],
  ['e02', 'Daniel Okafor', 'trader', 'Head Trader, Equities', 'Trading', 'ws-trade-01', look(5, 0, 'buzz', '#e9ecef', 'shirt', '#2b2f3a', 1.04, 1.05), 'eq'],
  ['e03', 'Priya Raman', 'trader', 'Equity Trader', 'Trading', 'ws-trade-02', look(3, 0, 'long', '#7a8fa6', 'blouse', '#2a2a30', 0.95, 0.95), 'eq'],
  ['e04', 'Lucas Moreau', 'trader', 'Equity Trader', 'Trading', 'ws-trade-03', look(1, 3, 'short', '#c8d6e5', 'shirt', '#3b3f4a', 1.02, 1.0, true), 'eq'],
  ['e05', 'Sofia Alvarez', 'trader', 'Execution Trader', 'Trading', 'ws-trade-04', look(2, 1, 'bob', '#f3efe8', 'blouse', '#1f2a3a', 0.97, 0.95), 'eq'],
  ['e06', 'Kenji Watanabe', 'trader', 'Macro Trader', 'Trading', 'ws-trade-05', look(1, 0, 'short', '#dfe7f2', 'shirt', '#262a33', 1.0, 1.0), 'macro'],
  ['e07', 'Hannah Weiss', 'trader', 'Rates Trader', 'Trading', 'ws-trade-06', look(0, 4, 'long', '#40495a', 'sweater', '#2c2c2c', 0.98, 0.95), 'macro'],
  ['e08', 'Omar Haddad', 'trader', 'FX & Commodities Trader', 'Trading', 'ws-trade-07', look(3, 1, 'short', '#ffffff', 'shirt', '#3a3530', 1.03, 1.08), 'macro'],
  ['e09', 'Grace Kim', 'trader', 'Credit Trader', 'Trading', 'ws-trade-08', look(1, 0, 'bob', '#9fb4c7', 'blouse', '#232733', 0.94, 0.92, true), 'credit'],
  ['e10', 'Mateo Rossi', 'trader', 'Credit Trader', 'Trading', 'ws-trade-09', look(2, 2, 'curly', '#e3e8ee', 'shirt', '#30343d', 1.01, 1.02), 'credit'],
  ['e11', 'Aisha Bello', 'trader', 'Credit Trader', 'Trading', 'ws-trade-10', look(5, 0, 'curly', '#5c3a4a', 'blouse', '#202124', 0.97, 0.97), 'credit'],
  ['e12', 'Elena Petrova', 'researcher', 'Head of Research', 'Research', 'ws-res-01', look(0, 3, 'bun', '#3e4a3d', 'blazer', '#25262a', 0.99, 0.95, true)],
  ['e13', 'Samuel Adeyemi', 'researcher', 'Equity Analyst', 'Research', 'ws-res-02', look(6, 0, 'buzz', '#b7c4cf', 'sweater', '#2e3138', 1.05, 1.05)],
  ['e14', 'Clara Lindqvist', 'researcher', 'Macro Economist', 'Research', 'ws-res-03', look(0, 4, 'long', '#d9c9b0', 'sweater', '#3a3a3f', 1.0, 0.94)],
  ['e15', 'Ravi Iyer', 'researcher', 'Quantitative Analyst', 'Research', 'ws-res-04', look(3, 0, 'short', '#6c7a89', 'shirt', '#2b2e33', 0.98, 1.0, true)],
  ['e16', 'Noah Fischer', 'researcher', 'Credit Analyst', 'Research', 'ws-res-05', look(0, 2, 'curly', '#e6e2da', 'shirt', '#3c4250', 1.02, 1.0)],
  ['e17', 'Isabel Duarte', 'risk', 'Head of Risk', 'Risk', 'ws-risk-01', look(2, 1, 'bob', '#2b2f3a', 'blazer', '#1d1e22', 0.98, 0.95)],
  ['e18', 'Tomasz Nowak', 'risk', 'Risk Analyst', 'Risk', 'ws-risk-02', look(0, 3, 'short', '#dce3ea', 'shirt', '#2f343d', 1.04, 1.05, true)],
  ['e19', 'Leila Karimi', 'risk', 'Market Risk Analyst', 'Risk', 'ws-risk-03', look(2, 0, 'long', '#7d5f73', 'blouse', '#25252b', 0.95, 0.93)],
  ['e20', 'Jonathan Hale', 'pm', 'Portfolio Manager, Global Equities', 'Portfolio Management', 'ws-pm-01', look(0, 5, 'short', '#283141', 'blazer', '#23252b', 1.03, 1.05), 'eq'],
  ['e21', 'Mei Tanaka', 'pm', 'Portfolio Manager, Global Macro', 'Portfolio Management', 'ws-pm-02', look(1, 0, 'bob', '#3a3f4b', 'blazer', '#1f2026', 0.95, 0.93), 'macro'],
  ['e22', 'Victor Mensah', 'pm', 'Portfolio Manager, Credit', 'Portfolio Management', 'ws-pm-03', look(5, 0, 'buzz', '#2e3a4a', 'blazer', '#202228', 1.05, 1.08), 'credit'],
  ['e23', 'Arjun Mehta', 'tech', 'Head of Technology', 'Technology', 'ws-tech-01', look(3, 0, 'short', '#4a5560', 'sweater', '#2a2d33', 1.0, 1.0, true)],
  ['e24', 'Zoe Bennett', 'tech', 'Platform Engineer', 'Technology', 'ws-tech-02', look(0, 7, 'long', '#334046', 'sweater', '#29303a', 0.96, 0.94)],
  ['e25', 'Felix Wagner', 'tech', 'Trading Systems Developer', 'Technology', 'ws-tech-03', look(0, 4, 'curly', '#5b6b5a', 'sweater', '#2b2b2b', 1.06, 1.02)],
  ['e26', 'Nadia Rahman', 'tech', 'Data Engineer', 'Technology', 'ws-tech-04', look(3, 0, 'bun', '#6f5f7d', 'sweater', '#24262c', 0.95, 0.94, true)],
  ['e27', 'Carlos Mendes', 'ops', 'Operations Manager', 'Operations', 'ws-ops-01', look(2, 1, 'short', '#d7dee6', 'shirt', '#33373f', 1.01, 1.06)],
  ['e28', 'Fatima Zahra', 'ops', 'Settlements Analyst', 'Operations', 'ws-ops-02', look(3, 0, 'bun', '#8a7a62', 'blouse', '#2a2b30', 0.94, 0.93)],
  ['e29', 'Alexander Reed', 'ceo', 'Founder & Chief Executive Officer', 'Executive', 'ws-ceo', look(0, 5, 'short', '#1f2430', 'blazer', '#1b1c20', 1.05, 1.03)],
  ['e30', 'Rosa Delgado', 'coordinator', 'Office & Café Coordinator', 'Workplace', 'ws-cafe', look(2, 2, 'bun', '#6b4f3a', 'sweater', '#2b2b2f', 0.96, 0.98)],
];

export const DEFAULT_COMPANY = 'ASTRA';
export const DEFAULT_SEED = 20261022;

export function defaultConfig(): OfficeConfig {
  const employees: EmployeeConfig[] = ROWS.map(([id, name, roleType, title, department, workstationId, appearance, bookId]) => ({
    id, name, roleType, title, department, workstationId, appearance: { ...appearance }, ...(bookId ? { bookId } : {}),
  }));
  return { schemaVersion: 1, companyName: DEFAULT_COMPANY, seed: DEFAULT_SEED, employees };
}
