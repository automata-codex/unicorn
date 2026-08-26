import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  ASSEMBLY_GOLDEN_FILES,
  findAssemblyGoldenMismatches,
  renderAssemblySurfaces,
} from '../src/session/session.assembly';

import {
  assertAssemblyGoldensCurrent,
  assertJudgeContractGoldenCurrent,
  describeAssemblyGoldenMismatches,
} from './preflight';

import type { AssemblySurfaces } from '../src/session/session.assembly';

/**
 * Writes a full set of goldens to a fresh temp directory, optionally
 * corrupting or omitting one. Real files rather than a mocked reader — the
 * thing under test is whether a stale render is caught on disk.
 */
function goldenDir(
  opts: { corrupt?: keyof AssemblySurfaces; omit?: keyof AssemblySurfaces } = {},
): string {
  const dir = mkdtempSync(join(tmpdir(), 'assembly-goldens-'));
  const surfaces = renderAssemblySurfaces();
  for (const [key, file] of Object.entries(ASSEMBLY_GOLDEN_FILES)) {
    const surface = key as keyof AssemblySurfaces;
    if (opts.omit === surface) continue;
    const text =
      opts.corrupt === surface
        ? `${surfaces[surface]}an edit nobody committed\n`
        : surfaces[surface];
    writeFileSync(join(dir, file), text);
  }
  return dir;
}

describe('findAssemblyGoldenMismatches', () => {
  it('finds nothing when every golden matches the render', () => {
    expect(findAssemblyGoldenMismatches(goldenDir())).toEqual([]);
  });

  it('reports a golden whose text has drifted from the render', () => {
    expect(
      findAssemblyGoldenMismatches(goldenDir({ corrupt: 'stateSnapshot' })),
    ).toEqual([
      { surface: 'stateSnapshot', file: 'state-snapshot.txt', reason: 'differs' },
    ]);
  });

  it('reports a golden that is absent rather than throwing', () => {
    expect(findAssemblyGoldenMismatches(goldenDir({ omit: 'tools' }))).toEqual([
      { surface: 'tools', file: 'tools.txt', reason: 'missing' },
    ]);
  });

  it('reports every mismatched surface, not just the first', () => {
    const dir = mkdtempSync(join(tmpdir(), 'assembly-goldens-empty-'));
    expect(findAssemblyGoldenMismatches(dir)).toHaveLength(
      Object.keys(ASSEMBLY_GOLDEN_FILES).length,
    );
  });
});

describe('describeAssemblyGoldenMismatches', () => {
  // The wording is the load-bearing part: a failing golden is ambiguous
  // between a stale build and an uncommitted edit, and the two fixes are
  // opposite. A message naming only one sends half its readers the wrong way.
  it('names both readings for a differing golden', () => {
    const message = describeAssemblyGoldenMismatches([
      { surface: 'tools', file: 'tools.txt', reason: 'differs' },
    ]);
    expect(message).toContain('npm run build');
    expect(message).toContain('UPDATE_ASSEMBLY_GOLDENS=1');
    expect(message).toContain('tools.txt');
  });

  it('does not offer the stale-build reading when nothing differs', () => {
    const message = describeAssemblyGoldenMismatches([
      { surface: 'tools', file: 'tools.txt', reason: 'missing' },
    ]);
    expect(message).not.toContain('npm run build');
    expect(message).toContain('never been committed');
  });

  it('says it is not skippable, since that is the question a reader asks next', () => {
    const message = describeAssemblyGoldenMismatches([
      { surface: 'gmContext', file: 'gm-context.txt', reason: 'differs' },
    ]);
    expect(message).toContain('not skippable');
  });
});

describe('assertAssemblyGoldensCurrent', () => {
  it('passes against the goldens committed in this repo', () => {
    // The integration half: if this fails, the workspace build is stale or a
    // golden was not committed — which is exactly what it exists to catch.
    expect(() => assertAssemblyGoldensCurrent()).not.toThrow();
  });
});

describe('assertJudgeContractGoldenCurrent', () => {
  it('passes against the golden committed in this repo', () => {
    expect(() => assertJudgeContractGoldenCurrent()).not.toThrow();
  });
});
