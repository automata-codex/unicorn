import { zodToJsonSchema } from 'zod-to-json-schema';

import { submitGmResponseSchema } from './session.schema';

import type Anthropic from '@anthropic-ai/sdk';

const submitGmResponseJsonSchema = zodToJsonSchema(submitGmResponseSchema, {
  $refStrategy: 'none',
});

export const SUBMIT_GM_RESPONSE_TOOL: Anthropic.Tool = {
  name: 'submit_gm_response',
  description:
    'Submit the GM response for this turn. Call this exactly once to complete every turn. The narrative for the player goes in playerText; state changes are proposals the backend will validate.',
  input_schema: submitGmResponseJsonSchema as Anthropic.Tool['input_schema'],
};

export const SESSION_TOOLS: Anthropic.Tool[] = [SUBMIT_GM_RESPONSE_TOOL];
