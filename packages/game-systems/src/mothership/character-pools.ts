import type {
  MothershipCharacterSheet,
  MothershipClass,
  MothershipSave,
  MothershipStat,
} from './character-sheet.schema';
import type { MothershipCharacterPoolName } from './pool-definitions';

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
  const breakdowns = explainMothershipCharacterPools(sheet);
  const total = (name: MothershipCharacterPoolName): number =>
    breakdowns[name].total;

  const pools: Record<string, ResourcePool> = {};

  pools.hp = { current: total('hp'), max: total('hp') };

  // Starts at zero and counts *up* to its ceiling, unlike every other pool
  // here — so the breakdown's total is the ceiling, not the starting value.
  pools.wounds = { current: 0, max: total('wounds') };

  pools.stress = { current: total('stress'), max: null };

  for (const stat of STATS) {
    pools[stat] = { current: total(stat), max: total(stat) };
  }

  for (const save of SAVES) {
    pools[save] = { current: total(save), max: total(save) };
  }

  pools.credits = { current: total('credits'), max: null };

  return { [sheet.entityId]: pools };
}

/**
 * One term in a pool's arithmetic — a die roll, a flat base, a class
 * adjustment. `multiply` scales the running total rather than adding to it,
 * which is only `credits`.
 */
export type PoolTermKind =
  | 'dice'
  | 'base'
  | 'class'
  | 'choice'
  | 'seed'
  | 'multiplier'
  | 'spend';

export interface PoolTerm {
  kind: PoolTermKind;
  value: number;
  /** `multiply` scales; everything else adds. */
  op: 'add' | 'multiply';
}

export interface PoolBreakdown {
  terms: PoolTerm[];
  total: number;
}

function foldTerms(terms: PoolTerm[]): number {
  return terms.reduce(
    (running, term) =>
      term.op === 'multiply' ? running * term.value : running + term.value,
    0,
  );
}

const breakdown = (terms: PoolTerm[]): PoolBreakdown => ({
  terms,
  total: foldTerms(terms),
});

const add = (kind: PoolTermKind, value: number): PoolTerm => ({
  kind,
  value,
  op: 'add',
});

/**
 * The same arithmetic `deriveMothershipCharacterResourcePools` performs, with
 * its terms kept rather than collapsed.
 *
 * **This is the authority and the derivation reads it**, not the other way
 * round. A second function that re-adds the same numbers to explain them is the
 * duplication M7.6 removed everywhere else — it would be free to disagree with
 * the pools it claims to explain, and it would disagree silently, because both
 * numbers would still look plausible.
 *
 * It exists because a bare total is unauditable. The whole `creationRolls`
 * design rests on rolls plus class arithmetic reconciling to each starting
 * ceiling, and until this landed the only screens where a human could perform
 * that reconciliation displayed the answer and none of the terms — which is how
 * a *correct* Scientist Sanity of `2d10+10+30` came to be reported as a bug.
 *
 * Three pools carry a term with no dice behind it: `wounds` totals to its
 * ceiling (it starts at zero), `stress` to Minimum Stress, and `credits`
 * multiplies rather than adds.
 */
export function explainMothershipCharacterPools(
  sheet: MothershipCharacterSheet,
): Record<MothershipCharacterPoolName, PoolBreakdown> {
  const rolls = sheet.creationRolls;
  const adjustment = CLASS_ADJUSTMENTS[sheet.class];
  const chosen = sheet.creationChoices?.adjustedStat;

  const statBreakdown = (stat: MothershipStat): PoolBreakdown => {
    const terms = [add('dice', sum(rolls[stat])), add('base', STAT_BASE)];
    const classBonus = adjustment.stats[stat] ?? 0;
    if (classBonus !== 0) terms.push(add('class', classBonus));
    if (chosen === stat && adjustment.chosenStat !== undefined) {
      terms.push(add('choice', adjustment.chosenStat));
    }
    return breakdown(terms);
  };

  const saveBreakdown = (save: MothershipSave): PoolBreakdown => {
    const terms = [add('dice', sum(rolls[save])), add('base', SAVE_BASE)];
    const classBonus = adjustment.saves[save] ?? 0;
    if (classBonus !== 0) terms.push(add('class', classBonus));
    return breakdown(terms);
  };

  /**
   * `2d10 × rate − gearSpend`. The spend is a term rather than a later write
   * over the seeded pool, so the derivation stays the only authority on what a
   * character starts with.
   */
  const creditsTerms = (): PoolTerm[] => {
    const terms: PoolTerm[] = [
      add('dice', sum(rolls.credits)),
      {
        kind: 'multiplier',
        value: sheet.creationChoices?.forgoLoadout ? 100 : 10,
        op: 'multiply',
      },
    ];
    const spend = sheet.creationChoices?.gearSpend ?? 0;
    if (spend !== 0) terms.push(add('spend', -spend));
    return terms;
  };

  const woundsTerms = [add('base', BASE_MAX_WOUNDS)];
  if (adjustment.maxWoundsBonus !== 0) {
    woundsTerms.push(add('class', adjustment.maxWoundsBonus));
  }

  return {
    hp: breakdown([add('dice', sum(rolls.maxHp)), add('base', MAX_HP_BASE)]),
    wounds: breakdown(woundsTerms),
    stress: breakdown([add('seed', STARTING_STRESS)]),
    strength: statBreakdown('strength'),
    speed: statBreakdown('speed'),
    intellect: statBreakdown('intellect'),
    combat: statBreakdown('combat'),
    sanity: saveBreakdown('sanity'),
    fear: saveBreakdown('fear'),
    body: saveBreakdown('body'),
    credits: breakdown(creditsTerms()),
  };
}
