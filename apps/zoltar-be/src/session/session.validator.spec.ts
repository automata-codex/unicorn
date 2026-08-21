import {
  emptyMothershipCharacterState,
  emptyMothershipState,
  getMothershipPoolDefinition,
  type MothershipCampaignState,
  type MothershipCharacterState,
  suppressedSkills,
} from '@uv/game-systems';
import { describe, expect, it } from 'vitest';

import { submitGmResponseSchema } from './session.schema';
import { validateStateChanges } from './session.validator';

const poolDef = getMothershipPoolDefinition;

function stateWith(
  overrides: Partial<MothershipCampaignState>,
): MothershipCampaignState {
  return { ...emptyMothershipState(), ...overrides };
}

/** A pool change with the boilerplate filled in; `reason` is always required. */
function poolChange(
  owner: string,
  pool: string,
  delta: number,
  extra: Partial<{ maxDelta: number; reason: string }> = {},
) {
  return { owner, pool, delta, reason: 'test', ...extra };
}

describe('validateStateChanges — resourcePools', () => {
  it('initializes an unknown pool when the delta is positive', () => {
    const result = validateStateChanges({
      proposed: { resourcePools: [poolChange('xenomorph', 'hp', 12)] },
      currentData: emptyMothershipState(),
      poolDef,
    });
    expect(result.rejections).toEqual([]);
    expect(result.applied.resourcePools).toEqual({
      xenomorph: { hp: { current: 12, max: null } },
    });
  });

  it('rejects an unknown pool when the delta is non-positive', () => {
    const result = validateStateChanges({
      proposed: { resourcePools: [poolChange('xenomorph', 'hp', -3)] },
      currentData: emptyMothershipState(),
      poolDef,
    });
    expect(result.applied.resourcePools).toEqual({});
    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0].reason).toMatch(/bootstrap/i);
  });

  it('names the failing entry by index and address', () => {
    const result = validateStateChanges({
      proposed: { resourcePools: [poolChange('xenomorph', 'hp', -3)] },
      currentData: emptyMothershipState(),
      poolDef,
    });
    expect(result.rejections[0].path).toBe('resourcePools[0] (xenomorph.hp)');
  });

  it('accepts the reserved _scenario owner', () => {
    const result = validateStateChanges({
      proposed: {
        resourcePools: [poolChange('_scenario', 'hull_breach_timer', 5)],
      },
      currentData: emptyMothershipState(),
      poolDef,
    });
    expect(result.rejections).toEqual([]);
    expect(result.applied.resourcePools._scenario.hull_breach_timer).toEqual({
      current: 5,
      max: null,
    });
  });

  it('rejects an unrecognised leading-underscore owner', () => {
    const result = validateStateChanges({
      proposed: { resourcePools: [poolChange('_station', 'power_reserve', 4)] },
      currentData: emptyMothershipState(),
      poolDef,
    });
    expect(result.applied.resourcePools).toEqual({});
    expect(result.rejections[0].reason).toMatch(/_scenario/);
  });

  it('rejects bootstrapping a pool that re-spells the player entity id', () => {
    const result = validateStateChanges({
      proposed: { resourcePools: [poolChange('alvarez', 'hp', 20)] },
      currentData: stateWith({
        resourcePools: { lt_alvarez: { hp: { current: 20, max: 20 } } },
      }),
      poolDef,
      identifiers: {
        playerEntityIds: ['lt_alvarez'],
        knownEntityIds: ['burned_out_medic'],
      },
    });
    expect(result.applied.resourcePools).toEqual({});
    // The valid id is named so the model can correct inside the loop.
    expect(result.rejections[0].reason).toContain('lt_alvarez');
  });

  it('still bootstraps a pool for a known entity that shares a player pool name', () => {
    const result = validateStateChanges({
      proposed: { resourcePools: [poolChange('burned_out_medic', 'hp', 8)] },
      currentData: stateWith({
        resourcePools: { lt_alvarez: { hp: { current: 20, max: 20 } } },
      }),
      poolDef,
      identifiers: {
        playerEntityIds: ['lt_alvarez'],
        knownEntityIds: ['burned_out_medic'],
      },
    });
    expect(result.rejections).toEqual([]);
    expect(result.applied.resourcePools).toEqual({
      burned_out_medic: { hp: { current: 8, max: null } },
    });
  });

  it('disables the impersonation check when no player ids are declared', () => {
    const result = validateStateChanges({
      proposed: { resourcePools: [poolChange('alvarez', 'hp', 20)] },
      currentData: stateWith({
        resourcePools: { lt_alvarez: { hp: { current: 20, max: 20 } } },
      }),
      poolDef,
      identifiers: { playerEntityIds: [], knownEntityIds: [] },
    });
    expect(result.rejections).toEqual([]);
    expect(result.applied.resourcePools).toHaveProperty('alvarez');
  });

  describe('the four rules from §2.2', () => {
    it('rejects a result below the floor rather than clamping it', () => {
      const result = validateStateChanges({
        proposed: { resourcePools: [poolChange('dr_chen', 'stress', -5)] },
        currentData: stateWith({
          resourcePools: { dr_chen: { stress: { current: 3, max: null } } },
        }),
        poolDef,
      });
      expect(result.applied.resourcePools).toEqual({});
      expect(result.rejections[0].reason).toMatch(/spend more than available/i);
    });

    it('rejects maxDelta on a pool whose instance max is null', () => {
      // A ceiling delta on an uncapped pool would hide a Warden error: there
      // is no ceiling to move, so the request means something unsaid.
      const result = validateStateChanges({
        proposed: {
          resourcePools: [poolChange('dr_chen', 'stress', 0, { maxDelta: -2 })],
        },
        currentData: stateWith({
          resourcePools: { dr_chen: { stress: { current: 3, max: null } } },
        }),
        poolDef,
      });
      expect(result.applied.resourcePools).toEqual({});
      expect(result.rejections[0].reason).toMatch(/no ceiling/);
    });

    it('rejects a ceiling drop that leaves current above the new max', () => {
      const result = validateStateChanges({
        proposed: {
          resourcePools: [poolChange('dr_chen', 'hp', 0, { maxDelta: -4 })],
        },
        currentData: stateWith({
          resourcePools: { dr_chen: { hp: { current: 18, max: 20 } } },
        }),
        poolDef,
      });
      expect(result.applied.resourcePools).toEqual({});
      expect(result.rejections[0].reason).toMatch(/exceed its ceiling/);
    });

    it('rejects an entry with no reason at parse time', () => {
      // `reason` is required by the tool schema rather than checked here, so
      // the assertion is that the schema rejects it — a delta that reaches the
      // validator without one is not expressible.
      const parsed = submitGmResponseSchema.safeParse({
        playerText: 'x',
        stateChanges: {
          resourcePools: [{ owner: 'dr_chen', pool: 'hp', delta: -2 }],
        },
      });
      expect(parsed.success).toBe(false);
    });

    it('the §2.2 worked example: both deltas sent, larger delta permitted', () => {
      // Death table `00`, maxHp 20, current 18, `1d5` of 4. `{ delta: -2,
      // maxDelta: -4 }` is the *wrong* answer — it discards whatever damage
      // exceeded 2 — but it is legal, and so is the larger delta that records
      // what actually happened. The inequality permits both. This test exists
      // so a later "simplification" to "delta exactly closes the gap" does not
      // narrow it.
      const state = stateWith({
        resourcePools: { dr_chen: { hp: { current: 18, max: 20 } } },
      });

      const minimal = validateStateChanges({
        proposed: {
          resourcePools: [poolChange('dr_chen', 'hp', -2, { maxDelta: -4 })],
        },
        currentData: state,
        poolDef,
      });
      expect(minimal.rejections).toEqual([]);
      expect(minimal.applied.resourcePools.dr_chen.hp).toEqual({
        current: 16,
        max: 16,
      });

      const actual = validateStateChanges({
        proposed: {
          resourcePools: [poolChange('dr_chen', 'hp', -6, { maxDelta: -4 })],
        },
        currentData: state,
        poolDef,
      });
      expect(actual.rejections).toEqual([]);
      expect(actual.applied.resourcePools.dr_chen.hp).toEqual({
        current: 12,
        max: 16,
      });
    });
  });

  describe('the in-order fold', () => {
    it('applies two entries against one pool, in order', () => {
      // The wounds chain in miniature: drive hp to zero, then reset it.
      // Validating each independently against pre-turn state would reject the
      // second, or accept a pair no sequence of events explains.
      const result = validateStateChanges({
        proposed: {
          resourcePools: [
            poolChange('dr_chen', 'hp', -18, { reason: 'gunshot' }),
            poolChange('dr_chen', 'hp', 14, {
              reason: 'reset minus carryover',
            }),
          ],
        },
        currentData: stateWith({
          resourcePools: { dr_chen: { hp: { current: 18, max: 20 } } },
        }),
        poolDef,
      });
      expect(result.rejections).toEqual([]);
      expect(result.applied.resourcePools.dr_chen.hp).toEqual({
        current: 14,
        max: 20,
      });
    });

    it('preserves sum(deltas) == current - initial across the fold', () => {
      const result = validateStateChanges({
        proposed: {
          resourcePools: [
            poolChange('dr_chen', 'stress', 3),
            poolChange('dr_chen', 'stress', 2),
            poolChange('dr_chen', 'stress', -1),
          ],
        },
        currentData: stateWith({
          resourcePools: { dr_chen: { stress: { current: 2, max: null } } },
        }),
        poolDef,
      });
      expect(result.applied.resourcePools.dr_chen.stress.current).toBe(
        2 + (3 + 2 - 1),
      );
    });

    it('rejects an entry the fold makes invalid, not the pre-turn state', () => {
      // Independently against pre-turn state, -3 from 5 is fine. After the
      // first entry the pool is at 1, so it is not.
      const result = validateStateChanges({
        proposed: {
          resourcePools: [
            poolChange('dr_chen', 'stress', -4),
            poolChange('dr_chen', 'stress', -3),
          ],
        },
        currentData: stateWith({
          resourcePools: { dr_chen: { stress: { current: 5, max: null } } },
        }),
        poolDef,
      });
      expect(result.rejections).toHaveLength(1);
      expect(result.rejections[0].path).toContain('[1]');
    });

    it('aborts the whole array on a rejection, applying nothing', () => {
      // D4: partial application leaves state no complete delta stream
      // explains, and re-prompts the Warden against a world it cannot see
      // moved.
      const result = validateStateChanges({
        proposed: {
          resourcePools: [
            poolChange('dr_chen', 'hp', -2),
            poolChange('dr_chen', 'stress', -99),
            poolChange('dr_chen', 'hp', -1),
          ],
        },
        currentData: stateWith({
          resourcePools: {
            dr_chen: {
              hp: { current: 10, max: 10 },
              stress: { current: 2, max: null },
            },
          },
        }),
        poolDef,
      });
      expect(result.rejections).toHaveLength(1);
      expect(result.applied.resourcePools).toEqual({});
    });

    it('folds on a working copy, leaving currentData byte-identical', () => {
      // The one test that distinguishes a clean abort from an abort over
      // already-modified state. If the fold mutated `currentData`, entries one
      // and two would have landed before entry three failed, and D4's
      // guarantee would be void while every other test still passed.
      const currentData = stateWith({
        resourcePools: {
          dr_chen: {
            hp: { current: 10, max: 10 },
            stress: { current: 2, max: null },
          },
        },
      });
      const before = structuredClone(currentData);

      validateStateChanges({
        proposed: {
          resourcePools: [
            poolChange('dr_chen', 'hp', -2),
            poolChange('dr_chen', 'hp', -1),
            poolChange('dr_chen', 'stress', -99),
          ],
        },
        currentData,
        poolDef,
      });

      expect(currentData).toEqual(before);
      expect(currentData.resourcePools.dr_chen.hp).toEqual({
        current: 10,
        max: 10,
      });
    });

    it('applies pools of two different owners in one turn', () => {
      const result = validateStateChanges({
        proposed: {
          resourcePools: [
            poolChange('dr_chen', 'hp', -2),
            poolChange('_scenario', 'hull_breach_timer', -1),
          ],
        },
        currentData: stateWith({
          resourcePools: {
            dr_chen: { hp: { current: 10, max: 10 } },
            _scenario: { hull_breach_timer: { current: 5, max: 5 } },
          },
        }),
        poolDef,
      });
      expect(result.rejections).toEqual([]);
      expect(result.applied.resourcePools.dr_chen.hp.current).toBe(8);
      expect(
        result.applied.resourcePools._scenario.hull_breach_timer.current,
      ).toBe(4);
    });
  });

  describe('thresholds', () => {
    it('addresses a crossing owner-first', () => {
      const customPoolDef = () => ({
        min: null,
        max: null,
        thresholds: [{ value: 0, effect: 'reactor_scram' }],
      });
      const result = validateStateChanges({
        proposed: { resourcePools: [poolChange('_scenario', 'coolant', -6)] },
        currentData: stateWith({
          resourcePools: { _scenario: { coolant: { current: 5, max: 10 } } },
        }),
        poolDef: customPoolDef,
      });
      expect(result.thresholds).toEqual([
        { pool: '_scenario.coolant', finalValue: -1, effect: 'reactor_scram' },
      ]);
    });

    it('does not fire when healing from -1 to +2 (already past it)', () => {
      const customPoolDef = () => ({
        min: null,
        max: null,
        thresholds: [{ value: 0, effect: 'reactor_scram' }],
      });
      const result = validateStateChanges({
        proposed: { resourcePools: [poolChange('_scenario', 'coolant', 3)] },
        currentData: stateWith({
          resourcePools: { _scenario: { coolant: { current: -1, max: 10 } } },
        }),
        poolDef: customPoolDef,
      });
      expect(result.thresholds).toEqual([]);
    });

    it('reports no thresholds when the array was rejected', () => {
      const customPoolDef = () => ({
        min: 0,
        max: null,
        thresholds: [{ value: 3, effect: 'reactor_scram' }],
      });
      const result = validateStateChanges({
        proposed: {
          resourcePools: [
            poolChange('_scenario', 'coolant', -3),
            poolChange('_scenario', 'coolant', -99),
          ],
        },
        currentData: stateWith({
          resourcePools: { _scenario: { coolant: { current: 5, max: 10 } } },
        }),
        poolDef: customPoolDef,
      });
      expect(result.rejections).toHaveLength(1);
      expect(result.thresholds).toEqual([]);
    });
  });
});

