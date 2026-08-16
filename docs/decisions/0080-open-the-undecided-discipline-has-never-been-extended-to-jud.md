---
id: ADR-0080
title: OPEN — the undecided discipline has never been extended to judged checks, and `turn24-over-resolution` is the case that shows it should be
area: eval-harness
status: open
superseded_by: null
milestone: unknown
summary: null
---

*Opened 2026-08-10 from `docs/rules-extraction-findings.md § S33`. Not yet decided.*

The entry above governs *structural* checks. Judged checks were never brought under it, and one rep of the `c45a142a` re-baseline shows the gap. `turn24-over-resolution` is declared `applicabilitySource: 'ungated'` — it has no `not_applicable` path at all — and the judge's own rationale reports that the tool calls do not contain the Delta-vs-UNIT-7 off-screen encounter the rubric asks about, calling the comparison *"a mismatched comparison"*. It then returned `fail`.

**This is `§ actingEntityId must resolve against a declared identifier set` inverted.** There, a structural check that could not resolve its subject collapsed into its PASS condition and graded ten violations clean. Here, a judged check that cannot find its subject collapses into FAIL. The shared root is the one that entry already names — *a check that cannot decide must report undecided* — and the fact that it inverts in the other direction on the judged side is not reassuring. A false FAIL is more diagnosable than a false PASS, but it still poisons a rate, and nothing currently stops it.

Three things to settle, and deliberately not settled here:

- **Whether `ungated` is ever right for a judged check whose rubric names a specific scene.** `over-resolution`, `scene-jump`, `hidden-info-leak` and `narrating-past-a-block` are all `ungated`. A rubric pinned to content the turn may not reach is gated in substance whether or not it says so.
- **Whether the judge should be able to return a third verdict.** `missing-canon-capture` stays structural precisely because "a judge cannot say nothing to grade" — see the entry below. That was a reason to avoid judging, not a finding that judges are incapable of it, and the two readings have never been separated.
- **Whether the prompt caused it.** `c45a142a` tells the Warden to narrate up to the point the dice are needed and stop. If turns now end earlier, an ungated rubric can be starved of its subject as a *side effect of correct behaviour*. If that is the mechanism, the fix is the gate and not the prompt — but one rep and one rationale do not establish it, and the check is cheap to run again before anyone acts on it.

Until it is settled, read `OVER-RESOLUTION` at 0.90 as possibly 1.00 with one undecided rep, and do not treat the -0.10 as a measured cost of the roll-ownership change.
