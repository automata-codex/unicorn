import {
  MothershipCharacterSheetSchema,
  MothershipSkillEntrySchema,
} from '@uv/game-systems';
import { z } from 'zod';

/**
 * Creating a character writes to two places, so the request carries two things.
 *
 * The **sheet** is immutable creation data and lands on `character_sheet`. The
 * **starting skills** are play state and land in `campaign_state.characterState`
 * — M7.6 moved skills off the sheet precisely because they change during play
 * and the sheet has no write path from a turn.
 *
 * A wrapper rather than extra fields on the sheet body: putting `startingSkills`
 * alongside the sheet's own keys would read as though it were sheet data, which
 * is the confusion M7.6 removed.
 *
 * **No prerequisite-chain validation, deliberately.** The skill list and its
 * Trained → Expert → Master graph are TKG content on the same footing as the
 * Wounds Table and do not ship in this repo (`character-state.schema.ts`, and
 * the loadout tables take the same line). What is enforceable here is shape,
 * tier, and that the player has not listed one skill twice — so that is what is
 * enforced. Shipping a graph a self-hoster cannot install would be worse than
 * shipping none.
 */
export const CreateCharacterRequestSchema = z.object({
  sheet: MothershipCharacterSheetSchema,
  startingSkills: z
    .array(MothershipSkillEntrySchema)
    .max(20)
    .default([])
    .superRefine((skills, ctx) => {
      const seen = new Set<string>();
      for (const entry of skills) {
        const key = entry.skill.trim().toLowerCase();
        if (seen.has(key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              `"${entry.skill}" is listed twice. A skill is held at one tier; ` +
              'a higher tier already implies the ones below it.',
          });
          return;
        }
        seen.add(key);
      }
    }),
});

export type CreateCharacterRequestDto = z.infer<
  typeof CreateCharacterRequestSchema
>;
