import { z } from 'zod';

export const MothershipClassEnum = z.enum([
  'teamster',
  'scientist',
  'android',
  'marine',
]);

export type MothershipClass = z.infer<typeof MothershipClassEnum>;

/** The four Stats. Saves are a separate axis — see `MothershipSaveEnum`. */
export const MothershipStatEnum = z.enum([
  'strength',
  'speed',
  'intellect',
  'combat',
]);

export type MothershipStat = z.infer<typeof MothershipStatEnum>;

export const MothershipSaveEnum = z.enum(['sanity', 'fear', 'body']);

export type MothershipSave = z.infer<typeof MothershipSaveEnum>;

/**
 * A roll recorded as the dice fell, not as a sum: `[7, 4]`, not `11`. Same
 * storage, and it keeps the doubles information a sum discards.
 */
const DiceRollSchema = z.array(z.number().int().min(1)).min(1).max(2);

/**
 * Every roll made at character creation (M7.6 §1.1). The `+25` on Stats, the
 * `+10` on Saves, the `+10` on Max Health, the `×10` on credits, and the class
 * adjustments are all arithmetic applied downstream — none of them are rolls,
 * and none of them are stored here.
 *
 * **This is not a second authority, and the distinction matters because it
 * looks like one at a glance.** A `maxHp` field on the sheet was a *duplicate*
 * of the hp pool's ceiling — one fact in two places, free to diverge, and it
 * did. A creation roll is a *different fact* from the current value: it records
 * what the dice showed, which no later event can change. Nothing writes it
 * after creation, and no mechanic reads it as state.
 *
 * Its three uses are all non-mechanical: telling bad luck apart from attrition
 * (Strength 27 means one thing rolled and another thing rolled at 42 and
 * drained by fifteen), auditing the class adjustments — rolls plus class
 * arithmetic must reconcile to each starting ceiling — and character history
 * once a campaign can run a second adventure.
 */
export const MothershipCreationRollsSchema = z.object({
  // 2d10 each; +25 and the class adjustment are applied at derivation.
  strength: DiceRollSchema,
  speed: DiceRollSchema,
  intellect: DiceRollSchema,
  combat: DiceRollSchema,

  // 2d10 each; +10 and the class adjustment are applied at derivation.
  sanity: DiceRollSchema,
  fear: DiceRollSchema,
  body: DiceRollSchema,

  // 1d10; +10 at derivation.
  maxHp: DiceRollSchema,

  // 2d10; ×10, or ×100 when forgoing a loadout (PSG §6.1).
  credits: DiceRollSchema,

  // d100 each, against the trinket and patch tables.
  trinket: DiceRollSchema,
  patch: DiceRollSchema,
});

export type MothershipCreationRolls = z.infer<
  typeof MothershipCreationRollsSchema
>;

/**
 * The creation-time decisions that are a player *choice* rather than a
 * constant, and that later arithmetic reads as an input.
 *
 * The Android takes −10 to one Stat and the Scientist +5 to one Stat (PSG
 * "Step 3"). Without recording which, the reconciliation the milestone's
 * acceptance criterion asks for — rolls plus class arithmetic equal each
 * starting ceiling — cannot be computed. This is the missing *input* to that
 * audit, not a second copy of a value that lives elsewhere, which is the same
 * argument that admits `creationRolls`.
 *
 * `adjustedStat` is absent for Marine and Teamster, whose class adjustments
 * are entirely fixed. `forgoLoadout` is class-independent and may appear on
 * any sheet.
 */
export const MothershipCreationChoicesSchema = z.object({
  adjustedStat: MothershipStatEnum.optional(),

  /**
   * The player traded the starting loadout for cash, so starting credits are
   * `2d10 × 100` rather than `2d10 × 10` (PSG §6.1).
   *
   * On the sheet by the same argument as `adjustedStat`: it is an input to the
   * credits arithmetic, not a copy of its result. It lived as a
   * `deriveMothershipCharacterResourcePools` *option* until it was found that
   * nothing on the write path passed one — the creation form fed it to the
   * preview and omitted it from the payload, so checking the box showed ×100
   * and seeded ×10. An option a caller can forget is a divergence waiting to
   * happen; read from the sheet it cannot be forgotten.
   */
  forgoLoadout: z.boolean().optional(),
});

export type MothershipCreationChoices = z.infer<
  typeof MothershipCreationChoicesSchema
>;

/**
 * The character sheet holds **immutable creation data only** — everything whose
 * value cannot change during play. Anything that moves lives in
 * `campaign_state.data`: pools, conditions, skills, equipment, worn armor
 * (M7.6 §1.1, and `decisions.md § State placement is decided by the lifetime of
 * the referent, not the lifetime of the value`).
 *
 * Removed in M7.6: `level`, `stats`, `saves`, `maxHp`, `maxStress`, `skills`,
 * `equipment`. Stats and Saves are pools now; `maxHp` and `maxStress` were
 * duplicates of pool ceilings; `level` has no referent in Mothership at all.
 */
const MothershipCharacterSheetBaseSchema = z.object({
  entityId: z.string().min(1).max(100),
  name: z.string().min(1).max(100),
  pronouns: z.string().max(50).optional(),
  class: MothershipClassEnum,

  /** Rolled on the trinket table at creation; narrative, never mechanical. */
  trinket: z.string().max(200).optional(),
  /** Rolled on the patch table at creation; narrative, never mechanical. */
  patch: z.string().max(200).optional(),

  /**
   * Stored, not derived from `class`. Military Training grants the Marine's
   * trauma response to a character of any class (PSG §25.1), so deriving it
   * from the class would be wrong for exactly the character who took that
   * training.
   */
  traumaResponse: z.string().max(500).optional(),

  creationRolls: MothershipCreationRollsSchema,
  creationChoices: MothershipCreationChoicesSchema.optional(),

  notes: z.string().max(2000).optional(),
});

/**
 * Classes whose Stat adjustment is a player choice rather than a constant, and
 * which therefore cannot have their starting ceilings reconciled without
 * `creationChoices.adjustedStat`.
 */
const CLASSES_CHOOSING_A_STAT: readonly MothershipClass[] = [
  'android',
  'scientist',
];

export const MothershipCharacterSheetSchema =
  MothershipCharacterSheetBaseSchema.superRefine((sheet, ctx) => {
    const choosesStat = CLASSES_CHOOSING_A_STAT.includes(sheet.class);
    const hasChoice = sheet.creationChoices?.adjustedStat !== undefined;

    if (choosesStat && !hasChoice) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['creationChoices', 'adjustedStat'],
        message:
          `A ${sheet.class} adjusts one Stat of the player's choosing, so the ` +
          'chosen Stat must be recorded — without it the starting ceilings ' +
          'cannot be reconciled against the creation rolls.',
      });
    }

    if (!choosesStat && hasChoice) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['creationChoices', 'adjustedStat'],
        message:
          `A ${sheet.class}'s adjustments are entirely fixed, so no Stat is ` +
          'chosen at creation.',
      });
    }
  });

export type MothershipCharacterSheet = z.infer<
  typeof MothershipCharacterSheetBaseSchema
>;
