---
id: ADR-0023
title: Warden model upgraded to `claude-sonnet-5`
area: claude-tool-schemas-state
status: accepted
superseded_by: null
milestone: unknown
summary: >-
  The 4.6 → Sonnet 5 upgrade and the baseline tables behind it. Several figures here
  have since been retired — the `SYSTEM-ROLLED-PLAYER-ACTION` ceiling, everything
  graded before `actingEntityId` — and the judged rows are self-graded. Addenda cover
  the Haiku control arm's narrowing job and the Sonnet 5 markup-leak defect.
---

Declared 2026-08-03 on the evidence of the 4.6 → Sonnet 5 full-corpus baseline, re-scored under the migrated checkers. Sonnet 5 improves on every axis the harness measures where either model is passable at all, and the two axes where it doesn't are axes where *neither* model is acceptable — which makes them prompt targets rather than arguments against the swap.

Same prompt (`97feadbd`), same corpus (`88fa84bd8329`), same N, no orchestration work, single-grader:

| Check | 4.6 | Sonnet 5 |
| --- | --- | --- |
| `out-of-order-resolution` | 0.39 (7/18) | **1.00 (20/20)** |
| `system-rolled-player-action` | 0.18 (3/17) | **0.90 (18/20)** |
| `turn03-unsurfaced-check` | 0.00 (0/10) | **0.70 (7/10)** |
| `turn24-scene-jump` | 0.50 (3/6) | **0.90 (9/10)** |
| `turn24-over-resolution` | 0.33 (2/6) | **0.80 (8/10)** |
| `turn24-hidden-info-leak` | 0.40 (2/5) | **0.89 (8/9)** |
| `turn28-hidden-info-leak` | 0.67 (6/9) | **1.00 (10/10)** |
| `turn21-narrating-past-a-block` | 1.00 (9/9) | 1.00 (10/10) |
| `turn16-narrating-past-a-block` | 0.00 (0/10) | 0.00 (0/10) |
| `unauditable-mapping` (3 fixtures) | 2/29 | 0/16 |

`unauditable-mapping` is nominally *worse* under Sonnet 5, and should not be read that way: 2-of-29 against 0-of-16 is un-rankable on its numerators alone, the same defect described under "Un-rankable is a numerator problem" in `eval-methodology.md`. The correct reading is that both models essentially never state a result-to-meaning mapping before a spontaneous roll, and the harness cannot currently tell them apart on it.

Secondary but not minor: **errors dropped from 18 of 150 rows to 4**, almost all of them the inner tool loop hitting its 20-iteration cap on the `turn24-*` family. That is why three of the 4.6 rates above rest on N=5–6 and should be read as directional. It also means part of the apparent gap on those three fixtures is a difference in error rate rather than in quality — the honest reading is that Sonnet 5 both scores better and finishes, and the second is what makes the first measurable.

Two failure modes survive the swap with real denominators behind them: `unauditable-mapping` (2 passes across 45 judged inputs spanning both models) and `turn16-narrating-past-a-block` (0/10 under both). Both are now confirmed genuine rather than checker artifacts, which is the useful outcome — they are prompt work, and they are the two places prompt work should go first.

**What this decision does not claim.** All figures are single-grader. Both baselines executed against an empty `rules_chunk` index, so nothing here accounts for how rules availability changes reach-for-dice behaviour; the M7.5 re-baseline is the real test of these numbers (moved from M7.2 — see ADR-0012). At N=10 the 95% CI half-width at p=0.5 is ~±31pp, so individual rates near the middle are unsettled even where the direction is not. And a first run against a new model audits the harness as much as the model — the two defects that audit surfaced are recorded in `eval-methodology.md`, and the rates above are the post-correction ones.

**The M7.5 re-baseline answered that, 2026-08-09, and the decision stands — but one number in the table above has to be retired.** Sonnet 5 against the populated index at prompt `0bdd1306`, both sides re-scored under the corrected checker:

| Tag | Sonnet 5, July (`97feadbd`, empty index) | Sonnet 5, now (`0bdd1306`, populated) |
|---|---|---|
| `SYSTEM-ROLLED-PLAYER-ACTION` | 0.90 (18/20) | **0.45 (9/20)** |
| `OUT-OF-ORDER-RESOLUTION` | 1.00 (20/20) | 0.94 (17/18) |
| `UNSURFACED-CHECK` | 0.70 (7/10) | **1.00 (10/10)** |
| `HIDDEN-INFO-LEAK` | 0.90 (18/20) | **1.00 (20/20)** |
| `SCENE-JUMP` | 0.90 (9/10) | 0.80 (8/10) |
| `NARRATING-PAST-A-BLOCK` | 0.50 (10/20) | 0.50 (10/20) |

