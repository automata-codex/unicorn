import { describe, expect, it } from 'vitest';

import { evalChecks, stubCheckIds } from '../registry';

import { checkUnimplemented } from './unimplemented';

/**
 * Two tags that were once stubbed, used here only as sample arguments — the
 * behaviour under test is `checkUnimplemented` itself, which reads nothing
 * about the tag beyond its name.
 */
const SAMPLE_TAGS = ['MISSING-DELTA', 'ROLL-RESULT-INVERSION'] as const;

describe('checkUnimplemented', () => {
  it('reports NOT_APPLICABLE, never PASSED', () => {
    // A stub that passed would report 1.00 on a failure mode nothing is
    // looking for — the `ADR-0096` blind spot, re-created deliberately.
    const verdict = checkUnimplemented('MISSING-DELTA');
    expect(verdict.outcome).toBe('NOT_APPLICABLE');
  });

  it('names the tag in its reason', () => {
    expect(checkUnimplemented('ROLL-RESULT-INVERSION').actual).toContain(
      'ROLL-RESULT-INVERSION',
    );
  });

  it('groups exclusions under one stable code across tags', () => {
    // Per-rep exclusion aggregation groups on `actualCode`; a shared code
    // keeps "these checks are stubs" one line in the report rather than one
    // per tag per fixture.
    const codes = SAMPLE_TAGS.map((tag) => checkUnimplemented(tag).actualCode);
    expect(new Set(codes)).toEqual(new Set(['checker-unimplemented']));
  });
});

describe('the stub mechanism after STUB_CHECK_IDS was emptied', () => {
  /**
   * `MISSING-DELTA` and `ROLL-RESULT-INVERSION` were the only stubs, and both
   * became judged checks on 2026-08-20. Nothing is stubbed now.
   *
   * `checkUnimplemented` and `stubCheckIds` stay because the mechanism is the
   * right answer the next time a playtest surfaces a tag before its checker
   * exists — capture while the adventure is still seedable, stub the tag, let
   * the preflight refuse the run. These assertions keep the mechanism honest
   * in the meantime: an empty set, and a stray entry caught immediately,
   * because `assertNoStubCheckers` refuses on exactly this list and one wrong
   * name takes the whole harness offline.
   */
  it('has no stubbed checks', () => {
    expect([...stubCheckIds]).toEqual([]);
  });

  it('leaves the two former stubs registered as judged checks', () => {
    for (const id of ['missing-delta', 'roll-result-inversion']) {
      const check = evalChecks[id];
      expect(check, id).toBeDefined();
      expect(check.mode, id).toBe('judged');
      expect(check.stub, id).toBeUndefined();
    }
  });

  /**
   * Neither may travel onto a fixture tagged something else. A check attached
   * corpus-wide would grade every fixture against a rubric written for one
   * failure mode.
   */
  it('keeps both attached by tag only', () => {
    for (const id of ['missing-delta', 'roll-result-inversion']) {
      expect(evalChecks[id].tagIndependent, id).toBeUndefined();
      expect(evalChecks[id].universal, id).toBeUndefined();
    }
  });
});
