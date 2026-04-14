import { describe, it, expect } from 'vitest';
import type { OracleCategory } from '../data/oracle/types';
import {
  createOracleFilterState,
  isAllActive,
  isNoneActive,
  activeCount,
  toggleEntry,
  selectAll,
  deselectAll,
  canBegin,
} from './state.svelte';

const testCategories: OracleCategory[] = [
  {
    id: 'survivors',
    label: 'SURVIVORS',
    entries: [
      { id: 'a', player_text: 'Alpha', claude_text: '', interfaces: [], tags: [] },
      { id: 'b', player_text: 'Beta', claude_text: '', interfaces: [], tags: [] },
      { id: 'c', player_text: 'Gamma', claude_text: '', interfaces: [], tags: [] },
    ],
  },
  {
    id: 'threats',
    label: 'THREATS',
    entries: [
      { id: 'x', player_text: 'X-ray', claude_text: '', interfaces: [], tags: [] },
      { id: 'y', player_text: 'Yankee', claude_text: '', interfaces: [], tags: [] },
    ],
  },
];

describe('createOracleFilterState', () => {
  it('initialises all entries as active', () => {
    const state = createOracleFilterState(testCategories);
    expect(state.active['survivors']).toEqual(new Set(['a', 'b', 'c']));
    expect(state.active['threats']).toEqual(new Set(['x', 'y']));
  });
});

describe('isAllActive', () => {
  it('returns true when all entries are active', () => {
    const state = createOracleFilterState(testCategories);
    expect(isAllActive(state, 'survivors', testCategories)).toBe(true);
  });

  it('returns false when some entries are deactivated', () => {
    const state = createOracleFilterState(testCategories);
    toggleEntry(state, 'survivors', 'a');
    expect(isAllActive(state, 'survivors', testCategories)).toBe(false);
  });
});

describe('isNoneActive', () => {
  it('returns false when entries are active', () => {
    const state = createOracleFilterState(testCategories);
    expect(isNoneActive(state, 'survivors')).toBe(false);
  });

  it('returns true when all entries are deactivated', () => {
    const state = createOracleFilterState(testCategories);
    deselectAll(state, 'survivors');
    expect(isNoneActive(state, 'survivors')).toBe(true);
  });
});

describe('activeCount', () => {
  it('returns the number of active entries', () => {
    const state = createOracleFilterState(testCategories);
    expect(activeCount(state, 'survivors')).toBe(3);
    toggleEntry(state, 'survivors', 'a');
    expect(activeCount(state, 'survivors')).toBe(2);
  });

  it('returns 0 for unknown category', () => {
    const state = createOracleFilterState(testCategories);
    expect(activeCount(state, 'unknown')).toBe(0);
  });
});

describe('toggleEntry', () => {
  it('deactivates an active entry', () => {
    const state = createOracleFilterState(testCategories);
    toggleEntry(state, 'survivors', 'b');
    expect(state.active['survivors'].has('b')).toBe(false);
  });

  it('reactivates an inactive entry', () => {
    const state = createOracleFilterState(testCategories);
    toggleEntry(state, 'survivors', 'b');
    toggleEntry(state, 'survivors', 'b');
    expect(state.active['survivors'].has('b')).toBe(true);
  });
});

describe('selectAll', () => {
  it('reactivates all entries in a category', () => {
    const state = createOracleFilterState(testCategories);
    deselectAll(state, 'survivors');
    expect(activeCount(state, 'survivors')).toBe(0);
    selectAll(state, 'survivors', testCategories);
    expect(activeCount(state, 'survivors')).toBe(3);
  });
});

describe('deselectAll', () => {
  it('deactivates all entries in a category', () => {
    const state = createOracleFilterState(testCategories);
    deselectAll(state, 'threats');
    expect(activeCount(state, 'threats')).toBe(0);
    expect(isNoneActive(state, 'threats')).toBe(true);
  });
});

describe('canBegin', () => {
  it('returns true when all categories have at least one active entry', () => {
    const state = createOracleFilterState(testCategories);
    expect(canBegin(state)).toBe(true);
  });

  it('returns false when any category has zero active entries', () => {
    const state = createOracleFilterState(testCategories);
    deselectAll(state, 'threats');
    expect(canBegin(state)).toBe(false);
  });

  it('returns true again after reactivating an entry in the empty category', () => {
    const state = createOracleFilterState(testCategories);
    deselectAll(state, 'threats');
    toggleEntry(state, 'threats', 'x');
    expect(canBegin(state)).toBe(true);
  });
});
