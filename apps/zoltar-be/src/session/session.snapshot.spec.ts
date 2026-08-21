import { emptyMothershipState } from '@uv/game-systems';
import { describe, expect, it } from 'vitest';

import { buildStateSnapshot } from './session.snapshot';

import type { CampaignStateData, GmContextBlob } from './session.snapshot';

function makeState(
  overrides: Partial<CampaignStateData> = {},
): CampaignStateData {
  return { ...emptyMothershipState(), ...overrides };
}

const emptyBlob: GmContextBlob = {
  structured: { flags: {} },
  playerEntityIds: [],
};

describe('buildStateSnapshot', () => {
  it('emits no inner block tags when campaign state is empty', () => {
    const snapshot = buildStateSnapshot({
      gmContextBlob: emptyBlob,
      campaignStateData: makeState(),
    });
    expect(snapshot).not.toContain('<resource_pools>');
    expect(snapshot).not.toContain('<entities>');
    expect(snapshot).not.toContain('<flags>');
    expect(snapshot).not.toContain('<scenario_state>');
    expect(snapshot).not.toContain('<world_facts>');
    // Outer wrapper still present.
    expect(snapshot).toContain('<state_snapshot>');
    expect(snapshot).toContain('</state_snapshot>');
  });

  it('formats resource pools owner-first, with and without a max', () => {
    const snapshot = buildStateSnapshot({
      gmContextBlob: emptyBlob,
      campaignStateData: makeState({
        resourcePools: {
          dr_chen: { hp: { current: 8, max: 10 } },
          _scenario: { emergency_timer: { current: 6, max: null } },
        },
      }),
    });
    expect(snapshot).toContain('dr_chen.hp: 8/10');
    expect(snapshot).toContain('_scenario.emergency_timer: 6');
    expect(snapshot).not.toContain('_scenario.emergency_timer: 6/');
  });

  it('renders every pool of an owner, sorted within the owner', () => {
    const snapshot = buildStateSnapshot({
      gmContextBlob: emptyBlob,
      campaignStateData: makeState({
        resourcePools: {
          dr_chen: {
            stress: { current: 2, max: null },
            hp: { current: 8, max: 10 },
            wounds: { current: 0, max: 2 },
          },
        },
      }),
    });
    const block = snapshot
      .slice(
        snapshot.indexOf('<resource_pools>'),
        snapshot.indexOf('</resource_pools>'),
      )
      .trim()
      .split('\n')
      .slice(1);
    expect(block).toEqual([
      'dr_chen.hp: 8/10',
      'dr_chen.stress: 2',
      'dr_chen.wounds: 0/2',
    ]);
  });

  it('omits the block entirely when every owner has an empty pool set', () => {
    // Reachable after CharacterService.delete removes an owner's pools.
    const snapshot = buildStateSnapshot({
      gmContextBlob: emptyBlob,
      campaignStateData: makeState({ resourcePools: { dr_chen: {} } }),
    });
    expect(snapshot).not.toContain('<resource_pools>');
  });

  describe('<character_attributes>', () => {
    const armored = {
      conditions: [],
      rollModifiers: [],
      skills: [],
      equipment: [],
      wornArmor: {
        item: 'Vaccsuit',
        apBase: 3,
        apCurrent: 3,
        destroyed: false,
        dr: 1,
        o2Remaining: 12,
        features: ['radiation shielding'],
      },
      minimumStress: 2,
      bleeding: 0,
      pendingDeathSave: null,
    };

    function attributesBlock(state: Record<string, unknown>): string {
      const snapshot = buildStateSnapshot({
        gmContextBlob: emptyBlob,
        campaignStateData: makeState({ characterState: state } as never),
      });
      const start = snapshot.indexOf('<character_attributes>');
      if (start === -1) return '';
      return snapshot.slice(start, snapshot.indexOf('</character_attributes>'));
    }

    it('renders armor mode with AP, DR, O2 and features', () => {
      const block = attributesBlock({ dr_chen: armored });
      expect(block).toContain('dr_chen:');
      expect(block).toContain('Vaccsuit');
      expect(block).toContain('AP 3/3');
      expect(block).toContain('DR 1');
      expect(block).toContain('O2 12 min');
      expect(block).toContain('radiation shielding');
    });

    it('marks destroyed armor and still states DR', () => {
      // DR applies first and survives destruction; a Warden that stops seeing
      // it once the armor is gone subtracts nothing.
      const block = attributesBlock({
        dr_chen: {
          ...armored,
          wornArmor: { ...armored.wornArmor, apCurrent: 0, destroyed: true },
        },
      });
      expect(block).toContain('DESTROYED');
      expect(block).toContain('DR 1');
    });

    it('omits the O2 line for an item with no air supply', () => {
      const block = attributesBlock({
        dr_chen: {
          ...armored,
          wornArmor: { ...armored.wornArmor, o2Remaining: null },
        },
      });
      expect(block).not.toContain('O2');
    });

    it('renders the weapon loadout with shots and quantities', () => {
      const block = attributesBlock({
        dr_chen: {
          ...armored,
          equipment: [
            { item: 'Revolver', charges: 4 },
            { item: 'Stimpak', quantity: 2 },
            { item: 'Rope' },
          ],
        },
      });
      expect(block).toContain('Revolver (4 loaded)');
      expect(block).toContain('Stimpak (x2)');
      // Inert kit says nothing the Warden needs mid-turn.
      expect(block).not.toContain('Rope');
    });

    it('renders active conditions with their parameters', () => {
      const block = attributesBlock({
        dr_chen: {
          ...armored,
          conditions: [
            { condition: 'frightened', parameter: 'the thing in the vent' },
            { condition: 'doomed' },
          ],
        },
      });
      expect(block).toContain('frightened (the thing in the vent)');
      expect(block).toContain('doomed');
    });

    it('states bleeding, raised minimum stress and a pending death save', () => {
      const block = attributesBlock({
        dr_chen: {
          ...armored,
          bleeding: 3,
          minimumStress: 4,
          pendingDeathSave: 7,
        },
      });
      expect(block).toContain('bleeding: 3');
      expect(block).toContain('minimum stress: 4');
      expect(block).toContain('death save: in 7 rounds');
    });

    it('stays silent about the three at their resting values', () => {
      // A line reading "bleeding: 0" every turn teaches the Warden to skip the
      // block.
      const block = attributesBlock({ dr_chen: armored });
      expect(block).not.toContain('bleeding');
      expect(block).not.toContain('minimum stress');
      expect(block).not.toContain('death save');
    });

    it('omits an entity with nothing to say', () => {
      const block = attributesBlock({
        dr_chen: armored,
        xenomorph: {
          conditions: [],
          rollModifiers: [],
          skills: [],
          equipment: [],
          wornArmor: null,
          minimumStress: 2,
          bleeding: 0,
          pendingDeathSave: null,
        },
      });
      expect(block).toContain('dr_chen:');
      expect(block).not.toContain('xenomorph');
    });

    it('suppresses the whole block when no entity has anything to say', () => {
      const snapshot = buildStateSnapshot({
        gmContextBlob: emptyBlob,
        campaignStateData: makeState({ characterState: {} } as never),
      });
      expect(snapshot).not.toContain('<character_attributes>');
    });

    it('renders no Stats or Saves — those are live in <resource_pools>', () => {
      // The roadmap bullet calls this "static build data" and its own title is
      // wrong: Wounds reduce a Stat and a Save, radiation reduces all seven.
      // Duplicating them here would hand the Warden a stale target number
      // after any wound, silently, because it would still look plausible.
      const block = attributesBlock({ dr_chen: armored });
      expect(block).not.toMatch(/strength|combat|sanity|intellect/i);
    });
  });

  it('elides hidden entities from the <entities> block', () => {
    const snapshot = buildStateSnapshot({
      gmContextBlob: emptyBlob,
      campaignStateData: makeState({
        entities: {
          engineer_kowalski: { visible: true, status: 'alive' },
          shadow_threat: { visible: false, status: 'unknown' },
        },
      }),
    });
    expect(snapshot).toContain('engineer_kowalski: visible, status=alive');
    expect(snapshot).not.toContain('shadow_threat');
  });

  it('renders npcState as the trailing `state:` bit', () => {
    const snapshot = buildStateSnapshot({
      gmContextBlob: emptyBlob,
      campaignStateData: makeState({
        entities: {
          engineer_kowalski: {
            visible: true,
            status: 'alive',
            npcState: 'Hostile — cornered, low ammo',
          },
        },
      }),
    });
    expect(snapshot).toContain(
      'engineer_kowalski: visible, status=alive, state: Hostile — cornered, low ammo',
    );
  });

  it('omits the `state:` bit entirely when npcState is unset', () => {
    const snapshot = buildStateSnapshot({
      gmContextBlob: emptyBlob,
      campaignStateData: makeState({
        entities: { engineer_kowalski: { visible: true, status: 'alive' } },
      }),
    });
    expect(snapshot).toContain('engineer_kowalski: visible, status=alive');
    expect(snapshot).not.toContain('state:');
  });

  it('always includes player entities even when hidden', () => {
    const snapshot = buildStateSnapshot({
      gmContextBlob: {
        ...emptyBlob,
        playerEntityIds: ['dr_chen'],
      },
      campaignStateData: makeState({
        entities: {
          dr_chen: { visible: false, status: 'alive' },
          shadow_threat: { visible: false, status: 'unknown' },
        },
      }),
    });
    expect(snapshot).toContain('dr_chen: hidden, status=alive');
    expect(snapshot).not.toContain('shadow_threat');
  });

  it('emits a player entity absent from the entities map', () => {
    // The real shape: campaign_state.entities holds NPCs/threats/features
    // only, so before this the player id reached the prompt nowhere at all and
    // the Warden inferred one from pool names.
    const snapshot = buildStateSnapshot({
      gmContextBlob: { ...emptyBlob, playerEntityIds: ['lt_alvarez'] },
      campaignStateData: makeState({
        entities: { burned_out_medic: { visible: true, status: 'alive' } },
      }),
    });
    expect(snapshot).toContain(
      'lt_alvarez: visible, status=unknown, player_character',
    );
    expect(snapshot).toContain('burned_out_medic: visible, status=alive');
  });

  it('tags a player entity that is in the map and lists players first', () => {
    const snapshot = buildStateSnapshot({
      gmContextBlob: { ...emptyBlob, playerEntityIds: ['dr_chen'] },
      campaignStateData: makeState({
        entities: {
          apex_predator: { visible: true, status: 'unknown' },
          dr_chen: { visible: true, status: 'alive' },
        },
      }),
    });
    expect(snapshot).toContain(
      'dr_chen: visible, status=alive, player_character',
    );
    // `apex_predator` sorts before `dr_chen`; the player must still come first.
    const block = snapshot.slice(snapshot.indexOf('<entities>'));
    expect(block.indexOf('dr_chen')).toBeLessThan(
      block.indexOf('apex_predator'),
    );
  });

  it('emits the <entities> block for a player entity even with no other entities', () => {
    const snapshot = buildStateSnapshot({
      gmContextBlob: { ...emptyBlob, playerEntityIds: ['lt_alvarez'] },
      campaignStateData: makeState({ entities: {} }),
    });
    expect(snapshot).toContain('<entities>');
    expect(snapshot).toContain(
      'lt_alvarez: visible, status=unknown, player_character',
    );
  });

  it('omits the <entities> block when every entity is hidden and no player entities exist', () => {
    const snapshot = buildStateSnapshot({
      gmContextBlob: emptyBlob,
      campaignStateData: makeState({
        entities: {
          shadow_threat: { visible: false, status: 'unknown' },
        },
      }),
    });
    expect(snapshot).not.toContain('<entities>');
  });

  it('drops an entity from the snapshot when its visibility toggles to false', () => {
    const first = buildStateSnapshot({
      gmContextBlob: emptyBlob,
      campaignStateData: makeState({
        entities: {
          engineer_kowalski: { visible: true, status: 'alive' },
        },
      }),
    });
    const second = buildStateSnapshot({
      gmContextBlob: emptyBlob,
      campaignStateData: makeState({
        entities: {
          engineer_kowalski: { visible: false, status: 'alive' },
        },
      }),
    });
    expect(first).toContain('engineer_kowalski');
    expect(second).not.toContain('engineer_kowalski');
  });

  it('emits a flag trigger only for flags introduced during play', () => {
    const snapshot = buildStateSnapshot({
      gmContextBlob: {
        structured: {
          flags: {
            adventure_complete: { value: false, trigger: 'Escape pod.' },
          },
        },
      },
      campaignStateData: makeState({
        flags: {
          adventure_complete: { value: false, trigger: 'Escape pod.' },
          distress_beacon_active: {
            value: true,
            trigger: 'Player activates beacon.',
          },
        },
      }),
    });
    expect(snapshot).toContain('adventure_complete: false');
    expect(snapshot).not.toContain('Escape pod.');
    expect(snapshot).toContain(
      'distress_beacon_active: true (trigger: Player activates beacon.)',
    );
  });

  it('treats all flags as original when the blob has no structured.flags', () => {
    const snapshot = buildStateSnapshot({
      gmContextBlob: { playerEntityIds: [] }, // no structured.flags at all
      campaignStateData: makeState({
        flags: {
          adventure_complete: { value: false, trigger: 'Escape pod.' },
        },
      }),
    });
    expect(snapshot).toContain('adventure_complete: false');
    expect(snapshot).not.toContain('Escape pod.');
  });

  it('orders entries alphabetically within each block regardless of input order', () => {
    const stateA = buildStateSnapshot({
      gmContextBlob: emptyBlob,
      campaignStateData: makeState({
        worldFacts: { bravo: 'B', alpha: 'A', charlie: 'C' },
      }),
    });
    const stateB = buildStateSnapshot({
      gmContextBlob: emptyBlob,
      campaignStateData: makeState({
        worldFacts: { charlie: 'C', alpha: 'A', bravo: 'B' },
      }),
    });
    expect(stateA).toBe(stateB);
    expect(stateA.indexOf('alpha: A')).toBeLessThan(stateA.indexOf('bravo: B'));
    expect(stateA.indexOf('bravo: B')).toBeLessThan(
      stateA.indexOf('charlie: C'),
    );
  });

  it('appends the scenario state note when present and omits it when empty', () => {
    const snapshot = buildStateSnapshot({
      gmContextBlob: emptyBlob,
      campaignStateData: makeState({
        scenarioState: {
          hull_breach: {
            current: 2,
            max: 5,
            note: 'Increments on combat near outer walls.',
          },
          quiet_counter: { current: 0, max: null, note: '' },
        },
      }),
    });
    expect(snapshot).toContain(
      'hull_breach: 2/5 — Increments on combat near outer walls.',
    );
    expect(snapshot).toContain('quiet_counter: 0');
    expect(snapshot).not.toContain('quiet_counter: 0 —');
  });

  it('emits each non-empty block in the documented order', () => {
    const snapshot = buildStateSnapshot({
      gmContextBlob: emptyBlob,
      campaignStateData: makeState({
        resourcePools: { dr_chen: { hp: { current: 10, max: 10 } } },
        characterState: {
          dr_chen: {
            conditions: [{ condition: 'doomed' }],
            rollModifiers: [],
            skills: [],
            equipment: [],
            wornArmor: null,
            minimumStress: 2,
            bleeding: 0,
            pendingDeathSave: null,
          },
        },
        entities: { kowalski: { visible: true, status: 'alive' } },
        flags: {
          adventure_complete: { value: false, trigger: 'Escape pod.' },
        },
        scenarioState: { oxygen: { current: 87, max: 100, note: '' } },
        worldFacts: { ship_layout: 'Three decks.' },
      }),
    });
    const pools = snapshot.indexOf('<resource_pools>');
    const attributes = snapshot.indexOf('<character_attributes>');
    const entities = snapshot.indexOf('<entities>');
    const flags = snapshot.indexOf('<flags>');
    const scenario = snapshot.indexOf('<scenario_state>');
    const world = snapshot.indexOf('<world_facts>');
    expect(pools).toBeGreaterThan(-1);
    // `<character_attributes>` sits directly after `<resource_pools>`: the two
    // describe the same characters, and the attributes qualify the numbers.
    expect(pools).toBeLessThan(attributes);
    expect(attributes).toBeLessThan(entities);
    expect(entities).toBeLessThan(flags);
    expect(flags).toBeLessThan(scenario);
    expect(scenario).toBeLessThan(world);
  });
});
