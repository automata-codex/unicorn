import { z } from 'zod';

import type { MothershipSkillEntry } from './character-state.schema';

/**
 * The twenty crew roles a Contractor NPC may hold (`ADR-0100`).
 *
 * **A Zoltar house rule, invented from the Contractors rules rather than
 * applied from them.** PSG Contractors resolve every check on a single Instinct
 * score with no skill layer; the role table below, the rolled Instinct, and the
 * seniority adjustment are three separate deviations. Nothing here is sourced
 * content, and nothing derived from it should be phrased as though it were.
 *
 * An enum rather than a free-text tag: a near-miss string would not error, it
 * would silently miss the lookup and quietly revert the NPC to Instinct-only.
 */
export const MothershipCrewRoleEnum = z.enum([
  'captain',
  'executive_officer',
  'pilot',
  'navigator',
  'chief_engineer',
  'engineer',
  'machinist_mechanic',
  'life_support_tech',
  'doctor',
  'medic',
  'scientist',
  'geologist',
  'miner',
  'xenobiologist',
  'comms_officer',
  'corporate_liaison',
  'counselor',
  'security_chief',
  'security_officer',
  'cargo_handler',
]);

export type MothershipCrewRole = z.infer<typeof MothershipCrewRoleEnum>;

/** A player Stat is `2d10 + 25`; Contractor Instinct borrows the shape. */
const INSTINCT_BASE = 25;

type SeniorityTier = 'senior' | 'skilled' | 'unskilled';

/**
 * Seniority rather than twenty bespoke numbers — twenty numbers would be twenty
 * separate inventions, while three tiers reuse the senior/junior pairing the
 * skill chains already imply (Chief Engineer/Engineer, Doctor/Medic, Security
 * Chief/Security Officer).
 *
 * A role-less NPC gets `+0` and is deliberately not folded into `unskilled`:
 * Miner and Cargo Handler are *roles* that need no specialist training, whereas
 * an NPC with no role is not crew at all.
 */
const SENIORITY_ADJUSTMENT: Record<SeniorityTier, number> = {
  senior: 15,
  skilled: 10,
  unskilled: 5,
};

const ROLE_SENIORITY: Record<MothershipCrewRole, SeniorityTier> = {
  captain: 'senior',
  executive_officer: 'senior',
  chief_engineer: 'senior',
  doctor: 'senior',
  security_chief: 'senior',

  pilot: 'skilled',
  navigator: 'skilled',
  engineer: 'skilled',
  medic: 'skilled',
  scientist: 'skilled',
  geologist: 'skilled',
  xenobiologist: 'skilled',
  comms_officer: 'skilled',
  corporate_liaison: 'skilled',
  counselor: 'skilled',
  machinist_mechanic: 'skilled',
  life_support_tech: 'skilled',
  security_officer: 'skilled',

  miner: 'unskilled',
  cargo_handler: 'unskilled',
};

/**
 * Role → skill chain, Trained → Expert → Master (`ADR-0100`).
 *
 * **Derived, never stored.** `crewRole` is the input and this is arithmetic
 * over it; persisting the chain would repeat the `maxHp` duplication M7.6
 * removed — one fact in two places, free to diverge the moment this table is
 * edited.
 *
 * Editing it changes what the Warden sees for frozen eval fixtures whose files
 * did not change, so `corpusVersion` cannot see the edit and `assemblyHash`
 * must: `ASSEMBLY_PROBE` carries a `crewRole` Contractor and a golden renders
 * every row below.
 */
export const CREW_ROLE_SKILLS: Record<
  MothershipCrewRole,
  MothershipSkillEntry[]
