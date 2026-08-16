---
id: ADR-0044
title: Agentic graph decomposition stays deferred; dice-arbitration evidence weakens the case without closing it
area: claude-turn-loop-correction
status: accepted
superseded_by: null
milestone: unknown
summary: null
---

The standing deferral on a LangGraph-style decomposition of the turn loop carried a falsifiable criterion: harness results should first show which failure categories resist prompt-level fixes. Dice arbitration reliability was the lead candidate for a category that would, on the theory that reliable sequencing of request → resolution → narration is a control-flow problem a single prompt can't be made to solve.

The 4.6 → Sonnet 5 baseline is evidence against that theory for at least half the category. Under corrected applicability gating, `SYSTEM-ROLLED-PLAYER-ACTION` moved from 3/17 (0.18) to 18/20 (0.90) — with an unchanged prompt (`97feadbd`), unchanged fixture content, and no orchestration work of any kind. A category that responds that strongly to a model swap is not a category that resists non-structural fixes, and rebuilding the turn loop to solve something a model upgrade largely solved would have been the expensive answer to the wrong question.

Three reasons this doesn't close the question:

- **The residual is not cosmetic.** 2/20 means the Warden takes a player's declared action out of their hands roughly one combat turn in ten. In solo play, where the player has no table to appeal to, that's an agency violation rather than a polish item. "Mostly fixed" is a weaker result here than the rate suggests.
- **The measurement predates M7.2.** Both runs executed against an empty `rules_chunk` index, and the runaway-lookup errors show a Warden repeatedly unable to resolve what it was looking for. Rules availability plausibly affects when and how it reaches for dice. Re-measure after M7.5's re-baseline — not M7.2's, which no longer exists — before treating 0.90 as the model's actual ceiling.
- **The sequencing half is measured, and agrees.** `OUT-OF-ORDER-RESOLUTION` reads 0.39 (7/18)
  on 4.6 and 1.00 (20/20) on Sonnet 5 under the structural deferred-gate rule. Both
  dice-arbitration categories therefore respond to a model swap alone. The caveat is that only
  the deferred-gate half is measurable: the in-turn case reports `not_applicable` pending
  `gatedByRollId`. Sonnet 5 defers on every rep, so nothing is currently being missed for the
  model we'd be building against — but that is a property of this model's behaviour, not a
  guarantee, and it will need re-checking whenever roll behaviour moves.

Revised criterion for revisiting: re-baseline after M7.5 (the re-baseline moved there from M7.2), and try the cheaper structural option first — the deferred `rollType` / `gatedByRollId` / `actingEntityId` fields on `roll_dice`, which enforce sequencing at the tool schema without decomposing the loop. A graph becomes the right answer only if a measured residual survives both.

**Both conditions of that criterion have now been met, and the answer is: still no graph, but the case has stopped weakening.** (2026-08-09, `docs/rules-extraction-findings.md § S31`.)

The criterion was explicit that 0.90 should not be treated as a ceiling until re-measured against a populated index. Re-measured, `SYSTEM-ROLLED-PLAYER-ACTION` reads **0.45 (9/20)** — half what the deferral rested on. The second condition also fired: the structural fields landed in M7.5, and they did *not* fix this. `gatedByRollId` closed the in-turn sequencing case as designed, and `OUT-OF-ORDER-RESOLUTION` holds at 0.94; but no tool-schema field can express "this roll belongs to the player," because the tool being called is `roll_dice` and the correct behaviour is *not calling it*. A schema constrains the shape of an action taken, not the choice to take it.

So the residual survived both cheaper options, which is exactly the trigger this entry set. It still does not justify a graph, for a reason the criterion did not anticipate:

**The failure is not a control-flow failure.** The evidence for that is `UNSURFACED-CHECK` moving 0.70 → 1.00 in the same run. The Warden is not losing track of sequencing or forgetting to route a request; it correctly identifies that a check is warranted and then resolves it in the wrong place. Decomposing the turn loop into graph nodes would give that misjudgement a more elaborate structure to happen inside.

**The ownership rule is not missing from the prompt, and an earlier draft of this entry was wrong to say so.** `mothership-m7.txt:41` reads "WHEN TO CALL diceRequests — Any roll the player's character makes to resolve their own action," and `:22` gives the mirror rule for `roll_dice`. Both predate M7.5. The Warden is violating an explicit instruction on 9 of 10 reps, and every failing rep resolves the *whole* combat exchange server-side — the player's Combat check, the player's damage, then the NPC's return fire — emitting no `diceRequests` at all.

So the live hypothesis is prompt *structure*, not prompt *content*: M7.5 appended ~50 lines of mechanical primer after the tool-routing rules, written throughout in resolution voice ("call for a FEAR Save", "roll under it"), which never restates who rolls. "Call for a Save" is precisely ambiguous between issuing a request and rolling one. That would make this a recency-and-specificity failure, in which case the fix is placement and voice rather than a new rule.

**Revised criterion, third iteration.** Test the placement hypothesis before anything structural, and re-measure `SYSTEM-ROLLED-PLAYER-ACTION` against `UNSURFACED-CHECK` **as a pair** — the two moved in opposite directions on one prompt change and must be read together, or a fix that trades one for the other will read as progress. A graph becomes the right answer only if the rule, stated unambiguously *and* positioned where it governs the primer, still fails to move the rate. That would be the first real evidence the model understands the rule and cannot act on it — a distinction nothing measured so far supports, and which the presence of the rule at `:41` makes the more urgent question rather than a settled one.

An earlier version of this criterion also called for extending the `turn19`/`turn21` fixtures through the follow-up turn, on the theory that a model which splits a to-hit request from its resolution puts the ordering evidence on a turn the fixture doesn't contain. **That is withdrawn.** The violation window is the captured turn: once a gate is deferred, the turn ends, so any dependent roll landing on the follow-up turn is necessarily *after* the gate resolved. Extending the fixtures would have produced a structurally guaranteed PASS and read as evidence of correct sequencing.