describe('validateStateChanges — characterState', () => {
  function stateWithCharacter(
    overrides: Partial<MothershipCharacterState> = {},
  ): MothershipCampaignState {
    return stateWith({
      characterState: {
        dr_chen: { ...emptyMothershipCharacterState(), ...overrides },
      },
    });
  }

  describe('roll modifiers', () => {
    const skullFracture = {
      op: 'roll_modifier_add' as const,
      entityId: 'dr_chen',
      effect: 'disadvantage' as const,
      scope: 'all_rolls' as const,
      source: 'Wounds Table: skull fracture',
    };

    const run = (changes: unknown[], current = stateWithCharacter()) =>
      validateStateChanges({
        proposed: { characterState: changes as never },
        currentData: current,
        poolDef,
      });

    /**
     * The 2026-08-16 playtest lost exactly this. The Warden read "Skull
     * fracture. [-] on all rolls" off the Wounds Table, found no match among
     * the eight Panic Conditions, correctly declined to invent one, and
     * recorded it in notes where nothing downstream could apply it.
     */
    it('records a lasting [-] on all rolls', () => {
      const result = run([skullFracture]);
      expect(result.rejections).toEqual([]);
      expect(result.applied.characterState.dr_chen.rollModifiers).toEqual([
        {
          effect: 'disadvantage',
          scope: 'all_rolls',
          source: 'Wounds Table: skull fracture',
        },
      ]);
    });

    it('records a scoped modifier with its target', () => {
      const result = run([
        {
          op: 'roll_modifier_add',
          entityId: 'dr_chen',
          effect: 'advantage',
          scope: 'save',
          target: 'body',
          source: 'Automed',
        },
      ]);
      expect(result.rejections).toEqual([]);
      expect(
        result.applied.characterState.dr_chen.rollModifiers[0],
      ).toMatchObject({ scope: 'save', target: 'body' });
    });

    it('rejects all_rolls carrying a target', () => {
      const result = run([{ ...skullFracture, target: 'combat' }]);
      expect(result.rejections).toHaveLength(1);
    });

    it('rejects a scoped modifier with no target', () => {
      const result = run([{ ...skullFracture, scope: 'stat' }]);
      expect(result.rejections).toHaveLength(1);
    });

    /** `source` is the key a removal names, so it has to be unique. */
    it('rejects a second modifier from the same source', () => {
      const result = run([skullFracture, skullFracture]);
      expect(result.rejections).toHaveLength(1);
    });

    it('removes a modifier by source', () => {
      const current = stateWithCharacter({
        rollModifiers: [
          {
            effect: 'disadvantage',
            scope: 'all_rolls',
            source: 'Wounds Table: skull fracture',
          },
        ],
      });
      const result = run(
        [
          {
            op: 'roll_modifier_remove',
            entityId: 'dr_chen',
            source: 'Wounds Table: skull fracture',
          },
        ],
        current,
      );
      expect(result.rejections).toEqual([]);
      expect(result.applied.characterState.dr_chen.rollModifiers).toEqual([]);
    });

    it('rejects removing a modifier that is not there', () => {
      const result = run([
        {
          op: 'roll_modifier_remove',
          entityId: 'dr_chen',
          source: 'Wounds Table: broken jaw',
        },
      ]);
      expect(result.rejections).toHaveLength(1);
    });
  });

  describe('conditions', () => {
    it('adds a condition that takes no parameter', () => {
      const result = validateStateChanges({
        proposed: {
          characterState: [
            { op: 'condition_add', entityId: 'dr_chen', condition: 'doomed' },
          ],
        },
        currentData: stateWithCharacter(),
        poolDef,
      });
      expect(result.rejections).toEqual([]);
      expect(result.applied.characterState.dr_chen.conditions).toEqual([
        { condition: 'doomed' },
      ]);
    });

    it('requires a parameter for frightened', () => {
      const result = validateStateChanges({
        proposed: {
          characterState: [
            {
              op: 'condition_add',
              entityId: 'dr_chen',
              condition: 'frightened',
            },
          ],
        },
        currentData: stateWithCharacter(),
        poolDef,
      });
      expect(result.rejections[0].reason).toMatch(/requires a parameter/);
    });

    it('forbids a parameter on the six that take none', () => {
      const result = validateStateChanges({
        proposed: {
          characterState: [
            {
              op: 'condition_add',
              entityId: 'dr_chen',
              condition: 'doomed',
              parameter: 'something',
            },
          ],
        },
        currentData: stateWithCharacter(),
        poolDef,
      });
      expect(result.rejections[0].reason).toMatch(/takes no parameter/);
    });

    it('rejects a loss_of_confidence naming a skill the character lacks', () => {
      // The parameter is a link into the skills list, not a label; a name that
      // resolves to nothing would suppress nothing, silently.
      const result = validateStateChanges({
        proposed: {
          characterState: [
            {
              op: 'condition_add',
              entityId: 'dr_chen',
              condition: 'loss_of_confidence',
              parameter: 'Astrogation',
            },
          ],
        },
        currentData: stateWithCharacter({
          skills: [{ skill: 'Firearms', tier: 'trained' }],
        }),
        poolDef,
      });
      expect(result.rejections[0].reason).toMatch(/not a skill/);
      expect(result.rejections[0].reason).toContain('Firearms');
    });

    it('accepts a loss_of_confidence naming a skill the character has', () => {
      const result = validateStateChanges({
        proposed: {
          characterState: [
            {
              op: 'condition_add',
              entityId: 'dr_chen',
              condition: 'loss_of_confidence',
              parameter: 'Firearms',
            },
          ],
        },
        currentData: stateWithCharacter({
          skills: [{ skill: 'Firearms', tier: 'trained' }],
        }),
        poolDef,
      });
      expect(result.rejections).toEqual([]);
      expect(suppressedSkills(result.applied.characterState.dr_chen)).toEqual(
        new Set(['Firearms']),
      );
    });

    it('removing loss_of_confidence removes the suppression', () => {
      // Because the condition entry was the only record of it.
      const result = validateStateChanges({
        proposed: {
          characterState: [
            {
              op: 'condition_remove',
              entityId: 'dr_chen',
              condition: 'loss_of_confidence',
            },
          ],
        },
        currentData: stateWithCharacter({
          skills: [{ skill: 'Firearms', tier: 'trained' }],
          conditions: [
            { condition: 'loss_of_confidence', parameter: 'Firearms' },
          ],
        }),
        poolDef,
      });
      expect(result.rejections).toEqual([]);
      expect(suppressedSkills(result.applied.characterState.dr_chen)).toEqual(
        new Set(),
      );
    });

    it('rejects removing a condition the character does not have', () => {
      const result = validateStateChanges({
        proposed: {
          characterState: [
            {
              op: 'condition_remove',
              entityId: 'dr_chen',
              condition: 'doomed',
            },
          ],
        },
        currentData: stateWithCharacter(),
        poolDef,
      });
      expect(result.rejections[0].reason).toMatch(/nothing to remove/);
    });

    it('rejects adding a condition the character already has', () => {
      const result = validateStateChanges({
        proposed: {
          characterState: [
            { op: 'condition_add', entityId: 'dr_chen', condition: 'doomed' },
          ],
        },
        currentData: stateWithCharacter({
          conditions: [{ condition: 'doomed' }],
        }),
        poolDef,
      });
      expect(result.rejections[0].reason).toMatch(/do not stack/);
    });
  });

  describe('armor_damage', () => {
    // **AP is a threshold, not a pool** (rules-extraction-findings § S25.6,
    // from reading PSG p.28; the live Warden prompt says the same). A hit
    // below AP is ignored entirely and wears nothing down; a hit at or above
    // AP destroys the armor outright. M7.6's spec §1.3 says "AP is consumed"
    // and is wrong on that point — see the validator's note.
    const armored = () =>
      stateWithCharacter({
        wornArmor: {
          item: 'Vaccsuit',
          apBase: 3,
          apCurrent: 3,
          destroyed: false,
          dr: 1,
          o2Remaining: 12,
          features: [],
        },
      });

    it('destroys the armor when the hit reaches AP', () => {
      const result = validateStateChanges({
        proposed: {
          characterState: [
            {
              op: 'armor_damage',
              entityId: 'dr_chen',
              apDelta: -3,
              destroyed: true,
            },
          ],
        },
        currentData: armored(),
        poolDef,
      });
      expect(result.rejections).toEqual([]);
      expect(result.applied.characterState.dr_chen.wornArmor).toMatchObject({
        apCurrent: 0,
        destroyed: true,
      });
    });

    it('leaves DR intact when the armor is destroyed', () => {
      // DR applies first and survives both destruction and Anti-Armor, which
      // is why it is a separate field: one number could not express "the armor
      // is gone but the reduction is not".
      const result = validateStateChanges({
        proposed: {
          characterState: [
            {
              op: 'armor_damage',
              entityId: 'dr_chen',
              apDelta: -5,
              destroyed: true,
            },
          ],
        },
        currentData: armored(),
        poolDef,
      });
      expect(result.applied.characterState.dr_chen.wornArmor?.dr).toBe(1);
    });

    it('rejects a hit below AP, which wears nothing down', () => {
      // The exact error a Warden defaults to — "subtract armor from each hit".
      const result = validateStateChanges({
        proposed: {
          characterState: [
            {
              op: 'armor_damage',
              entityId: 'dr_chen',
              apDelta: -1,
              destroyed: true,
            },
          ],
        },
        currentData: armored(),
        poolDef,
      });
      expect(result.rejections[0].reason).toMatch(/threshold, not a pool/);
      expect(result.applied.characterState).toEqual({});
    });

    it('rejects a positive apDelta', () => {
      const result = validateStateChanges({
        proposed: {
          characterState: [
            {
              op: 'armor_damage',
              entityId: 'dr_chen',
              apDelta: 2,
              destroyed: true,
            },
          ],
        },
        currentData: armored(),
        poolDef,
      });
      expect(result.rejections[0].reason).toMatch(/must be negative/);
    });

    it('rejects destroyed: false at parse time', () => {
      // There is no armor change that is not destruction, so the field is a
      // literal rather than a boolean the validator has to second-guess.
      const parsed = submitGmResponseSchema.safeParse({
        playerText: 'x',
        stateChanges: {
          characterState: [
            {
              op: 'armor_damage',
              entityId: 'dr_chen',
              apDelta: -5,
              destroyed: false,
            },
          ],
        },
      });
      expect(parsed.success).toBe(false);
    });

    it('rejects damaging armor the character is not wearing', () => {
      const result = validateStateChanges({
        proposed: {
          characterState: [
            {
              op: 'armor_damage',
              entityId: 'dr_chen',
              apDelta: -3,
              destroyed: true,
            },
          ],
        },
        currentData: stateWithCharacter(),
        poolDef,
      });
      expect(result.rejections[0].reason).toMatch(/not wearing armor/);
    });

    it('rejects destroying armor that is already destroyed', () => {
      const result = validateStateChanges({
        proposed: {
          characterState: [
            {
              op: 'armor_damage',
              entityId: 'dr_chen',
              apDelta: -3,
              destroyed: true,
            },
          ],
        },
        currentData: stateWithCharacter({
          wornArmor: {
            item: 'Vaccsuit',
            apBase: 3,
            apCurrent: 0,
            destroyed: true,
            dr: 1,
            o2Remaining: 12,
            features: [],
          },
        }),
        poolDef,
      });
      expect(result.rejections[0].reason).toMatch(/already destroyed/);
    });
  });

  describe('absolute setters', () => {
    it('sets bleeding to a total, not a delta', () => {
      const result = validateStateChanges({
        proposed: {
          characterState: [
            { op: 'bleeding_set', entityId: 'dr_chen', value: 3 },
          ],
        },
        currentData: stateWithCharacter({ bleeding: 2 }),
        poolDef,
      });
      expect(result.applied.characterState.dr_chen.bleeding).toBe(3);
    });

    it('clears bleeding with zero', () => {
      const result = validateStateChanges({
        proposed: {
          characterState: [
            { op: 'bleeding_set', entityId: 'dr_chen', value: 0 },
          ],
        },
        currentData: stateWithCharacter({ bleeding: 5 }),
        poolDef,
      });
      expect(result.applied.characterState.dr_chen.bleeding).toBe(0);
    });

    it('sets and clears a pending Death Save', () => {
      const set = validateStateChanges({
        proposed: {
          characterState: [
            {
              op: 'death_save_pending',
              entityId: 'dr_chen',
              roundsRemaining: 7,
            },
          ],
        },
        currentData: stateWithCharacter(),
        poolDef,
      });
      expect(set.applied.characterState.dr_chen.pendingDeathSave).toBe(7);

      const cleared = validateStateChanges({
        proposed: {
          characterState: [
            {
              op: 'death_save_pending',
              entityId: 'dr_chen',
              roundsRemaining: null,
            },
          ],
        },
        currentData: stateWithCharacter({ pendingDeathSave: 7 }),
        poolDef,
      });
      expect(
        cleared.applied.characterState.dr_chen.pendingDeathSave,
      ).toBeNull();
    });

    it('raises minimum stress', () => {
      const result = validateStateChanges({
        proposed: {
          characterState: [
            { op: 'minimum_stress_set', entityId: 'dr_chen', value: 4 },
          ],
        },
        currentData: stateWithCharacter(),
        poolDef,
      });
      expect(result.applied.characterState.dr_chen.minimumStress).toBe(4);
    });

    it('rejects a minimum stress below 2 at parse time', () => {
      // A scope bound rather than a rules invariant: nothing in M7.6 lowers it
      // below 2, and the one effect that could — Nanogel — has no write path.
      const parsed = submitGmResponseSchema.safeParse({
        playerText: 'x',
        stateChanges: {
          characterState: [
            { op: 'minimum_stress_set', entityId: 'dr_chen', value: 1 },
          ],
        },
      });
      expect(parsed.success).toBe(false);
    });
  });

  it('bootstraps state for an entity that has none', () => {
    // NPCs get no state at creation — only player characters do — and an NPC
    // can bleed.
    const result = validateStateChanges({
      proposed: {
        characterState: [
          { op: 'bleeding_set', entityId: 'xenomorph', value: 4 },
        ],
      },
      currentData: emptyMothershipState(),
      poolDef,
    });
    expect(result.rejections).toEqual([]);
    expect(result.applied.characterState.xenomorph).toEqual({
      ...emptyMothershipCharacterState(),
      bleeding: 4,
    });
  });

  it('folds several ops against one entity in order', () => {
    const result = validateStateChanges({
      proposed: {
        characterState: [
          { op: 'condition_add', entityId: 'dr_chen', condition: 'doomed' },
          { op: 'bleeding_set', entityId: 'dr_chen', value: 2 },
          { op: 'condition_add', entityId: 'dr_chen', condition: 'haunted' },
        ],
      },
      currentData: stateWithCharacter(),
      poolDef,
    });
    expect(result.rejections).toEqual([]);
    const state = result.applied.characterState.dr_chen;
    expect(state.conditions.map((c) => c.condition)).toEqual([
      'doomed',
      'haunted',
    ]);
    expect(state.bleeding).toBe(2);
  });

  it('aborts the whole array on a rejection, applying nothing', () => {
    const result = validateStateChanges({
      proposed: {
        characterState: [
          { op: 'bleeding_set', entityId: 'dr_chen', value: 2 },
          {
            op: 'armor_damage',
            entityId: 'dr_chen',
            apDelta: 1,
            destroyed: true,
          },
        ],
      },
      currentData: stateWithCharacter(),
      poolDef,
    });
    expect(result.rejections).toHaveLength(1);
    expect(result.applied.characterState).toEqual({});
  });

  it('does not mutate currentData when it aborts', () => {
    const currentData = stateWithCharacter({ bleeding: 1 });
    const before = structuredClone(currentData);

    validateStateChanges({
      proposed: {
        characterState: [
          { op: 'bleeding_set', entityId: 'dr_chen', value: 9 },
          {
            op: 'armor_damage',
            entityId: 'dr_chen',
            apDelta: 1,
            destroyed: true,
          },
        ],
      },
      currentData,
      poolDef,
    });

    expect(currentData).toEqual(before);
  });
});

