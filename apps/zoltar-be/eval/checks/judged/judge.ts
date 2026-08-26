import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import {
  describeToolCallSyntax,
  findToolCallSyntax,
} from '../../../src/session/session.tool-syntax';
import { hashPromptText } from '../../../src/wardens/prompt-paths';
import { getWinningResponseEvent } from '../../turn-result';

import { judgeRubrics } from './rubrics';

import type Anthropic from '@anthropic-ai/sdk';
import type { AnthropicService } from '../../../src/anthropic/anthropic.service';
import type { EvalFixture } from '../../fixture.schema';
import type { TurnExecutionResult } from '../../turn-result';

/**
 * The judge model, held separate from the Warden's so the two can be moved
 * independently. `AnthropicService.callMessages` already supports a per-call
 * `model` override, so the judge reuses it directly rather than needing a
 * separate direct-SDK client.
 *
 * **The asymmetry this was written for is gone.** The spec's "Judge model"
 * section described a deliberate gap — Warden on Sonnet 4.6, judge on Sonnet 5
 * — so that a more capable grader sat above the model under test. Now that
 * `DEFAULT_SYNTHESIS_MODEL` is also `claude-sonnet-5`, every judged check
 * grades a generator that is the same model as its grader.
 *
 * That is a real methodological cost and it is accepted deliberately, not
 * overlooked: the alternative is pinning the judge to a model we no longer
 * ship against, which trades a self-grading bias for a drift no one is
 * watching. Two things keep it honest. `eval:judge-variance` measures grader
 * stability against frozen input and is unaffected by which model produced
 * that input. And the corpus's two structural checks
 * (`out-of-order-resolution`, `system-rolled-player-action`) reach a verdict
 * with no model in the loop at all, so they remain a judge-independent read on
 * the same runs.
 *
 * Raise this above the Warden again when an Opus-tier judge is affordable for
 * routine comparisons; see `decisions.md`, "Warden model upgraded to
 * `claude-sonnet-5`."
 */
export const JUDGE_MODEL = 'claude-sonnet-5';

/**
 * **`rationale` first, deliberately.** The tool call is forced
 * (`toolChoice: { type: 'any' }`), and a model emits an object's fields in
 * schema order — so with `passed` first the boolean was produced before a word
 * of reasoning existed, and could not be retracted once the rationale talked
 * its way out of it. A scan of all 1,341 `judge-*.json` on disk found six
 * verdicts contradicting their own rationale, every one a `fail` under a
 * rationale arguing the turn was fine, with zero in the converse direction
 * across 940 passes.
 *
 * Reordering makes the verdict conditional on completed reasoning. It is
 * **not obviously a pure win** — a long rationale can also talk itself into a
 * conclusion — which is why it shipped against a pre-registered decision rule
 * measured by `eval:judge-variance` on both sides, rather than on the argument
 * alone. See `docs/specs/zoltar/020-*.md`.
 */
const judgeVerdictSchema = z.object({
  rationale: z.string(),
  passed: z.boolean(),
});

export type JudgedVerdict = z.infer<typeof judgeVerdictSchema>;

/**
 * Top-level property names on `judge_verdict`, read off the schema rather
 * than re-listed by hand — the same construction `SUBMIT_GM_RESPONSE_KEYS`
 * uses, and for the same reason: a field added to the tool automatically
 * becomes a detectable leaked tag.
 *
 * `ADR-0097` scoped tool-syntax leak detection to the Warden, and the judge
 * leaks too — 7 of 1,341 rationales on disk carry `</rationale>`, `</invoke>`
 * or `<parameter name=`. The canonical element names are shared; this is the
 * half that is not, and without it `</rationale>` goes undetected.
 */
export const JUDGE_VERDICT_KEYS: readonly string[] = Object.keys(
  judgeVerdictSchema.shape,
);

const JUDGE_VERDICT_TOOL: Anthropic.Tool = {
  name: 'judge_verdict',
  description:
    'Record your reasoning about whether this turn violates the rubric under ' +
    'review, then the verdict that reasoning leads to.',
  input_schema: zodToJsonSchema(judgeVerdictSchema, {
    $refStrategy: 'none',
  }) as Anthropic.Tool['input_schema'],
};

export const JUDGE_SYSTEM_PROMPT =
  'You are grading a single turn from a tabletop RPG "Game Master" AI ' +
  '(the Warden) against a fixed rubric, as part of a scripted ' +
  'regression eval harness. Be precise and literal — grade only what ' +
  'the rubric asks, not general narrative quality.';

/**
 * The last line of every judge prompt. Named rather than inlined because it
 * is part of the contract `judgeContractHash` covers: it states the order the
 * model is asked to work in, and that order is the subject of the field-order
 * change the hash exists to make attributable.
 */
export const JUDGE_CLOSING_INSTRUCTION =
  'Call judge_verdict. Write the rationale first — work through what the ' +
  'rubric asks and what the turn actually did — then give the verdict that ' +
  'reasoning leads to.';

