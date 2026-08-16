---
id: ADR-0042
title: The correction loop does not re-enter the inner tool loop
area: claude-turn-loop-correction
status: accepted
superseded_by: null
milestone: unknown
summary: null
---

M7 introduces an inner tool-use loop in `SessionService.sendMessage`: Claude may call `roll_dice` and `rules_lookup` any number of times before issuing `submit_gm_response`. When the M6 validator subsequently rejects the proposed `stateChanges`, the correction pass re-prompts Claude with `tool_choice: { type: 'tool', name: 'submit_gm_response' }` — explicitly narrowing away from `{ type: 'any' }` — so the correction cannot invoke additional tools. The rejection is handed to Claude as a `tool_result { is_error: true }` and Claude must resubmit directly.

Rationale: dice and rules retrieval are inputs to Claude's reasoning. By the time `submit_gm_response` arrives, those tools have already done their work against the live fiction. If the proposed state changes are invalid, the fix is narrative (restate the same fiction with a valid delta), not mechanical (re-roll). Letting the correction path re-invoke `roll_dice` would also make dice-outcome manipulation possible ("that wasn't the result I wanted, reroll until validation passes") — a principle violation that's easy to avoid by construction.

Implementation: `buildCorrectionRequest` in `session.correction.ts` hardcodes `toolChoice: { type: 'tool', name: 'submit_gm_response' }` in its return, overriding whatever was on the original request. The unit test `session.correction.spec.ts` asserts this override explicitly.
