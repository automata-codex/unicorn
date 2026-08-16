---
id: ADR-0074
title: A structural check may read event and state structure; it may not classify prose
area: eval-harness
status: accepted
superseded_by: null
milestone: unknown
summary: null
---

Structural checkers began as regexes over `purpose` and `playerText` because the alternative
looked like an API call per rep for questions that seemed mechanically answerable. Every
structural check that has ever produced a verdict has since been found to misreport, in all
three possible directions: `system-rolled-player-action` returned false PASS on a
system-rolled to-hit its damage-only matcher didn't recognize; `unauditable-mapping`'s
`MAPPING_STATED_PATTERN` is content-blind enough that any `digit + (:|=|means|indicates)`
satisfies it, while `NARRATIVE_SELECTION_PATTERN` returned false NOT_APPLICABLE on twelve
turns of `"Ambient station event check"` — the model's own dominant phrasing for exactly the
roll type the check exists to grade; `narrating-past-a-block` returns false FAIL on
commitment language (`"you put two rounds into..."` before the roll is issued), which its
own doc comment already flags as the class the `\bif\b` guard was added to fix. Patching
does not converge: `NARRATIVE_SELECTION_PATTERN` and `narrating-past-a-block` have each been
widened once after a real-run miss and failed again the same way, and `UNSURFACED-CHECK`
gave up and migrated to a judge call after its own false pass. The 4.6 → Sonnet 5 swap
quantified why: `NARRATIVE_SELECTION_PATTERN` reached a verdict on 15 of 20 reps under 4.6
and 4 of 20 under Sonnet 5, against an unchanged prompt. A regex over prose encodes the idiom
of whichever model was current when it was written, and silently stops matching when that
changes.

The dividing line is what the checker reads, not how hard the question sounds. Event and
state structure — does a pending `dice_request` exist, in what sequence did events land,
what changed in `resourcePools`, does a roll resolve an antecedent request — are facts the
backend produced, identical in shape across models and across prompt revisions. Narrative
prose is where model idiom lives. So structural remains the default wherever the question
can be answered from structure, since it is deterministic, free, and carries no judge
variance; it is simply not available for questions whose answer lives in wording. A single
check may span both: `unauditable-mapping` keeps a structural pre-filter on the shape of a
spontaneous GM-side roll (single die, no modifier, no `target`, resolving no pending
request) and sends only the remaining semantic question — does `purpose` enumerate outcomes
covering the notation's range — to the judge.

The line has a third case, discovered by applying it. Some questions are neither semantic nor
answerable from current structure: they would be structural if the payload recorded a fact it
doesn't. Ordering two rolls requires knowing which depends on which — sequence numbers show
what happened first, not what gated what — and attributing a Warden-side roll to the player
requires `actingEntityId`, since `actorType` is `'gm'` for every such roll whether it stands
in for an NPC or the player. Those wait on the deferred `roll_dice` fields, and the honest
interim verdict is `not_applicable` naming the missing field, not a regex approximating it.
That reframes those fields: they are measurement infrastructure as much as a candidate fix
for the Warden's own sequencing.

**Closed in M7.5 — the third case had a shelf life, and this is what the end of it looks
like.** `gatedByRollId` and `actingEntityId` landed on `roll_dice` with the prompt
instructions to populate them, and both questions moved from the third case into the first:
`out-of-order-resolution` decides in-turn ordering by comparing a named gate's sequence
number against the roll that names it, and `system-rolled-player-action` attributes through
`actingEntityId` without reading `purpose` at all. **On output produced after M7.5 there is
no prose left in the structural checks.**

Two things about *how* it closed are worth more than the fact that it did. First, the
interim verdict was the right instrument and not merely an honest one — `not_applicable`
naming the missing field is what made the gap countable, and a regex approximation would
have made the same turns read as graded and left nothing pointing at the fix. Second, the
prose path is **kept, not deleted**, and every consumer branches on field *presence* rather
than on `fixtureSchemaVersion`. Frozen artifacts from the `88fa84bd8329` runs predate the
fields entirely, and `eval:rescore` has to keep grading them the way it always did or the
comparison history `eval:compare` pairs on is silently severed. Version-gating would have
been the obvious mechanism and the wrong one: the fixture version records what
`capture-fixture` captured, and it captures no game events at all.

The residual, stated so it is not assumed closed: `out-of-order-resolution`'s deferred-gate
branch still has its known false FAIL. `gatedByRollId` records which *roll* gated a roll;
that branch asks whether a roll was gated by a pending *request*, which is a different link
and still unrecorded.

The line has a second constraint, running the other way. A judged verdict is binary, so a
judge cannot say "nothing to grade" — asked about a detail the narration never introduced, it
answers "it didn't" and returns a pass, converting an honest zero denominator into a spurious
1.00. Applicability gating therefore stays structural even on judged checks. `judgeGate` is
the mechanism, and `missing-canon-capture` is the case where that constraint decided against
migrating at all.

But `judgeGate` is only available where the applicability question is *itself* structurally
answerable, which is narrower than it first reads. `narrating-past-a-block` is the
counter-case. Its pre-migration gate was prose-dependent in both directions —
`BLOCK_ACKNOWLEDGING_CONTINUATION_PATTERN` over `playerText` to decide the Warden had
acknowledged a block, `STAT_CHECK_PATTERN` over `purpose` to decide a roll was the blocked
one — so there was nothing structural to port, and `ungated` is the honest declaration rather
than a gap someone forgot to fill. The binary-verdict hazard is genuinely live for that check;
it is managed by watching exclusion counts and applicability, not by manufacturing a gate.
Gating anyway, on "was there a block at all," would have cost `turn16` 19 of its 20 reps
across the two frozen runs — deleting the corpus's clearest surviving failure to guard against
a spurious pass that was not occurring.

Applying the line as it currently stands: `system-rolled-player-action` stays structural, and
reports undecided rather than guessing when its prose binding fails. `out-of-order-resolution`
stays structural for the deferred-gate case and declines the in-turn case as schema-blocked —
it was *not* structure-only when this entry was first written; `CONDITIONAL_DAMAGE_PATTERN`
was prose classification and was the only clause firing under 4.6. `unauditable-mapping` and
`narrating-past-a-block` migrated to judged with structural gates. `missing-canon-capture`
stays structural; its zero denominator is a fixture defect, not a checker one. Migration is
cheap by construction: `checkId` deliberately does not encode `checkMode` (see above), so a
check changes mode without un-pairing its own comparison history.

**Addendum — the harness writes a `character_sheet` row the sheet schema would reject, and
that is load-bearing**

`harness-runner.ts:326-328` inserts `data: { entityId: canonicalPlayerEntityId }` — one of
nine required fields. It works because **no read path anywhere parses
`character_sheet.data`**; the sheet is validated on write only
(`milestones/m7.6-code-inventory.md`, `e1cdaac`). The partial row is deliberate: without
it `getPlayerEntityIds` returns `[]` and the run measures a code path production doesn't
take (reasoning at `harness-runner.ts:195-207`).

**Recorded because it constrains a milestone whose whole subject is sheet fidelity.**
Adding read-side validation of `character_sheet.data` — the natural instinct when
correcting a schema — breaks every eval run. M7.6 must either leave the read path
unvalidated or change the harness seed in the same milestone; discovering this during
implementation would surface as the harness failing for reasons unrelated to the change
under test.