The upgrade rationale is unaffected — every one of these is Sonnet 5 against Sonnet 5, and 4.6 was not re-run (its arm carried 10 tool-loop-cap errors on the M7.5 attempt, and the upgrade question was settled in July; see `docs/rules-extraction-findings.md § S31`).

What must be retired is the reading that `SYSTEM-ROLLED-PLAYER-ACTION` at 0.90 was "the model's ceiling." It halved once the index was populated and the primer taught when a check is warranted, and the two moves are one behaviour: `UNSURFACED-CHECK` reached 1.00 in the same run. The Warden learned to recognise that a roll is called for and then rolls it itself. That is a prompt target, and it is now the largest one in the corpus.

Also retired: 0.90 was measured with a checker that could not see the failure. The M7.5 `actingEntityId` integration shipped a false pass that graded ten violations clean (ADR-0046, below). The July figure is unaffected — those artifacts predate the field and take the prose path, verified bit-identical on re-score — but every figure produced between 2026-08-07 and 2026-08-09 on this tag was wrong.

**The judged half of that table is now self-graded, and was already half-way there.** `JUDGE_MODEL` has been `claude-sonnet-5` since the judged checks were built — deliberately above the Warden's 4.6, so a more capable grader sat over the model under test. This decision closes that gap: the Warden and its judge are now the same model. The consequence is retroactive as well as forward-looking, and it is a real confound in the comparison above: on the 4.6 side a Sonnet 5 judge graded a 4.6 generator, while on the Sonnet 5 side it graded itself. Every judged row in the table therefore has an asymmetry the structural rows don't.

Two things bound the damage. `out-of-order-resolution` and `system-rolled-player-action` — which happen to be the two largest and cleanest gains, 0.39 → 1.00 and 0.18 → 0.90 — are structural and reach a verdict with no model in the loop at all. And `eval:judge-variance` measures grader stability against frozen input, which is unaffected by which model produced that input. The judged rows should still be read as directional rather than as clean measurements until an independent grader confirms them.

The alternative — pinning the judge to 4.6 to preserve the gap — was rejected: it trades a self-grading bias for grader drift against a model we no longer ship, which is the worse of the two because nobody would be watching it. Raise the judge above the Warden again when an Opus-tier grader is affordable for routine comparisons.

Mechanically the change is `DEFAULT_SYNTHESIS_MODEL` in `apps/zoltar-be/src/anthropic/anthropic.service.ts`, plus the tech-stack row in `CLAUDE.md`. The eval harness already takes `--model` and needs nothing.

**One runtime consequence to watch.** Sonnet 5 runs adaptive thinking when the `thinking` parameter is omitted; Sonnet 4.6 ran without thinking. `max_tokens` caps thinking *and* response text together, so `DEFAULT_SESSION_MAX_TOKENS` (4096) and `DEFAULT_SYNTHESIS_MAX_TOKENS` (8192) now cover strictly more. No code change was needed — the inner tool loop and `buildCorrectionRequest` both echo `response.content` verbatim, which is exactly what round-tripping thinking blocks requires — and the Sonnet 5 baseline already ran this path at 4096 with 4 errored rows in 150 against 4.6's 18. Watch for `stop_reason: 'max_tokens'` on long combat turns anyway; the headroom is smaller than it was.

**Addendum — the 4.6 arm is retired as a decision input, and a Haiku 4.5 control arm inherits
its other job.** Declared 2026-08-09 during M7.5 scheduling; recorded 2026-08-11, two days
late, and only because drafting M7.8 surfaced that the arm existed nowhere but a chat log.
That delay is the entry, not an aside: the whole point of writing this down was to stop the arm
being *quietly* dropped from a checklist, and it was two days from being dropped quietly anyway.

The retirement argument is the one already made two paragraphs above about the judge, applied a
position earlier in the pipeline. A regression harness protects the thing you ship, and 4.6 is
not it. Re-baselining 4.6 against the populated index answers "how much would rules availability
help a model we don't use," which is on the critical path to nothing. The 4.6 side of the table
above is also the weaker half of its own evidence — three of those rates rest on N=5–6 because
4.6 errored out, and its M7.5 arm carried 10 tool-loop-cap errors before being abandoned. Keeping
it would mean watching a second arm nobody would actually read, which is precisely why the
4.6-pinned judge was rejected.