> = {
  captain: [
    { skill: 'Zero-G', tier: 'trained' },
    { skill: 'Piloting', tier: 'expert' },
    { skill: 'Command', tier: 'master' },
  ],
  executive_officer: [
    { skill: 'Zero-G', tier: 'trained' },
    { skill: 'Piloting', tier: 'expert' },
    { skill: 'Command', tier: 'master' },
  ],
  pilot: [
    { skill: 'Zero-G', tier: 'trained' },
    { skill: 'Piloting', tier: 'expert' },
  ],
  navigator: [
    { skill: 'Zero-G', tier: 'trained' },
    { skill: 'Piloting', tier: 'expert' },
    { skill: 'Hyperspace', tier: 'master' },
  ],
  chief_engineer: [
    { skill: 'Industrial Equipment', tier: 'trained' },
    { skill: 'Mechanical Repair', tier: 'expert' },
    { skill: 'Engineering', tier: 'master' },
    { skill: 'Jury-Rigging', tier: 'trained' },
  ],
  engineer: [
    { skill: 'Industrial Equipment', tier: 'trained' },
    { skill: 'Mechanical Repair', tier: 'expert' },
  ],
  machinist_mechanic: [
    { skill: 'Jury-Rigging', tier: 'trained' },
    { skill: 'Mechanical Repair', tier: 'expert' },
  ],
  life_support_tech: [
    { skill: 'Industrial Equipment', tier: 'trained' },
    { skill: 'Botany', tier: 'trained' },
    { skill: 'Ecology', tier: 'expert' },
  ],
  doctor: [
    { skill: 'Zoology', tier: 'trained' },
    { skill: 'Field Medicine', tier: 'expert' },
    { skill: 'Surgery', tier: 'master' },
  ],
  medic: [
    { skill: 'Zoology', tier: 'trained' },
    { skill: 'Field Medicine', tier: 'expert' },
  ],
  scientist: [
    { skill: 'Mathematics', tier: 'trained' },
    { skill: 'Physics', tier: 'expert' },
  ],
  geologist: [
    { skill: 'Geology', tier: 'trained' },
    { skill: 'Asteroid Mining', tier: 'expert' },
  ],
  miner: [
    { skill: 'Geology', tier: 'trained' },
    { skill: 'Asteroid Mining', tier: 'expert' },
    { skill: 'Zero-G', tier: 'trained' },
  ],
  xenobiologist: [
    { skill: 'Zoology', tier: 'trained' },
    { skill: 'Pathology', tier: 'expert' },
    { skill: 'Exobiology', tier: 'master' },
  ],
  comms_officer: [
    { skill: 'Computers', tier: 'trained' },
    { skill: 'Hacking', tier: 'expert' },
  ],
  corporate_liaison: [
    { skill: 'Linguistics', tier: 'trained' },
    { skill: 'Psychology', tier: 'expert' },
    { skill: 'Computers', tier: 'trained' },
  ],
  counselor: [
    { skill: 'Linguistics', tier: 'trained' },
    { skill: 'Psychology', tier: 'expert' },
  ],
  security_chief: [
    { skill: 'Military Training', tier: 'trained' },
    { skill: 'Firearms', tier: 'expert' },
    { skill: 'Command', tier: 'master' },
  ],
  security_officer: [
    { skill: 'Military Training', tier: 'trained' },
    { skill: 'Firearms', tier: 'expert' },
  ],
  cargo_handler: [
    { skill: 'Zero-G', tier: 'trained' },
    { skill: 'Athletics', tier: 'trained' },
  ],
};

/** The seniority adjustment a role contributes to Instinct; `0` for none. */
export function crewRoleInstinctAdjustment(
  crewRole: MothershipCrewRole | undefined,
): number {
  if (!crewRole) return 0;
  return SENIORITY_ADJUSTMENT[ROLE_SENIORITY[crewRole]];
}

/**
 * A Contractor's Instinct: `2d10 + 25 + role adjustment`.
 *
 * The dice are stored on the entity because a roll is an input nothing can
 * recompute; the `+25` and the adjustment are derived here and stored nowhere,
 * the same split `creationRolls` uses for a player character.
 *
 * Returns `null` for an entity with no roll — a `threat`, or an NPC written
 * before this existed. Callers render nothing rather than inventing a number.
 */
export function deriveMothershipInstinct(entity: {
  instinctRoll?: number[];
  crewRole?: MothershipCrewRole;
}): number | null {
  if (!entity.instinctRoll || entity.instinctRoll.length === 0) return null;
  const dice = entity.instinctRoll.reduce((total, die) => total + die, 0);
  return dice + INSTINCT_BASE + crewRoleInstinctAdjustment(entity.crewRole);
}