describe('cross-member atomicity', () => {
  // The wounds chain writes both halves — HP to zero, the Wound recorded,
  // bleeding set from the table, HP reset — and half of that is a state
  // Mothership has no rule for.
  const currentData = () =>
    stateWith({
      resourcePools: { dr_chen: { hp: { current: 10, max: 10 } } },
      characterState: { dr_chen: emptyMothershipCharacterState() },
    });

  it('a characterState rejection leaves resourcePools unapplied', () => {
    const result = validateStateChanges({
      proposed: {
        resourcePools: [poolChange('dr_chen', 'hp', -2)],
        characterState: [
          {
            op: 'armor_damage',
            entityId: 'dr_chen',
            apDelta: 1,
            destroyed: true,
          },
        ],
      },
      currentData: currentData(),
      poolDef,
    });
    expect(result.rejections).toHaveLength(1);
    expect(result.applied.resourcePools).toEqual({});
    expect(result.applied.characterState).toEqual({});
  });

  it('a resourcePools rejection leaves characterState unapplied', () => {
    const result = validateStateChanges({
      proposed: {
        resourcePools: [poolChange('dr_chen', 'hp', -99)],
        characterState: [{ op: 'bleeding_set', entityId: 'dr_chen', value: 3 }],
      },
      currentData: currentData(),
      poolDef,
    });
    expect(result.rejections).toHaveLength(1);
    expect(result.applied.characterState).toEqual({});
    expect(result.applied.resourcePools).toEqual({});
  });

  it('applies both when neither rejects', () => {
    const result = validateStateChanges({
      proposed: {
        resourcePools: [poolChange('dr_chen', 'hp', -2)],
        characterState: [{ op: 'bleeding_set', entityId: 'dr_chen', value: 3 }],
      },
      currentData: currentData(),
      poolDef,
    });
    expect(result.rejections).toEqual([]);
    expect(result.applied.resourcePools.dr_chen.hp.current).toBe(8);
    expect(result.applied.characterState.dr_chen.bleeding).toBe(3);
  });

  it('still applies the other stateChanges members', () => {
    // D4 leaves `entities`, `flags`, `scenarioState` and `worldFacts` open.
    // Recorded as a test so the current behaviour is visible rather than
    // assumed if that question is settled later.
    const result = validateStateChanges({
      proposed: {
        resourcePools: [poolChange('dr_chen', 'hp', -99)],
        worldFacts: { corridor_smell: 'ozone' },
      },
      currentData: currentData(),
      poolDef,
    });
    expect(result.rejections).toHaveLength(1);
    expect(result.applied.worldFacts).toEqual({ corridor_smell: 'ozone' });
  });
});

