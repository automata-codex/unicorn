import { describe, expect, it } from 'vitest';

import { resolveMothershipSkills } from './character-skills';

const skills = [
  { skill: 'Zero-G', tier: 'trained' as const },
  { skill: 'Piloting', tier: 'expert' as const },
  { skill: 'Command', tier: 'master' as const },
];

describe('resolveMothershipSkills', () => {
  it('returns nothing for an entity with no state or no skills', () => {
    expect(resolveMothershipSkills({})).toEqual([]);
    expect(
      resolveMothershipSkills({ characterState: { skills: [], conditions: [] } }),
    ).toEqual([]);
  });

  it('grants each tier its bonus, in stored order', () => {
    expect(
      resolveMothershipSkills({ characterState: { skills, conditions: [] } }),
    ).toEqual([
      { skill: 'Zero-G', tier: 'trained', bonus: 10, suppressed: false },
      { skill: 'Piloting', tier: 'expert', bonus: 15, suppressed: false },
      { skill: 'Command', tier: 'master', bonus: 20, suppressed: false },
    ]);
  });

  /**
   * The assertion `loss_of_confidence` has never been able to make. The
   * Condition has existed since M7.6 and nothing wrote a skill for it to
   * suppress, so it could be granted and could never do anything.
   */
  it('zeroes the bonus of the skill loss_of_confidence names, and only that one', () => {
    const resolved = resolveMothershipSkills({
      characterState: {
        skills,
        conditions: [
          { condition: 'loss_of_confidence', parameter: 'Piloting' },
        ],
      },
    });

    expect(resolved[1]).toEqual({
      skill: 'Piloting',
      tier: 'expert',
      bonus: 0,
      suppressed: true,
    });
    expect(resolved.filter((s) => s.suppressed)).toHaveLength(1);
  });

  it('retains the tier when suppressed — the training is not lost, the bonus is', () => {
    const [resolved] = resolveMothershipSkills({
      characterState: {
        skills: [{ skill: 'Hacking', tier: 'master' }],
        conditions: [{ condition: 'loss_of_confidence', parameter: 'Hacking' }],
      },
    });
    expect(resolved.tier).toBe('master');
    expect(resolved.bonus).toBe(0);
  });

  it('suppresses nothing when the condition carries no parameter', () => {
    const resolved = resolveMothershipSkills({
      characterState: {
        skills,
        conditions: [{ condition: 'loss_of_confidence' }],
      },
    });
    expect(resolved.every((s) => !s.suppressed)).toBe(true);
  });

  it('ignores conditions that suppress nothing', () => {
    const resolved = resolveMothershipSkills({
      characterState: {
        skills,
        conditions: [{ condition: 'frightened', parameter: 'the signal' }],
      },
    });
    expect(resolved.every((s) => !s.suppressed)).toBe(true);
  });
});
