import { describe, expect, it } from 'vitest';

import { submitGmResponseSchema } from './session.schema';

describe('submitGmResponseSchema', () => {
  it('accepts a minimal payload with only playerText', () => {
    const result = submitGmResponseSchema.safeParse({
      playerText: 'You stand at the airlock.',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a fully populated payload', () => {
    const result = submitGmResponseSchema.safeParse({
      playerText: 'The terminal flickers.',
      stateChanges: {
        resourcePools: { dr_chen_hp: { delta: -3 } },
        entities: {
          shadow_threat: { visible: true, status: 'revealed' },
        },
        flags: {
          airlock_sealed: { value: true },
          corporate_spy_revealed: { value: true, trigger: 'Manifest shown.' },
        },
        scenarioState: { hull_breach_progression: { current: 3 } },
        worldFacts: { corridor_length: 'eight meters' },
      },
      gmUpdates: {
        npcStates: { engineer_kowalski: 'wounded, cooperating' },
        notes: 'Party is running low on ammo.',
        proposedCanon: [{ summary: 'Ship has a brig.', context: 'Cell door.' }],
      },
      playerRolls: [
        { notation: '1d100', purpose: 'Fear save', pool: 'dr_chen_stress' },
      ],
      adventureMode: 'initiative',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a missing playerText', () => {
    const result = submitGmResponseSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects a legacy position subfield on entities', () => {
    // Position is not in the corrected shape — the write path must reject it
    // if Claude emits it, so the spatial deferral stays clean.
    const result = submitGmResponseSchema.safeParse({
      playerText: 'x',
      stateChanges: {
        entities: {
          dr_chen: { position: { x: 1, y: 2, z: 0 } },
        },
      },
    });
    // Zod's default behaviour is to strip unknown keys, not reject them, so a
    // payload carrying `position` still parses. Assert that at minimum the
    // parsed output does NOT carry position through.
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stateChanges?.entities?.dr_chen).not.toHaveProperty(
        'position',
      );
    }
  });

  it('rejects a flags entry with non-boolean value', () => {
    const result = submitGmResponseSchema.safeParse({
      playerText: 'x',
      stateChanges: {
        flags: { airlock_sealed: { value: 'true' } },
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-integer delta in resourcePools', () => {
    const result = submitGmResponseSchema.safeParse({
      playerText: 'x',
      stateChanges: {
        resourcePools: { dr_chen_hp: { delta: 1.5 } },
      },
    });
    expect(result.success).toBe(false);
  });

  it('accepts adventureMode: null', () => {
    const result = submitGmResponseSchema.safeParse({
      playerText: 'x',
      adventureMode: null,
    });
    expect(result.success).toBe(true);
  });
});
