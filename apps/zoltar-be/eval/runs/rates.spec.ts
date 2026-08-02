import { describe, expect, it } from 'vitest';

import {
  classifyApplicability,
  computeRates,
  findApplicabilityIssues,
  rollupByTag,
  summarizeExclusions,
} from './rates';

import type { ScoreRow } from './scores';

function scoreRow(overrides: Partial<ScoreRow> = {}): ScoreRow {
  return {
    runId: 'run-1',
    model: 'claude-sonnet-4-6',
    promptHash: 'ab12cd34',
    temperature: 1.0,
    corpusVersion: 'abc',
    harnessVersion: 'abc1234',
    repIndex: 1,
    fixtureId: 'turn19-out-of-order-resolution',
    checkId: 'out-of-order-resolution',
    tag: 'OUT-OF-ORDER-RESOLUTION',
    checkMode: 'structural',
    verdict: 'pass',
    artifactPath: 'reps/001/turn19-out-of-order-resolution/warden-output.json',
    durationMs: 1,
    recordedAt: '2026-07-26T14:33:00.000Z',
    ...overrides,
  };
}

describe('computeRates', () => {
  it('excludes not_applicable and error from the denominator', () => {
    const rows = [
      scoreRow({ repIndex: 1, verdict: 'pass' }),
      scoreRow({ repIndex: 2, verdict: 'fail' }),
      scoreRow({
        repIndex: 3,
        verdict: 'not_applicable',
        notApplicableReason: 'no dice_roll this turn',
      }),
      scoreRow({ repIndex: 4, verdict: 'error', errorMessage: 'timeout' }),
    ];

    const [rate] = computeRates(rows);
    expect(rate.pass).toBe(1);
    expect(rate.fail).toBe(1);
    expect(rate.notApplicable).toBe(1);
    expect(rate.error).toBe(1);
    expect(rate.n).toBe(2);
    expect(rate.rate).toBe(0.5);
  });

  it('gives rate: null and n: 0 when every row is not_applicable', () => {
    const rows = [
      scoreRow({
        repIndex: 1,
        verdict: 'not_applicable',
        notApplicableReason: 'no dice_roll this turn',
      }),
      scoreRow({
        repIndex: 2,
        verdict: 'not_applicable',
        notApplicableReason: 'no dice_roll this turn',
      }),
    ];

    const [rate] = computeRates(rows);
    expect(rate.n).toBe(0);
    expect(rate.rate).toBeNull();
  });

  it('gives a fixture present in some reps and absent in others the right N', () => {
    const rows = [
      scoreRow({ fixtureId: 'a', repIndex: 1, verdict: 'pass' }),
      scoreRow({ fixtureId: 'a', repIndex: 2, verdict: 'pass' }),
      scoreRow({ fixtureId: 'a', repIndex: 3, verdict: 'fail' }),
      scoreRow({ fixtureId: 'b', repIndex: 1, verdict: 'pass' }),
    ];

    const rates = computeRates(rows);
    const a = rates.find((r) => r.fixtureId === 'a')!;
    const b = rates.find((r) => r.fixtureId === 'b')!;
    expect(a.n).toBe(3);
    expect(b.n).toBe(1);
  });

  it('keeps two checks of one fixture separate', () => {
    const rows = [
      scoreRow({
        fixtureId: 'turn24-scene-jump',
        checkId: 'scene-jump',
        tag: 'SCENE-JUMP',
        checkMode: 'judged',
        verdict: 'pass',
      }),
      scoreRow({
        fixtureId: 'turn24-scene-jump',
        checkId: 'over-resolution',
        tag: 'OVER-RESOLUTION',
        checkMode: 'judged',
        verdict: 'fail',
      }),
    ];

    const rates = computeRates(rows);
    expect(rates).toHaveLength(2);
    const sceneJump = rates.find((r) => r.checkId === 'scene-jump')!;
    const overRes = rates.find((r) => r.checkId === 'over-resolution')!;
    expect(sceneJump.rate).toBe(1);
    expect(overRes.rate).toBe(0);
  });

  it('keeps errors out of the applicability denominator', () => {
    // turn14's shape: 7 not_applicable, 3 errors, no pass or fail. A rep that
    // errored never determined whether the check applied, so it belongs in
    // neither half of the ratio — the applicability denominator is 7, and the
    // 3 errors are accounted for separately.
    const rows = [
      ...Array.from({ length: 7 }, (_, i) =>
        scoreRow({
          repIndex: i + 1,
          verdict: 'not_applicable',
          notApplicableReason: 'no mapping to audit',
        }),
      ),
      ...Array.from({ length: 3 }, (_, i) =>
        scoreRow({
          repIndex: i + 8,
          verdict: 'error',
          errorMessage: 'timeout',
        }),
      ),
    ];

    const [rate] = computeRates(rows);
    expect(rate.notApplicable).toBe(7);
    expect(rate.error).toBe(3);
    expect(rate.n).toBe(0);
    expect(rate.applicabilityDenominator).toBe(7);
    expect(rate.applicability).toBe(0);
  });

  it('gives applicability: null when every rep errored', () => {
    const rows = [
      scoreRow({ repIndex: 1, verdict: 'error', errorMessage: 'timeout' }),
      scoreRow({ repIndex: 2, verdict: 'error', errorMessage: 'timeout' }),
    ];

    const [rate] = computeRates(rows);
    expect(rate.applicabilityDenominator).toBe(0);
    expect(rate.applicability).toBeNull();
  });

  it('computes applicability as n / (n + notApplicable)', () => {
    const rows = [
      scoreRow({ repIndex: 1, verdict: 'pass' }),
      scoreRow({ repIndex: 2, verdict: 'fail' }),
      scoreRow({ repIndex: 3, verdict: 'pass' }),
      scoreRow({
        repIndex: 4,
        verdict: 'not_applicable',
        notApplicableReason: 'no dice_roll this turn',
      }),
    ];

    const [rate] = computeRates(rows);
    expect(rate.n).toBe(3);
    expect(rate.applicabilityDenominator).toBe(4);
    expect(rate.applicability).toBe(0.75);
    // The rate itself is unchanged by any of this.
    expect(rate.rate).toBeCloseTo(2 / 3);
  });

  it('resolves applicabilitySource when every row declares the same one', () => {
    const rows = [
      scoreRow({ repIndex: 1, applicabilitySource: 'fixture' }),
      scoreRow({ repIndex: 2, applicabilitySource: 'fixture' }),
    ];
    expect(computeRates(rows)[0].applicabilitySource).toBe('fixture');
  });

  it('resolves applicabilitySource to unknown when no row declares one', () => {
    const rows = [scoreRow({ repIndex: 1 }), scoreRow({ repIndex: 2 })];
    expect(computeRates(rows)[0].applicabilitySource).toBe('unknown');
  });

  it('resolves applicabilitySource to unknown when only some rows declare one', () => {
    // Can't vouch that the undeclared row was scored the same way, and
    // nothing is known to conflict — distinct from `mixed`, which is a
    // checker migration caught mid-run.
    const rows = [
      scoreRow({ repIndex: 1, applicabilitySource: 'artifact' }),
      scoreRow({ repIndex: 2 }),
    ];
    expect(computeRates(rows)[0].applicabilitySource).toBe('unknown');
  });

  it('resolves applicabilitySource to mixed when rows declare different ones', () => {
    const rows = [
      scoreRow({ repIndex: 1, applicabilitySource: 'artifact' }),
      scoreRow({ repIndex: 2, applicabilitySource: 'fixture' }),
    ];
    expect(computeRates(rows)[0].applicabilitySource).toBe('mixed');
  });

  it('sorts by fixtureId then checkId', () => {
    const rows = [
      scoreRow({ fixtureId: 'b', checkId: 'z' }),
      scoreRow({ fixtureId: 'a', checkId: 'z' }),
      scoreRow({ fixtureId: 'a', checkId: 'a' }),
    ];

    const rates = computeRates(rows);
    expect(rates.map((r) => `${r.fixtureId}:${r.checkId}`)).toEqual([
      'a:a',
      'a:z',
      'b:z',
    ]);
  });
});

