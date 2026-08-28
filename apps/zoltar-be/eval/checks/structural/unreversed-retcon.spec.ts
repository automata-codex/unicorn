import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  fakeFixture,
  fakeGameEvent,
  fakeTurnExecutionResult,
} from './test-helpers';
import {
  precedingCommitFor,
  unreversedRetconGate,
  unreversedRetconJudgeContext,
} from './unreversed-retcon';

import type { EvalFixture } from '../../fixture.schema';

const PRIOR_NARRATION =
  'The screen throws a hard fault and the file icon goes from an unlocked ' +
  'padlock back to a sealed one.';

const PRIOR_STATE_CHANGES = {
  flags: { insurance_scam_exposed: { value: false } },
  resourcePools: [
    {
      pool: 'stress',
      delta: 1,
      owner: 'danny',
      reason:
        'failed Intellect+Computers check cracking insurance file encoding',
    },
  ],
};

const PRIOR_APPLIED = {
  flags: {
    insurance_scam_exposed: { value: false, trigger: 'Flip to true when...' },
  },
  entities: {},
  worldFacts: {},
  resourcePools: { danny: { stress: { max: null, current: 3 } } },
  scenarioState: {},
  characterState: {},
};

function narratedTurn() {
  return fakeTurnExecutionResult({
    gameEvents: [
      fakeGameEvent({
        sequenceNumber: 64,
        eventType: 'gm_response',
        payload: { playerText: 'You reel the moment back.' },
      }),
    ],
  });
}

function seeded(
  overrides: {
    precedingCommittedTurn?: EvalFixture['seededState']['precedingCommittedTurn'];
    messages?: Record<string, unknown>[];
  } = {},
): EvalFixture {
  const base = fakeFixture();
  return fakeFixture({
    seededState: {
      ...base.seededState,
      messages: overrides.messages ?? [
        { role: 'player', content: 'I try the file.' },
        { role: 'gm', content: PRIOR_NARRATION },
      ],
      precedingCommittedTurn:
        overrides.precedingCommittedTurn === undefined
          ? {
              sequenceNumber: 62,
              stateChanges: PRIOR_STATE_CHANGES,
              applied: PRIOR_APPLIED,
            }
          : overrides.precedingCommittedTurn,
    },
  });
}

describe('precedingCommitFor', () => {
  it('pairs the captured deltas with the last narration in the window', () => {
    const commit = precedingCommitFor(seeded());

    expect(commit?.sequenceNumber).toBe(62);
    expect(commit?.narration).toBe(PRIOR_NARRATION);
    expect(commit?.stateChanges).toEqual(PRIOR_STATE_CHANGES);
  });

  it('is null when the fixture captured no preceding committed turn', () => {
    expect(precedingCommitFor(seeded({ precedingCommittedTurn: null }))).toBe(
      null,
    );
  });

  it('takes the last gm message, not the last message', () => {
    // The seeded window always ends with the player message that triggers the
    // turn under grading — so "the narration the player was last shown" is
    // never simply the final entry.
    const commit = precedingCommitFor(
      seeded({
        messages: [
          { role: 'gm', content: 'An earlier turn.' },
          { role: 'gm', content: PRIOR_NARRATION },
          { role: 'player', content: 'Wait, my maths was wrong.' },
        ],
      }),
    );

    expect(commit?.narration).toBe(PRIOR_NARRATION);
  });

  it('leaves narration null when the window holds no gm message', () => {
    const commit = precedingCommitFor(
      seeded({ messages: [{ role: 'player', content: 'I try the file.' }] }),
    );

    expect(commit?.narration).toBe(null);
    expect(commit?.sequenceNumber).toBe(62);
  });
});

