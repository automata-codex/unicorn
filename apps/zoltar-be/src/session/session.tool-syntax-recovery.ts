import type { SubmitGmResponse } from './session.schema';

/**
 * Why a leaked payload could not be put back together. Every reason leaves
 * the turn path doing what it did before recovery existed: one retry, then
 * `SessionToolSyntaxError`.
 */
export type RefusalReason =
  /** `playerText` carries no tool-call markup; there is nothing to recover. */
  | 'no_leak'
  /** The text contains a call to a different tool (`<invoke name="…">`). */
  | 'other_tool_call'
  /** A tag carries an attribute other than `name` (`<entity id="…">`). */
  | 'unexpected_attribute'
  /** A tag names a field the schema does not have at that position. */
  | 'unknown_field'
  /** An array written as tags rather than as JSON. */
  | 'array_as_tags'
  /** A value that is neither valid JSON nor a literal of the expected type. */
  | 'bad_value'
  /** Text after the narration that was not parsed into any field. */
  | 'leftover_text'
  /** A recovered field also arrived as a real parameter. */
  | 'collision'
  /** The merged payload fails `submitGmResponseSchema`. */
  | 'schema_invalid'
  /** The trimmed `playerText` still trips the leak detector. */
  | 'still_leaking';

export type Recovery =
  | { ok: true; payload: SubmitGmResponse }
  | { ok: false; reason: RefusalReason };
