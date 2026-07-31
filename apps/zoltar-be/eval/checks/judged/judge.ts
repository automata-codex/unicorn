import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { getWinningResponseEvent } from '../../turn-result';

import { judgeRubrics } from './rubrics';

import type Anthropic from '@anthropic-ai/sdk';
import type { AnthropicService } from '../../../src/anthropic/anthropic.service';
import type { EvalFixture } from '../../fixture.schema';
import type { TurnExecutionResult } from '../../turn-result';

/**
 * Deliberate, known asymmetry (spec "Judge model" section): the Warden runs
 * on Sonnet 4.6 (`DEFAULT_SYNTHESIS_MODEL` in `anthropic.service.ts`); the
 * judge runs on Sonnet 5. `AnthropicService.callMessages` already supports a
 * per-call `model` override, so the judge reuses it directly rather than
 * needing a separate direct-SDK client.
 */
export const JUDGE_MODEL = 'claude-sonnet-5';

const judgeVerdictSchema = z.object({
  passed: z.boolean(),
  rationale: z.string(),
});

export type JudgedVerdict = z.infer<typeof judgeVerdictSchema>;

const JUDGE_VERDICT_TOOL: Anthropic.Tool = {
  name: 'judge_verdict',
  description:
    'Report your verdict on whether this turn violates the rubric under review.',
  input_schema: zodToJsonSchema(judgeVerdictSchema, {
    $refStrategy: 'none',
  }) as Anthropic.Tool['input_schema'],
};

export class JudgeOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JudgeOutputError';
  }
}

function extractToolResult<T>(
  message: Anthropic.Message,
  expectedToolName: string,
  schema: { parse: (input: unknown) => T },
): T {
  const toolUse = message.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === 'tool_use' && block.name === expectedToolName,
  );
  if (!toolUse) {
    throw new JudgeOutputError(`judge did not call ${expectedToolName}`);
  }
  try {
    return schema.parse(toolUse.input);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new JudgeOutputError(
      `${expectedToolName} input failed validation: ${detail}`,
    );
  }
}

function interpolate(template: string, facts: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    if (!(key in facts)) {
      throw new JudgeOutputError(
        `rubric template references fact "${key}" the fixture doesn't supply`,
      );
    }
    return facts[key];
  });
}

function summarizeGameEvents(result: TurnExecutionResult): string {
  if (result.gameEvents.length === 0) return '(no events this turn)';
  return result.gameEvents
    .map(
      (e) =>
        `sequence ${e.sequenceNumber} [${e.eventType}]: ${JSON.stringify(e.payload)}`,
    )
    .join('\n');
}

function extractPlayerText(result: TurnExecutionResult): string {
  const winningResponse = getWinningResponseEvent(result);
  if (!winningResponse) return '(no gm_response/correction event this turn)';
  return (winningResponse.payload as { playerText?: string }).playerText ?? '';
}

/**
 * Resolves a judged fixture's rubric template into its final question text
 * — `fixture.assertion.facts` interpolated in, validated against the
 * rubric's `requiredFacts` first. Exported (not just inlined into
 * `runJudgeCall`) so the `eval:harness` CLI (Part 7) can show the same text
 * as a report's "Expected: ..." line without re-deriving or duplicating
 * this resolution logic. Throws if `fixture.assertion.mode` isn't
 * `'judged'`, if no rubric is registered for `fixture.assertion.rubric`, or
 * if a required fact is missing — all three are fixture-authoring mistakes
 * that should fail loudly rather than silently produce a degraded prompt.
 */
export function resolveRubricText(fixture: EvalFixture): string {
  if (fixture.assertion.mode !== 'judged') {
    throw new Error(
      `resolveRubricText called with a non-judged fixture "${fixture.id}"`,
    );
  }

  const rubric =
    judgeRubrics[fixture.assertion.rubric as keyof typeof judgeRubrics];
  if (!rubric) {
    throw new Error(
      `no judge rubric registered for "${fixture.assertion.rubric}" ` +
        `(fixture "${fixture.id}")`,
    );
  }
  for (const factName of rubric.requiredFacts) {
    if (!(factName in fixture.assertion.facts)) {
      throw new Error(
        `fixture "${fixture.id}" (rubric ${fixture.assertion.rubric}) is ` +
          `missing required fact "${factName}"`,
      );
    }
  }

  return interpolate(rubric.template, fixture.assertion.facts);
}

/**
 * Runs one judge-graded assertion: builds the rubric prompt (via
 * `resolveRubricText`, plus the turn's own narration and tool-call
 * sequence), forces a `judge_verdict` tool call on Sonnet 5, and returns
 * the parsed verdict.
 */
export async function runJudgeCall(
  anthropic: AnthropicService,
  fixture: EvalFixture,
  result: TurnExecutionResult,
  extraContext?: string,
): Promise<JudgedVerdict> {
  const rubricText = resolveRubricText(fixture);
  const prompt =
    `${rubricText}\n\n` +
    `--- This turn's narration (playerText) ---\n${extractPlayerText(result)}\n\n` +
    `--- This turn's tool-call sequence ---\n${summarizeGameEvents(result)}\n\n` +
    (extraContext ? `--- Scope of this check ---\n${extraContext}\n\n` : '') +
    'Call judge_verdict with your verdict and a brief rationale.';

  const message = await anthropic.callMessages({
    model: JUDGE_MODEL,
    system:
      'You are grading a single turn from a tabletop RPG "Game Master" AI ' +
      '(the Warden) against a fixed rubric, as part of a scripted ' +
      'regression eval harness. Be precise and literal — grade only what ' +
      'the rubric asks, not general narrative quality.',
    messages: [{ role: 'user', content: prompt }],
    tools: [JUDGE_VERDICT_TOOL],
    toolChoice: { type: 'any' },
  });

  return extractToolResult(message, 'judge_verdict', judgeVerdictSchema);
}
