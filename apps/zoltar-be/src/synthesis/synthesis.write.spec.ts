import { describe, expect, it } from 'vitest';

import {
  buildCampaignStateData,
  buildEntityMap,
  buildGmContextBlob,
  buildGridEntityRows,
  buildResourcePools,
  SynthesisWriteValidationError,
  validateSubmitGmContextForWrite,
} from './synthesis.write';

import type { SubmitGmContext } from './synthesis.schema';

function makeInput(overrides: Partial<SubmitGmContext> = {}): SubmitGmContext {
  return {
    openingNarration: 'Amber lights pulse.',
    narrative: {
      location: 'loc',
      atmosphere: 'atmo',
      npcAgendas: {},
      hiddenTruth: 'truth',
      oracleConnections: 'conn',
    },
    structured: {
      entities: [
        {
          id: 'dr_chen',
          type: 'npc',
          visible: true,
          tags: ['corporate'],
          startingPosition: { x: 3, y: 4, z: 0 },
        },
        {
          id: 'shadow_threat',
          type: 'threat',
          visible: false,
          tags: [],
        },
      ],
      flags: {
        adventure_complete: {
          value: false,
          trigger: 'Escape the vessel.',
        },
      },
      initialState: {
        'dr_chen.hp': { current: 10, max: 10 },
      },
    },
    ...overrides,
  };
}

describe('validateSubmitGmContextForWrite', () => {
  it('accepts a valid input', () => {
    expect(() => validateSubmitGmContextForWrite(makeInput())).not.toThrow();
  });

  it('rejects missing adventure_complete flag', () => {
    const input = makeInput();
    input.structured.flags = {};
    expect(() => validateSubmitGmContextForWrite(input)).toThrow(
      SynthesisWriteValidationError,
    );
  });

  it('rejects adventure_complete starting as true', () => {
    const input = makeInput();
    input.structured.flags.adventure_complete.value = true;
    expect(() => validateSubmitGmContextForWrite(input)).toThrow(
      /must start as/,
    );
  });

  it('accepts non-pool entries in initialState without throwing', () => {
    const input = makeInput();
    input.structured.initialState.current_deck = 'derelict_lower';
    expect(() => validateSubmitGmContextForWrite(input)).not.toThrow();
  });

  it('rejects duplicate entity ids', () => {
    const input = makeInput();
    input.structured.entities.push({
      id: 'dr_chen',
      type: 'feature',
      visible: true,
      tags: [],
    });
    expect(() => validateSubmitGmContextForWrite(input)).toThrow(
      /duplicate entity id/,
    );
  });
});

