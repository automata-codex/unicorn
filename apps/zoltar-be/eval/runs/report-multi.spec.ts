import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { renderRunReport } from './report-multi';

import type { Manifest } from './manifest';
import type { ExclusionsSummary, RateEntry } from './rates';

function baseManifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    schemaVersion: 1,
    runId: 'claude-sonnet-4-6__ab12cd34__2026-07-26T14-32-10Z',
    model: 'claude-sonnet-4-6',
    promptHash: 'ab12cd34',
    temperature: 1,
    corpusVersion: 'deadbeef'.repeat(8),
    createdAt: '2026-07-26T14:32:10.000Z',
    plannedReps: 2,
    completedReps: [],
    ...overrides,
  };
}

const EMPTY_EXCLUSIONS: ExclusionsSummary = {
  unvouchedReps: [],
  rawExclusions: [],
  notApplicableByReason: [],
  errorsByMessage: [],
};

describe('renderRunReport', () => {
  it('renders a golden report for a mixed run', () => {
    const manifest = baseManifest({
      completedReps: [
        {
          index: 1,
          harnessVersion: 'abc1234',
          rubricHashes: { 'scene-jump': 'ba1cff52' },
          fixtureIds: ['turn19-out-of-order-resolution', 'turn24-scene-jump'],
          startedAt: '2026-07-26T14:33:00.000Z',
          completedAt: '2026-07-26T14:34:00.000Z',
        },
        {
          index: 2,
          harnessVersion: 'abc1234',
          rubricHashes: {},
          fixtureIds: ['turn19-out-of-order-resolution', 'turn24-scene-jump'],
          startedAt: '2026-07-26T14:34:00.000Z',
          completedAt: '2026-07-26T14:35:00.000Z',
        },
      ],
    });

    const rates: RateEntry[] = [
      {
        fixtureId: 'turn19-out-of-order-resolution',
        checkId: 'out-of-order-resolution',
        tag: 'OUT-OF-ORDER-RESOLUTION',
        checkMode: 'structural',
        pass: 1,
        fail: 1,
        notApplicable: 0,
        error: 0,
        n: 2,
        rate: 0.5,
      },
      {
        fixtureId: 'turn24-scene-jump',
        checkId: 'scene-jump',
        tag: 'SCENE-JUMP',
        checkMode: 'judged',
        pass: 0,
        fail: 0,
        notApplicable: 2,
        error: 0,
        n: 0,
        rate: null,
      },
    ];

    const exclusions: ExclusionsSummary = {
      unvouchedReps: [3],
      rawExclusions: [
        'rep 003 exists on disk but is not vouched for in manifest.json (crashed or in-progress run) — excluded',
      ],
      notApplicableByReason: [{ reason: 'no dice_roll this turn', count: 2 }],
      errorsByMessage: [
        {
          message: 'Inner tool loop did not terminate within 20 iterations',
          count: 1,
        },
      ],
    };

    const report = renderRunReport(manifest, rates, exclusions);

    expect(report).toBe(
      [
        '# Eval Run Report: claude-sonnet-4-6__ab12cd34__2026-07-26T14-32-10Z',
        '',
        '- Model: claude-sonnet-4-6',
        '- Prompt hash: ab12cd34',
        '- Temperature: 1',
        '- Corpus version: deadbeefdead',
        '- Planned reps: 2',
        '- Completed reps: 2',
        '',
        '## Per-fixture rates',
        '',
        '| Fixture | Check | Tag | Mode | Pass | Fail | N/A | Error | N | Rate |',
        '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
        '| turn19-out-of-order-resolution | out-of-order-resolution | OUT-OF-ORDER-RESOLUTION | structural | 1 | 1 | 0 | 0 | 2 | 0.50 |',
        '| turn24-scene-jump | scene-jump | SCENE-JUMP | judged | 0 | 0 | 2 | 0 | 0 | n/a |',
        '',
        '## Per-tag rollup',
        '',
        '| Tag | Pass | Fail | N | Rate | Fixtures w/o denominator |',
        '| --- | --- | --- | --- | --- | --- |',
        '| OUT-OF-ORDER-RESOLUTION | 1 | 1 | 2 | 0.50 | 0 |',
        '| SCENE-JUMP | 0 | 0 | 0 | n/a | 1 |',
        '',
        '## Errors',
        '',
        '- (1x) Inner tool loop did not terminate within 20 iterations',
        '',
        '## Exclusions',
        '',
        '- Unvouched reps on disk (not in manifest.json): 3',
        '- (2x) not_applicable: no dice_roll this turn',
        '- rep 003 exists on disk but is not vouched for in manifest.json (crashed or in-progress run) — excluded',
      ].join('\n'),
    );
  });

  it('renders a golden report for a run with zero vouched reps', () => {
    const manifest = baseManifest({ plannedReps: 3, completedReps: [] });

    const report = renderRunReport(manifest, [], EMPTY_EXCLUSIONS);

    expect(report).toBe(
      [
        '# Eval Run Report: claude-sonnet-4-6__ab12cd34__2026-07-26T14-32-10Z',
        '',
        '- Model: claude-sonnet-4-6',
        '- Prompt hash: ab12cd34',
        '- Temperature: 1',
        '- Corpus version: deadbeefdead',
        '- Planned reps: 3',
        '- Completed reps: 0',
        '',
        '## Per-fixture rates',
        '',
        '(no vouched rows)',
        '',
        '## Per-tag rollup',
        '',
        '(no vouched rows)',
        '',
        '## Errors',
        '',
        '(none)',
        '',
        '## Exclusions',
        '',
        '(none)',
      ].join('\n'),
    );
  });

  it('renders a golden report echoing decisionRule verbatim when recorded', () => {
    const manifest = baseManifest({
      plannedReps: 1,
      completedReps: [],
      decisionRule: 'ship if no fixture drops >0.2 and median rises',
    });

    const report = renderRunReport(manifest, [], EMPTY_EXCLUSIONS);

    expect(report).toBe(
      [
        '# Eval Run Report: claude-sonnet-4-6__ab12cd34__2026-07-26T14-32-10Z',
        '',
        '- Model: claude-sonnet-4-6',
        '- Prompt hash: ab12cd34',
        '- Temperature: 1',
        '- Corpus version: deadbeefdead',
        '- Planned reps: 1',
        '- Completed reps: 0',
        '- Decision rule: ship if no fixture drops >0.2 and median rises',
        '',
        '## Per-fixture rates',
        '',
        '(no vouched rows)',
        '',
        '## Per-tag rollup',
        '',
        '(no vouched rows)',
        '',
        '## Errors',
        '',
        '(none)',
        '',
        '## Exclusions',
        '',
        '(none)',
      ].join('\n'),
    );
  });
});

describe('guard: report-multi.ts and rates.ts never read the DB', () => {
  it('import nothing from src/db', () => {
    for (const file of ['report-multi.ts', 'rates.ts']) {
      const source = readFileSync(join(__dirname, file), 'utf-8');
      expect(source).not.toMatch(/from ['"].*src\/db/);
    }
  });
});
