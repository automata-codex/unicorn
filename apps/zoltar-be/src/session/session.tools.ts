import { zodToJsonSchema } from 'zod-to-json-schema';

import {
  planMoveInputSchema,
  rollDiceInputSchema,
  rulesLookupInputSchema,
  submitGmResponseSchema,
} from './session.schema';

import type Anthropic from '@anthropic-ai/sdk';

const submitGmResponseJsonSchema = zodToJsonSchema(submitGmResponseSchema, {
  $refStrategy: 'none',
});

const rollDiceJsonSchema = zodToJsonSchema(rollDiceInputSchema, {
  $refStrategy: 'none',
});

const rulesLookupJsonSchema = zodToJsonSchema(rulesLookupInputSchema, {
  $refStrategy: 'none',
});

export const SUBMIT_GM_RESPONSE_TOOL: Anthropic.Tool = {
  name: 'submit_gm_response',
  description:
    'Submit the GM response for this turn. Call this exactly once to complete every turn. ' +
    'The narrative for the player goes in playerText; state changes are proposals the backend will validate. ' +
    "Use roll_dice for any roll the GM makes on the world's behalf; use diceRequests for player-facing rolls. " +
    'Call rules_lookup before adjudicating any mechanic you are not certain about.',
  input_schema: submitGmResponseJsonSchema as Anthropic.Tool['input_schema'],
};

export const ROLL_DICE_TOOL: Anthropic.Tool = {
  name: 'roll_dice',
  description:
    'Execute a dice roll server-side. Use for system-generated rolls — NPC actions, GM saves, panic checks, ' +
    'random resolutions. The result is computed by the backend, logged to the audit trail, and returned to you ' +
    'before you narrate. For player-facing rolls where the player interacts with the dice, use diceRequests in ' +
    'submit_gm_response instead.',
  input_schema: rollDiceJsonSchema as Anthropic.Tool['input_schema'],
};

export const RULES_LOOKUP_TOOL: Anthropic.Tool = {
  name: 'rules_lookup',
  description:
    'Semantic search against the rules index for the active game system. Call this instead of inferring mechanics ' +
    'from memory. Query with natural language. Returns the top matching rules chunks with source citations. ' +
    "May return an empty result set if the system's index has not been populated; proceed with a best-effort " +
    'ruling and note the gap in gmUpdates.notes so reviewers can catch divergence.',
  input_schema: rulesLookupJsonSchema as Anthropic.Tool['input_schema'],
};

const planMoveJsonSchema = zodToJsonSchema(planMoveInputSchema, {
  $refStrategy: 'none',
});

/** PROTOTYPE — `docs/eval-findings.md § S76`. */
export const PLAN_MOVE_TOOL: Anthropic.Tool = {
  name: 'plan_move',
  description:
    'Work out the route for a character going from where they are to another place on the ship. The backend ' +
    'holds which deck every place is on and where the character is now, and returns the route: whether it is ' +
    'a walk on one deck or a trip by the ladder shaft, and which decks it starts on, ends on and passes. Call ' +
    'this before you narrate any character going from one place to another, and narrate the route it returns.',
  input_schema: planMoveJsonSchema as Anthropic.Tool['input_schema'],
};

export const SESSION_TOOLS: Anthropic.Tool[] = [
  SUBMIT_GM_RESPONSE_TOOL,
  ROLL_DICE_TOOL,
  RULES_LOOKUP_TOOL,
  PLAN_MOVE_TOOL,
];
