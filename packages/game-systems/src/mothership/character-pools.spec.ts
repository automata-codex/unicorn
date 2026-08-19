import { describe, expect, it } from 'vitest';

import type {
  MothershipCharacterSheet,
  MothershipClass,
} from './character-sheet.schema';
import { deriveMothershipCharacterResourcePools } from './character-pools';

/**
 * Every roll is `[3, 4]` (sum 7) except maxHp, so each ceiling is a single
 * addition away from a number stated in the test — which is what makes the
 * reconciliation assertions below readable rather than arithmetic puzzles.
 */
const ROLLS = {
  strength: [3, 4],
  speed: [3, 4],
  intellect: [3, 4],
  combat: [3, 4],
  sanity: [3, 4],
  fear: [3, 4],
  body: [3, 4],
  maxHp: [6],
  credits: [3, 4],
  trinket: [42],
  patch: [17],
};

function sheetFor(
  cls: MothershipClass,
  adjustedStat?: 'strength' | 'speed' | 'intellect' | 'combat',
): MothershipCharacterSheet {
  return {
    entityId: 'vasquez',
    name: 'Vasquez',
    class: cls,
    creationRolls: ROLLS,
    ...(adjustedStat ? { creationChoices: { adjustedStat } } : {}),
  };
}

describe('deriveMothershipCharacterResourcePools', () => {
  it('nests every pool under the entity id', () => {
    const pools = deriveMothershipCharacterResourcePools(sheetFor('teamster'));
    expect(Object.keys(pools)).toEqual(['vasquez']);
    expect(Object.keys(pools.vasquez).sort()).toEqual([
      'body',
      'combat',
      'credits',
      'fear',
      'hp',
      'intellect',
      'sanity',
      'speed',
      'strength',
      'stress',
      'wounds',
    ]);
  });

  it('uses the entityId, not the display name, as the owner key', () => {
    const pools = deriveMothershipCharacterResourcePools({
      ...sheetFor('teamster'),
      entityId: 'dr_chen',
      name: 'Dr. Chen',
    });
    expect(Object.keys(pools)).toEqual(['dr_chen']);
  });

  it('seeds hp at its full 1d10+10 ceiling', () => {
    const pools = deriveMothershipCharacterResourcePools(sheetFor('teamster'));
    expect(pools.vasquez.hp).toEqual({ current: 16, max: 16 });
  });

  it('seeds stress at 2, not 0, and leaves it uncapped', () => {
    // Minimum Stress starts at 2 (PSG §20.1). Seeding 0 would put every
    // character a point below their own floor from the first turn.
    const pools = deriveMothershipCharacterResourcePools(sheetFor('teamster'));
    expect(pools.vasquez.stress).toEqual({ current: 2, max: null });
  });

  it('seeds wounds at zero, counting up to the class ceiling', () => {
    expect(
      deriveMothershipCharacterResourcePools(sheetFor('teamster')).vasquez
        .wounds,
    ).toEqual({ current: 0, max: 2 });
    expect(
      deriveMothershipCharacterResourcePools(sheetFor('marine')).vasquez.wounds,
    ).toEqual({ current: 0, max: 3 });
    expect(
      deriveMothershipCharacterResourcePools(sheetFor('android', 'speed'))
        .vasquez.wounds,
    ).toEqual({ current: 0, max: 3 });
    expect(
      deriveMothershipCharacterResourcePools(sheetFor('scientist', 'speed'))
        .vasquez.wounds,
    ).toEqual({ current: 0, max: 2 });
  });

  it('seeds credits as 2d10 x 10, uncapped', () => {
    const pools = deriveMothershipCharacterResourcePools(sheetFor('teamster'));
    expect(pools.vasquez.credits).toEqual({ current: 70, max: null });
  });

  it('multiplies credits by 100 when the sheet forgoes a loadout', () => {
    const sheet = sheetFor('teamster');
    const pools = deriveMothershipCharacterResourcePools({
      ...sheet,
      creationChoices: { ...sheet.creationChoices, forgoLoadout: true },
    });
    expect(pools.vasquez.credits).toEqual({ current: 700, max: null });
  });

  /**
   * The regression this field exists for: `forgoLoadout` used to be a caller
   * option, the creation form passed it to the preview and omitted it from the
   * POST payload, and the backend derived with no options at all — so the
   * player was shown ×100 and seeded ×10. Read off the sheet there is one
   * source, and a sheet that records the choice cannot derive the other value.
   */
  it('keeps credits at x10 when the choice is absent or false', () => {
    const sheet = sheetFor('teamster');
    expect(
      deriveMothershipCharacterResourcePools({
        ...sheet,
        creationChoices: { forgoLoadout: false },
      }).vasquez.credits,
    ).toEqual({ current: 70, max: null });
    expect(
      deriveMothershipCharacterResourcePools({
        ...sheet,
        creationChoices: {},
      }).vasquez.credits,
    ).toEqual({ current: 70, max: null });
  });
});

