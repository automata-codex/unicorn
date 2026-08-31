import { zodToJsonSchema } from 'zod-to-json-schema';

import {
  coherenceReportSchema,
  submitGmContextSchema,
} from './synthesis.schema';

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

/**
 * Generated from `coherenceReportSchema`, which the service already parses the
 * model's response with. It was a hand-written JSON literal until 2026-08-31 —
 * two definitions of one shape, maintained separately, which is the shape the
 * schema-is-the-home policy exists to remove.
 *
 * **`coherenceReportSchema`'s `.refine` does not survive the conversion.**
 * "`rerollCategory` is required when `resolution` is `reroll`" is a cross-field
 * rule and JSON Schema as `zodToJsonSchema` emits it cannot say so. Nothing is
 * weakened on the backend — the refine still runs when the response is parsed,
 * so a violation is rejected either way. What would have been lost is the model
 * being *told*, which is why the rule is restated in `rerollCategory`'s own
 * `.describe` and in `buildMothershipCoherenceCheckPrompt`'s resolution guide.
 */
const coherenceReportJsonSchema = zodToJsonSchema(coherenceReportSchema, {
  $refStrategy: 'none',
});

export const REPORT_COHERENCE_TOOL: Anthropic.Tool = {
  name: 'report_coherence',
  description:
    'Report hard contradictions between oracle selections, if any, and a recommended resolution path.',
  input_schema: coherenceReportJsonSchema as Anthropic.Tool['input_schema'],
};

export const COHERENCE_TOOLS: Anthropic.Tool[] = [REPORT_COHERENCE_TOOL];
