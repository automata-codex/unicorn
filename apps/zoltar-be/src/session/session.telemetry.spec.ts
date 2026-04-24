import { describe, expect, it } from 'vitest';

import { buildAdventureTelemetryPayload } from './session.telemetry';

import type Anthropic from '@anthropic-ai/sdk';
import type { CallSessionParams } from '../anthropic/anthropic.service';
import type { SubmitGmResponse } from './session.schema';
import type { ValidationResult } from './session.validator';

function stubRequest(): CallSessionParams {
  return {
    systemBlocks: [
      { type: 'text', text: 'gm context' },
      { type: 'text', text: 'warden role' },
    ],
    messages: [
      { role: 'user', content: 'snapshot' },
      { role: 'user', content: 'player action' },
    ],
    tools: [{ name: 'submit_gm_response' } as unknown as Anthropic.Tool],
    toolChoice: { type: 'tool', name: 'submit_gm_response' },
  };
}

function stubResponse(
  overrides?: Partial<Anthropic.Message>,
): Anthropic.Message {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-6',
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: {
      input_tokens: 1500,
      output_tokens: 420,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
    },
    content: [],
    ...overrides,
  } as unknown as Anthropic.Message;
}

function stubParsed(overrides?: Partial<SubmitGmResponse>): SubmitGmResponse {
  return {
    playerText: 'narration',
    stateChanges: {},
    gmUpdates: {},
    diceRequests: [],
    adventureMode: null,
    ...overrides,
  };
}

const emptyApplied: ValidationResult['applied'] = {
  resourcePools: {},
  entities: {},
  flags: {},
  scenarioState: {},
  worldFacts: {},
};