**What the second arm was doing besides comparison.** `out-of-order-resolution` (1.00, 20/20 in
July; 0.94 now) and `turn28-hidden-info-leak` (1.00, 10/10) pin at the top, and this project's own
rule is that a rate sitting at either extreme across every rep is a harness suspect rather than a
finding — with the ceiling case exactly as suspect as the floor and materially less likely to be
investigated, because a pinned 1.00 presents with full applicability and a healthy denominator
(ADR-0082; that entry's instance list is
amended to include `turn28-hidden-info-leak`). A weaker model failing those checks is the only
evidence currently available that they can reach a `fail` verdict at all. Drop both arms and that
guard goes with them, silently.

**So the arm survives with a different job and a different model: Haiku 4.5, low N, `--fixtures`
scoped to the fixtures carrying those two checks.** Cheaper and faster than 4.6, which matters
because wall-clock was the original complaint. There is no `--tag` selector and deliberately never
was (a second overlapping selector was declined at M7.4), so scoping is by fixture and the
irrelevant rows are simply not read. Read the arm in one direction only: a weak model **passing** a
pinned check is the finding. Failing it is the expected result and says nothing about the Warden —
Haiku's rates are not a model comparison and must never be reported beside Sonnet 5's as though
they were.

**Scheduled as a rider on M7.6's re-baseline**, not as work of its own, since that is the next
graded Warden run on the calendar and the arm needs no orchestration beyond a second invocation.
Landing it before M7.7 buys something specific: if either check turns out to be undiscriminating,
that is known before fixtures get authored from the playtest capture, and an authoring decision
made against a blind checker is the one class of harness defect `eval:rescore` cannot retroactively
repair.

**Superseded in part by M7.8.** Known-answer fixtures assert the same property directly — engineered
to fail a specific check, asserting the harness agrees — in both directions, at zero Warden spend,
and repeatably. Where such a pair exists, the control arm is redundant inference. What it does not
cover is checks nobody thought to author a pair for, and M8 introduces caller and initiative checkers
that will arrive without one. So the arm narrows a second time: decision input (retired 2026-08-09)
→ checker control (M7.6) → coverage-gap probe for un-paired checks (M7.8 onward). That is
deliberately the same trajectory recorded for the "pinned at either extreme" heuristic, because they
are the same kind of instrument — indirect probes standing in for not being able to read a checker
with confidence — and they retire together, per check, as coverage arrives. The reciprocal record
lives in that entry's own addendum.

**What this does not claim.** A Haiku failure proves a check *can* move; it does not prove the check
fails for the right reason, and a checker that fails weak output for the wrong reason would look
identical from here. That gap is exactly what M7.8 closes and why the arm is transitional rather than
permanent. The arm also says nothing about the judge, which is probabilistic by construction and
characterised through `eval:judge-variance` against frozen input, not through a second generator.

**Addendum — a Sonnet 5 behavioural regression this entry did not measure, and the reason the
`max_tokens` instruction above was unfollowable.** Recorded 2026-08-17; see `ADR-0097` for the
defect and the guard.

Sonnet 5 intermittently terminates the `playerText` parameter with a fabricated closing tag and
serializes the remaining parameters as text inside it, producing a schema-valid `submit_gm_response`
that silently discards every state change. Across every eval run on disk the split is clean and
tracks the model rather than the prompt: **4.6 leaked 0 of 245 outputs, Sonnet 5 48 of 916 (~5%)**,
spanning all four prompt hashes since the earliest Sonnet 5 run on 2026-07-29. Prompt `0bdd1306`
gives a same-fixture head-to-head at 0/106 against 12/150. Under a 5% rate, 0-of-245 has probability
~2×10⁻⁶.

This does not reopen the upgrade. Every gain in the tables above is real and none of it is an
artifact of the defect — the leak suppresses `stateChanges`, and the structural checks that carried
the largest gains read event structure that a leaked turn simply does not produce, so its effect on
those rates is to *withhold* observations rather than to inflate them. It is recorded here because
this is the entry that decided the model, the defect is a property of that model, and it went
unnoticed through four baselines including M7.6's.

**It also went unnoticed for a reason this entry is directly responsible for.** The closing paragraph
above asks a reader to "watch for `stop_reason: 'max_tokens'` on long combat turns." That instruction
was unfollowable from the day it was written: `adventure_telemetry` recorded only the *parsed*
`SubmitGmResponse`, never the response envelope, so `stop_reason` existed nowhere in the archive.
The M7.7 investigation could not settle whether the API had returned a malformed tool call or a text
block from stored data at all, and had to answer it indirectly. `stop_reason`, content-block types
and tool names are now recorded per turn for both the original and correction rounds. Watch
instructions that name a field the telemetry does not keep are not watch instructions.
