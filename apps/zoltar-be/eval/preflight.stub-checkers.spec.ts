import { describe, expect, it } from 'vitest';

import { loadFixtures } from './fixture-loader';
import { assertNoStubCheckers, EvalPreflightError } from './preflight';

import type { EvalFixture } from './fixture.schema';

/**
 * The run-refusal. Asserted against the real corpus rather than synthetic
 * fixtures, because the question it answers is about the corpus in the repo:
 * "would `eval:run` start right now, and if not, which fixtures stopped it".
 */
const FIXTURES_DIR = 'eval/fixtures';

async function corpus(): Promise<EvalFixture[]> {
  const { fixtures, errors } = await loadFixtures(FIXTURES_DIR);
  expect(errors).toEqual([]);
  return fixtures;
}

describe('assertNoStubCheckers', () => {
  it('passes on a selection carrying no stub check', async () => {
    const fixtures = await corpus();
    const clean = fixtures.filter((f) => !f.id.startsWith('5c34991b-turn07'));
    expect(clean.length).toBeGreaterThan(0);
    expect(() =>
      assertNoStubCheckers(
        clean.filter(
          (f) => !['MISSING-DELTA', 'ROLL-RESULT-INVERSION'].includes(f.tag),
        ),
      ),
    ).not.toThrow();
  });

  it('refuses the full corpus while any stub tag is captured', async () => {
    // Not a hypothetical: three fixtures from the 2026-08-16 playtest carry
    // stub tags, so an unfiltered `eval:run` is refused today. This test is
    // the thing that will fail — deliberately — on the day someone
    // implements the checkers and forgets to clear STUB_CHECK_IDS, or
    // deletes the fixtures.
    await expect(async () =>
      assertNoStubCheckers(await corpus()),
    ).rejects.toThrow(EvalPreflightError);
  });

  it('names every offending fixture and what to do about it', async () => {
    let message = '';
    try {
      assertNoStubCheckers(await corpus());
    } catch (err) {
      message = (err as Error).message;
    }

    for (const id of [
      '5c34991b-turn07-missing-delta',
      '5c34991b-turn10-roll-result-inversion',
      '5c34991b-turn11-missing-delta',
    ]) {
      expect(message).toContain(id);
    }
    // The two ways out, both stated: fix it, or scope the run on purpose.
    expect(message).toContain('STUB_CHECK_IDS');
    expect(message).toContain('--fixtures');
    // And the one way that is not available.
    expect(message).toContain('not skippable');
  });

  it('reports a fixture once, listing each stub check it carries', async () => {
    const fixtures = await corpus();
    const one = fixtures.filter(
      (f) => f.id === '5c34991b-turn10-roll-result-inversion',
    );
    expect(one).toHaveLength(1);

    let message = '';
    try {
      assertNoStubCheckers(one);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('1 selected fixture(s)');
    expect(message).toContain('roll-result-inversion');
    // Its other two checks work and are not the reason for the refusal.
    expect(message).not.toContain('tool-syntax-leak');
  });

  it('passes on an empty selection', () => {
    expect(() => assertNoStubCheckers([])).not.toThrow();
  });
});