describe('class adjustments (PSG "Step 3")', () => {
  it('applies the Marine adjustment', () => {
    const p = deriveMothershipCharacterResourcePools(sheetFor('marine')).vasquez;
    expect(p.combat.max).toBe(7 + 25 + 10);
    expect(p.body.max).toBe(7 + 10 + 10);
    expect(p.fear.max).toBe(7 + 10 + 20);
    // Untouched by the Marine adjustment.
    expect(p.strength.max).toBe(7 + 25);
    expect(p.sanity.max).toBe(7 + 10);
  });

  it('applies the Android adjustment, including the chosen −10', () => {
    const p = deriveMothershipCharacterResourcePools(
      sheetFor('android', 'strength'),
    ).vasquez;
    expect(p.intellect.max).toBe(7 + 25 + 20);
    expect(p.fear.max).toBe(7 + 10 + 60);
    expect(p.strength.max).toBe(7 + 25 - 10);
    expect(p.speed.max).toBe(7 + 25);
  });

  it('applies the Android −10 to intellect when that is the chosen Stat', () => {
    // The one case where the fixed and chosen adjustments land on the same
    // Stat, and they must sum rather than one replacing the other.
    const p = deriveMothershipCharacterResourcePools(
      sheetFor('android', 'intellect'),
    ).vasquez;
    expect(p.intellect.max).toBe(7 + 25 + 20 - 10);
  });

  it('applies the Scientist adjustment, including the chosen +5', () => {
    const p = deriveMothershipCharacterResourcePools(
      sheetFor('scientist', 'speed'),
    ).vasquez;
    expect(p.intellect.max).toBe(7 + 25 + 10);
    expect(p.sanity.max).toBe(7 + 10 + 30);
    expect(p.speed.max).toBe(7 + 25 + 5);
    expect(p.combat.max).toBe(7 + 25);
  });

  it('applies the Teamster adjustment to all Stats and all Saves', () => {
    const p =
      deriveMothershipCharacterResourcePools(sheetFor('teamster')).vasquez;
    for (const stat of ['strength', 'speed', 'intellect', 'combat']) {
      expect(p[stat].max, stat).toBe(7 + 25 + 5);
    }
    for (const save of ['sanity', 'fear', 'body']) {
      expect(p[save].max, save).toBe(7 + 10 + 10);
    }
  });

  it('ignores a chosen Stat for classes that do not choose one', () => {
    // The schema rejects this combination on write; the derivation must not
    // depend on that to stay correct.
    const p = deriveMothershipCharacterResourcePools({
      ...sheetFor('marine'),
      creationChoices: { adjustedStat: 'strength' },
    }).vasquez;
    expect(p.strength.max).toBe(7 + 25);
  });
});

describe('reconciliation — rolls plus class arithmetic equal each ceiling', () => {
  // The milestone's acceptance criterion, asserted directly: for every class
  // and both choice cases, recompute each ceiling from `creationRolls` and the
  // published class table, and require it to equal what the derivation
  // produced. Nothing here reads the implementation's own constants.
  const CLASS_TABLE: Record<
    MothershipClass,
    {
      stats: Record<string, number>;
      saves: Record<string, number>;
      chosen: number;
      wounds: number;
    }
  > = {
    marine: {
      stats: { combat: 10 },
      saves: { body: 10, fear: 20 },
      chosen: 0,
      wounds: 3,
    },
    android: {
      stats: { intellect: 20 },
      saves: { fear: 60 },
      chosen: -10,
      wounds: 3,
    },
    scientist: {
      stats: { intellect: 10 },
      saves: { sanity: 30 },
      chosen: 5,
      wounds: 2,
    },
    teamster: {
      stats: { strength: 5, speed: 5, intellect: 5, combat: 5 },
      saves: { sanity: 10, fear: 10, body: 10 },
      chosen: 0,
      wounds: 2,
    },
  };

  const CHOICE_CASES = ['strength', 'intellect'] as const;

  for (const cls of Object.keys(CLASS_TABLE) as MothershipClass[]) {
    const choices =
      CLASS_TABLE[cls].chosen === 0 ? [undefined] : CHOICE_CASES;

    for (const chosenStat of choices) {
      const label = chosenStat ? `${cls} (chose ${chosenStat})` : cls;

      it(`reconciles every ceiling for ${label}`, () => {
        const sheet = sheetFor(cls, chosenStat);
        const pools =
          deriveMothershipCharacterResourcePools(sheet).vasquez;
        const table = CLASS_TABLE[cls];
        const rolled = (key: keyof typeof ROLLS) =>
          ROLLS[key].reduce((a, b) => a + b, 0);

        for (const stat of ['strength', 'speed', 'intellect', 'combat']) {
          const expected =
            rolled(stat as keyof typeof ROLLS) +
            25 +
            (table.stats[stat] ?? 0) +
            (chosenStat === stat ? table.chosen : 0);
          expect(pools[stat].max, stat).toBe(expected);
          expect(pools[stat].current, `${stat} starts at its ceiling`).toBe(
            expected,
          );
        }

        for (const save of ['sanity', 'fear', 'body']) {
          const expected =
            rolled(save as keyof typeof ROLLS) + 10 + (table.saves[save] ?? 0);
          expect(pools[save].max, save).toBe(expected);
          expect(pools[save].current, `${save} starts at its ceiling`).toBe(
            expected,
          );
        }

        expect(pools.hp.max).toBe(rolled('maxHp') + 10);
        expect(pools.hp.current).toBe(pools.hp.max);
        expect(pools.wounds.max).toBe(table.wounds);
        expect(pools.credits.current).toBe(rolled('credits') * 10);
      });
    }
  }
});
