import { describe, expect, it } from 'vitest';

import { renderReport } from './report';

import type { EvalFixture, FailureModeTag } from './fixture.schema';
import type { FixtureResult } from './report';

function fixture(id: string, tag: FailureModeTag): EvalFixture {
  return {
    id,
    tag,
    sourceAdventureId: '00000000-0000-0000-0000-000000000001',
    sourceSequenceNumber: 1,
    seededState: {
      campaignState: {},
      gmContextBlob: {},
      pendingCanon: [],
      messages: [],
      pendingDiceRequests: [],
      capturedAt: '2026-07-15T00:00:00.000Z',
    },
    playerInput: { type: 'message', content: 'x' },
    assertion: { mode: 'structural', check: 'x' },
  };
}

function result(
  overrides: Partial<FixtureResult> & Pick<FixtureResult, 'fixture' | 'passed'>,
): FixtureResult {
  return {
    expected: 'no damage roll before to-hit roll resolves',
    actual: 'clean',
    campaignId: '00000000-0000-0000-0000-0000000000c1',
    adventureId: '00000000-0000-0000-0000-0000000000a1',
    ...overrides,
  };
}

const META = { runId: 'a1b2c3d4-0000-0000-0000-000000000000', keptScratch: false };

describe('renderReport', () => {
  it('renders a valid, non-crashing report for an empty result set', () => {
    expect(renderReport('mothership-m7.txt', [], META)).toBe(
      '# Eval Run: mothership-m7.txt  |  runId: a1b2c3d4-0000-0000-0000-000000000000  |  scratch: torn down\n' +
        '\n' +
        'Fixtures: 0  |  Passed: 0  |  Failed: 0\n' +
        '\n' +
        '## Summary by tag\n' +
        '\n' +
        '## Failures\n' +
        '\n' +
        '## Passes\n',
    );
  });

  it('renders an all-pass report with one tag, including Expected/Actual detail in Passes', () => {
    const results: FixtureResult[] = [
      result({
        fixture: fixture('turn19', 'OUT-OF-ORDER-RESOLUTION'),
        passed: true,
        actual: 'no violation found',
      }),
      result({
        fixture: fixture('turn21', 'OUT-OF-ORDER-RESOLUTION'),
        passed: true,
        actual: 'no violation found',
      }),
    ];

    expect(renderReport('baseline', results, META)).toBe(
      '# Eval Run: baseline  |  runId: a1b2c3d4-0000-0000-0000-000000000000  |  scratch: torn down\n' +
        '\n' +
        'Fixtures: 2  |  Passed: 2  |  Failed: 0\n' +
        '\n' +
        '## Summary by tag\n' +
        '- OUT-OF-ORDER-RESOLUTION: 2/2 passed\n' +
        '\n' +
        '## Failures\n' +
        '\n' +
        '## Passes\n' +
        '\n' +
        '### turn19 — PASSED\n' +
        'Campaign: 00000000-0000-0000-0000-0000000000c1  |  Adventure: 00000000-0000-0000-0000-0000000000a1\n' +
        'Expected: no damage roll before to-hit roll resolves\n' +
        'Actual: no violation found\n' +
        '\n' +
        '### turn21 — PASSED\n' +
        'Campaign: 00000000-0000-0000-0000-0000000000c1  |  Adventure: 00000000-0000-0000-0000-0000000000a1\n' +
        'Expected: no damage roll before to-hit roll resolves\n' +
        'Actual: no violation found\n',
    );
  });

  it('renders an all-fail report with one tag, including Expected/Actual detail', () => {
    const results: FixtureResult[] = [
      result({
        fixture: fixture('turn19', 'OUT-OF-ORDER-RESOLUTION'),
        passed: false,
        expected: 'no damage roll before to-hit roll resolves',
        actual: 'damage roll at sequence 2 preceded to-hit roll at sequence 3',
      }),
    ];

    expect(renderReport('baseline', results, META)).toBe(
      '# Eval Run: baseline  |  runId: a1b2c3d4-0000-0000-0000-000000000000  |  scratch: torn down\n' +
        '\n' +
        'Fixtures: 1  |  Passed: 0  |  Failed: 1\n' +
        '\n' +
        '## Summary by tag\n' +
        '- OUT-OF-ORDER-RESOLUTION: 0/1 passed\n' +
        '\n' +
        '## Failures\n' +
        '\n' +
        '### turn19 — FAILED\n' +
        'Campaign: 00000000-0000-0000-0000-0000000000c1  |  Adventure: 00000000-0000-0000-0000-0000000000a1\n' +
        'Expected: no damage roll before to-hit roll resolves\n' +
        'Actual: damage roll at sequence 2 preceded to-hit roll at sequence 3\n' +
        '\n' +
        '## Passes\n',
    );
  });

  it('renders a mixed pass/fail report within a single tag', () => {
    const results: FixtureResult[] = [
      result({
        fixture: fixture('turn19', 'OUT-OF-ORDER-RESOLUTION'),
        passed: true,
        actual: 'no violation found',
      }),
      result({
        fixture: fixture('turn28', 'OUT-OF-ORDER-RESOLUTION'),
        passed: false,
        expected: 'no damage roll before to-hit roll resolves',
        actual: 'damage roll at sequence 5 preceded to-hit roll at sequence 6',
      }),
    ];

    expect(renderReport('baseline', results, META)).toBe(
      '# Eval Run: baseline  |  runId: a1b2c3d4-0000-0000-0000-000000000000  |  scratch: torn down\n' +
        '\n' +
        'Fixtures: 2  |  Passed: 1  |  Failed: 1\n' +
        '\n' +
        '## Summary by tag\n' +
        '- OUT-OF-ORDER-RESOLUTION: 1/2 passed\n' +
        '\n' +
        '## Failures\n' +
        '\n' +
        '### turn28 — FAILED\n' +
        'Campaign: 00000000-0000-0000-0000-0000000000c1  |  Adventure: 00000000-0000-0000-0000-0000000000a1\n' +
        'Expected: no damage roll before to-hit roll resolves\n' +
        'Actual: damage roll at sequence 5 preceded to-hit roll at sequence 6\n' +
        '\n' +
        '## Passes\n' +
        '\n' +
        '### turn19 — PASSED\n' +
        'Campaign: 00000000-0000-0000-0000-0000000000c1  |  Adventure: 00000000-0000-0000-0000-0000000000a1\n' +
        'Expected: no damage roll before to-hit roll resolves\n' +
        'Actual: no violation found\n',
    );
  });

  it('groups and sorts multiple tags alphabetically, independent of input order', () => {
    const results: FixtureResult[] = [
      result({
        fixture: fixture('turn24', 'OVER-RESOLUTION'),
        passed: true,
        actual: 'resolution level matches',
      }),
      result({
        fixture: fixture('turn19', 'OUT-OF-ORDER-RESOLUTION'),
        passed: true,
        actual: 'no violation found',
      }),
      result({
        fixture: fixture('turn24b', 'HIDDEN-INFO-LEAK'),
        passed: false,
        expected: 'no leak beyond perception boundary',
        actual: 'reveals a roll value beyond the boundary',
      }),
    ];

    expect(renderReport('baseline', results, META)).toBe(
      '# Eval Run: baseline  |  runId: a1b2c3d4-0000-0000-0000-000000000000  |  scratch: torn down\n' +
        '\n' +
        'Fixtures: 3  |  Passed: 2  |  Failed: 1\n' +
        '\n' +
        '## Summary by tag\n' +
        '- HIDDEN-INFO-LEAK: 0/1 passed\n' +
        '- OUT-OF-ORDER-RESOLUTION: 1/1 passed\n' +
        '- OVER-RESOLUTION: 1/1 passed\n' +
        '\n' +
        '## Failures\n' +
        '\n' +
        '### turn24b — FAILED\n' +
        'Campaign: 00000000-0000-0000-0000-0000000000c1  |  Adventure: 00000000-0000-0000-0000-0000000000a1\n' +
        'Expected: no leak beyond perception boundary\n' +
        'Actual: reveals a roll value beyond the boundary\n' +
        '\n' +
        '## Passes\n' +
        '\n' +
        '### turn24 — PASSED\n' +
        'Campaign: 00000000-0000-0000-0000-0000000000c1  |  Adventure: 00000000-0000-0000-0000-0000000000a1\n' +
        'Expected: no damage roll before to-hit roll resolves\n' +
        'Actual: resolution level matches\n' +
        '\n' +
        '### turn19 — PASSED\n' +
        'Campaign: 00000000-0000-0000-0000-0000000000c1  |  Adventure: 00000000-0000-0000-0000-0000000000a1\n' +
        'Expected: no damage roll before to-hit roll resolves\n' +
        'Actual: no violation found\n',
    );
  });

  it('reflects keptScratch: true in the header', () => {
    expect(
      renderReport('baseline', [], { runId: 'r-1', keptScratch: true }),
    ).toContain('runId: r-1  |  scratch: kept');
  });
});
