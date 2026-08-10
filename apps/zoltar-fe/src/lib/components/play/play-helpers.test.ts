import { describe, expect, it } from 'vitest';

import {
  applyStatusDelta,
  type CampaignStateData,
  type CharacterStatus,
  classifySendError,
  deriveCharacterStatus,
  formatThresholdLine,
  seedMessagesWithOpeningNarration,
  stampPendingPlayerTurn,
} from './play-helpers';

import type { MessageWire } from './timeline';

function stateWith(overrides: Partial<CampaignStateData>): CampaignStateData {
  return {
    resourcePools: {},
    entities: {},
    flags: {},
    scenarioState: {},
    worldFacts: {},
    schemaVersion: 1,
    ...overrides,
  };
}

describe('deriveCharacterStatus', () => {
  it('returns pool values when present', () => {
    const status = deriveCharacterStatus({
      state: stateWith({
        resourcePools: {
          dr_chen_hp: { current: 7, max: 10 },
          dr_chen_stress: { current: 2, max: 20 },
        },
      }),
      playerEntityId: 'dr_chen',
      fallbackMaxHp: 10,
      fallbackMaxStress: 20,
    });
    expect(status.hp).toEqual({ current: 7, max: 10 });
    expect(status.stress).toEqual({ current: 2, max: 20 });
    expect(status.conditions).toBe('');
  });

  it('falls back to character-sheet maxes when pool max is null', () => {
    const status = deriveCharacterStatus({
      state: stateWith({
        resourcePools: {
          dr_chen_hp: { current: 9, max: null },
        },
      }),
      playerEntityId: 'dr_chen',
      fallbackMaxHp: 10,
      fallbackMaxStress: 20,
    });
    expect(status.hp).toEqual({ current: 9, max: 10 });
    expect(status.stress).toEqual({ current: 0, max: 20 });
  });

  it('surfaces npcState as conditions when the entity carries one', () => {
    const status = deriveCharacterStatus({
      state: stateWith({
        entities: {
          dr_chen: {
            visible: true,
            status: 'alive',
            npcState: 'Bleeding, panicked',
          },
        },
      }),
      playerEntityId: 'dr_chen',
      fallbackMaxHp: 10,
      fallbackMaxStress: 20,
    });
    expect(status.conditions).toBe('Bleeding, panicked');
  });
});

describe('applyStatusDelta', () => {
  const previous: CharacterStatus = {
    hp: { current: 10, max: 10 },
    stress: { current: 0, max: 20 },
    conditions: '',
  };

  it('overwrites HP when applied.resourcePools carries the player HP key', () => {
    const next = applyStatusDelta({
      previous,
      playerEntityId: 'dr_chen',
      applied: {
        resourcePools: { dr_chen_hp: { current: 6, max: 10 } },
      },
    });
    expect(next.hp).toEqual({ current: 6, max: 10 });
    expect(next.stress).toEqual(previous.stress);
  });

  it('preserves previous values when the applied map does not mention them', () => {
    const next = applyStatusDelta({
      previous,
      playerEntityId: 'dr_chen',
      applied: { resourcePools: {} },
    });
    expect(next).toEqual(previous);
  });

  it('uses the previous max when applied pool max is null', () => {
    const next = applyStatusDelta({
      previous,
      playerEntityId: 'dr_chen',
      applied: {
        resourcePools: { dr_chen_hp: { current: 4, max: null } },
      },
    });
    expect(next.hp).toEqual({ current: 4, max: 10 });
  });

  it('updates conditions when the applied entity carries a new npcState', () => {
    const next = applyStatusDelta({
      previous,
      playerEntityId: 'dr_chen',
      applied: {
        entities: {
          dr_chen: { visible: true, status: 'alive', npcState: 'Hunted' },
        },
      },
    });
    expect(next.conditions).toBe('Hunted');
  });
});

describe('formatThresholdLine', () => {
  it('capitalizes the entity id and unsnakes the effect', () => {
    const line = formatThresholdLine({
      pool: 'dr_chen_hp',
      finalValue: 0,
      effect: 'death_save_required',
    });
    expect(line).toBe('Dr Chen Hp at 0 — death save required');
  });
});

describe('classifySendError', () => {
  it('returns null on a 2xx response', () => {
    expect(classifySendError({ status: 200 })).toBeNull();
  });

  it('maps 409 to precondition', () => {
    expect(classifySendError({ status: 409 })).toBe('precondition');
  });

  it('maps 502 + body.error = gm_correction_failed to the distinct code', () => {
    expect(
      classifySendError({
        status: 502,
        body: { error: 'gm_correction_failed' },
      }),
    ).toBe('gm_correction_failed');
  });

  it('maps 502 without the distinct error code to gm_unavailable', () => {
    expect(classifySendError({ status: 502, body: null })).toBe(
      'gm_unavailable',
    );
  });

  it('maps anything else to unknown', () => {
    expect(classifySendError({ status: 500 })).toBe('unknown');
  });
});

