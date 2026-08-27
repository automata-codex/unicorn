import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  contractorRollsInScope,
  misappliedContractorSkillGate,
  misappliedContractorSkillJudgeContext,
} from './misapplied-contractor-skill';
import {
  fakeDiceRoll,
  fakeFixture,
  fakeGameEvent,
  fakeTurnExecutionResult,
} from './test-helpers';

import type { EvalFixture } from '../../fixture.schema';

/**
 * `mara_odinsen` as adventure `2c0ba938` authored her: `cargo_handler`,
 * `instinctRoll: [5, 5]`. Instinct derives to 40 (5+5, +25 base, +5 for the
 * unskilled tier) and the role maps to Zero-G trained and Athletics trained,
 * +10 each. Those numbers are the ones `ADR-0103` reconciled against
 * `crew-roles.ts` by hand, so a change to the table shows up here as a
 * changed expectation rather than as a silently different derivation.
 */
function fixtureWithContractor(
  overrides: Record<string, unknown> = {},
): EvalFixture {
  const base = fakeFixture();
  return fakeFixture({
    seededState: {
      ...base.seededState,
      campaignState: {
        entities: {
          mara_odinsen: {
            status: 'alive',
            visible: true,
            revealed: true,
            crewRole: 'cargo_handler',
            instinctRoll: [5, 5],
            ...overrides,
          },
          falsified_maintenance_logs: {
            status: 'unknown',
            visible: false,
            revealed: false,
          },
        },
      },
    },
  });
}

describe('contractorRollsInScope', () => {
  it('selects a roll whose actingEntityId names a crewRole-bearing entity', () => {
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeDiceRoll({
          sequenceNumber: 44,
          purpose: 'roll under her Instinct 40',
          actingEntityId: 'mara_odinsen',
        }),
      ],
    });

    const scope = contractorRollsInScope(result, fixtureWithContractor());
    expect(scope).toHaveLength(1);
    expect(scope[0].entityId).toBe('mara_odinsen');
  });

  it('ignores a roll attributed to an entity with no crewRole', () => {
    // The falsified-logs entity is a `feature` and has no role. Selecting it
    // would put a roll in front of the judge with no derivable target, which
    // is the one thing the scope block must never contain.
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeDiceRoll({
          sequenceNumber: 30,
          purpose: 'does the terminal cooperate',
          actingEntityId: 'falsified_maintenance_logs',
        }),
      ],
    });

    expect(contractorRollsInScope(result, fixtureWithContractor())).toEqual([]);
  });

  it('ignores a roll carrying no actingEntityId', () => {
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeDiceRoll({ sequenceNumber: 44, purpose: 'ambient hull groan' }),
      ],
    });

    expect(contractorRollsInScope(result, fixtureWithContractor())).toEqual([]);
  });

  it('ignores an actingEntityId naming no seeded entity at all', () => {
    // The 2026-08-24 playtest has exactly this: rolls whose purpose is about
    // Voss, a captain invented mid-play and never made a tracked entity,
    // while `actingEntityId` names Mara. An id that resolves to nothing must
    // not be treated as a Contractor.
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeDiceRoll({
          sequenceNumber: 124,
          purpose: "Voss's Instinct check",
          actingEntityId: 'captain_voss',
        }),
      ],
    });

    expect(contractorRollsInScope(result, fixtureWithContractor())).toEqual([]);
  });
});

describe('misappliedContractorSkillGate', () => {
  it('excludes a turn that rolled nothing, naming the Warden as the reason', () => {
    const verdict = misappliedContractorSkillGate(
      fakeTurnExecutionResult({
        gameEvents: [
          fakeGameEvent({ sequenceNumber: 1, eventType: 'gm_response' }),
        ],
      }),
      fixtureWithContractor(),
    );

    expect(verdict?.outcome).toBe('NOT_APPLICABLE');
    expect(verdict?.actualCode).toBe('no dice_roll events this turn');
  });

  it('distinguishes "no Contractor rolled" from "rolls this gate cannot see"', () => {
    // The split is the deliverable. An attributed turn with no Contractor is
    // an honest exclusion; an unattributed one may be hiding the very thing
    // this check grades, and the two must not aggregate into one row.
    const attributed = misappliedContractorSkillGate(
      fakeTurnExecutionResult({
        gameEvents: [
          fakeDiceRoll({
            sequenceNumber: 1,
            purpose: 'a feature roll',
            actingEntityId: 'falsified_maintenance_logs',
          }),
        ],
      }),
      fixtureWithContractor(),
    );

    const unattributed = misappliedContractorSkillGate(
      fakeTurnExecutionResult({
        gameEvents: [
          fakeDiceRoll({ sequenceNumber: 1, purpose: 'ambient hull groan' }),
        ],
      }),
      fixtureWithContractor(),
    );

    expect(attributed?.outcome).toBe('NOT_APPLICABLE');
    expect(unattributed?.outcome).toBe('NOT_APPLICABLE');
    expect(attributed?.actualCode).not.toBe(unattributed?.actualCode);
    expect(unattributed?.actual).toContain('invisible to this gate');
  });

  it('groups exclusions on a code that carries no roll count', () => {
    // `summarizeExclusions` groups on `actualCode`; interpolating a count
    // there splinters one failure mode into a row per rep.
    const one = misappliedContractorSkillGate(
      fakeTurnExecutionResult({
        gameEvents: [fakeDiceRoll({ sequenceNumber: 1, purpose: 'a' })],
      }),
      fixtureWithContractor(),
    );
    const three = misappliedContractorSkillGate(
      fakeTurnExecutionResult({
        gameEvents: [
          fakeDiceRoll({ sequenceNumber: 1, purpose: 'a' }),
          fakeDiceRoll({ sequenceNumber: 2, purpose: 'b' }),
          fakeDiceRoll({ sequenceNumber: 3, purpose: 'c' }),
        ],
      }),
      fixtureWithContractor(),
    );

    expect(one?.actualCode).toBe(three?.actualCode);
    expect(one?.actual).not.toBe(three?.actual);
  });

  it('falls through to the judge when a Contractor rolled', () => {
    const verdict = misappliedContractorSkillGate(
      fakeTurnExecutionResult({
        gameEvents: [
          fakeDiceRoll({
            sequenceNumber: 44,
            purpose: 'roll under her Instinct 40',
            actingEntityId: 'mara_odinsen',
          }),
        ],
      }),
      fixtureWithContractor(),
    );

    expect(verdict).toBeNull();
  });
});