describe('validateStateChanges — entities', () => {
  it('accepts a status=dead transition without auto-zeroing prefixed pools', () => {
    const result = validateStateChanges({
      proposed: { entities: { dr_chen: { status: 'dead' } } },
      currentData: stateWith({
        entities: {
          dr_chen: {
            visible: true,
            revealed: true,
            status: 'alive',
            npcState: 'Stressed',
          },
        },
        resourcePools: { dr_chen: { hp: { current: 5, max: 10 } } },
      }),
      poolDef,
    });
    expect(result.rejections).toEqual([]);
    expect(result.applied.entities.dr_chen).toEqual({
      visible: true,
      revealed: true,
      status: 'dead',
      npcState: 'Stressed',
    });
    expect(result.applied.resourcePools).toEqual({});
  });

  it('rejects an unrecognized id instead of silently creating one', () => {
    const result = validateStateChanges({
      proposed: { entities: { corporate_spy_1: { status: 'alive' } } },
      currentData: emptyMothershipState(),
      poolDef,
    });
    expect(result.applied.entities).toEqual({});
    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0].reason).toContain('newEntities');
  });

  it('reports every invalid field on one entity, not just the first', () => {
    const result = validateStateChanges({
      proposed: {
        entities: { dr_chen: { status: 'hibernating', revealed: false } },
      },
      currentData: stateWith({
        entities: {
          dr_chen: { visible: true, revealed: true, status: 'alive' },
        },
      }),
      poolDef,
    });
    expect(result.applied.entities).toEqual({});
    expect(result.rejections).toHaveLength(2);
    expect(result.rejections.map((r) => r.reason).join(' ')).toContain(
      'status',
    );
    expect(result.rejections.map((r) => r.reason).join(' ')).toContain(
      'monotonic',
    );
  });

  it('rejects un-revealing a discovered entity', () => {
    const result = validateStateChanges({
      proposed: { entities: { dr_chen: { revealed: false } } },
      currentData: stateWith({
        entities: {
          dr_chen: { visible: true, revealed: true, status: 'alive' },
        },
      }),
      poolDef,
    });
    expect(result.applied.entities).toEqual({});
    expect(result.rejections[0].reason).toContain('monotonic');
  });

  it('accepts losing sight of a discovered entity — the point of the split', () => {
    const result = validateStateChanges({
      proposed: { entities: { dr_chen: { visible: false } } },
      currentData: stateWith({
        entities: {
          dr_chen: { visible: true, revealed: true, status: 'alive' },
        },
      }),
      poolDef,
    });
    expect(result.rejections).toEqual([]);
    expect(result.applied.entities.dr_chen).toEqual({
      visible: false,
      revealed: true,
      status: 'alive',
    });
  });

  it('accepts revealing a hidden entity', () => {
    const result = validateStateChanges({
      proposed: { entities: { ghost: { visible: true, revealed: true } } },
      currentData: stateWith({
        entities: {
          ghost: { visible: false, revealed: false, status: 'unknown' },
        },
      }),
      poolDef,
    });
    expect(result.rejections).toEqual([]);
    expect(result.applied.entities.ghost).toEqual({
      visible: true,
      revealed: true,
      status: 'unknown',
    });
  });
});

