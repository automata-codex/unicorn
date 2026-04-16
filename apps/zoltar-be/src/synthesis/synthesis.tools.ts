import { zodToJsonSchema } from 'zod-to-json-schema';

import { submitGmContextSchema } from './synthesis.schema';

import type Anthropic from '@anthropic-ai/sdk';

/**
 * Tool and schema definitions that are universal across game systems.
 * System-specific prompt prose lives under `src/synthesis/<system>/`.
 */

const submitGmContextJsonSchema = zodToJsonSchema(submitGmContextSchema, {
  $refStrategy: 'none',
});

export const SUBMIT_GM_CONTEXT_TOOL: Anthropic.Tool = {
  name: 'submit_gm_context',
  description:
    'Commit the synthesized GM context to the database. Call this exactly once when synthesis is complete.',
  input_schema: submitGmContextJsonSchema as Anthropic.Tool['input_schema'],
};

export const SYNTHESIS_TOOLS: Anthropic.Tool[] = [SUBMIT_GM_CONTEXT_TOOL];

export const REPORT_COHERENCE_TOOL: Anthropic.Tool = {
  name: 'report_coherence',
  description:
    'Report hard contradictions between oracle selections, if any, and a recommended resolution path.',
  input_schema: {
    type: 'object',
    properties: {
      conflicts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            category: { type: 'string' },
            description: { type: 'string' },
            rerollable: { type: 'boolean' },
          },
          required: ['category', 'description', 'rerollable'],
        },
      },
      resolution: {
        type: 'string',
        enum: ['proceed', 'reroll', 'surface'],
      },
      rerollCategory: { type: 'string' },
    },
    required: ['conflicts', 'resolution'],
  },
};

export const COHERENCE_TOOLS: Anthropic.Tool[] = [REPORT_COHERENCE_TOOL];
