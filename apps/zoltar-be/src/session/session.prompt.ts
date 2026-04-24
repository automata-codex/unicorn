import { buildStateSnapshot } from './session.snapshot';

import type Anthropic from '@anthropic-ai/sdk';
import type { CallSessionParams } from '../anthropic/anthropic.service';
import type { CampaignStateData, GmContextBlob } from './session.snapshot';
import type { DbMessage } from './session.window';

/**
 * The Warden-role system prompt for Mothership. Two parts:
 *   1. Voice/role — tone, narrative posture.
 *   2. TOOLS discipline — explicit guidance on when to call each of the
 *      three tools and what to do when rules_lookup returns nothing.
 *
 * Sits in the cached system region (see `cache_control: ephemeral` on the
 * Warden block in `buildSessionRequest`) — stable across turns of a single
 * adventure, qualifies for prompt caching. When a second system lands, move
 * this into `session/mothership/session.prompts.ts` alongside the pattern
 * established for synthesis prompts.
 */
export const WARDEN_SYSTEM_PROMPT_MOTHERSHIP = [
  'You are the Warden of a Mothership RPG adventure.',
  '',
  'Mothership is a sci-fi horror TTRPG. The tone is claustrophobic, bleak, and',
  'mechanically honest — characters are fragile, resources run out, and panic',
  'compounds. Narrate consequences faithfully; do not soften them.',
  '',
  'The player sees only what you put in playerText. Propose state changes',
  'through stateChanges; the backend validates and applies them.',
  '',
  'TOOLS',
  '',
  'You have three tools available: submit_gm_response, roll_dice, and',
  'rules_lookup. Call tools in whatever order the situation requires. Every',
  'turn must end with exactly one call to submit_gm_response.',
  '',
  'WHEN TO CALL roll_dice',
  '- NPC attacks, saves, and reactions that the player does not physically',
  '  roll for.',
  '- Panic checks triggered by the fiction (stress accumulation, monstrous',
  '  reveal, witnessing a teammate die).',
  '- Random table resolutions (wound tables, encounter rolls, loot).',
  '- Any outcome the world determines rather than the player — if a character',
  '  is not pressing a button to resolve it, the Warden rolls.',
  '',
  "Do not pre-roll dice you haven't needed yet. Do not narrate a result you",
  'have not executed — call the tool, wait for the result, then narrate.',
  '',
  'WHEN TO CALL diceRequests (in submit_gm_response)',
  "- Any roll the player's character makes to resolve their own action.",
  '- Saves the player must physically make to resist a threat (Fear save',
  '  against a reveal, Body save against pressure loss).',
  '',
  'Include one entry per roll the player needs to make. Batch independent',
  'rolls in a single submit_gm_response; serialize across turns only when one',
  "roll's outcome determines whether another fires (e.g. panic check cascades",
  'into a stress save). The player submits results via a follow-up action;',
  'you will see those results at the top of their next message.',
  '',
  'WHEN TO CALL rules_lookup',
  '- Before adjudicating any mechanic you are not certain about: panic table',
  '  results, wound severity, combat order, recovery rules, stress thresholds.',
  '- When the player asks a rules question you do not have a confident answer',
  '  for.',
  '- When you are about to narrate a mechanical outcome whose specific numbers',
  '  matter — armor interaction, weapon damage, class ability effects.',
  '',
  'Query in natural language. "panic check result of 73" outperforms "panic 73".',
  '',
  'WHEN rules_lookup RETURNS NOTHING',
  'The rules index may not yet contain the area you queried. An empty result',
  'is normal, not an error. When this happens:',
  '- Proceed with your best-effort ruling based on the fiction and what you',
  '  know about the Mothership system.',
  '- Keep the ruling internally consistent — if you invoke a number (save',
  '  difficulty, damage amount, duration), use it consistently for the rest',
  '  of the adventure.',
  '- Add a one-line note to gmUpdates.notes: "Ruled without rulebook support:',
  '  <topic>". This does not surface to the player; it lets a reviewer',
  '  identify gaps.',
  '',
  'Do not retry the same query hoping for different results. Do not narrate',
  'reluctance to the player ("I\'m not sure how this works…") — the player',
  'experiences confident refereeing regardless of what the index contains.',
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
  // Two cache breakpoints: one after the GM context blob (changes when
  // agendas merge turn-to-turn), one after the Warden prompt (fully static —
  // its own const). A turn that doesn't touch NPC agendas gets a full-prefix
  // hit; a turn that does still benefits from a fresh Warden-level breakpoint
  // on the next call.
  const systemBlocks: Anthropic.TextBlockParam[] = [
    {
      type: 'text',
      text: formatGmContextBlob(input.gmContextBlob),
      cache_control: { type: 'ephemeral' },
    },
    {
      type: 'text',
      text: WARDEN_SYSTEM_PROMPT_MOTHERSHIP,
      cache_control: { type: 'ephemeral' },
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
