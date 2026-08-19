import type {
  MothershipCharacterSheet,
  MothershipClass,
  MothershipSave,
  MothershipStat,
} from './character-sheet.schema';

export type ResourcePool = { current: number; max: number | null };

/** `resourcePools[owner][poolName]` — one owner's worth of pools. */
export type OwnedResourcePools = Record<string, Record<string, ResourcePool>>;

const STATS: readonly MothershipStat[] = [
  'strength',
  'speed',
  'intellect',
  'combat',
];

const SAVES: readonly MothershipSave[] = ['sanity', 'fear', 'body'];

/** Stats are `2d10+25`; Saves are `2d10+10` (PSG "Step 2"). */
const STAT_BASE = 25;
const SAVE_BASE = 10;

/** Max Health is `1d10+10` (PSG "Step 2"). */
const MAX_HP_BASE = 10;

/** Every character starts with two Wounds; Marine and Android get a third. */
const BASE_MAX_WOUNDS = 2;

/**
 * Stress starts at 2, not 0 — Minimum Stress is 2 at creation and Stress can
 * never sit below it (PSG §20.1). Seeding 0 would put every character one
 * point below their own floor from the first turn.
 */
const STARTING_STRESS = 2;

/**
 * Class adjustments, PSG "Step 3". `chosenStat` is the player's pick, applied
 * only by the two classes whose adjustment is a choice rather than a constant.
 *
 * Applied here rather than on the frontend deliberately: this is the arithmetic
 * the milestone's acceptance criterion wants reconcilable against
 * `creationRolls`, and it belongs where it is unit-testable rather than behind
 * a form.
 */
interface ClassAdjustment {
  stats: Partial<Record<MothershipStat, number>>;
  saves: Partial<Record<MothershipSave, number>>;
  /** Applied to whichever Stat `creationChoices.adjustedStat` names. */
  chosenStat?: number;
  maxWoundsBonus: number;
}

const CLASS_ADJUSTMENTS: Record<MothershipClass, ClassAdjustment> = {
  marine: {
    stats: { combat: 10 },
    saves: { body: 10, fear: 20 },
    maxWoundsBonus: 1,
  },
  android: {
    stats: { intellect: 20 },
    saves: { fear: 60 },
    chosenStat: -10,
    maxWoundsBonus: 1,
  },
  scientist: {
    stats: { intellect: 10 },
    saves: { sanity: 30 },
    chosenStat: 5,
    maxWoundsBonus: 0,
  },
  teamster: {
    stats: { strength: 5, speed: 5, intellect: 5, combat: 5 },
    saves: { sanity: 10, fear: 10, body: 10 },
    maxWoundsBonus: 0,
  },
};

const sum = (dice: readonly number[]): number =>
  dice.reduce((total, die) => total + die, 0);

/**
 * Derives the eleven pools a Mothership player character carries, from the
 * creation rolls plus the class adjustments (M7.6 §1.2).
 *
 * (The milestone documents calls this "ten pools" throughout. The spec's own
 * §1.2 table lists eleven names — hp, wounds, stress, four Stats, three Saves,
 * credits — and the table is what was built. The count is a label that was
 * never recounted; noted for the spec's closeout rather than silently followed.)
 *
 * Every pool's `current` starts at its `max`, except `stress` (starts at
 * Minimum Stress, and has no ceiling), `wounds` (starts at zero and counts up),
 * and `credits` (a balance, not a ceiling).
 *
 * `creationChoices.forgoLoadout` multiplies starting credits by 100 instead of
 * 10 (PSG §6.1) — a character who takes cash instead of gear. Read from the
 * sheet rather than taken as a caller option: as an option it was passed by the
 * creation form's preview and by nothing on the write path, so the box showed
 * ×100 and seeded ×10.
 *
 * Returned nested under the character's entity id, matching
 * `campaign_state.data.resourcePools`. Called at character creation so the
 * pools exist before synthesis runs; synthesis is not expected to re-derive
 * them.
 */
export function deriveMothershipCharacterResourcePools(
  sheet: MothershipCharacterSheet,
): OwnedResourcePools {
  const rolls = sheet.creationRolls;
  const adjustment = CLASS_ADJUSTMENTS[sheet.class];
  const chosen = sheet.creationChoices?.adjustedStat;

  const pools: Record<string, ResourcePool> = {};

  const maxHp = sum(rolls.maxHp) + MAX_HP_BASE;
  pools.hp = { current: maxHp, max: maxHp };

  const maxWounds = BASE_MAX_WOUNDS + adjustment.maxWoundsBonus;
  pools.wounds = { current: 0, max: maxWounds };

  pools.stress = { current: STARTING_STRESS, max: null };

  for (const stat of STATS) {
    const chosenBonus =
      chosen === stat && adjustment.chosenStat !== undefined
        ? adjustment.chosenStat
        : 0;
    const value =
      sum(rolls[stat]) + STAT_BASE + (adjustment.stats[stat] ?? 0) + chosenBonus;
    pools[stat] = { current: value, max: value };
  }

  for (const save of SAVES) {
    const value = sum(rolls[save]) + SAVE_BASE + (adjustment.saves[save] ?? 0);
    pools[save] = { current: value, max: value };
  }

  const credits =
    sum(rolls.credits) * (sheet.creationChoices?.forgoLoadout ? 100 : 10);
  pools.credits = { current: credits, max: null };

  return { [sheet.entityId]: pools };
}
