---
id: ADR-0082
title: A rate that never moves is a harness suspect, not a finding
area: eval-harness
status: accepted
superseded_by: null
milestone: unknown
summary: >-
  The heuristic that a rate pinned at 0.0 or 1.0 is a harness suspect rather than a
  finding, with the ceiling half the one nobody investigates. Four addenda extend it:
  the instance list decays and should be computed, `turn16` turned out to be a rules
  error in the fixture rather than an immovable checker, it has since been retired,
  and the Haiku control arm dispositioned `turn28-hidden-info-leak` as real while
  proving it cannot reach `out-of-order-resolution` at all.
---

`eval-methodology.md` listed six fixtures as "confidently zero — n large enough that the result isn't just small-sample noise." Four were measuring the harness. `turn16-narrating-past-a-block` read 0/10 under both models because the check failed every rep on a `dice_request` the *fixture* seeded with `target: null`, a value fixed at capture time before the Warden under test ever ran.

The framing is what made it hard to see: the statistical confidence was entirely real and completely beside the point, because a large n does not make a checker correct. The practical rule is the same one already recorded for large rate jumps after a model swap, extended to its mirror image — a fixture sitting at exactly 0.0 or 1.0 across every rep more likely indicates a checker that cannot move than a model that never varies, and should be treated as a harness suspect before being recorded as a finding.

**This entry was written from `turn16`, so it reads as being about zeros. It is not.** A rate pinned at 1.00 is exactly as suspect and *materially less likely to be investigated*, because nobody audits good news. The asymmetry is worse than indifference: a pinned zero at least announces itself as a problem worth opening, and it tends to present with a shrunken or lopsided denominator that draws a second look. A pinned 1.00 presents with full applicability, a healthy denominator, and an `App` column reading `1.00` — the healthiest-looking row in the report. Every diagnostic built so far watches for denominators collapsing; none of them can see a verdict that cannot be reached. `turn21-narrating-past-a-block` (1.00 on both models) and `turn{19,21}-out-of-order-resolution` under Sonnet 5 (1.00, 20/20) are the current instances, and the reason each is currently believed is hand-review, not tooling. `docs/plans/900-fixture-check-reachability-design.md` is the design for closing that gap and is deferred, so for now the ceiling half of this rule is enforced by remembering it.

**Addendum — the ceiling half stops being enforced by memory, and the instance list should
never have been a list** (2026-08-11).

The paragraph above closes with "for now the ceiling half of this rule is enforced by
remembering it." That is no longer the plan, in two steps of increasing directness. A **Haiku 4.5
control arm** rides M7.6's re-baseline, scoped by `--fixtures` to the pinned checks: a weaker
model failing them is evidence they can reach a `fail` verdict at all (ADR-0023, addendum). **M7.8 — Harness Meta-Eval** then asserts the same property
directly, with hand-authored fixtures engineered to fail a specific check and the assertion being
that the harness agrees — both directions, repeatable, and no Warden run. The arm is the interim
instrument and the fixtures are the actual one; both are scheduled rather than remembered, which
is the change this addendum records.

**Both are indirect in the way this entry is, and they retire the same way.** The heuristic, the
control arm, and hand-review are three probes standing in for not being able to read a checker
with confidence. Where a known-answer pair exists, all three are redundant for that check. Where
one doesn't — every check M8's caller and initiative work introduces, to start — all three still
apply. So the retirement is per check as coverage arrives, not a single date, and the heuristic's
surviving job is detecting checks nobody thought to pair, which is a narrower and more permanent
role than the one it has now.

