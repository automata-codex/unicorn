---
id: ADR-0024
title: Tool use over prompt instructions for structured output
area: claude-tool-schemas-state
status: accepted
superseded_by: null
milestone: unknown
summary: >-
  Structured output goes through forced tool calls rather than prompt-instructed JSON.
  The addendum narrows the guarantee substantially: tool use enforces the schema, not
  that the model put its content in the right field, and the category of malformed
  response this entry claims to eliminate relocated inside a valid parameter. Schema
  validity is a floor, not a proof.
---

Claude is required to call `submit_gm_response` and `submit_gm_context` rather than producing structured JSON in plain text. Tool use enforces the schema at the API level and eliminates a whole category of malformed response runtime errors. Prompt instructions alone are not sufficient for this guarantee.

**Addendum — the guarantee is narrower than this entry states, and the gap cost 39 turns.** Recorded 2026-08-17 on the evidence of the 2026-08-16 playtest (`ADR-0097`).

Tool use enforces *the schema*. It does not enforce that the model put its content in the right field, and the category of malformed response this entry claims to eliminate did not disappear — it relocated inside a valid parameter, where schema enforcement cannot reach it by construction. `playerText` is the only required field on `submitGmResponseSchema`, so a response that serialized its remaining parameters as text inside the narration is a *valid* tool call carrying a malformed payload. The API accepted it, Zod accepted it, and the turn committed while discarding every state change the Warden had computed.

The sentence above still holds against its actual alternative: prompt-instructed JSON in a text block would have failed more often and more visibly. What it must not be read as is a guarantee that a `tool_use` block is well-formed. Schema validity is a floor, not a proof, and the fields a schema marks optional are precisely where a malformed response can hide without tripping anything. Payload-level well-formedness is a separate check, and it now exists (`ADR-0097`).