describe('validateStateChanges — newEntities', () => {
  it('creates an entity that is not in play', () => {
    const result = validateStateChanges({
      proposed: {
        newEntities: {
          corporate_spy_1: { visible: true, revealed: true, status: 'alive' },
        },
      },
      currentData: emptyMothershipState(),
      poolDef,
    });
    expect(result.rejections).toEqual([]);
    expect(result.applied.entities.corporate_spy_1).toEqual({
      visible: true,
      revealed: true,
      status: 'alive',
    });
  });

  it('rejects creating an entity that already exists', () => {
    const result = validateStateChanges({
      proposed: {
        newEntities: { dr_chen: { visible: true, revealed: true } },
      },
      currentData: stateWith({
        entities: {
          dr_chen: { visible: true, revealed: true, status: 'alive' },
        },
      }),
      poolDef,
    });
    expect(result.applied.entities).toEqual({});
    expect(result.rejections[0].reason).toContain('already in play');
  });

  it('rejects visible-but-undiscovered on create', () => {
    const result = validateStateChanges({
      proposed: {
        newEntities: { ghost: { visible: true, revealed: false } },
      },
      currentData: emptyMothershipState(),
      poolDef,
    });
    expect(result.applied.entities).toEqual({});
    expect(result.rejections[0].reason).toContain('not a state that exists');
  });

  it('makes a created id a legal pool owner in the same turn', () => {
    const result = validateStateChanges({
      proposed: {
        newEntities: { new_guard: { visible: true, revealed: true } },
        resourcePools: [
          { owner: 'new_guard', pool: 'hp', delta: 10, reason: 'bootstrap' },
        ],
      },
      currentData: stateWith({
        entities: {},
        resourcePools: { alvarez: { hp: { current: 10, max: 10 } } },
      }),
      poolDef,
      identifiers: { playerEntityIds: ['alvarez'], knownEntityIds: [] },
    });
    expect(result.rejections).toEqual([]);
  });

  /**
   * Negative control for the test above. Without the create, the identical
   * pool change is rejected as impersonation — an unknown owner bootstrapping
   * a pool the player owns. That rejection is correct and stays; the point of
   * widening the identifier set is that a create in the same payload is what
   * separates "declared four lines ago" from "nobody declared this".
   */
  it('still rejects the same pool change when nothing created the owner', () => {
    const result = validateStateChanges({
      proposed: {
        resourcePools: [
          { owner: 'new_guard', pool: 'hp', delta: 10, reason: 'bootstrap' },
        ],
      },
      currentData: stateWith({
        entities: {},
        resourcePools: { alvarez: { hp: { current: 10, max: 10 } } },
      }),
      poolDef,
      identifiers: { playerEntityIds: ['alvarez'], knownEntityIds: [] },
    });
    expect(result.rejections).not.toEqual([]);
  });

  it('rejects an invalid status string', () => {
    const result = validateStateChanges({
      proposed: { entities: { dr_chen: { status: 'hibernating' } } },
      currentData: stateWith({
        entities: {
          dr_chen: { visible: true, revealed: true, status: 'alive' },
        },
      }),
      poolDef,
    });
    expect(result.applied.entities).toEqual({});
    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0].path).toBe('entities.dr_chen');
  });
});

