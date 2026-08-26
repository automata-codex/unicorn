import { describe, expect, it } from 'vitest';

import { CreateCharacterRequestSchema } from './create-character.dto';

const sheet = {
  entityId: 'vasquez',
  name: 'Vasquez',
  class: 'marine' as const,
  creationRolls: {
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
  },
};

describe('CreateCharacterRequestSchema', () => {
  it('defaults startingSkills to an empty list', () => {
    const parsed = CreateCharacterRequestSchema.parse({ sheet });
    expect(parsed.startingSkills).toEqual([]);
  });

  it('accepts skills at every tier', () => {
    const parsed = CreateCharacterRequestSchema.parse({
      sheet,
      startingSkills: [
        { skill: 'Zero-G', tier: 'trained' },
        { skill: 'Piloting', tier: 'expert' },
        { skill: 'Command', tier: 'master' },
      ],
    });
    expect(parsed.startingSkills).toHaveLength(3);
  });

  /**
   * Shape, tier and no-duplicates is the whole of what is enforceable. The
   * skill list and its prerequisite graph are TKG content and do not ship, so a
   * free-text skill name is accepted on purpose — see the DTO's own comment.
   */
  it('accepts a skill name the repo has never heard of', () => {
    expect(() =>
      CreateCharacterRequestSchema.parse({
        sheet,
        startingSkills: [{ skill: 'Xenoyodelling', tier: 'trained' }],
      }),
    ).not.toThrow();
  });

  it('rejects the same skill listed twice, case-insensitively', () => {
    const result = CreateCharacterRequestSchema.safeParse({
      sheet,
      startingSkills: [
        { skill: 'Zero-G', tier: 'trained' },
        { skill: 'zero-g', tier: 'master' },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown tier', () => {
    const result = CreateCharacterRequestSchema.safeParse({
      sheet,
      startingSkills: [{ skill: 'Zero-G', tier: 'legendary' }],
    });
    expect(result.success).toBe(false);
  });

  it('still rejects an invalid sheet — an android with no chosen Stat', () => {
    const result = CreateCharacterRequestSchema.safeParse({
      sheet: { ...sheet, class: 'android' },
    });
    expect(result.success).toBe(false);
  });
});
