import type Anthropic from '@anthropic-ai/sdk';

import type { CallSessionParams } from '../anthropic/anthropic.service';
import type { CampaignStateData, GmContextBlob } from './session.snapshot';
import type { DbMessage } from './session.window';

import { buildStateSnapshot } from './session.snapshot';

/**
 * The Warden-role system prompt for Mothership. Kept short and focused on
 * voice/role — mechanical detail belongs in the rules lookup tool (M7) and
 * scenario detail lives in the cached GM context blob. When a second system
 * lands, move this into `session/mothership/session.prompts.ts` alongside the
 * pattern established for synthesis prompts.
 */
export const WARDEN_SYSTEM_PROMPT_MOTHERSHIP = [
  'You are the Warden of a Mothership RPG adventure.',
  '',
  'Mothership is a sci-fi horror TTRPG. The tone is claustrophobic, bleak, and',
  'mechanically honest — characters are fragile, resources run out, and panic',
  'compounds. Narrate consequences faithfully; do not soften them. Avoid',
  'improvising rules: when a mechanical ruling is uncertain, call the rules',
  'lookup tool rather than guess. When dice are needed, use the roll tool for',
  'GM-side rolls and prompt the player via playerRolls for their rolls.',
  '',
  'Every turn you must call the submit_gm_response tool exactly once. The',
  "player sees only what you put in playerText. Propose state changes through",
  'stateChanges; the backend validates and applies them.',
].join('\n');

/**
 * Serializes the structured GM context into a human-readable block for
 * Claude. Sits in the cached system message, so it is stable across turns of
 * a single adventure and qualifies for prompt caching. `openingNarration` is
 * deliberately NOT emitted — Claude has already used it as the first message
 * the player sees, and re-shipping it wastes cache bytes.
 */
export function formatGmContextBlob(blob: GmContextBlob): string {
  const sections: string[] = [];

  if (blob.narrative) {
    const n = blob.narrative;
    const agendaKeys = Object.keys(n.npcAgendas).sort();
    const agendaLines = agendaKeys.map(
      (key) => `- ${key}: ${n.npcAgendas[key]}`,
    );
    sections.push(
      [
        '<narrative>',
        `location: ${n.location}`,
        `atmosphere: ${n.atmosphere}`,
        'npc_agendas:',
        ...(agendaLines.length > 0 ? agendaLines : ['- (none)']),
        `hidden_truth: ${n.hiddenTruth}`,
        `oracle_connections: ${n.oracleConnections}`,
        '</narrative>',
      ].join('\n'),
    );
  }

  if (blob.entities && blob.entities.length > 0) {
    const sorted = [...blob.entities].sort((a, b) => a.id.localeCompare(b.id));
    const lines = sorted.map((entity) => {
      const tags = entity.tags.length > 0 ? entity.tags.join(', ') : '(none)';
      return `- ${entity.id} (${entity.type}${entity.visible ? '' : ', starts hidden'}): tags=${tags}`;
    });
    sections.push(['<entities>', ...lines, '</entities>'].join('\n'));
  }

  const originalFlags = blob.structured?.flags;
  if (originalFlags && Object.keys(originalFlags).length > 0) {
    const keys = Object.keys(originalFlags).sort();
    const lines = keys.map((key) => {
      const flag = originalFlags[key];
      return `- ${key}: value=${flag.value}, trigger=${flag.trigger}`;
    });
    sections.push(['<flags>', ...lines, '</flags>'].join('\n'));
  }

  return `<gm_context>\n\n${sections.join('\n\n')}\n\n</gm_context>`;
}

/**
 * Maps a persisted message role onto the Anthropic `MessageParam` role. The
 * DB distinguishes `player`/`gm`/`system`; Anthropic only knows
 * `user`/`assistant`. `system` DB rows are treated as assistant text — they
 * are GM-adjacent narration rather than genuinely system-level — and in
 * practice none exist today.
 */
function mapRole(role: DbMessage['role']): 'user' | 'assistant' {
  return role === 'player' ? 'user' : 'assistant';
}

/**
 * Assembles the full per-turn Claude request. Structure per spec §"Part 4":
 *
 *   system:
 *     [0] GM context blob (cache_control: ephemeral)
 *     [1] Warden role prompt (no cache marker)
 *   messages:
 *     [0] user: <state_snapshot>...</state_snapshot>   (fresh every turn)
 *     [1..n-1] prior window messages in chronological order
 *     [n] user: the new player input
 *
 * `tool_choice` forces `submit_gm_response` — this eliminates the "Claude
 * responds with plain text instead of a tool call" failure class entirely.
 */
export function buildSessionRequest(input: {
  gmContextBlob: GmContextBlob;
  campaignStateData: CampaignStateData;
  windowMessages: DbMessage[];
  playerMessage: string;
  tools: Anthropic.Tool[];
}): CallSessionParams {
  const systemBlocks: Anthropic.TextBlockParam[] = [
    {
      type: 'text',
      text: formatGmContextBlob(input.gmContextBlob),
      cache_control: { type: 'ephemeral' },
    },
    {
      type: 'text',
      text: WARDEN_SYSTEM_PROMPT_MOTHERSHIP,
    },
  ];

  const messages: Anthropic.MessageParam[] = [];

  // Opening user message carries the per-turn state snapshot.
  messages.push({
    role: 'user',
    content: buildStateSnapshot({
      gmContextBlob: input.gmContextBlob,
      campaignStateData: input.campaignStateData,
    }),
  });

  for (const m of input.windowMessages) {
    messages.push({ role: mapRole(m.role), content: m.content });
  }

  messages.push({ role: 'user', content: input.playerMessage });

  const toolChoice: Anthropic.ToolChoiceTool = {
    type: 'tool',
    name: 'submit_gm_response',
  };

  return {
    systemBlocks,
    messages,
    tools: input.tools,
    toolChoice,
  };
}