describe('rollupByTag', () => {
  it('aggregates pass/fail/n/rate across fixtures sharing a tag', () => {
    const rows = [
      scoreRow({
        fixtureId: 'a',
        tag: 'OUT-OF-ORDER-RESOLUTION',
        verdict: 'pass',
      }),
      scoreRow({
        fixtureId: 'b',
        tag: 'OUT-OF-ORDER-RESOLUTION',
        verdict: 'fail',
      }),
    ];
    const [rollup] = rollupByTag(computeRates(rows));

    expect(rollup.tag).toBe('OUT-OF-ORDER-RESOLUTION');
    expect(rollup.pass).toBe(1);
    expect(rollup.fail).toBe(1);
    expect(rollup.n).toBe(2);
    expect(rollup.rate).toBe(0.5);
  });

  it('counts fixtures with no usable denominator', () => {
    const rows = [
      scoreRow({
        fixtureId: 'a',
        tag: 'SYSTEM-ROLLED-PLAYER-ACTION',
        verdict: 'not_applicable',
        notApplicableReason: 'no dice_roll this turn',
      }),
      scoreRow({
        fixtureId: 'b',
        tag: 'SYSTEM-ROLLED-PLAYER-ACTION',
        verdict: 'pass',
      }),
    ];
    const [rollup] = rollupByTag(computeRates(rows));
    expect(rollup.fixturesWithNoDenominator).toBe(1);
  });

  it('carries not_applicable, error and applicability across the tag', () => {
    const rows = [
      scoreRow({
        fixtureId: 'a',
        tag: 'SYSTEM-ROLLED-PLAYER-ACTION',
        verdict: 'pass',
        applicabilitySource: 'fixture',
      }),
      scoreRow({
        fixtureId: 'b',
        tag: 'SYSTEM-ROLLED-PLAYER-ACTION',
        verdict: 'not_applicable',
        notApplicableReason: 'fixture says this check does not apply',
        applicabilitySource: 'fixture',
      }),
      scoreRow({
        fixtureId: 'c',
        tag: 'SYSTEM-ROLLED-PLAYER-ACTION',
        verdict: 'error',
        errorMessage: 'timeout',
        applicabilitySource: 'fixture',
      }),
    ];
    const [rollup] = rollupByTag(computeRates(rows));

    expect(rollup.notApplicable).toBe(1);
    expect(rollup.error).toBe(1);
    expect(rollup.n).toBe(1);
    // 1 / (1 + 1) — the errored rep is in neither half.
    expect(rollup.applicabilityDenominator).toBe(2);
    expect(rollup.applicability).toBe(0.5);
    expect(rollup.applicabilitySources).toEqual(['fixture']);
  });

  it('names every distinct applicability source a tag spans', () => {
    const rows = [
      scoreRow({
        fixtureId: 'a',
        checkId: 'check-a',
        tag: 'SHARED-TAG',
        applicabilitySource: 'fixture',
      }),
      scoreRow({
        fixtureId: 'b',
        checkId: 'check-b',
        tag: 'SHARED-TAG',
        applicabilitySource: 'artifact',
      }),
    ];
    const [rollup] = rollupByTag(computeRates(rows));
    expect(rollup.applicabilitySources).toEqual(['artifact', 'fixture']);
  });
});

