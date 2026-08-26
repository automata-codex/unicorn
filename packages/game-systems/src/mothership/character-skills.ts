import {
  MOTHERSHIP_SKILL_BONUS,
  suppressedSkills,
  type MothershipCharacterState,
  type MothershipSkillEntry,
  type MothershipSkillTier,
} from './character-state.schema';
import { CREW_ROLE_SKILLS, type MothershipCrewRole } from './crew-roles';

/**
 * A skill as it applies right now: the tier the character holds, and the bonus
 * it actually grants after Conditions are taken into account.
 */
export interface ResolvedMothershipSkill {
  skill: string;
  tier: MothershipSkillTier;
  /** `0` when suppressed — the tier is retained, the bonus is not. */
  bonus: number;
  suppressed: boolean;
}

/**
 * The skills an entity can bring to a check, with suppression already applied.
 *
 * **One reader for every consumer.** `MOTHERSHIP_SKILL_BONUS`, the state
 * snapshot render, and `loss_of_confidence` each need "what does this entity
 * know, and what is it worth"; answering that in three places is three chances
 * to forget the Condition. Panic `08` suppresses a skill's bonus for the life
 * of the Condition and records which skill in its own `parameter`
 * (`character-state.schema.ts`), so suppression is derived here rather than
 * stored — the alternative is one fact in two places, free to disagree, with
 * clearing the Condition obliged to remember both.
 *
 * Until 018 nothing called `suppressedSkills` with a non-empty list, because
 * nothing ever wrote a skill: `characterState.skills` has existed since M7.6
 * and had no writer, which made `loss_of_confidence` inert by construction.
 *
 * **The options object is deliberate.** A Contractor's skills come from its
 * `crewRole` rather than from stored state (`ADR-0100`), and that branch lands
 * behind this same signature — so the shape takes a bag rather than a single
 * argument to keep call sites stable when it does.
 *
 * Order is the stored order, not sorted: a character sheet lists skills in the
 * order they were taken, and re-sorting would lose the progression.
 */
export function resolveMothershipSkills(args: {
  characterState?: Pick<MothershipCharacterState, 'skills' | 'conditions'>;
  /** A Contractor's role. Its chain is derived here, never stored. */
  entity?: { crewRole?: MothershipCrewRole };
}): ResolvedMothershipSkill[] {
  const state = args.characterState;

  /*
   * A player's skills are stored because a player *chose* them and nothing can
   * recompute a choice; a Contractor's are arithmetic over `crewRole`. Two
   * different kinds of fact, one reader — so `MOTHERSHIP_SKILL_BONUS`, the
   * render and `loss_of_confidence` each keep a single implementation, and
   * suppression works on a Contractor for free.
   *
   * Stored skills win where an entity somehow has both: a written record beats
   * a derivation, and an NPC with stored skills has had them written
   * deliberately.
   */
  const held: MothershipSkillEntry[] =
    state && state.skills.length > 0
      ? state.skills
      : args.entity?.crewRole
        ? CREW_ROLE_SKILLS[args.entity.crewRole]
        : [];

  if (held.length === 0) return [];

  const suppressed = suppressedSkills(state ?? { conditions: [] });

  return held.map((entry) => {
    const isSuppressed = suppressed.has(entry.skill);
    return {
      skill: entry.skill,
      tier: entry.tier,
      bonus: isSuppressed ? 0 : MOTHERSHIP_SKILL_BONUS[entry.tier],
      suppressed: isSuppressed,
    };
  });
}