describe('validateStateChanges — flags', () => {
  it('rejects a new flag that is missing a trigger', () => {
    const result = validateStateChanges({
      proposed: { flags: { secret_door_found: { value: true } } },
      currentData: emptyMothershipState(),
      poolDef,
    });
    expect(result.applied.flags).toEqual({});
    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0].reason).toMatch(/trigger/i);
  });

  it('applies a new flag that carries a trigger', () => {
    const result = validateStateChanges({
      proposed: {
        flags: {
          secret_door_found: {
            value: true,
            trigger: 'Player notices the maintenance panel',
          },
        },
      },
      currentData: emptyMothershipState(),
      poolDef,
    });
    expect(result.rejections).toEqual([]);
    expect(result.applied.flags.secret_door_found).toEqual({
      value: true,
      trigger: 'Player notices the maintenance panel',
    });
  });

  it('preserves the original trigger when Claude provides one on an existing flag', () => {
    const result = validateStateChanges({
      proposed: {
        flags: {
          reactor_primed: { value: true, trigger: 'mutated replacement text' },
        },
      },
      currentData: stateWith({
        flags: {
          reactor_primed: {
            value: false,
            trigger: 'Engineer toggles the primer switch',
          },
        },
      }),
      poolDef,
    });
    expect(result.rejections).toEqual([]);
    expect(result.applied.flags.reactor_primed).toEqual({
      value: true,
      trigger: 'Engineer toggles the primer switch',
    });
  });
});