describe('classifyApplicability', () => {
  it('accepts a fixture-gated check that applies on every rep', () => {
    expect(
      classifyApplicability({
        applicability: 1,
        applicabilitySource: 'fixture',
      }),
    ).toBe('ok');
  });

  it('flags a fixture-gated check whose reps disagree as a harness defect', () => {
    // The scenario decides before the model runs, so anything strictly
    // between 0 and 1 means the checker or the fixture is wrong — never that
    // behaviour moved.
    expect(
      classifyApplicability({
        applicability: 0.6,
        applicabilitySource: 'fixture',
      }),
    ).toBe('fixture-gated-split');
  });

  it('treats a fixture-gated check that never applies as a coverage note', () => {
    expect(
      classifyApplicability({
        applicability: 0,
        applicabilitySource: 'fixture',
      }),
    ).toBe('fixture-gated-never-applies');
  });

  it('flags an ungated check that reported not_applicable', () => {
    expect(
      classifyApplicability({
        applicability: 0.9,
        applicabilitySource: 'ungated',
      }),
    ).toBe('ungated-gate-fired');
  });

  it('reads a partial artifact-gated applicability as behaviour, not a defect', () => {
    expect(
      classifyApplicability({
        applicability: 0.1,
        applicabilitySource: 'artifact',
      }),
    ).toBe('artifact-gated-selection');
  });

  it('declines to interpret an unknown or mixed source', () => {
    expect(
      classifyApplicability({
        applicability: 0.5,
        applicabilitySource: 'unknown',
      }),
    ).toBe('indeterminate-source');
    expect(
      classifyApplicability({
        applicability: 0.5,
        applicabilitySource: 'mixed',
      }),
    ).toBe('indeterminate-source');
  });

  it('says nothing about a check where every rep errored', () => {
    expect(
      classifyApplicability({
        applicability: null,
        applicabilitySource: 'fixture',
      }),
    ).toBe('ok');
  });
});

