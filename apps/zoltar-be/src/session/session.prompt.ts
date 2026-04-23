import { buildStateSnapshot } from './session.snapshot';

import type Anthropic from '@anthropic-ai/sdk';
import type { CallSessionParams } from '../anthropic/anthropic.service';
import type { CampaignStateData, GmContextBlob } from './session.snapshot';
import type { DbMessage } from './session.window';

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
  'GM-side rolls and prompt the player via diceRequests for their rolls.',
  '',
  'Every turn you must call the submit_gm_response tool exactly once. The',
  'player sees only what you put in playerText. Propose state changes through',
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

export interface ResolvedPlayerRoll {
  notation: string;
  purpose: string;
  target: number | null;
  results: number[];
  total: number;
}

/**
 * Renders a single resolved player roll as one line of the `[Dice results]`
 * block. Format mirrors the playtest-app convention in
 * docs/specs/zoltar-playtest/pre-playtest-1.md: purpose (notation): total
 * followed by a success/failure annotation when target is known.
 */
function formatDiceResultLine(roll: ResolvedPlayerRoll): string {
  const base = `${roll.purpose} (${roll.notation}): ${roll.total}`;
  if (roll.target === null) return base;
  const outcome = roll.total <= roll.target ? 'success' : 'failure';
  return `${base} → target ${roll.target}, ${outcome}`;
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
 * `tool_choice: { type: 'any' }` forces a tool call but lets Claude choose
 * which one — the inner tool loop (session.service.ts) handles `roll_dice`
 * and `rules_lookup` iteratively until `submit_gm_response` lands. Plain
 * text responses are still rejected. The correction path overrides this to
 * force `submit_gm_response` specifically (see buildCorrectionRequest).
 */
export function buildSessionRequest(input: {
  gmContextBlob: GmContextBlob;
  campaignStateData: CampaignStateData;
  windowMessages: DbMessage[];
  playerMessage: string;
  /**
   * Player-entered dice rolls that resolved between the last gm_response and
   * this turn's narrative input. Rendered as a synthetic `[Dice results]`
   * block immediately before the player's message so Claude can narrate the
   * outcome. Empty or omitted when no dice were in flight.
   */
  resolvedPlayerRolls?: ResolvedPlayerRoll[];
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

  // Synthetic [Dice results] block — placed as its own user message right
  // before the narrative input so Claude treats it as incoming information
  // for this turn, not part of prior history.
  const resolved = input.resolvedPlayerRolls ?? [];
  if (resolved.length > 0) {
    const lines = resolved.map((r) => formatDiceResultLine(r)).join('\n');
    messages.push({
      role: 'user',
      content: `[Dice results]\n${lines}`,
    });
  }

  // Empty `playerMessage` means an auto-advanced turn from a dice-result
  // submission — the [Dice results] block above is the turn's user input,
  // no narrative text to add. Skipping keeps Claude from receiving an empty
  // user turn (which the API rejects).
  if (input.playerMessage.length > 0) {
    messages.push({ role: 'user', content: input.playerMessage });
  }

  const toolChoice: Anthropic.ToolChoiceAny = { type: 'any' };

  return {
    systemBlocks,
    messages,
    tools: input.tools,
    toolChoice,
  };
}