describe('validateStateChanges — scenarioState', () => {
  it('rejects a scenarioState key that was not authored at synthesis time', () => {
    const result = validateStateChanges({
      proposed: { scenarioState: { brand_new_counter: { current: 3 } } },
      currentData: emptyMothershipState(),
      poolDef,
    });
    expect(result.applied.scenarioState).toEqual({});
    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0].reason).toMatch(/synthesis time/i);
  });

  it('overwrites current while preserving max and note on an existing key', () => {
    const result = validateStateChanges({
      proposed: { scenarioState: { oxygen: { current: 40 } } },
      currentData: stateWith({
        scenarioState: {
          oxygen: { current: 80, max: 100, note: 'Life support reserve' },
        },
      }),
      poolDef,
    });
    expect(result.rejections).toEqual([]);
    expect(result.applied.scenarioState.oxygen).toEqual({
      current: 40,
      max: 100,
      note: 'Life support reserve',
    });
  });
});

describe('validateStateChanges — worldFacts', () => {
  it('applies worldFacts verbatim without rejecting', () => {
    const result = validateStateChanges({
      proposed: {
        worldFacts: {
          captains_log_subject: 'Outbreak on Deck 4',
          mess_hall_graffiti: 'THEY HEAR US',
        },
      },
      currentData: emptyMothershipState(),
      poolDef,
    });
    expect(result.rejections).toEqual([]);
    expect(result.applied.worldFacts).toEqual({
      captains_log_subject: 'Outbreak on Deck 4',
      mess_hall_graffiti: 'THEY HEAR US',
    });
  });
});

