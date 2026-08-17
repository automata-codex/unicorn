---
id: ADR-0097
title: A schema-valid `submit_gm_response` is not necessarily well-formed
area: claude-turn-loop-correction
status: accepted
superseded_by: null
milestone: M7.7
summary: null
---

`playerText` is the only required field on `submitGmResponseSchema`. A response carrying nothing else validates cleanly, so a payload whose remaining parameters were serialized as *text inside the narration* is indistinguishable, to every consumer downstream of the Zod parse, from a turn that genuinely had no state changes. The turn commits, the markup reaches the player, and `stateChanges` / `gmUpdates` / `diceRequests` are discarded — with no rejection, no correction event, and no log line. There was no discard point to instrument: nothing in the code believed anything had gone wrong.

The 2026-08-16 playtest applied state changes on 3 of 58 turns. On 39 it shipped raw tool-call markup inside `playerText` and dropped the payload. The anti-correlation is perfect across all 58 — every turn carrying markup applied nothing, and the discarded payloads were not junk: turn 52 lost an HP delta of −12, a carryover reset with `maxDelta: 0`, and `characterState: [{op: "death_save_pending", entityId: "dr_kennedy", roundsRemaining: 2}]`, all of it mechanically correct.

**The defect is model-side, and the extraction path was never at fault.** The API returned a well-formed `tool_use` block whose only parameter was `playerText`. One response — eval rep `008/turn24-hidden-info-leak` on the `ccac7d1c` re-baseline — carried the markup inside `playerText` *and* a correctly structured `gmUpdates` parameter in the same tool call, which rules out a parameter-boundary parse failure: the parser demonstrably closed the parameter and parsed a subsequent real one. What the model did was write the tag as content.

**It tracks the model, not the prompt, and predates the playtest by two and a half weeks.** Across every eval run on disk, `claude-sonnet-4-6` leaked 0 of 245 outputs and `claude-sonnet-5` 48 of 916 (~5%), spanning all four prompt hashes since 2026-07-29. Prompt `0bdd1306` gives a same-fixture head-to-head: 4.6 at 0/106, Sonnet 5 at 12/150. Under a 5% rate, 0-of-245 has probability ~2×10⁻⁶. `mothership-m7.txt` contains no tool-call examples to imitate, so prompt-induced mimicry is not the seed.

**The playtest's 67% is amplification of that ~5%, not a second defect.** Leaked `playerText` is persisted to `message` verbatim and replayed as assistant history on the next turn, where the model imitates it. Turn 12 leaked with zero contaminated messages in window — the spontaneous seed — and the rate thereafter tracks in-window contamination density (8% at turn 13, 44% at turn 23, 87–100% from turn 42) rather than prompt tokens, which is why turn 13 leaked at 6,952 tokens while turn 50 stayed clean at 15,799. Any single-turn measurement of this defect will read ~5% and understate what a long session does with it.

## Reject and retry, rather than fail the turn

`ADR-0041` caps the correction loop at one re-prompt on the reasoning that a larger retry budget masks a validator-or-prompt bug. This guard retries and does not violate that, because the two are rejecting different things. `ADR-0041` governs *semantic* rejection — the Warden proposed a delta the validator disagrees with — where a second attempt papers over a real disagreement. This is *structural* malformation: the model computed the right payload and put it in the wrong place. Turn 52 is the proof. Retrying recovers a correct answer rather than negotiating for a different one, and there is no outcome to launder, because the guard reads no game state.

So the inner tool loop hands back an error `tool_result` naming the failure and the corrective action, and re-enters — the same machinery a malformed payload already uses, bounded by the same `INNER_TOOL_LOOP_CAP`. A turn that never recovers exhausts the cap and 502s, which is loud. The correction pass throws instead: it is single-shot by construction (`ADR-0042`), so there is nowhere to retry to, and applying a response whose state changes were serialized into prose is worse than failing.

The alternative — flag and pass through — was rejected outright. The whole defect is that a broken payload was indistinguishable from a valid one; preserving that indistinguishability while adding a log entry keeps the data loss and merely annotates it.

## Structural matching, not a semantic classifier

The detector (`apps/zoltar-be/src/session/session.tool-syntax.ts`) matches literal markup only: the canonical tool-call element names as whole tags, plus a tag built from each **top-level property name on the schema itself**. Deriving that half from `submitGmResponseSchema.shape` rather than listing it by hand is what stops the token set and the tool drifting apart when a field is added — a hand-maintained list would go stale silently, in a detector whose entire job is catching things that fail silently.

A "looks like internals" heuristic was rejected. It would be non-deterministic against narration, and this check sits on the path of every turn: a false positive costs a real player a real turn. Deterministic matching also makes the check re-runnable against frozen artifacts, which is what lets the eval harness reuse it (`ADR-0096`) rather than reimplement it — `eval/` already imports from `src/`, so the shared boundary is a wrapper, not a port.

Validated against every playtest turn and every eval `gm_response` on disk — 1,228 real responses — at 87 true positives and 1,141 true negatives, with zero false positives and zero false negatives.

## Only `playerText` is scanned

`gmUpdates.notes` is Warden-private reasoning where naming schema fields is legitimate and frequent — turn 52's notes discuss `resourcePools` and `characterState` by name at length, correctly. Scanning it would trade the real signal for false positives on the field most likely to produce them. The accepted consequence is that markup leaking into `notes` alone goes undetected; it is not player-visible and it does not discard state.

## What this does not claim

The guard catches the symptom. It does not stop the model emitting the markup, and it does not reduce the ~5% base rate — it converts those turns from silent data loss into an extra tool-loop iteration. Expect `toolLoopIterations` to rise slightly and `UNAUDITABLE-MAPPING` applicability to rise with it, since state changes that previously vanished now land; both are the defect clearing, not a regression.

Mitigating the emission is Warden-visible and needs a re-baseline, so it is deferred to M8.1's backlog under `ADR-0085` unless the retry rate proves unacceptable in practice. Nothing here was measured against a model other than the two named above, and the Haiku 4.5 control arm's 9 outputs are far too few to say whether it exhibits the defect at all.

The detector cannot see a leak that uses markup it does not know — a differently-shaped fabricated tag would pass. That is the accepted cost of matching on structure instead of guessing at intent, and the schema-derived half of the token set is what keeps the known surface from shrinking as the tool grows.