describe('buildResourcePools', () => {
  it('preserves existing pools on address conflict', () => {
    const existing = {
      vasquez: { hp: { current: 15, max: 15 } },
      dr_chen: { hp: { current: 1, max: 10 } },
    };
    const initialState = {
      'dr_chen.hp': { current: 10, max: 10 }, // should be ignored
      'crewman_wick.timer': { current: 4, max: 4 },
    };
    const result = buildResourcePools(existing, initialState, {
      playerEntityId: 'vasquez',
      knownEntityIds: ['dr_chen', 'crewman_wick'],
    });
    expect(result.pools.vasquez.hp).toEqual({ current: 15, max: 15 });
    expect(result.pools.dr_chen.hp).toEqual({ current: 1, max: 10 });
    expect(result.pools.crewman_wick.timer).toEqual({ current: 4, max: 4 });
    expect(result.skipped).toEqual([]);
  });

  it('adds a pool to an owner that already has one, keeping both', () => {
    // The deep-merge case. A per-owner overwrite would drop `hp` here.
    const existing = { vasquez: { hp: { current: 15, max: 15 } } };
    const result = buildResourcePools(
      existing,
      { 'vasquez.oxygen': { current: 6, max: 6 } },
      { playerEntityId: 'vasquez', knownEntityIds: [] },
    );
    expect(result.pools.vasquez).toEqual({
      hp: { current: 15, max: 15 },
      oxygen: { current: 6, max: 6 },
    });
  });

  it('returns a fresh object at both levels', () => {
    const existing = { vasquez: { hp: { current: 15, max: 15 } } };
    const result = buildResourcePools(
      existing,
      {},
      {
        playerEntityId: 'vasquez',
        knownEntityIds: [],
      },
    );
    expect(result.pools).not.toBe(existing);
    expect(result.pools.vasquez).not.toBe(existing.vasquez);
    // Writing into `result.pools` must not mutate `existing` at either level.
    result.pools.new_owner = { some_pool: { current: 1, max: 1 } };
    result.pools.vasquez.stress = { current: 2, max: null };
    expect(existing).not.toHaveProperty('new_owner');
    expect(existing.vasquez).not.toHaveProperty('stress');
  });

  it('drops a pool that re-spells the player id, and reports it as skipped', () => {
    // The M7.5 capture in miniature: the sheet says `lt_alvarez`, the model
    // emits `alvarez.*`. Nothing collides, so preservation alone lets both
    // spellings persist for one character.
    const existing = {
      lt_alvarez: {
        hp: { current: 20, max: 20 },
        stress: { current: 0, max: 3 },
      },
    };
    const initialState = {
      'alvarez.hp': { current: 20, max: 20 },
      'alvarez.stress': { current: 0, max: 3 },
    };
    const result = buildResourcePools(existing, initialState, {
      playerEntityId: 'lt_alvarez',
      knownEntityIds: ['burned_out_medic'],
    });
    expect(result.pools).toEqual(existing);
    expect(result.skipped.sort()).toEqual(['alvarez.hp', 'alvarez.stress']);
  });

  it('keeps NPC pools that share a pool name with a player pool', () => {
    const existing = { lt_alvarez: { hp: { current: 20, max: 20 } } };
    const result = buildResourcePools(
      existing,
      { 'burned_out_medic.hp': { current: 8, max: 8 } },
      { playerEntityId: 'lt_alvarez', knownEntityIds: ['burned_out_medic'] },
    );
    expect(result.pools.burned_out_medic).toHaveProperty('hp');
    expect(result.skipped).toEqual([]);
  });

  it('keeps _scenario pools naming no player pool', () => {
    // The legitimate unattached pools the impersonation check must not touch.
    const existing = { lt_alvarez: { hp: { current: 20, max: 20 } } };
    const result = buildResourcePools(
      existing,
      {
        '_scenario.station_power_reserve': { current: 4, max: 4 },
        '_scenario.contamination_spread_timer': { current: 6, max: 6 },
      },
      { playerEntityId: 'lt_alvarez', knownEntityIds: [] },
    );
    expect(result.pools._scenario).toHaveProperty('station_power_reserve');
    expect(result.pools._scenario).toHaveProperty('contamination_spread_timer');
    expect(result.skipped).toEqual([]);
  });

  it('skips a composite single-part key left over from the pre-M7.6 shape', () => {
    const result = buildResourcePools(
      {},
      { station_power_reserve: { current: 4, max: 4 } },
      { playerEntityId: 'vasquez', knownEntityIds: [] },
    );
    expect(result.pools).toEqual({});
    expect(result.skipped).toEqual(['station_power_reserve']);
  });

  it('skips an unrecognised leading-underscore owner', () => {
    const result = buildResourcePools(
      {},
      { '_station.power_reserve': { current: 4, max: 4 } },
      { playerEntityId: 'vasquez', knownEntityIds: [] },
    );
    expect(result.pools).toEqual({});
    expect(result.skipped).toEqual(['_station.power_reserve']);
  });
});

describe('buildEntityMap', () => {
  it('keys by entity id, rolling Instinct for npcs and not for threats', () => {
    const map = buildEntityMap(makeInput().structured.entities, () => [6, 3]);
    expect(map).toEqual({
      dr_chen: {
        visible: true,
        revealed: true,
        status: 'unknown',
        instinctRoll: [6, 3],
      },
      // `revealed` defaults to `visible` when the author omits it, so a threat
      // that starts hidden also starts undiscovered.
      shadow_threat: { visible: false, revealed: false, status: 'unknown' },
    });
  });

  /**
   * `SYNTHESIS_TOOLS` carries no `roll_dice`, so a number the model supplied
   * would be a fabrication rather than a roll. The tool schema omits the field
   * so Zod strips it — asserted here rather than trusted to the prompt, which
   * is the lesson `ADR-0097` records.
   */
  it('discards an instinctRoll the model tried to supply', () => {
    const input = makeInput();
    (input.structured.entities[0] as Record<string, unknown>).instinctRoll = [
      10, 10,
    ];

    const map = buildEntityMap(input.structured.entities, () => [1, 1]);
    expect(map.dr_chen.instinctRoll).toEqual([1, 1]);
  });

  it('carries a crewRole through, which the old field list would have dropped', () => {
    const input = makeInput();
    (input.structured.entities[0] as Record<string, unknown>).crewRole =
      'chief_engineer';

    const map = buildEntityMap(input.structured.entities, () => [6, 3]);
    expect(map.dr_chen.crewRole).toBe('chief_engineer');
  });
});