describe('validateStateChanges — mixed batch', () => {
  it('partitions across members without throwing', () => {
    // Pools abort as a unit now, so a rejected pool entry takes the whole
    // array with it — but `flags` and `worldFacts` are still partitioned
    // independently. D4 leaves that wider atomicity question open.
    const result = validateStateChanges({
      proposed: {
        resourcePools: [
          poolChange('dr_chen', 'hp', -2),
          poolChange('xenomorph', 'hp', -5),
        ],
        flags: {
          unknown_flag: { value: true },
          known_flag: { value: true },
        },
        worldFacts: { corridor_smell: 'ozone and burnt hair' },
      },
      currentData: stateWith({
        resourcePools: { dr_chen: { hp: { current: 5, max: 10 } } },
        flags: {
          known_flag: { value: false, trigger: 'airlock cycles' },
        },
      }),
      poolDef,
    });

    expect(result.applied.resourcePools).toEqual({});
    expect(result.applied.flags).toEqual({
      known_flag: { value: true, trigger: 'airlock cycles' },
    });
    expect(result.applied.worldFacts).toEqual({
      corridor_smell: 'ozone and burnt hair',
    });
    expect(result.rejections).toHaveLength(2);
    expect(result.rejections.map((r) => r.path).sort()).toEqual([
      'flags.unknown_flag',
      'resourcePools[1] (xenomorph.hp)',
    ]);
  });
});
