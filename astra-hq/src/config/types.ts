export const ROLE_TYPES = ['receptionist', 'trader', 'researcher', 'risk', 'pm', 'tech', 'ops', 'ceo', 'coordinator'] as const;
export type RoleType = (typeof ROLE_TYPES)[number];

export const ROLE_LABELS: Record<RoleType, string> = {
  receptionist: 'Receptionist',
  trader: 'Trader',
  researcher: 'Researcher',
  risk: 'Risk Analyst',
  pm: 'Portfolio Manager',
  tech: 'Technology',
  ops: 'Operations',
  ceo: 'Founder / CEO',
  coordinator: 'Office & Café Coordinator',
};

export const HAIR_STYLES = ['short', 'long', 'bun', 'buzz', 'bald', 'curly', 'bob'] as const;
export type HairStyle = (typeof HAIR_STYLES)[number];
export const TOP_STYLES = ['shirt', 'blazer', 'sweater', 'blouse'] as const;
export type TopStyle = (typeof TOP_STYLES)[number];

export interface Appearance {
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  top: string;
  topStyle: TopStyle;
  bottom: string;
  shoes: string;
  /** Height scale, 0.9 .. 1.1 (1 = 1.75 m). */
  height: number;
  /** Body width scale, 0.9 .. 1.15. */
  build: number;
  glasses: boolean;
}

export const BOOK_IDS = ['eq', 'macro', 'credit'] as const;
export type BookId = (typeof BOOK_IDS)[number];

export interface EmployeeConfig {
  id: string;
  name: string;
  roleType: RoleType;
  title: string;
  department: string;
  workstationId: string;
  appearance: Appearance;
  /** Trading book for traders and portfolio managers. */
  bookId?: BookId;
}

export interface OfficeConfig {
  schemaVersion: 1;
  companyName: string;
  seed: number;
  employees: EmployeeConfig[];
}