describe('buildAdventureTelemetryPayload', () => {
  it('produces the full payload shape without missing fields', () => {
    const payload = buildAdventureTelemetryPayload({
      playerMessage: 'Open the door.',
      snapshotSent: '<state_snapshot>...</state_snapshot>',
      originalRequest: stubRequest(),
      originalResponse: stubResponse(),
      originalParsed: stubParsed(),
      applied: emptyApplied,
      thresholds: [],
    });

    expect(Object.keys(payload).sort()).toEqual(
      [
        'applied',
        'diceRolls',
        'notes',
        'originalRequest',
        'originalResponse',
        'playerMessage',
        'rulesLookups',
        'snapshotSent',
        'thresholds',
        'toolLoopIterations',
      ].sort(),
    );
    expect(payload.originalRequest).toEqual({
      model: 'claude-sonnet-4-6',
      systemBlocks: 2,
      messageCount: 2,
      promptTokens: 1500,
      completionTokens: 420,
    });
  });

  it('defaults diceRolls to an empty array', () => {
    const payload = buildAdventureTelemetryPayload({
      playerMessage: 'x',
      snapshotSent: 'x',
      originalRequest: stubRequest(),
      originalResponse: stubResponse(),
      originalParsed: stubParsed(),
      applied: emptyApplied,
      thresholds: [],
    });
    expect(payload.diceRolls).toEqual([]);
  });

  it('carries gmUpdates.notes from the original response; notes.correction is null without a correction', () => {
    const payload = buildAdventureTelemetryPayload({
      playerMessage: 'x',
      snapshotSent: 'x',
      originalRequest: stubRequest(),
      originalResponse: stubResponse(),
      originalParsed: stubParsed({
        gmUpdates: { notes: 'Claude thinks the reactor is overheating' },
      }),
      applied: emptyApplied,
      thresholds: [],
    });
    expect(payload.notes).toEqual({
      original: 'Claude thinks the reactor is overheating',
      correction: null,
    });
    expect(payload.correction).toBeUndefined();
  });

  it('populates notes.correction and the correction block when a correction fired', () => {
    const payload = buildAdventureTelemetryPayload({
      playerMessage: 'x',
      snapshotSent: 'x',
      originalRequest: stubRequest(),
      originalResponse: stubResponse(),
      originalParsed: stubParsed({ gmUpdates: { notes: 'first-round note' } }),
      correction: {
        rejections: [
          {
            path: 'resourcePools.xenomorph_hp',
            reason: 'Pool does not exist',
            received: { delta: -3 },
          },
        ],
        response: stubResponse({
          usage: {
            input_tokens: 1800,
            output_tokens: 510,
            cache_creation_input_tokens: null,
            cache_read_input_tokens: null,
          } as Anthropic.Message['usage'],
        }),
        parsed: stubParsed({ gmUpdates: { notes: 'second-round note' } }),
      },
      applied: emptyApplied,
      thresholds: [],
    });

    expect(payload.notes).toEqual({
      original: 'first-round note',
      correction: 'second-round note',
    });
    expect(payload.correction).toBeDefined();
    expect(payload.correction?.correctionRequest).toEqual({
      promptTokens: 1800,
      completionTokens: 510,
    });
    expect(payload.correction?.rejections).toHaveLength(1);
  });

  it('leaves notes.original null when gmUpdates.notes is absent', () => {
    const payload = buildAdventureTelemetryPayload({
      playerMessage: 'x',
      snapshotSent: 'x',
      originalRequest: stubRequest(),
      originalResponse: stubResponse(),
      originalParsed: stubParsed({ gmUpdates: {} }),
      applied: emptyApplied,
      thresholds: [],
    });
    expect(payload.notes.original).toBeNull();
    expect(payload.notes.correction).toBeNull();
  });

  it('carries system-generated diceRolls in sequence order', () => {
    const payload = buildAdventureTelemetryPayload({
      playerMessage: 'x',
      snapshotSent: 'x',
      originalRequest: stubRequest(),
      originalResponse: stubResponse(),
      originalParsed: stubParsed(),
      applied: emptyApplied,
      thresholds: [],
      diceRolls: [
        {
          source: 'system_generated',
          sequenceNumber: 3,
          notation: '1d100',
          purpose: 'Panic',
          results: [73],
          modifier: 0,
          total: 73,
        },
        {
          source: 'system_generated',
          sequenceNumber: 2,
          notation: '2d6',
          purpose: 'Damage',
          results: [3, 4],
          modifier: 0,
          total: 7,
        },
      ],
    });
    // Sorted by sequenceNumber ascending.
    expect(payload.diceRolls.map((r) => r.sequenceNumber)).toEqual([2, 3]);
    expect(payload.diceRolls[0].notation).toBe('2d6');
    expect(payload.diceRolls[1].notation).toBe('1d100');
  });

  it('includes player-entered rolls alongside system-generated ones in diceRolls', () => {
    const payload = buildAdventureTelemetryPayload({
      playerMessage: 'x',
      snapshotSent: 'x',
      originalRequest: stubRequest(),
      originalResponse: stubResponse(),
      originalParsed: stubParsed(),
      applied: emptyApplied,
      thresholds: [],
      diceRolls: [
        {
          source: 'player_entered',
          sequenceNumber: 2,
          notation: '1d100',
          purpose: 'Intellect save',
          results: [34],
          modifier: 0,
          total: 34,
          requestId: '00000000-0000-0000-0000-000000000001',
        },
        {
          source: 'system_generated',
          sequenceNumber: 4,
          notation: '1d100',
          purpose: 'Panic follow-up',
          results: [73],
          modifier: 0,
          total: 73,
        },
      ],
    });
    expect(payload.diceRolls).toHaveLength(2);
    expect(payload.diceRolls[0].source).toBe('player_entered');
    expect(payload.diceRolls[0].requestId).toBe(
      '00000000-0000-0000-0000-000000000001',
    );
    expect(payload.diceRolls[1].source).toBe('system_generated');
  });

  it('carries rulesLookups records including zero-result entries', () => {
    const payload = buildAdventureTelemetryPayload({
      playerMessage: 'x',
      snapshotSent: 'x',
      originalRequest: stubRequest(),
      originalResponse: stubResponse(),
      originalParsed: stubParsed(),
      applied: emptyApplied,
      thresholds: [],
      rulesLookups: [
        {
          query: 'panic result 73',
          limit: 3,
          resultCount: 2,
          topSimilarity: 0.87,
          sources: ['PSG p.42', 'PSG p.43'],
        },
        {
          query: 'wound severity',
          limit: 3,
          resultCount: 0,
          topSimilarity: null,
          sources: [],
        },
      ],
    });
    expect(payload.rulesLookups).toHaveLength(2);
    // Empty-result entries are preserved — they are M7.2 ingestion priority signal.
    expect(payload.rulesLookups[1]).toEqual({
      query: 'wound severity',
      limit: 3,
      resultCount: 0,
      topSimilarity: null,
      sources: [],
    });
  });

  it('records toolLoopIterations verbatim', () => {
    const payload = buildAdventureTelemetryPayload({
      playerMessage: 'x',
      snapshotSent: 'x',
      originalRequest: stubRequest(),
      originalResponse: stubResponse(),
      originalParsed: stubParsed(),
      applied: emptyApplied,
      thresholds: [],
      toolLoopIterations: 4,
    });
    expect(payload.toolLoopIterations).toBe(4);
  });

  it('defaults toolLoopIterations to 1 when omitted (M6 no-tools case)', () => {
    const payload = buildAdventureTelemetryPayload({
      playerMessage: 'x',
      snapshotSent: 'x',
      originalRequest: stubRequest(),
      originalResponse: stubResponse(),
      originalParsed: stubParsed(),
      applied: emptyApplied,
      thresholds: [],
    });
    expect(payload.toolLoopIterations).toBe(1);
  });

  it('defaults rulesLookups to []', () => {
    const payload = buildAdventureTelemetryPayload({
      playerMessage: 'x',
      snapshotSent: 'x',
      originalRequest: stubRequest(),
      originalResponse: stubResponse(),
      originalParsed: stubParsed(),
      applied: emptyApplied,
      thresholds: [],
    });
    expect(payload.rulesLookups).toEqual([]);
  });
});
