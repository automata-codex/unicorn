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

  it('formats resource pools with and without a max', () => {
    const snapshot = buildStateSnapshot({
      gmContextBlob: emptyBlob,
      campaignStateData: makeState({
        resourcePools: {
          dr_chen_hp: { current: 8, max: 10 },
          emergency_timer: { current: 6, max: null },
        },
      }),
    });
    expect(snapshot).toContain('dr_chen_hp: 8/10');
    expect(snapshot).toContain('emergency_timer: 6');
    expect(snapshot).not.toContain('emergency_timer: 6/');
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
    expect(stateA.indexOf('bravo: B')).toBeLessThan(stateA.indexOf('charlie: C'));
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
        resourcePools: { dr_chen_hp: { current: 10, max: 10 } },
        entities: { kowalski: { visible: true, status: 'alive' } },
        flags: {
          adventure_complete: { value: false, trigger: 'Escape pod.' },
        },
        scenarioState: { oxygen: { current: 87, max: 100, note: '' } },
        worldFacts: { ship_layout: 'Three decks.' },
      }),
    });
    const pools = snapshot.indexOf('<resource_pools>');
    const entities = snapshot.indexOf('<entities>');
    const flags = snapshot.indexOf('<flags>');
    const scenario = snapshot.indexOf('<scenario_state>');
    const world = snapshot.indexOf('<world_facts>');
    expect(pools).toBeGreaterThan(-1);
    expect(pools).toBeLessThan(entities);
    expect(entities).toBeLessThan(flags);
    expect(flags).toBeLessThan(scenario);
    expect(scenario).toBeLessThan(world);
  });
});
