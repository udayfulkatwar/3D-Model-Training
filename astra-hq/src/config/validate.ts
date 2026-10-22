// Strict validation for office configuration JSON (imports and localStorage).
import { WS_INDEX } from '../world/furniture';
import { BOOK_IDS, HAIR_STYLES, ROLE_TYPES, TOP_STYLES, type OfficeConfig } from './types';

export type ValidationResult = { ok: true; config: OfficeConfig } | { ok: false; errors: string[] };

const COLOR = /^#[0-9a-fA-F]{6}$/;
const ID = /^[a-z0-9][a-z0-9-]{1,31}$/;
export const MAX_IMPORT_BYTES = 256 * 1024;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown, path: string, errors: string[], min = 1, max = 60): string {
  if (typeof v !== 'string') { errors.push(`${path} must be a string`); return ''; }
  const t = v.trim();
  if (t.length < min || t.length > max) errors.push(`${path} must be ${min}-${max} characters (got ${t.length})`);
  return t;
}

export function validateConfig(input: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObj(input)) return { ok: false, errors: ['Configuration must be a JSON object'] };
  if (input.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  const companyName = str(input.companyName, 'companyName', errors, 1, 40);
  let seed = 20261022;
  if (input.seed !== undefined) {
    if (typeof input.seed !== 'number' || !Number.isInteger(input.seed) || input.seed < 0 || input.seed > 2 ** 31) errors.push('seed must be a non-negative integer');
    else seed = input.seed;
  }
  if (!Array.isArray(input.employees)) {
    errors.push('employees must be an array');
    return { ok: false, errors };
  }
  if (input.employees.length < 1 || input.employees.length > WS_INDEX.size) errors.push(`employees must contain 1-${WS_INDEX.size} entries (got ${input.employees.length})`);
  const ids = new Set<string>();
  const desks = new Map<string, string>();
  const employees: OfficeConfig['employees'] = [];
  input.employees.forEach((raw: unknown, i: number) => {
    const p = `employees[${i}]`;
    if (!isObj(raw)) { errors.push(`${p} must be an object`); return; }
    const id = typeof raw.id === 'string' ? raw.id : '';
    if (!ID.test(id)) errors.push(`${p}.id must match ${ID} (lowercase letters, digits, dashes)`);
    else if (ids.has(id)) errors.push(`${p}.id "${id}" is duplicated`);
    ids.add(id);
    const name = str(raw.name, `${p}.name`, errors);
    const title = str(raw.title, `${p}.title`, errors);
    const department = str(raw.department, `${p}.department`, errors);
    const roleType = raw.roleType as OfficeConfig['employees'][number]['roleType'];
    if (!ROLE_TYPES.includes(roleType)) errors.push(`${p}.roleType must be one of ${ROLE_TYPES.join(', ')}`);
    const ws = typeof raw.workstationId === 'string' ? raw.workstationId : '';
    if (!WS_INDEX.has(ws)) errors.push(`${p}.workstationId "${ws}" is not a known workstation`);
    else if (desks.has(ws)) errors.push(`${p}.workstationId "${ws}" is already assigned to ${desks.get(ws)}`);
    else desks.set(ws, id || p);
    let bookId: OfficeConfig['employees'][number]['bookId'];
    if (raw.bookId !== undefined) {
      if (!BOOK_IDS.includes(raw.bookId as never)) errors.push(`${p}.bookId must be one of ${BOOK_IDS.join(', ')}`);
      else bookId = raw.bookId as typeof bookId;
    }
    const a = raw.appearance;
    if (!isObj(a)) { errors.push(`${p}.appearance must be an object`); return; }
    for (const k of ['skin', 'hair', 'top', 'bottom', 'shoes'] as const) {
      if (typeof a[k] !== 'string' || !COLOR.test(a[k] as string)) errors.push(`${p}.appearance.${k} must be a #rrggbb colour`);
    }
    if (!HAIR_STYLES.includes(a.hairStyle as never)) errors.push(`${p}.appearance.hairStyle must be one of ${HAIR_STYLES.join(', ')}`);
    if (!TOP_STYLES.includes(a.topStyle as never)) errors.push(`${p}.appearance.topStyle must be one of ${TOP_STYLES.join(', ')}`);
    if (typeof a.height !== 'number' || a.height < 0.85 || a.height > 1.15) errors.push(`${p}.appearance.height must be a number 0.85-1.15`);
    if (typeof a.build !== 'number' || a.build < 0.85 || a.build > 1.2) errors.push(`${p}.appearance.build must be a number 0.85-1.2`);
    if (typeof a.glasses !== 'boolean') errors.push(`${p}.appearance.glasses must be true or false`);
    employees.push({
      id, name, title, department, roleType, workstationId: ws,
      appearance: {
        skin: a.skin as string, hair: a.hair as string, hairStyle: a.hairStyle as never, top: a.top as string,
        topStyle: a.topStyle as never, bottom: a.bottom as string, shoes: a.shoes as string,
        height: a.height as number, build: a.build as number, glasses: a.glasses as boolean,
      },
      ...(bookId ? { bookId } : {}),
    });
  });
  if (errors.length) return { ok: false, errors };
  return { ok: true, config: { schemaVersion: 1, companyName, seed, employees } };
}

/** Parse + validate a JSON text import. Never throws. */
export function parseConfigJson(text: string): ValidationResult {
  if (text.length > MAX_IMPORT_BYTES) return { ok: false, errors: [`File is too large (${Math.round(text.length / 1024)} KB, limit ${MAX_IMPORT_BYTES / 1024} KB)`] };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`Not valid JSON: ${(e as Error).message}`] };
  }
  return validateConfig(data);
}