describe('findApplicabilityIssues', () => {
  it('separates harness defects from how-to-read notes', () => {
    const rows = [
      // Fixture-gated, reps disagree: defect.
      scoreRow({
        fixtureId: 'turn19-system-rolled-player-action',
        checkId: 'system-rolled-player-action',
        applicabilitySource: 'fixture',
        repIndex: 1,
        verdict: 'pass',
      }),
      scoreRow({
        fixtureId: 'turn19-system-rolled-player-action',
        checkId: 'system-rolled-player-action',
        applicabilitySource: 'fixture',
        repIndex: 2,
        verdict: 'not_applicable',
        notApplicableReason: 'nothing bound to the player',
      }),
      // Artifact-gated, mostly excluded: note, not a defect.
      scoreRow({
        fixtureId: 'turn14-unauditable-mapping',
        checkId: 'unauditable-mapping',
        applicabilitySource: 'artifact',
        repIndex: 1,
        verdict: 'not_applicable',
        notApplicableReason: 'no mapping to audit',
      }),
      scoreRow({
        fixtureId: 'turn14-unauditable-mapping',
        checkId: 'unauditable-mapping',
        applicabilitySource: 'artifact',
        repIndex: 2,
        verdict: 'pass',
      }),
    ];

    const findings = findApplicabilityIssues(computeRates(rows));

    expect(findings.map((f) => [f.checkId, f.reading, f.severity])).toEqual([
      ['unauditable-mapping', 'artifact-gated-selection', 'note'],
      ['system-rolled-player-action', 'fixture-gated-split', 'defect'],
    ]);
    expect(findings[1].message).toContain('0.50 (1/2)');
  });

  it('returns nothing when every check is clean', () => {
    const rows = [
      scoreRow({
        repIndex: 1,
        verdict: 'pass',
        applicabilitySource: 'ungated',
      }),
      scoreRow({
        repIndex: 2,
        verdict: 'fail',
        applicabilitySource: 'ungated',
      }),
    ];
    expect(findApplicabilityIssues(computeRates(rows))).toEqual([]);
  });
});