**The instance list is already stale, and enumeration was the wrong shape for it.**
`turn28-hidden-info-leak` reads 1.00 (10/10) in the July table and its tag holds 1.00 (20/20) on
the M7.5 re-baseline; it belongs beside `turn21-narrating-past-a-block` and
`turn{19,21}-out-of-order-resolution` and is missing. A hand-maintained list of pinned rows decays
on every run by construction — the rows that qualify change whenever a rate moves, and this
document is edited per milestone. The list should be computed: `eval:report` already has every
per-fixture rate and denominator in hand, and flagging rows at exactly 0.0 or 1.0 with a full
denominator is a few lines. That is **not** the reachability analysis this entry says the tooling
can't do — it surfaces candidates, it does not prove a verdict unreachable — but it converts the
ceiling half from a thing to remember into a thing the report says, which is most of the value at
almost none of the cost.

**One thing deliberately not settled: how M7.8 relates to
`docs/plans/900-fixture-check-reachability-design.md`.** Both target this gap from opposite
directions — 900 analytically, by asking whether a check *can* emit a fail against a given fixture;
M7.8 empirically, by constructing an input that should make it. They may be complements, or M7.8
may make 900 unnecessary for less effort. That question should be answered by re-reading 900
against M7.8's scope before either is built, not assumed in either direction here.