describe('unreversedRetconGate', () => {
  it('falls through to the judge when the preceding turn committed state', () => {
    expect(unreversedRetconGate(narratedTurn(), seeded())).toBe(null);
  });

  it('excludes a turn that produced no gm_response', () => {
    const verdict = unreversedRetconGate(
      fakeTurnExecutionResult({ gameEvents: [] }),
      seeded(),
    );

    expect(verdict?.outcome).toBe('NOT_APPLICABLE');
    expect(verdict?.actualCode).toBe('no gm_response event this turn');
  });

  it('excludes a fixture with no preceding committed turn', () => {
    const verdict = unreversedRetconGate(
      narratedTurn(),
      seeded({ precedingCommittedTurn: null }),
    );

    expect(verdict?.outcome).toBe('NOT_APPLICABLE');
    expect(verdict?.actualCode).toBe(
      'fixture captures no preceding committed turn',
    );
  });

  it('excludes a preceding turn whose stateChanges were null', () => {
    const verdict = unreversedRetconGate(
      narratedTurn(),
      seeded({
        precedingCommittedTurn: {
          sequenceNumber: 58,
          stateChanges: null,
          applied: {},
        },
      }),
    );

    expect(verdict?.outcome).toBe('NOT_APPLICABLE');
    expect(verdict?.actualCode).toBe('preceding turn committed no state');
  });

  it('excludes a preceding turn whose stateChanges sections were all empty', () => {
    // `{"flags": {}}` parses as an object and commits nothing. Treating only
    // an outright `null` as empty would send this to a paid judge call with an
    // empty scope block.
    const verdict = unreversedRetconGate(
      narratedTurn(),
      seeded({
        precedingCommittedTurn: {
          sequenceNumber: 58,
          stateChanges: { flags: {}, resourcePools: [], entities: {} },
          applied: {},
        },
      }),
    );

    expect(verdict?.outcome).toBe('NOT_APPLICABLE');
    expect(verdict?.actualCode).toBe('preceding turn committed no state');
  });

  it('names both fixture-shaped exclusions as repeating every rep', () => {
    // `ADR-0083`: an exclusion that depends on the capture rather than on the
    // model is worth labelling as such, so a reader of the report does not
    // read a stable denominator as Warden behaviour.
    for (const preceding of [
      null,
      { sequenceNumber: 58, stateChanges: null, applied: {} },
    ] as EvalFixture['seededState']['precedingCommittedTurn'][]) {
      const verdict = unreversedRetconGate(
        narratedTurn(),
        seeded({ precedingCommittedTurn: preceding }),
      );
      expect(verdict?.actual).toContain('every rep');
    }
  });
});

describe('unreversedRetconJudgeContext', () => {
  it('renders the prior narration, the emitted deltas and the committed values', () => {
    const context = unreversedRetconJudgeContext(narratedTurn(), seeded());

    expect(context).toContain(PRIOR_NARRATION);
    // The `reason` text is the causal link between the committed delta and
    // the outcome being reversed — without it the judge sees a stress point
    // with no stated cause and cannot tell what the reversal owes.
    expect(context).toContain(
      'failed Intellect+Computers check cracking insurance file encoding',
    );
    expect(context).toContain('"current": 3');
    expect(context).toContain('sequence 62');
  });

  it('omits the narration section when the window holds no gm message', () => {
    const context = unreversedRetconJudgeContext(
      narratedTurn(),
      seeded({ messages: [{ role: 'player', content: 'I try the file.' }] }),
    );

    expect(context).not.toContain('the narration the player was shown');
    expect(context).toContain('what that turn emitted');
  });

  it('drops the empty sections of the committed block', () => {
    // `applied` always carries all six keys, most of them empty on any given
    // turn. Rendering them verbatim spends prompt on six lines of `{}`.
    const context = unreversedRetconJudgeContext(narratedTurn(), seeded());

    expect(context).toContain('"resourcePools"');
    expect(context).not.toContain('"scenarioState"');
  });

  it('sorts keys so two captures of one adventure agree', () => {
    const context = unreversedRetconJudgeContext(
      narratedTurn(),
      seeded({
        precedingCommittedTurn: {
          sequenceNumber: 62,
          stateChanges: { zulu: { a: 1 }, alpha: { b: 2 }, mike: { c: 3 } },
          applied: {},
        },
      }),
    );

    expect(context.indexOf('"alpha"')).toBeLessThan(context.indexOf('"mike"'));
    expect(context.indexOf('"mike"')).toBeLessThan(context.indexOf('"zulu"'));
  });

  it('computes no prior values of its own', () => {
    // `ADR-0105`'s corollary: a renderer that selects leaves only its
    // selection logic uncovered, while one that authors leaves the content
    // uncovered too. The prior stress value (2) is the difference between the
    // emitted delta and the committed result, and stating it here would put
    // an arithmetic claim in front of the judge that no hash covers.
    const context = unreversedRetconJudgeContext(narratedTurn(), seeded());

    expect(context).not.toContain('prior value');
    expect(context).not.toContain('was 2');
  });
});

/**
 * `ADR-0105` requires a golden on every `judgeContext` renderer: its output
 * reaches the judge covered by no hash, so editing this function changes what
 * the grader reads while moving `rubricHash`, `judgeContractHash` and
 * `corpusVersion` not at all.
 */
describe('unreversedRetconJudgeContext golden (`ADR-0105`)', () => {
  const GOLDEN = join(
    __dirname,
    '..',
    'judged',
    'judge-context-golden',
    'unreversed-retcon.txt',
  );

  it('renders the frozen probe exactly as committed', () => {
    const rendered = unreversedRetconJudgeContext(narratedTurn(), seeded());

    expect(existsSync(GOLDEN)).toBe(true);
    expect(rendered).toBe(readFileSync(GOLDEN, 'utf8'));
  });
});
