---
id: ADR-0077
title: A judged check may carry a structural pre-filter (`judgeGate`), and gated reps are excluded from judge-variance
area: eval-harness
status: accepted
superseded_by: null
milestone: unknown
summary: >-
  `judgeGate` — the structural pre-filter that lets one check span both modes without
  adding a third `mode` value. The non-obvious half is what it does to
  `eval:judge-variance`: gated inputs are deterministic, so leaving them in the
  flip-rate denominator would pull the one number that command exists to produce
  toward zero.
---

`decisions.md` already held that a single check may span both modes. `judgeGate` is the mechanism: an optional function run before the judge call that either settles the rep structurally or returns `null` to mean "the remaining question is genuinely semantic." `mode` stays `'judged'` because that is what `runCheck` dispatches on and what the row records; a third mode value would have forced a fixture-schema change for no gain.

The non-obvious consequence is in `eval:judge-variance`. It selects candidates by `check.mode`, so a gated judged check contributes frozen inputs whose verdicts are deterministic — re-running one N times yields N identical answers, a guaranteed non-flip sitting in the denominator and pulling the measured flip rate toward zero. That is the one number the command exists to produce, and the one that must never be quietly optimistic. Gated inputs are therefore tracked via `judgeInvoked`, excluded from the flip-rate denominator, counted as `gatedInputs`, and named in the headline: a rubric validated on two inputs because a gate absorbed the other eighteen has not been validated.

`judgeContext` is the companion field. When a gate narrows *which* events the semantic question is about — as `unauditable-mapping`'s does — the judge has to be told which ones. The alternative is a rubric describing the structural filter in prose for the model to re-apply, which is a second implementation of the same rule, free to drift, in the one check being rebuilt precisely because prose descriptions of roll classification do not hold.