describe('seedMessagesWithOpeningNarration', () => {
  const real: MessageWire = {
    id: 'm1',
    role: 'user',
    content: 'I open the door.',
    createdAt: '2026-01-01T00:00:00.000Z',
    turnNumber: 1,
  };

  it('prepends the opening narration ahead of existing messages', () => {
    const result = seedMessagesWithOpeningNarration(
      [real],
      'Amber lights pulse overhead.',
    );
    expect(result).toEqual([
      {
        id: 'opening',
        role: 'assistant',
        content: 'Amber lights pulse overhead.',
        createdAt: new Date(0).toISOString(),
        turnNumber: null,
      },
      real,
    ]);
  });

  it('leaves the opening narration unnumbered — it precedes turn 1', () => {
    // Turn 1 is the player's first action, in the review report as well as
    // here. Numbering the opening narration would offset every later note.
    const [opening] = seedMessagesWithOpeningNarration([real], 'Amber lights.');
    expect(opening.turnNumber).toBeNull();
  });

  it('prepends even when bootstrapMessages is empty (first-ever load)', () => {
    const result = seedMessagesWithOpeningNarration(
      [],
      'Amber lights pulse overhead.',
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'opening', role: 'assistant' });
  });

  it('returns bootstrapMessages unchanged when openingNarration is null', () => {
    expect(seedMessagesWithOpeningNarration([real], null)).toEqual([real]);
  });

  it('returns bootstrapMessages unchanged when openingNarration is undefined', () => {
    expect(seedMessagesWithOpeningNarration([real], undefined)).toEqual([real]);
  });

  it('returns bootstrapMessages unchanged when openingNarration is an empty string', () => {
    expect(seedMessagesWithOpeningNarration([real], '')).toEqual([real]);
  });

  it('does not mutate the input array', () => {
    const input = [real];
    seedMessagesWithOpeningNarration(input, 'x');
    expect(input).toEqual([real]);
  });
});

describe('stampPendingPlayerTurn', () => {
  const msg = (
    id: string,
    role: MessageWire['role'],
    turnNumber: number | null,
  ): MessageWire => ({
    id,
    role,
    content: id,
    createdAt: '2026-01-01T00:00:00.000Z',
    turnNumber,
  });

  it('numbers the optimistic player message once the turn returns', () => {
    const result = stampPendingPlayerTurn(
      [
        msg('p1', 'user', 1),
        msg('gm1', 'assistant', 1),
        msg('local-2', 'user', null),
      ],
      2,
    );
    expect(result.map((m) => m.turnNumber)).toEqual([1, 1, 2]);
  });

  it('leaves already-numbered messages alone', () => {
    const input = [msg('p1', 'user', 1), msg('gm1', 'assistant', 1)];
    expect(stampPendingPlayerTurn(input, 2)).toBe(input);
  });

  it('is a no-op when the turn had no player message (dice auto-advance)', () => {
    // The trailing message is the previous turn's GM reply. Without the
    // trailing-only rule this would reach back and relabel an earlier turn.
    const input = [msg('p1', 'user', 1), msg('gm1', 'assistant', 1)];
    const result = stampPendingPlayerTurn(input, 2);
    expect(result.map((m) => m.turnNumber)).toEqual([1, 1]);
  });

  it('numbers a failed attempt and its retry with the same turn', () => {
    // A turn that errors leaves its optimistic message in the log. Both it
    // and the retry belong to the turn that finally succeeded — which is how
    // the backend numbers the orphaned rows it finds on reload.
    const result = stampPendingPlayerTurn(
      [
        msg('gm1', 'assistant', 1),
        msg('local-1', 'user', null),
        msg('local-2', 'user', null),
      ],
      2,
    );
    expect(result.map((m) => m.turnNumber)).toEqual([1, 2, 2]);
  });

  it('stops at the first numbered message rather than scanning the whole log', () => {
    const result = stampPendingPlayerTurn(
      [
        msg('p1', 'user', null),
        msg('gm1', 'assistant', 1),
        msg('local-2', 'user', null),
      ],
      2,
    );
    // The leading unnumbered player message belongs to an earlier turn that
    // never completed; it is not this turn's and must stay unlabelled.
    expect(result.map((m) => m.turnNumber)).toEqual([null, 1, 2]);
  });

  it('returns the same array when there is nothing to stamp', () => {
    const input: MessageWire[] = [];
    expect(stampPendingPlayerTurn(input, 1)).toBe(input);
  });

  it('does not mutate the input array', () => {
    const input = [msg('local-1', 'user', null)];
    stampPendingPlayerTurn(input, 3);
    expect(input[0].turnNumber).toBeNull();
  });
});