describe('summarizeExclusions', () => {
  it('names unvouched reps present on disk but not in the vouched row set', () => {
    const rows = [scoreRow({ repIndex: 1 })];
    const summary = summarizeExclusions(rows, [], [1, 2, 3]);
    expect(summary.unvouchedReps).toEqual([2, 3]);
  });

  it('groups not_applicable rows by reason with counts', () => {
    const rows = [
      scoreRow({
        repIndex: 1,
        verdict: 'not_applicable',
        notApplicableReason: 'no dice_roll this turn',
      }),
      scoreRow({
        repIndex: 2,
        verdict: 'not_applicable',
        notApplicableReason: 'no dice_roll this turn',
      }),
      scoreRow({
        repIndex: 3,
        verdict: 'not_applicable',
        notApplicableReason: 'no player entity identified',
      }),
    ];
    const summary = summarizeExclusions(rows, [], []);
    expect(summary.notApplicableByReason).toEqual([
      { reason: 'no dice_roll this turn', count: 2 },
      { reason: 'no player entity identified', count: 1 },
    ]);
  });

  it('groups not_applicable rows by notApplicableReasonCode when the full reason text varies per rep', () => {
    // Regression case: two reps of the same fixture/check hit the same
    // failure mode, but the reason text embeds a per-rep model-generated
    // purpose string that differs between them. Without a stable code these
    // would fragment into two one-off groups instead of aggregating to 2.
    const rows = [
      scoreRow({
        repIndex: 1,
        fixtureId: 'turn19-out-of-order-resolution',
        checkId: 'out-of-order-resolution',
        verdict: 'not_applicable',
        notApplicableReason:
          "the turn deferred Alvarez's gating roll to a pending dice_request " +
          '("Alvarez combat roll to hit") rather than resolving it this turn',
        notApplicableReasonCode:
          "deferred Alvarez's gating roll to a pending dice_request",
      }),
      scoreRow({
        repIndex: 2,
        fixtureId: 'turn19-out-of-order-resolution',
        checkId: 'out-of-order-resolution',
        verdict: 'not_applicable',
        notApplicableReason:
          "the turn deferred Alvarez's gating roll to a pending dice_request " +
          '("roll under Combat to hit the contractor") rather than resolving it this turn',
        notApplicableReasonCode:
          "deferred Alvarez's gating roll to a pending dice_request",
      }),
    ];

    const summary = summarizeExclusions(rows, [], []);

    expect(summary.notApplicableByReason).toHaveLength(1);
    expect(summary.notApplicableByReason[0].count).toBe(2);
    // The representative text is the first-seen row's full reason, kept for
    // human readability even though grouping ignored the variable part.
    expect(summary.notApplicableByReason[0].reason).toContain(
      'Alvarez combat roll to hit',
    );
  });

  it('falls back to the full reason text as the grouping key when notApplicableReasonCode is absent', () => {
    const rows = [
      scoreRow({
        repIndex: 1,
        verdict: 'not_applicable',
        notApplicableReason: 'no dice_roll this turn',
      }),
      scoreRow({
        repIndex: 2,
        verdict: 'not_applicable',
        notApplicableReason: 'no dice_roll this turn',
      }),
    ];

    const summary = summarizeExclusions(rows, [], []);

    expect(summary.notApplicableByReason).toEqual([
      { reason: 'no dice_roll this turn', count: 2 },
    ]);
  });

  it('breaks not_applicable rows out per (fixtureId, checkId, reason) without dropping the global rollup', () => {
    const rows = [
      scoreRow({
        repIndex: 1,
        fixtureId: 'a',
        checkId: 'out-of-order-resolution',
        verdict: 'not_applicable',
        notApplicableReason: 'no dice_roll events this turn',
      }),
      scoreRow({
        repIndex: 2,
        fixtureId: 'a',
        checkId: 'out-of-order-resolution',
        verdict: 'not_applicable',
        notApplicableReason: 'no dice_roll events this turn',
      }),
      scoreRow({
        repIndex: 3,
        fixtureId: 'b',
        checkId: 'system-rolled-player-action',
        verdict: 'not_applicable',
        notApplicableReason: 'no dice_roll events this turn',
      }),
    ];

    const summary = summarizeExclusions(rows, [], []);

    expect(summary.notApplicableByReason).toEqual([
      { reason: 'no dice_roll events this turn', count: 3 },
    ]);
    expect(summary.notApplicableByFixture).toEqual([
      {
        fixtureId: 'a',
        checkId: 'out-of-order-resolution',
        reason: 'no dice_roll events this turn',
        count: 2,
      },
      {
        fixtureId: 'b',
        checkId: 'system-rolled-player-action',
        reason: 'no dice_roll events this turn',
        count: 1,
      },
    ]);
  });

  it('groups error rows by message with counts', () => {
    const rows = [
      scoreRow({ repIndex: 1, verdict: 'error', errorMessage: 'timeout' }),
      scoreRow({ repIndex: 2, verdict: 'error', errorMessage: 'timeout' }),
    ];
    const summary = summarizeExclusions(rows, [], []);
    expect(summary.errorsByMessage).toEqual([{ message: 'timeout', count: 2 }]);
  });

  it('passes through readVouchedRows exclusion strings verbatim', () => {
    const summary = summarizeExclusions(
      [],
      ['rep 002 exists on disk but is not vouched for in manifest.json'],
      [],
    );
    expect(summary.rawExclusions).toEqual([
      'rep 002 exists on disk but is not vouched for in manifest.json',
    ]);
  });
});
