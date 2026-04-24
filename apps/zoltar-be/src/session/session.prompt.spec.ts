import { emptyMothershipState } from '@uv/game-systems';
import { describe, expect, it } from 'vitest';

import {
  buildSessionRequest,
  formatGmContextBlob,
  WARDEN_SYSTEM_PROMPT_MOTHERSHIP,
} from './session.prompt';
import { SESSION_TOOLS, SUBMIT_GM_RESPONSE_TOOL } from './session.tools';

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
    // Warden prompt is static across turns — cache breakpoint placed here
    // lets a fresh turn read the whole system from cache when agendas also
    // didn't change. See session.prompt.ts for the two-breakpoint layout.
    expect(req.systemBlocks[1].cache_control).toEqual({ type: 'ephemeral' });
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

  it("sets tool_choice: { type: 'any' } so the inner tool loop can run", () => {
    const req = buildSessionRequest({
      gmContextBlob: baseBlob,
      campaignStateData,
      windowMessages: [],
      playerMessage: 'x',
      tools: SESSION_TOOLS,
    });
    expect(req.toolChoice).toEqual({ type: 'any' });
    expect(req.tools).toContain(SUBMIT_GM_RESPONSE_TOOL);
  });

  it('omits the [Dice results] block when resolvedPlayerRolls is empty', () => {
    const req = buildSessionRequest({
      gmContextBlob: baseBlob,
      campaignStateData,
      windowMessages: [],
      playerMessage: 'I check the airlock.',
      resolvedPlayerRolls: [],
      tools: SESSION_TOOLS,
    });
    const texts = req.messages
      .filter((m) => typeof m.content === 'string')
      .map((m) => m.content as string);
    expect(texts.some((t) => t.includes('[Dice results]'))).toBe(false);
  });

  it('renders a [Dice results] block immediately before the player message', () => {
    const req = buildSessionRequest({
      gmContextBlob: baseBlob,
      campaignStateData,
      windowMessages: [],
      playerMessage: 'I brace myself.',
      resolvedPlayerRolls: [
        {
          notation: '1d100',
          purpose: 'Intellect save to interpret corrupted data',
          target: 65,
          results: [34],
          total: 34,
        },
      ],
      tools: SESSION_TOOLS,
    });
    // [0] snapshot, [1] dice block, [2] narrative input
    const dice = req.messages[1];
    const narrative = req.messages[2];
    expect(dice.role).toBe('user');
    expect(dice.content).toBe(
      '[Dice results]\nIntellect save to interpret corrupted data (1d100): 34 → target 65, success',
    );
    expect(narrative).toEqual({ role: 'user', content: 'I brace myself.' });
  });

  it('annotates failure when the roll exceeds its target', () => {
    const req = buildSessionRequest({
      gmContextBlob: baseBlob,
      campaignStateData,
      windowMessages: [],
      playerMessage: 'x',
      resolvedPlayerRolls: [
        {
          notation: '1d100',
          purpose: 'Body save against pressure loss',
          target: 50,
          results: [71],
          total: 71,
        },
      ],
      tools: SESSION_TOOLS,
    });
    expect(req.messages[1].content).toContain('target 50, failure');
  });

  it('omits the target/outcome annotation when target is null (commitment mode)', () => {
    const req = buildSessionRequest({
      gmContextBlob: baseBlob,
      campaignStateData,
      windowMessages: [],
      playerMessage: 'x',
      resolvedPlayerRolls: [
        {
          notation: '1d100',
          purpose: 'Hidden save',
          target: null,
          results: [42],
          total: 42,
        },
      ],
      tools: SESSION_TOOLS,
    });
    const line = req.messages[1].content as string;
    expect(line).toBe('[Dice results]\nHidden save (1d100): 42');
    expect(line).not.toContain('target');
    expect(line).not.toContain('success');
  });

  it('renders multiple resolved rolls as separate lines in sequence order', () => {
    const req = buildSessionRequest({
      gmContextBlob: baseBlob,
      campaignStateData,
      windowMessages: [],
      playerMessage: 'x',
      resolvedPlayerRolls: [
        {
          notation: '1d100',
          purpose: 'A',
          target: null,
          results: [10],
          total: 10,
        },
        {
          notation: '2d6',
          purpose: 'B',
          target: null,
          results: [3, 4],
          total: 7,
        },
      ],
      tools: SESSION_TOOLS,
    });
    expect(req.messages[1].content).toBe(
      '[Dice results]\nA (1d100): 10\nB (2d6): 7',
    );
  });
});
