import type { OracleCategory } from '../data/oracle/types';

export type OracleFilterState = {
  active: Record<string, Set<string>>;
};

export function createOracleFilterState(
  categories: OracleCategory[],
): OracleFilterState {
  const active: Record<string, Set<string>> = {};
  for (const cat of categories) {
    active[cat.id] = new Set(cat.entries.map((e) => e.id));
  }
  return { active };
}

export function isAllActive(
  state: OracleFilterState,
  categoryId: string,
  categories: OracleCategory[],
): boolean {
  const set = state.active[categoryId];
  const cat = categories.find((c) => c.id === categoryId);
  if (set == null || cat == null) return false;
  return set.size === cat.entries.length;
}

export function isNoneActive(
  state: OracleFilterState,
  categoryId: string,
): boolean {
  const set = state.active[categoryId];
  return set == null || set.size === 0;
}

export function activeCount(
  state: OracleFilterState,
  categoryId: string,
): number {
  return state.active[categoryId]?.size ?? 0;
}

export function toggleEntry(
  state: OracleFilterState,
  categoryId: string,
  entryId: string,
): void {
  const set = state.active[categoryId];
  if (set == null) return;
  if (set.has(entryId)) {
    set.delete(entryId);
  } else {
    set.add(entryId);
  }
}

export function selectAll(
  state: OracleFilterState,
  categoryId: string,
  categories: OracleCategory[],
): void {
  const cat = categories.find((c) => c.id === categoryId);
  if (cat == null) return;
  state.active[categoryId] = new Set(cat.entries.map((e) => e.id));
}

export function deselectAll(
  state: OracleFilterState,
  categoryId: string,
): void {
  const set = state.active[categoryId];
  if (set != null) {
    set.clear();
  }
}

export function canBegin(state: OracleFilterState): boolean {
  return Object.values(state.active).every((set) => set.size > 0);
}