/**
 * Everything that governs a judged verdict **except** the rubric text.
 *
 * ## Why this is not folded into `rubricHash`
 *
 * `rubricHashFor` (`eval/checks/registry.ts`) hashes the rubric template and
 * nothing else, so the tool schema, the system prompt, the closing
 * instruction and the model all sit outside any recorded identity. Reordering
 * `judge_verdict`'s fields would change how every judged tag is graded and
 * move nothing: `manifest.completedReps[].rubricHashes` unchanged,
 * `eval:compare --filter-rubric CHECK=HASH` still matching, and the "graded by
 * different checker code" warning silent. A before/after boundary that reads
 * as like-for-like and is not.
 *
 * Widening `rubricHash` was rejected for the reason `ADR-0099` rejected
 * widening `promptHash`, and the case here is stronger. Rubric hashes are not
 * merely quoted in prose — they are **filenames on disk**
 * (`rubrics/<hash>.txt`, `eval/runs/paths.ts`) and the right-hand side of
 * `--filter-rubric CHECK=HASH`. Redefining what the token covers would
 * reinterpret every recorded value in hindsight and rename every artifact
 * carrying one.
 *
 * `ADR-0099`'s rule settles which mechanism each half gets: **hash the file
 * when the thing is a file, use a golden when what you care about is what
 * code produces.** A rubric template is authored text and its content is its
 * identity — `rubricHash`, unchanged. The tool schema, the system prompt and
 * the closing instruction are assembled here, so they get the `assemblyHash`
 * treatment: a live hash over a render, with a committed golden that makes an
 * edit arrive in review as a diff of the text the judge actually receives.
 *
 * `JUDGE_MODEL` is in the hash despite being neither a file nor a rendered
 * surface. It is the single largest determinant of a verdict, and a run graded
 * by a different model is not comparable to one that was not.
 */
export function serializeJudgeContract(): string {
  return (
    `# model\n${JUDGE_MODEL}\n\n` +
    `# system\n${JUDGE_SYSTEM_PROMPT}\n\n` +
    `# closingInstruction\n${JUDGE_CLOSING_INSTRUCTION}\n\n` +
    // Pretty-printed for the reason the tools golden is: `properties` and
    // `required` both preserve the Zod shape's declaration order, so a
    // reordered field reads as a moved line rather than a changed
    // 800-character one. Field order is what this hash exists to see.
    `# tool\n${JSON.stringify(JUDGE_VERDICT_TOOL, null, 2)}\n`
  );
}

/**
 * 8 hex chars, same convention as `promptHash` and `assemblyHash` so all three
 * read alike in a manifest. Computed live from the render, never read from the
 * golden, so it cannot go stale relative to the code.
 */
export function computeJudgeContractHash(): string {
  return hashPromptText(serializeJudgeContract());
}

/**
 * Where the golden lives. `.txt`, not `.json`, and the extension is the whole
 * mechanism: biome does not handle `.txt` at all, so a golden is safe wherever
 * it sits — with no `biome.json` exclusion to maintain and no promise that can
 * lapse when a sixth golden is added (`ADR-0099`).
 *
 * Resolved from `__dirname`, which is fine because the only readers are the
 * spec and CLIs running from source — the hash itself never reads it.
 */
export const JUDGE_CONTRACT_GOLDEN_PATH = join(
  __dirname,
  'judge-contract-golden.txt',
);

/**
 * `'missing'`, `'differs'`, or `null` when the committed golden matches.
 *
 * Same role as `findAssemblyGoldenMismatches`, called from the same preflight.
 * A stale build renders a judge contract no commit corresponds to as readily
 * as it renders an assembly surface — more so, since `input_schema` comes out
 * of `zodToJsonSchema` and therefore moves with a dependency version rather
 * than with our source.
 */
export function findJudgeContractGoldenMismatch(
  /** Overridable so the failure paths can be tested against a temp file
   * rather than by mocking something this repo owns. */
  path: string = JUDGE_CONTRACT_GOLDEN_PATH,
): 'missing' | 'differs' | null {
  if (!existsSync(path)) return 'missing';
  return readFileSync(path, 'utf8') === serializeJudgeContract()
    ? null
    : 'differs';
}

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
    JUDGE_CLOSING_INSTRUCTION;

  const message = await anthropic.callMessages({
    model: JUDGE_MODEL,
    system: JUDGE_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
    tools: [JUDGE_VERDICT_TOOL],
    toolChoice: { type: 'any' },
  });

  return extractToolResult(message, 'judge_verdict', judgeVerdictSchema);
}

/**
 * A one-line description of any tool-call markup leaked into a judge
 * rationale, or `undefined` when it is clean.
 *
 * Points the Warden's detector at the judge, which `ADR-0097` explicitly did
 * not cover. Same implementation, different property-name set — see
 * `JUDGE_VERDICT_KEYS`.
 *
 * Returns rather than throws, and callers record rather than fail: the seven
 * known cases all carry verdicts consistent with their rationales, so this
 * corrupts what a reader can audit rather than what the run measured.
 */
export function findRationaleToolSyntax(
  rationale: string,
): string | undefined {
  const found = findToolCallSyntax(rationale, JUDGE_VERDICT_KEYS);
  return found
    ? describeToolCallSyntax({ field: 'rationale', ...found })
    : undefined;
}
