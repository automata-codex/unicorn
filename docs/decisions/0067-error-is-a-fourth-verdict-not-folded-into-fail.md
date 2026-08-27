---
id: ADR-0067
title: "`error` is a fourth verdict, not folded into `fail`"
area: eval-harness
status: accepted
superseded_by: null
milestone: unknown
summary: >-
  Why a turn that never completed is its own verdict rather than a `fail`: conflating
  a transient failure with a real regression corrupts `pass / (pass + fail)`, the one
  number the harness exists to produce. Errors leave the denominator, stay counted,
  and surface in their own report section.
---

M7.4's `runHarness` mapped any turn that didn't complete — a live model call producing output that failed schema validation, the inner tool loop exhausting its iteration cap, a checker rejecting a malformed fixture — to a **failed** `FixtureResult`, with a comment explaining that aborting the whole run over one flaky turn was worse than mislabeling it. That comment was right about the tradeoff and wrong about the fix: a transient failure and a real regression are different events, and conflating them under `fail` corrupts the one number (`pass / (pass + fail)`) the harness exists to produce. `error` is its own verdict — excluded from the denominator but counted and surfaced in `eval:report`'s Errors section, so it can never be silently absorbed into a regression-looking rate. Confirmed for real during the multi-run harness's own manual verification: the inner tool loop hit its 20-iteration cap on a busy off-screen-combat turn, and the resulting row correctly read as `error`, not as a phantom SCENE-JUMP failure.