describe('misappliedContractorSkillJudgeContext', () => {
  const result = fakeTurnExecutionResult({
    gameEvents: [
      fakeDiceRoll({
        sequenceNumber: 44,
        notation: '1d100',
        results: [79],
        purpose:
          "Mara's effort to crack the insurance file — roll under her Instinct 40",
        actingEntityId: 'mara_odinsen',
      }),
    ],
  });

  it('supplies every correct target, computed rather than described', () => {
    // The whole reason this renderer exists. If these numbers came out of the
    // rubric as a prose table instead, an edit to `CREW_ROLE_SKILLS` would
    // leave the judge grading against the old one.
    const context = misappliedContractorSkillJudgeContext(
      result,
      fixtureWithContractor(),
    );

    expect(context).toContain('target if no mapped skill applies: 40');
    expect(context).toContain('target if "Zero-G" (trained, +10) applies: 50');
    expect(context).toContain(
      'target if "Athletics" (trained, +10) applies: 50',
    );
    expect(context).toContain('You do not need to know the role table');
  });

  it('states that no target is derivable when the entity has no instinctRoll', () => {
    // An NPC authored before `ADR-0100`. The role still maps to a chain, but
    // inventing an absolute target for it would hand the judge a number the
    // Warden never had.
    const context = misappliedContractorSkillJudgeContext(
      result,
      fixtureWithContractor({ instinctRoll: undefined }),
    );

    expect(context).toContain('not derivable');
    expect(context).not.toContain('target if no mapped skill applies:');
  });

  it('marks a suppressed skill as contributing +0', () => {
    // `loss_of_confidence` works on a Contractor for free because player and
    // Contractor skills share one reader. A suppressed skill still appears,
    // because "the bonus exists but is switched off" is a different fact from
    // "the role never had it".
    const context = misappliedContractorSkillJudgeContext(
      result,
      fakeFixture({
        seededState: {
          ...fakeFixture().seededState,
          campaignState: {
            entities: {
              mara_odinsen: {
                status: 'alive',
                visible: true,
                revealed: true,
                crewRole: 'cargo_handler',
                instinctRoll: [5, 5],
              },
            },
            characterState: {},
          },
        },
      }),
    );

    // Suppression is driven by `characterState.conditions`, which a seeded
    // entity does not carry — so the default render has no suppression, and
    // this pins that the unsuppressed bonus is the one shown.
    expect(context).toContain('+10');
    expect(context).not.toContain('SUPPRESSED');
  });
});

/**
 * `ADR-0105` — `judgeContext` output reaches the judge and is covered by no
 * hash: editing this renderer changes what the grader reads while moving
 * `rubricHash`, `judgeContractHash` and `corpusVersion` not at all. The ADR's
 * remedy is the same instrument `assemblyHash` uses — a frozen input rendered
 * through the real function, the result committed, so a refactor producing
 * identical text moves nothing and a one-word edit fails by name.
 *
 * This is the first such golden in the repo. `unauditableMappingJudgeContext`
 * has sat in the same gap since it shipped and is not retrofitted here.
 */
describe('misappliedContractorSkillJudgeContext golden (`ADR-0105`)', () => {
  const GOLDEN = join(
    __dirname,
    '..',
    'judged',
    'judge-context-golden',
    'misapplied-contractor-skill.txt',
  );

  it('renders the frozen probe exactly as committed', () => {
    const rendered = misappliedContractorSkillJudgeContext(
      fakeTurnExecutionResult({
        gameEvents: [
          fakeDiceRoll({
            sequenceNumber: 44,
            notation: '1d100',
            results: [79],
            purpose:
              "Mara's effort to crack the insurance file — roll under her Instinct 40",
            actingEntityId: 'mara_odinsen',
          }),
          fakeDiceRoll({
            sequenceNumber: 97,
            notation: '1d100',
            results: [12],
            purpose: 'Petrov hauls the coupling clear of the housing',
            actingEntityId: 'petrov',
          }),
        ],
      }),
      fakeFixture({
        seededState: {
          ...fakeFixture().seededState,
          campaignState: {
            entities: {
              mara_odinsen: {
                status: 'alive',
                visible: true,
                revealed: true,
                crewRole: 'cargo_handler',
                instinctRoll: [5, 5],
              },
              // A senior role with a three-tier chain, so the golden covers a
              // chain longer than one tier and an adjustment other than the
              // unskilled +5.
              petrov: {
                status: 'alive',
                visible: true,
                revealed: true,
                crewRole: 'chief_engineer',
                instinctRoll: [8, 3],
              },
            },
          },
        },
      }),
    );

    expect(existsSync(GOLDEN)).toBe(true);
    expect(rendered).toBe(readFileSync(GOLDEN, 'utf8'));
  });
});