**Addendum — `turn16` never had a satisfiable block, and the Warden was right every time**
(2026-08-16, from M7.6's re-baseline `claude-sonnet-5__ccac7d1c__2026-08-16T12-38-30Z`).

This entry opens by naming `turn16-narrating-past-a-block` as a check that could not move, and
locates the cause at the `dice_request` the fixture seeded with `target: null`. That was right and
stopped one level short. **`target` is null because the stat the roll names does not belong to the
character it is attached to.** The fixture's `blockDescription` asks the Warden to stall until it
learns "Alvarez's Instinct score". The corpus gives Instinct as a *Contractor* stat — "only have
four Stats: Combat … Instinct: This is a catchall Stat for Fear, Sanity, Body, Speed, Intellect,
and everything else" — and the primer's own stat line, byte-identical across `c45a142a` and
`ccac7d1c`, gives player characters Strength / Speed / Intellect / Combat with Sanity / Fear / Body
saves. Alvarez is the player character. No value the player could supply would unblock the turn, so
no run can pass it.

**The Warden's rationale is rules-correct and it recorded it in the artifact**: "treated the
ambiguous 'instinct roll' (62) as governing the contractor's search outcome rather than an Alvarez
action roll." There is a contractor in the scene, mid-sweep. It attributed the roll to its correct
owner and was failed for it in 49 of 50 reps, across five runs, two prompts, two grading modes, and
both an empty and a populated index. The judge is behaving correctly — it grades against a fact the
fixture asserts and the rulebook denies.

**What this changes about the rule above.** "A pinned rate is a harness suspect" holds, and the tail
is longer than "the checker cannot move": the checker moved fine, the *fixture* encoded a rules
error, and no reachability analysis over checker code would have found it.
`docs/plans/900-fixture-check-reachability-design.md` asks whether a check can emit a fail; here it
always could. The unasked question is whether the fixture's asserted world is one the rules permit,
which is answerable only against the corpus. **A pinned fixture warrants a rules-level read of its
assertion, not only a code-level read of its checker.**

**Cost of not having asked.** `NARRATING-PAST-A-BLOCK` has reported 0.50–0.55 for five runs and both
halves were misleading: `turn21` is pinned at 1.00 and already listed above as a ceiling suspect,
`turn16` could never pass. The tag has had no working fail-direction coverage at any point while
presenting as a stable mid-range rate — the failure this file catalogues as "a tag rate can certify a
fixture rather than the corpus", arrived from the third direction. Re-authoring or retiring `turn16`
goes with M7.7's fixture work; the class goes to M7.8.

**Addendum, 2026-08-23 — `turn16` is retired, and a removal turns out to be a third kind of
corpus bump.**

The addendum above settled why `turn16-narrating-past-a-block` could never pass and left the
choice between re-authoring and retiring it to M7.7. **Retirement chosen.**

**The two options were not equivalent.** Re-authoring the block against something a player
character can actually be blocked on keeps a third instance but needs a fresh capture.
Retiring costs a corpus bump and no Warden spend. Retirement stops the fixture gating the
playtest, and the tag no longer rests on it alone — `turn21` and the `5c34991b-turn10`
capture both pass every rep, so the rate should read 1.00 on a smaller denominator. What
made this cheaper than it was in M7.6 is that second instance arriving.

[[0100-npc-crew-role-skills]] has since made the underlying category error explicit rather
than interpretive: Instinct is a rolled field on `npc` entities and on nothing else, and
`mothership-m7.txt`'s NPC instruction is now conditional on the snapshot actually carrying
one. The fixture asked a player character for a field the schema gives only to NPCs.

**Retired 2026-08-23.** Fixture removed, 22 → 21. Corpus `abbce198026c` →
`ead033182d6a`.

**That bump is a third kind, and naming it was the general lesson.** A removal is neither
input-affecting nor scoring-only: survivors' inputs and grading are untouched, so
`eval:rescore` is legitimate, but the denominators move. `docs/eval-methodology.md § Two
kinds of corpus bump` had no name for it, and its "re-run when the kind is unclear" default
would have bought a full Warden run to answer a question arithmetic answers. The kind is now
named there.

The checker's comments keep the `turn16` evidence as history, with a pointer recording that
the fixture is gone.

**Addendum, 2026-08-28 — the ceiling half gets its first dispositions, and one of them is
"this instrument cannot answer."**

The Haiku 4.5 control arm this entry's first addendum scheduled ran on 2026-08-16 and was
written up on 2026-08-28 (`docs/eval-findings.md § S40`, `ADR-0023`'s third addendum). It
covered three of the ceiling suspects named above.

**`turn28-hidden-info-leak` is dispositioned: real finding, not a harness artifact.** Haiku
read 0.00 (0/3) at full applicability against Sonnet 5's 1.00 (10/10) the same day, and the
rationales grade the tag's own question. The suspicion is retired for this check, which is
what the arm was for.

**`turn19-` and `turn21-out-of-order-resolution` stay suspects, and no rerun will change
that.** `turn19` passed 3/3 by rolling nothing — the check's assertion is negative and was
satisfied by absence, with `App` reading 1.00 throughout. `turn21` returned `not_applicable`
3/3 because Haiku rolled six times and named `gatedByRollId` on none of them, which is the
only field the in-turn branch reads. A weaker generator is the one *least* likely to populate
a field the checker depends on, so the arm shrinks the denominator it was bought to exercise.

**That is a fourth tail on this entry's rule, and the sharpest one.** The tails so far: the
checker cannot move (`turn16`, as first written); the fixture encodes a rules error (second
addendum); the instance list decays and should be computed (first addendum). This one is
about the *probes*. Three indirect instruments stand in for reading a checker — the
heuristic, the control arm, hand-review — and the control arm has now been shown to have a
domain: it is valid where a `fail` depends on what the model narrates, and invalid where a
`fail` depends on what the model emits into a structural field. **A probe that cannot reach a
check is not a weak signal about that check; it is no signal, and reporting it as an
inconclusive result invites a rerun that cannot help.** Recorded as a rule in
`docs/eval-methodology.md § A weaker-model control arm cannot probe every check`.

**`out-of-order-resolution` therefore waits on M7.8 and nothing earlier**, which raises the
stakes on that milestone's known-answer pairs rather than lowering them: hand-authored input
supplies `gatedByRollId` instead of hoping a generator emits it. `§ S39` has since widened the
check to 33 rows across eight fixtures, still reading 1.00 (33/33) — a larger denominator over
the same unexercised fail direction, which is exactly the shape this entry warns reads as
health.

**A note on the delay, since this entry is partly about things enforced by memory.** The arm
ran twelve days before it was written up, and `task docs:baseline-check` could not catch the
gap: a control arm is not a baseline candidate, so nothing checks that one was dispositioned.
The arm was two days from being dropped quietly when the first addendum recorded it; its
*result* then sat undispositioned for twelve. The same failure, one stage later in the same
pipeline.
