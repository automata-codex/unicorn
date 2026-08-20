import { describe, expect, it } from 'vitest';

import { resolveMothershipSkills } from './character-skills';
import {
  CREW_ROLE_SKILLS,
  MothershipCrewRoleEnum,
  crewRoleInstinctAdjustment,
  deriveMothershipInstinct,
} from './crew-roles';

const ROLES = MothershipCrewRoleEnum.options;

describe('CREW_ROLE_SKILLS', () => {
  it('covers every role in the enum with at least one skill', () => {
    for (const role of ROLES) {
      expect(CREW_ROLE_SKILLS[role]?.length, role).toBeGreaterThan(0);
    }
  });

  it('never lists the same skill twice within one role', () => {
    for (const role of ROLES) {
      const names = CREW_ROLE_SKILLS[role].map((s) => s.skill);
      expect(new Set(names).size, role).toBe(names.length);
    }
  });

  /**
   * ADR-0100: the senior half of each pair gets the full chain, the junior half
   * the same chain truncated. Asserted because it is the structure the seniority
   * tiers are justified by, and a later edit could silently break the pairing.
   */
  it.each([
    ['chief_engineer', 'engineer'],
    ['doctor', 'medic'],
    ['security_chief', 'security_officer'],
  ] as const)('gives %s a longer chain than %s', (senior, junior) => {
    expect(CREW_ROLE_SKILLS[senior].length).toBeGreaterThan(
      CREW_ROLE_SKILLS[junior].length,
    );
  });
});

describe('crewRoleInstinctAdjustment', () => {
  it('applies the seniority tiers from ADR-0100', () => {
    expect(crewRoleInstinctAdjustment('captain')).toBe(15);
    expect(crewRoleInstinctAdjustment('pilot')).toBe(10);
    expect(crewRoleInstinctAdjustment('miner')).toBe(5);
  });

  /**
   * Deliberately distinct from `unskilled`. Miner and Cargo Handler are roles
   * that need no specialist training; an NPC with no role is not crew at all.
   */
  it('gives a role-less NPC nothing, not the unskilled tier', () => {
    expect(crewRoleInstinctAdjustment(undefined)).toBe(0);
  });

  it('assigns every role a tier', () => {
    for (const role of ROLES) {
      expect([5, 10, 15], role).toContain(crewRoleInstinctAdjustment(role));
    }
  });
});

describe('deriveMothershipInstinct', () => {
  it('is 2d10 + 25 + the role adjustment', () => {
    expect(
      deriveMothershipInstinct({ instinctRoll: [7, 4], crewRole: 'captain' }),
    ).toBe(51);
    expect(deriveMothershipInstinct({ instinctRoll: [7, 4] })).toBe(36);
  });

  /** A threat, or an NPC written before this existed. Render nothing. */
  it('returns null with no roll rather than inventing one', () => {
    expect(deriveMothershipInstinct({})).toBeNull();
    expect(deriveMothershipInstinct({ instinctRoll: [] })).toBeNull();
    expect(deriveMothershipInstinct({ crewRole: 'captain' })).toBeNull();
  });
});

describe('resolveMothershipSkills — the Contractor branch', () => {
  it('derives a Contractor chain from crewRole, with tier bonuses', () => {
    expect(resolveMothershipSkills({ entity: { crewRole: 'pilot' } })).toEqual([
      { skill: 'Zero-G', tier: 'trained', bonus: 10, suppressed: false },
      { skill: 'Piloting', tier: 'expert', bonus: 15, suppressed: false },
    ]);
  });

  it('returns nothing for an NPC with no role', () => {
    expect(resolveMothershipSkills({ entity: {} })).toEqual([]);
  });

  /** The unification's payoff: one reader, so suppression works for NPCs too. */
  it('suppresses a derived Contractor skill via loss_of_confidence', () => {
    const resolved = resolveMothershipSkills({
      entity: { crewRole: 'pilot' },
      characterState: {
        skills: [],
        conditions: [{ condition: 'loss_of_confidence', parameter: 'Piloting' }],
      },
    });
    expect(resolved.find((s) => s.skill === 'Piloting')).toEqual({
      skill: 'Piloting',
      tier: 'expert',
      bonus: 0,
      suppressed: true,
    });
  });

  it('prefers stored skills over the derivation when an entity has both', () => {
    const resolved = resolveMothershipSkills({
      entity: { crewRole: 'pilot' },
      characterState: {
        skills: [{ skill: 'Hacking', tier: 'master' }],
        conditions: [],
      },
    });
    expect(resolved.map((s) => s.skill)).toEqual(['Hacking']);
  });
});
