import { describe, expect, it } from 'vitest';

import { evalChecks, stubCheckIds } from '../registry';

import { structuralCheckers } from './registry';
import { checkUnimplemented } from './unimplemented';

/**
 * The stub checkers behind `MISSING-DELTA` and `ROLL-RESULT-INVERSION`. The
 * only behaviour worth pinning is the one that makes a stub safe: it must
 * never report `PASSED`, and it must stay wired so the real checker replaces
 * something rather than being added next to it.
 */
const STUB_TAGS = ['MISSING-DELTA', 'ROLL-RESULT-INVERSION'] as const;

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
    const codes = STUB_TAGS.map((tag) => checkUnimplemented(tag).actualCode);
    expect(new Set(codes)).toEqual(new Set(['checker-unimplemented']));
  });
});

describe('stub tag registration', () => {
  it.each(STUB_TAGS)('%s dispatches to the stub', (tag) => {
    const verdict = structuralCheckers[tag](
      // The stub reads neither argument, which is what lets this assertion
      // be made without building a turn result or a fixture.
      undefined as never,
      undefined as never,
    );
    expect(verdict).toEqual(checkUnimplemented(tag));
  });

  it.each(STUB_TAGS)('%s is registered structural and fixture-gated', (tag) => {
    const check = evalChecks[tag.toLowerCase()];
    expect(check.mode).toBe('structural');
    // Honest for a stub on both halves of what `'fixture'` asserts: decided
    // before the model runs, and unanimous across reps — see registry.ts.
    expect(check.applicabilitySource).toBe('fixture');
    // Neither may travel onto a fixture tagged something else: a stub
    // attached corpus-wide would spray never-applies findings across every
    // fixture and grade nothing anywhere.
    expect(check.tagIndependent).toBeUndefined();
    expect(check.universal).toBeUndefined();
  });
});

describe('stub registration is what the run-refusal reads', () => {
  it.each(STUB_TAGS)('%s is flagged `stub` on the registry', (tag) => {
    expect(evalChecks[tag.toLowerCase()].stub).toBe(true);
    expect(stubCheckIds).toContain(tag.toLowerCase());
  });

  it('flags nothing else', () => {
    // `stubCheckIds` is what `assertNoStubCheckers` refuses runs on, so a
    // stray entry here takes the whole harness offline.
    expect([...stubCheckIds].sort()).toEqual([
      'missing-delta',
      'roll-result-inversion',
    ]);
  });
});
