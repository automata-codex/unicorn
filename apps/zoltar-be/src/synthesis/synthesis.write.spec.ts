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
        dr_chen_hp: { current: 10, max: 10 },
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
  it('preserves existing pools on key conflict', () => {
    const existing = {
      vasquez_hp: { current: 15, max: 15 },
      dr_chen_hp: { current: 1, max: 10 },
    };
    const initialState = {
      dr_chen_hp: { current: 10, max: 10 }, // should be ignored
      crewman_wick_timer: { current: 4, max: 4 },
    };
    const result = buildResourcePools(existing, initialState, {
      playerEntityId: 'vasquez',
      knownEntityIds: ['dr_chen', 'crewman_wick'],
    });
    expect(result.pools.vasquez_hp).toEqual({ current: 15, max: 15 });
    expect(result.pools.dr_chen_hp).toEqual({ current: 1, max: 10 });
    expect(result.pools.crewman_wick_timer).toEqual({ current: 4, max: 4 });
    expect(result.skipped).toEqual([]);
  });

  it('returns a fresh top-level object', () => {
    const existing = { vasquez_hp: { current: 15, max: 15 } };
    const result = buildResourcePools(
      existing,
      {},
      {
        playerEntityId: 'vasquez',
        knownEntityIds: [],
      },
    );
    expect(result.pools).not.toBe(existing);
    // Adding a key to `result.pools` must not mutate `existing`.
    result.pools.new_pool = { current: 1, max: 1 };
    expect(existing).not.toHaveProperty('new_pool');
  });

  it('drops a pool that re-spells the player id, and reports it as skipped', () => {
    // The M7.5 capture in miniature: the sheet says `lt_alvarez`, the model
    // emits `alvarez_*`. Nothing collides, so key preservation alone lets both
    // spellings persist for one character.
    const existing = {
      lt_alvarez_hp: { current: 20, max: 20 },
      lt_alvarez_stress: { current: 0, max: 3 },
    };
    const initialState = {
      alvarez_hp: { current: 20, max: 20 },
      alvarez_stress: { current: 0, max: 3 },
    };
    const result = buildResourcePools(existing, initialState, {
      playerEntityId: 'lt_alvarez',
      knownEntityIds: ['burned_out_medic'],
    });
    expect(result.pools).toEqual(existing);
    expect(result.skipped.sort()).toEqual(['alvarez_hp', 'alvarez_stress']);
  });

  it('keeps NPC pools that share a suffix with a player pool', () => {
    const existing = { lt_alvarez_hp: { current: 20, max: 20 } };
    const result = buildResourcePools(
      existing,
      { burned_out_medic_hp: { current: 8, max: 8 } },
      { playerEntityId: 'lt_alvarez', knownEntityIds: ['burned_out_medic'] },
    );
    expect(result.pools).toHaveProperty('burned_out_medic_hp');
    expect(result.skipped).toEqual([]);
  });

  it('keeps scenario-level pools whose prefix resolves to no entity', () => {
    // `station_power` is not an entity and never will be — these are the
    // legitimate unattached pools the check must not touch.
    const existing = { lt_alvarez_hp: { current: 20, max: 20 } };
    const result = buildResourcePools(
      existing,
      {
        station_power_reserve: { current: 4, max: 4 },
        contamination_spread_timer: { current: 6, max: 6 },
      },
      { playerEntityId: 'lt_alvarez', knownEntityIds: [] },
    );
    expect(result.pools).toHaveProperty('station_power_reserve');
    expect(result.pools).toHaveProperty('contamination_spread_timer');
    expect(result.skipped).toEqual([]);
  });
});

describe('buildEntityMap', () => {
  it('keys by entity id with visible/status only', () => {
    const map = buildEntityMap(makeInput().structured.entities);
    expect(map).toEqual({
      dr_chen: { visible: true, status: 'unknown' },
      shadow_threat: { visible: false, status: 'unknown' },
    });
  });
});

describe('buildCampaignStateData', () => {
  it('merges onto an existing row and satisfies MothershipCampaignStateSchema', () => {
    const existing = {
      schemaVersion: 1,
      resourcePools: { vasquez_hp: { current: 15, max: 15 } },
      entities: {
        vasquez: { visible: true, status: 'alive', npcState: 'alert' },
      },
      flags: { old_flag: { value: true, trigger: 'legacy' } },
      scenarioState: { oxygen: { current: 100, max: 100, note: '' } },
      worldFacts: { bridge_display: 'ERROR' },
    };
    const result = buildCampaignStateData(existing, makeInput(), 'vasquez')
      .data as {
      resourcePools: Record<string, unknown>;
      entities: Record<string, unknown>;
      flags: Record<string, unknown>;
      scenarioState: Record<string, unknown>;
      worldFacts: Record<string, unknown>;
    };
    expect(result.resourcePools).toHaveProperty('vasquez_hp');
    expect(result.resourcePools).toHaveProperty('dr_chen_hp');
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
      resourcePools: Record<string, unknown>;
      scenarioState: Record<string, unknown>;
      worldFacts: Record<string, unknown>;
    };
    expect(result.resourcePools).toEqual({
      dr_chen_hp: { current: 10, max: 10 },
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
