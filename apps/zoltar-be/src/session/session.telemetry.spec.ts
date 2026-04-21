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
    playerRolls: [],
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
        'snapshotSent',
        'thresholds',
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
});
