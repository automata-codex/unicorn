import { emptyMothershipState } from '@uv/game-systems';
import { describe, expect, it } from 'vitest';

import { SUBMIT_GM_RESPONSE_TOOL, SESSION_TOOLS } from './session.tools';
import {
  buildSessionRequest,
  formatGmContextBlob,
  WARDEN_SYSTEM_PROMPT_MOTHERSHIP,
} from './session.prompt';

import type { GmContextBlob } from './session.snapshot';
import type { DbMessage } from './session.window';

const baseBlob: GmContextBlob = {
  openingNarration: 'Amber lights pulse — the ship drifts.',
  narrative: {
    location: 'Derelict freighter Persephone.',
    atmosphere: 'Dim corridors, the hum of failing life support.',
    npcAgendas: {
      corporate_liaison: 'Keep the manifest hidden at any cost.',
      engineer_kowalski: 'Reach the engine room before the fire spreads.',
    },
    hiddenTruth: 'The manifest lists an unauthorized bio-sample.',
    oracleConnections: 'Survivor motive ties to the hidden truth.',
  },
  entities: [
    {
      id: 'engineer_kowalski',
      type: 'npc',
      visible: true,
      tags: ['crew', 'wounded'],
    },
    {
      id: 'shadow_threat',
      type: 'threat',
      visible: false,
      tags: [],
    },
  ],
  structured: {
    flags: {
      adventure_complete: {
        value: false,
        trigger: 'Player escapes via the emergency pod.',
      },
    },
  },
  playerEntityIds: ['dr_chen'],
};

function makeMessage(
  index: number,
  role: DbMessage['role'],
  content: string,
): DbMessage {
  return {
    id: `00000000-0000-0000-0000-00000000${String(index).padStart(4, '0')}`,
    adventureId: '00000000-0000-0000-0000-0000000000aa',
    role,
    content,
    createdAt: new Date(2026, 0, 1, 0, 0, index),
  };
}

describe('formatGmContextBlob', () => {
  it('emits narrative, entities, and original flags inside a <gm_context> wrapper', () => {
    const text = formatGmContextBlob(baseBlob);
    expect(text).toMatch(/^<gm_context>/);
    expect(text).toMatch(/<\/gm_context>$/);
    expect(text).toContain('location: Derelict freighter Persephone.');
    expect(text).toContain('engineer_kowalski');
    expect(text).toContain('shadow_threat');
    expect(text).toContain('adventure_complete');
    expect(text).toContain('Player escapes via the emergency pod.');
  });

  it('never re-ships openingNarration — that byte count is wasted', () => {
    const text = formatGmContextBlob(baseBlob);
    expect(text).not.toContain('Amber lights pulse');
  });

  it('is deterministic for identical input', () => {
    expect(formatGmContextBlob(baseBlob)).toBe(formatGmContextBlob(baseBlob));
  });
});

describe('buildSessionRequest', () => {
  const campaignStateData = emptyMothershipState();

  it('places the GM context block first with ephemeral cache_control, Warden second without', () => {
    const req = buildSessionRequest({
      gmContextBlob: baseBlob,
      campaignStateData,
      windowMessages: [],
      playerMessage: 'I check the airlock.',
      tools: SESSION_TOOLS,
    });
    expect(req.systemBlocks).toHaveLength(2);
    expect(req.systemBlocks[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(req.systemBlocks[0].text).toContain('<gm_context>');
    expect(req.systemBlocks[1].cache_control).toBeUndefined();
    expect(req.systemBlocks[1].text).toBe(WARDEN_SYSTEM_PROMPT_MOTHERSHIP);
  });

  it('starts the message array with the state snapshot as a user message', () => {
    const req = buildSessionRequest({
      gmContextBlob: baseBlob,
      campaignStateData,
      windowMessages: [],
      playerMessage: 'I check the airlock.',
      tools: SESSION_TOOLS,
    });
    expect(req.messages[0].role).toBe('user');
    expect(req.messages[0].content).toMatch(/^<state_snapshot>/);
  });

  it('preserves the window between the snapshot and the new player message, mapping roles', () => {
    const windowMessages = [
      makeMessage(1, 'player', 'First turn input.'),
      makeMessage(2, 'gm', 'First turn response.'),
      makeMessage(3, 'player', 'Second turn input.'),
      makeMessage(4, 'gm', 'Second turn response.'),
    ];
    const req = buildSessionRequest({
      gmContextBlob: baseBlob,
      campaignStateData,
      windowMessages,
      playerMessage: 'Third turn input.',
      tools: SESSION_TOOLS,
    });
    expect(req.messages).toHaveLength(6);
    // [0] snapshot, [1..4] window, [5] new input
    expect(req.messages[1]).toEqual({
      role: 'user',
      content: 'First turn input.',
    });
    expect(req.messages[2]).toEqual({
      role: 'assistant',
      content: 'First turn response.',
    });
    expect(req.messages[3]).toEqual({
      role: 'user',
      content: 'Second turn input.',
    });
    expect(req.messages[4]).toEqual({
      role: 'assistant',
      content: 'Second turn response.',
    });
    expect(req.messages[5]).toEqual({
      role: 'user',
      content: 'Third turn input.',
    });
  });

  it('forces tool_choice: submit_gm_response', () => {
    const req = buildSessionRequest({
      gmContextBlob: baseBlob,
      campaignStateData,
      windowMessages: [],
      playerMessage: 'x',
      tools: SESSION_TOOLS,
    });
    expect(req.toolChoice).toEqual({
      type: 'tool',
      name: 'submit_gm_response',
    });
    expect(req.tools).toContain(SUBMIT_GM_RESPONSE_TOOL);
  });
});
