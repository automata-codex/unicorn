import { submitGmResponseSchema } from './session.schema';

import type { SubmitGmResponse } from './session.schema';

/**
 * Detects raw tool-call markup that has leaked into a `submit_gm_response`
 * payload's player-facing text.
 *
 * ## What this defends against
 *
 * The model occasionally terminates the `playerText` parameter with a
 * fabricated closing tag — `</playerText>`, built from the JSON property
 * name rather than the canonical `</parameter>` — and then serializes the
 * *remaining* parameters as literal text inside the string it is still
 * writing. What arrives is a structurally valid `tool_use` block whose input
 * is `{ playerText: "…narration…</playerText><parameter name=\"stateChanges\">…" }`.
 *
 * That payload passes `submitGmResponseSchema` cleanly, because `playerText`
 * is the only required field. So the turn succeeds, raw markup reaches the
 * player, and every state change the Warden actually computed is discarded
 * without a single log line. The 2026-08-16 playtest lost the payload on 39
 * of 58 turns this way, silently.
 *
 * The leak is model-side, not a parse failure: responses have been observed
 * carrying this markup inside `playerText` *and* a correctly structured
 * `gmUpdates` parameter in the same tool call. Measured base rate on
 * `claude-sonnet-5` is ~5% per turn; it compounds because leaked text is
 * persisted and replayed as conversation history, which the model then
 * imitates.
 *
 * ## Why matching is structural, not semantic
 *
 * The token set is literal markup only: the canonical tool-call element
 * names, plus a tag built from each top-level property name on
 * `submitGmResponseSchema`. There is no "looks like internals" heuristic —
 * the same input always yields the same verdict, and the property-name half
 * is derived from the schema so the two cannot drift when a field is added.
 *
 * Only `playerText` is scanned. It is the field the player sees and the one
 * the defect carries in. `gmUpdates.notes` is Warden-private reasoning where
 * naming schema fields is legitimate and frequent, so scanning it would
 * trade a real signal for false positives.
 */

/**
 * Canonical tool-call element names. Matched only as whole tags — opening
 * (with or without attributes) or closing — never as bare words, so prose
 * like "if you invoke a number" cannot trip the check.
 */
const TOOL_CALL_ELEMENTS = [
  'invoke',
  'parameter',
  'function_calls',
  'function_results',
] as const;

/**
 * Top-level property names on `submit_gm_response`, read off the schema
 * rather than re-listed by hand. A field added to the tool automatically
 * becomes a detectable leaked tag.
 */
export const SUBMIT_GM_RESPONSE_KEYS: readonly string[] = Object.keys(
  submitGmResponseSchema.shape,
);

/**
 * `</?name…>`. The `\b` after the alternation stops `<parameterization>`
 * from matching `parameter`.
 */
function tagPattern(names: readonly string[]): RegExp {
  return new RegExp(`</?(?:${names.join('|')})\\b[^>]*>`, 'g');
}

const TOOL_CALL_TAGS = tagPattern(TOOL_CALL_ELEMENTS);

/**
 * Compiled property-name patterns, one per distinct key set. Cached because
 * `findToolCallSyntax` is called once per graded turn and once per judge
 * rationale, and there are exactly two key sets in practice — recompiling a
 * `RegExp` on every call to support that would be silly.
 */
const propertyNamePatterns = new Map<string, RegExp>();

function propertyNameTags(names: readonly string[]): RegExp {
  const key = names.join('|');
  let pattern = propertyNamePatterns.get(key);
  if (!pattern) {
    pattern = tagPattern(names);
    propertyNamePatterns.set(key, pattern);
  }
  return pattern;
}

export interface ToolCallSyntaxFinding {
  /** Payload field the markup was found in — always `playerText` today. */
  field: string;
  /**
   * Distinct literal tokens matched, in order of first appearance, capped so
   * a runaway payload can't produce an unbounded log line.
   */
  tokens: string[];
  /** Offset of the first match — where the payload went wrong. */
  index: number;
  /** Total matches, including duplicates beyond the reported-token cap. */
  matchCount: number;
}

const MAX_REPORTED_TOKENS = 6;

/**
 * Scans one string for leaked tool-call markup. Exported separately so the
 * eval harness can run the identical detector over a recorded `playerText`
 * without booting the session service (see ADR-0096's `tagIndependent`
 * check) — the point is that there is exactly one implementation.
 */
export function findToolCallSyntax(
  text: string,
  /**
   * Property names whose tag form counts as leaked markup — the schema half
   * of the token set. Defaults to `submit_gm_response`'s, so the Warden path
   * is unchanged by construction.
   *
   * **Parameterised for the judge, and it is not a formality.** 7 of 1,341
   * rationales on disk carry leaked markup, and `</rationale>` is a
   * `judge_verdict` property name: against the default set the canonical
   * elements would catch `</invoke>` and `<parameter name=` and miss it
   * entirely. One implementation stays one implementation — this is a
   * signature change, not a second detector.
   */
  propertyNames: readonly string[] = SUBMIT_GM_RESPONSE_KEYS,
): Omit<ToolCallSyntaxFinding, 'field'> | null {
  const matches: { token: string; index: number }[] = [];
  for (const pattern of [TOOL_CALL_TAGS, propertyNameTags(propertyNames)]) {
    // `lastIndex` is per-RegExp state and these are module-level constants,
    // so reset before scanning rather than trusting the previous caller.
    pattern.lastIndex = 0;
    for (const m of text.matchAll(pattern)) {
      matches.push({ token: m[0], index: m.index });
    }
  }
  if (matches.length === 0) return null;

  matches.sort((a, b) => a.index - b.index);

  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const m of matches) {
    if (seen.has(m.token)) continue;
    seen.add(m.token);
    if (tokens.length < MAX_REPORTED_TOKENS) tokens.push(m.token);
  }

  return { tokens, index: matches[0].index, matchCount: matches.length };
}

/** Payload-level entry point. `null` means clean. */
export function detectToolCallSyntax(
  payload: SubmitGmResponse,
): ToolCallSyntaxFinding | null {
  const found = findToolCallSyntax(payload.playerText);
  return found ? { field: 'playerText', ...found } : null;
}

/**
 * Renders a finding for a log line or exception message. Kept next to the
 * detector so the turn path and the correction path cannot describe the same
 * defect two different ways.
 */
export function describeToolCallSyntax(finding: ToolCallSyntaxFinding): string {
  return (
    `${finding.field} contains raw tool-call syntax ` +
    `(${finding.matchCount} match(es), first at offset ${finding.index}: ` +
    `${finding.tokens.join(' ')}). The remaining tool parameters were ` +
    `serialized as text inside ${finding.field} instead of being sent as ` +
    `parameters, so stateChanges / gmUpdates / diceRequests would be ` +
    `silently discarded.`
  );
}

/**
 * The instruction handed back to Claude as an error `tool_result` when the
 * turn path rejects a leaked payload. Deliberately names the failure and the
 * corrective action rather than just saying "invalid" — a bare rejection
 * tends to produce the same malformed shape again.
 */
export function toolCallSyntaxRetryInstruction(
  finding: ToolCallSyntaxFinding,
): string {
  return (
    `Invalid submit_gm_response: ${describeToolCallSyntax(finding)} ` +
    `Call submit_gm_response again. Put ONLY the narration the player should ` +
    `read in ${finding.field} — no XML tags, no closing tags, nothing that ` +
    `looks like tool-call markup — and send stateChanges, gmUpdates and ` +
    `diceRequests as separate tool parameters.`
  );
}
