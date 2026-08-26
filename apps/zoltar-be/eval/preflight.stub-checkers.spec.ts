import { describe, expect, it, vi } from 'vitest';

import * as checkRegistry from './checks/registry';
import { loadFixtures } from './fixture-loader';
import { assertNoStubCheckers, EvalPreflightError } from './preflight';

import type { EvalFixture } from './fixture.schema';

/**
 * The run-refusal.
 *
 * **`STUB_CHECK_IDS` is empty as of 2026-08-20**, when `MISSING-DELTA` and
 * `ROLL-RESULT-INVERSION` became judged checks. The corpus assertion below is
 * therefore the inverse of what it used to be — it now asserts that a full
 * `eval:run` *is* startable — and the mechanism itself is exercised against a
 * stubbed registry rather than against two real tags that no longer are.
 *
 * The mechanism is kept rather than deleted because it is the right answer the
 * next time a playtest surfaces a tag before its checker exists: capture the
 * fixture while the adventure is still seedable, stub the tag, and let the
 * preflight refuse the run instead of reporting a rate nothing measured.
 */
const FIXTURES_DIR = 'eval/fixtures';

async function corpus(): Promise<EvalFixture[]> {
  const { fixtures, errors } = await loadFixtures(FIXTURES_DIR);
  expect(errors).toEqual([]);
  return fixtures;
}

describe('assertNoStubCheckers', () => {
  it('passes on the whole corpus — nothing is stubbed today', async () => {
    const fixtures = await corpus();
    expect(fixtures.length).toBeGreaterThan(0);
    expect(() => assertNoStubCheckers(fixtures)).not.toThrow();
  });

  /**
   * The counterexample, against a synthetic stub. Without this the suite would
   * assert only that the refusal never fires, which is what a broken refusal
   * also looks like.
   */
  describe('when a check is stubbed', () => {
    async function withStubbedCheck(): Promise<EvalFixture[]> {
      const fixtures = await corpus();
      const target = fixtures[0];

      vi.spyOn(checkRegistry, 'selectChecksForFixture').mockImplementation(
        (f: EvalFixture) =>
          f.id === target.id
            ? [{ id: 'pretend-stub', tag: f.tag, stub: true } as never]
            : [],
      );
      return fixtures;
    }

    it('refuses the run', async () => {
      const fixtures = await withStubbedCheck();
      expect(() => assertNoStubCheckers(fixtures)).toThrow(EvalPreflightError);
      vi.restoreAllMocks();
    });

    it('names the offending fixture, the check, and what to do about it', async () => {
      const fixtures = await withStubbedCheck();
      let message = '';
      try {
        assertNoStubCheckers(fixtures);
      } catch (err) {
        message = (err as Error).message;
      }

      expect(message).toContain(fixtures[0].id);
      expect(message).toContain('pretend-stub');
      expect(message).toContain('STUB_CHECK_IDS');
      // The refusal has to say it cannot be waived, or the first person to
      // hit it reaches for --skip-preflight and pays for the run anyway.
      expect(message).toContain('not skippable');
      vi.restoreAllMocks();
    });
  });
});