describe('buildCampaignStateData', () => {
  it('merges onto an existing row and satisfies MothershipCampaignStateSchema', () => {
    const existing = {
      schemaVersion: 1,
      resourcePools: { vasquez: { hp: { current: 15, max: 15 } } },
      entities: {
        vasquez: {
          visible: true,
          revealed: true,
          status: 'alive',
          npcState: 'alert',
        },
      },
      flags: { old_flag: { value: true, trigger: 'legacy' } },
      scenarioState: { oxygen: { current: 100, max: 100, note: '' } },
      worldFacts: { bridge_display: 'ERROR' },
    };
    const result = buildCampaignStateData(existing, makeInput(), 'vasquez')
      .data as {
      resourcePools: Record<string, Record<string, unknown>>;
      entities: Record<string, unknown>;
      flags: Record<string, unknown>;
      scenarioState: Record<string, unknown>;
      worldFacts: Record<string, unknown>;
    };
    expect(result.resourcePools.vasquez).toHaveProperty('hp');
    expect(result.resourcePools.dr_chen).toHaveProperty('hp');
    expect(result.entities).toHaveProperty('vasquez');
    expect(result.entities).toHaveProperty('dr_chen');
    // Flags come entirely from the new input — not merged with old.
    expect(result.flags).toHaveProperty('adventure_complete');
    expect(result.flags).not.toHaveProperty('old_flag');
    // ScenarioState carries through.
    expect(result.scenarioState).toHaveProperty('oxygen');
    // Existing worldFacts are preserved; new ones from input are merged.
    expect(result.worldFacts).toHaveProperty('bridge_display');
  });

  it('merges worldFacts from tool input onto existing worldFacts', () => {
    const existing = {
      schemaVersion: 1,
      resourcePools: {},
      entities: {},
      flags: {},
      scenarioState: {},
      worldFacts: { bridge_display: 'ERROR' },
    };
    const input = makeInput();
    input.structured.worldFacts = { current_deck: 'engineering_lower' };
    const result = buildCampaignStateData(existing, input, 'vasquez').data as {
      worldFacts: Record<string, string>;
    };
    expect(result.worldFacts).toEqual({
      bridge_display: 'ERROR',
      current_deck: 'engineering_lower',
    });
  });

  it('initializes to emptyMothershipState when no existing row', () => {
    const result = buildCampaignStateData(null, makeInput(), 'vasquez')
      .data as {
      resourcePools: Record<string, Record<string, unknown>>;
      scenarioState: Record<string, unknown>;
      worldFacts: Record<string, unknown>;
    };
    expect(result.resourcePools).toEqual({
      dr_chen: { hp: { current: 10, max: 10 } },
    });
    expect(result.scenarioState).toEqual({});
    expect(result.worldFacts).toEqual({});
  });
});

describe('buildGmContextBlob', () => {
  it('stores narrative, openingNarration, and the raw entities array', () => {
    const blob = buildGmContextBlob(makeInput()) as {
      openingNarration: string | null;
      narrative: { location: string };
      entities: Array<{ id: string }>;
    };
    expect(blob.openingNarration).toBe('Amber lights pulse.');
    expect(blob.narrative.location).toBe('loc');
    expect(blob.entities.map((e) => e.id)).toEqual([
      'dr_chen',
      'shadow_threat',
    ]);
  });

  it('writes null openingNarration when absent', () => {
    const input = makeInput();
    delete (input as { openingNarration?: string }).openingNarration;
    const blob = buildGmContextBlob(input) as { openingNarration: null };
    expect(blob.openingNarration).toBeNull();
  });

  it('persists structured.flags so the session snapshot can identify originals', () => {
    const blob = buildGmContextBlob(makeInput()) as {
      structured: {
        flags: Record<string, { value: boolean; trigger: string }>;
      };
    };
    expect(blob.structured.flags).toEqual({
      adventure_complete: {
        value: false,
        trigger: 'Escape the vessel.',
      },
    });
  });
});

describe('buildGridEntityRows', () => {
  it('includes only positioned entities', () => {
    const rows = buildGridEntityRows(makeInput());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      entityRef: 'dr_chen',
      x: 3,
      y: 4,
      z: 0,
      visible: true,
      tags: ['corporate'],
    });
  });

  it('returns an empty array when no entity has a startingPosition', () => {
    const input = makeInput();
    input.structured.entities = input.structured.entities.map((e) => ({
      ...e,
      startingPosition: undefined,
    }));
    expect(buildGridEntityRows(input)).toEqual([]);
  });
});
