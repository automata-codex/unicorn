import { z } from 'zod';

/**
 * The Panic table's Conditions (PSG p. 21). A **closed** enum rather than free
 * text: the set is fixed by the rules, and an open string is a fabrication
 * surface — the Warden would be free to mint a Condition the book does not
 * have, which nothing downstream could interpret.
 */
export const MothershipConditionEnum = z.enum([
  'coward',
  'frightened',
  'nightmares',
  'loss_of_confidence',
  'deflated',
  'doomed',
  'haunted',
  'spiraling',
]);

export type MothershipCondition = z.infer<typeof MothershipConditionEnum>;

/**
 * The two Conditions that carry a parameter, and what it means for each.
 *
 * *Frightened* stores what frightened the character — free narrative text.
 * *Loss of Confidence* stores which skill loses its bonus, which is a **link
 * into the skills list**, not a label. That link is the reason Conditions need
 * a dedicated map at all: `entities[].status` is `string[]` and can hold a
 * name but not a reference.
 */
export const CONDITIONS_REQUIRING_PARAMETER: readonly MothershipCondition[] = [
  'frightened',
  'loss_of_confidence',
];

export const MothershipConditionEntrySchema = z.object({
  condition: MothershipConditionEnum,
  parameter: z.string().max(500).optional(),
});

export type MothershipConditionEntry = z.infer<
  typeof MothershipConditionEntrySchema
>;

/**
 * Skill tiers and the bonus each grants (PSG §22–23). Named rather than stored
 * as the bonus so the tier survives a rules revision that changes the numbers.
 */
export const MothershipSkillTierEnum = z.enum(['trained', 'expert', 'master']);

export type MothershipSkillTier = z.infer<typeof MothershipSkillTierEnum>;

export const MOTHERSHIP_SKILL_BONUS: Record<MothershipSkillTier, number> = {
  trained: 10,
  expert: 15,
  master: 20,
};

/**
 * A skill the character holds, at a tier.
 *
 * `skill` is a free string rather than an enum, unlike `condition` above, and
 * the asymmetry is deliberate: the skill list and its prerequisite graph are
 * TKG content, on the same footing as the Wounds Table, and do not ship in this
 * repo. The Warden reads them through `rules_lookup` against the self-hoster's
 * own ingested PDF. What is enforceable here is the shape and the tier.
 *
 * **Suppression is not stored here.** Panic `08` (*Loss of Confidence*)
 * suppresses one skill's bonus for the life of the Condition, and the Condition
 * entry already records which skill in its `parameter`. Storing it a second
 * time on the skill would be one fact in two places, free to disagree — and
 * removing the Condition would then have to remember to clear both. The
 * suppressed set is derived from the conditions list at read time.
 */
export const MothershipSkillEntrySchema = z.object({
  skill: z.string().min(1).max(100),
  tier: MothershipSkillTierEnum,
});

export type MothershipSkillEntry = z.infer<typeof MothershipSkillEntrySchema>;

/**
 * A stateful item. Loadouts carry counts that change during play — charges,
 * rounds, doses — which is why the pre-M7.6 `string[]` could not hold them:
 * "Revolver (12 rounds)" was a *label* that never decremented.
 *
 * `quantity` is how many of the item; `charges` is what remains inside one.
 * A Patch Kit is `{ item: 'Patch Kit', quantity: 3 }`; a revolver is
 * `{ item: 'Revolver', charges: 12 }`.
 */
export const MothershipEquipmentEntrySchema = z.object({
  item: z.string().min(1).max(200),
  quantity: z.number().int().min(0).optional(),
  charges: z.number().int().min(0).optional(),
  notes: z.string().max(500).optional(),
});

export type MothershipEquipmentEntry = z.infer<
  typeof MothershipEquipmentEntrySchema
>;

/**
 * Worn armor (PSG §28.3).
 *
 * AP is *consumed*, not a static rating: damage meeting or exceeding remaining
 * AP destroys the armor. A patched vaccsuit is AP 1.
 *
 * `dr` is deliberately separate and applies **first**. It survives both
 * destruction and Anti-Armor, which is why it cannot be folded into `apCurrent`
 * — a single number could not express "the armor is gone but the damage
 * reduction is not".
 */
export const MothershipWornArmorSchema = z.object({
  item: z.string().min(1).max(200),
  /** AP the item has when undamaged; `apCurrent` is restored to this on repair. */
  apBase: z.number().int().min(0),
  apCurrent: z.number().int().min(0),
  destroyed: z.boolean().default(false),
  /** Damage reduction, applied before AP. Survives destruction and Anti-Armor. */
  dr: z.number().int().min(0).default(0),
  /** Minutes of air remaining, for sealed suits. `null` when the item has none. */
  o2Remaining: z.number().int().min(0).nullable().default(null),
  /** Radiation shielding, air filter, exoskeletal weave, and so on. */
  features: z.array(z.string().max(200)).default([]),
});

export type MothershipWornArmor = z.infer<typeof MothershipWornArmorSchema>;

/**
 * What a durable modifier applies to.
 *
 * `all_rolls` is the Wounds Table's Fatal Injury shape — "[-] on all rolls" —
 * and needs no target. The others name one, which is why `target` is separate
 * rather than folded into the scope string: a scope of `save` with a target of
 * `sanity` is checkable, `"sanity_save"` is not.
 */
export const MothershipRollModifierScopeEnum = z.enum([
  'all_rolls',
  'stat',
  'save',
  'skill',
]);

export type MothershipRollModifierScope = z.infer<
  typeof MothershipRollModifierScopeEnum
>;

/**
 * A durable Advantage or Disadvantage on future rolls.
 *
 * **Not a number, and that is the whole point.** Mothership expresses
 * difficulty only as Advantage `[+]` or Disadvantage `[-]` — roll twice, take
 * the better or worse result — and has no additive roll bonus at all
 * (`mothership-m7.txt`, "That is the entire system"). A `-10` modifier would be
 * a mechanic this game does not have.
 *
 * **Why this is not a Condition.** The eight Conditions are the *Panic table's*
 * and the enum is closed for good reason. The Wounds Table produces effects
 * that are not Panic Conditions, which is why `bleeding` and `pendingDeathSave`
 * are already dedicated fields — this is the third one, and its absence is why
 * the 2026-08-16 playtest lost a Fatal Injury: the Warden read `Skull fracture.
 * [-] on all rolls.`, found no match among the eight, correctly declined to
 * invent one, and recorded the penalty in notes where nothing could apply it.
 *
 * **Lifetime: until something removes it.** Nothing here expires on its own,
 * exactly like a Condition and unlike `bleeding`. There is no duration field
 * because nothing in the system knows a round elapsed — the same reasoning
 * `pendingDeathSave` records for its own countdown.
 *
 * `source` is the natural key: it is what a removal names, and it is what tells
 * a Fatal Injury penalty apart from a later one of the same shape.
 */
export const MothershipRollModifierSchema = z.object({
  effect: z.enum(['advantage', 'disadvantage']),
  scope: MothershipRollModifierScopeEnum,
  /** The Stat, Save or skill named, when `scope` is not `all_rolls`. */
  target: z.string().max(100).optional(),
  /** Where it came from: "Wounds Table: skull fracture". */
  source: z.string().min(1).max(200),
});

export type MothershipRollModifier = z.infer<
  typeof MothershipRollModifierSchema
>;

/**
 * The per-character state that is neither a pool nor immutable creation data.
 *
 * Everything here changes during play, so none of it can live on the sheet —
 * the sheet has no write path from a turn, and a Panic result granting a
 * Condition would have nowhere to land. None of it is a pool either: they are
 * not resources that are spent and restored against a ceiling.
 *
 * M7.6 Part 3 adds the shapes and the seed values; the write path arrives in
 * Part 4 as `stateChanges.characterState`.
 */
export const MothershipCharacterStateSchema = z.object({
  conditions: z.array(MothershipConditionEntrySchema).default([]),

  /**
   * Durable Advantage/Disadvantage from sources that are not Conditions —
   * today the Wounds Table's Fatal Injury row. See
   * `MothershipRollModifierSchema`.
   */
  rollModifiers: z.array(MothershipRollModifierSchema).default([]),

  skills: z.array(MothershipSkillEntrySchema).default([]),
  equipment: z.array(MothershipEquipmentEntrySchema).default([]),
  wornArmor: MothershipWornArmorSchema.nullable().default(null),

  /**
   * The floor Stress can never fall below (PSG §20.2). Per-character and
   * mutable, which is exactly why it cannot be `PoolDefinition.min` — that is a
   * system constant shared by every character.
   *
   * Not a pool: it is a floor, not a resource.
   */
  minimumStress: z.number().int().min(0).default(2),

  /**
   * Cumulative damage taken per round, ignoring armor and DR (PSG §32.2). The
   * Wounds Table grants `+1` through `+7`, which is why this could not lag
   * behind the Wounds mechanic into a later milestone.
   */
  bleeding: z.number().int().min(0).default(0),

  /**
   * Rounds until the Death Save the Wounds Table's Lethal Injury row sets in
   * motion. `null` when none is pending.
   *
   * The countdown is Warden-driven: nothing decrements it automatically,
   * because nothing in the system knows a round elapsed.
   */
  pendingDeathSave: z.number().int().min(0).nullable().default(null),
});

export type MothershipCharacterState = z.infer<
  typeof MothershipCharacterStateSchema
>;

/** Fresh per-character state, as seeded at character creation. */
export const emptyMothershipCharacterState = (): MothershipCharacterState => ({
  conditions: [],
  rollModifiers: [],
  skills: [],
  equipment: [],
  wornArmor: null,
  minimumStress: 2,
  bleeding: 0,
  pendingDeathSave: null,
});

/**
 * The skills whose bonus is currently suppressed, derived from the conditions
 * list rather than stored (see `MothershipSkillEntrySchema`).
 *
 * A `loss_of_confidence` entry names its skill in `parameter`. An entry with no
 * parameter suppresses nothing — the validator rejects that combination on
 * write, so reaching here means older data, and guessing which skill was meant
 * would be worse than suppressing none.
 */
export function suppressedSkills(
  state: Pick<MothershipCharacterState, 'conditions'>,
): Set<string> {
  const suppressed = new Set<string>();
  for (const entry of state.conditions) {
    if (entry.condition !== 'loss_of_confidence') continue;
    if (entry.parameter) suppressed.add(entry.parameter);
  }
  return suppressed;
}
