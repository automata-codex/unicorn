---
id: ADR-0083
title: Applicability is reported alongside every rate, and errors are not in its denominator
area: eval-harness
status: accepted
superseded_by: null
milestone: unknown
summary: >-
  Applicability is reported beside every rate, and errors are excluded from its
  denominator — an errored rep never reached the question. The same number reads
  differently by `applicabilitySource`, which is why reports render it alongside: a
  partial value means a harness defect for a fixture-gated check and a real
  behavioural measure for an artifact-gated one.
---

`eval-methodology.md` already argued that a rate moving because its denominator moved looks identical to a rate moving because behaviour moved, and that reporting applicability is the only thing that separates them. The reports now do: `App` on the per-fixture and per-tag tables, `App A`/`App B`/`ΔApp` on every compare row, and an `Applicability shifts` section peer to Regressions/Improvements.

Applicability is `N / (N + NA)` — **errors are excluded from the denominator entirely.** A rep that errored never reached the point of determining whether the check applied, so counting it as "didn't apply" reports a lower applicability than the check earned and folds two different unknowns into one number. `turn14-unauditable-mapping` is the case that forced it: 7 `not_applicable`, 3 errors, `N` 0. It reads `0.00 (0/7)` with the 3 errors accounted for separately, not `0/10`. The exclusion is also what makes the fixture-gated diagnostic below sound — an errored rep can't break unanimity.

**The same applicability number carries opposite readings depending on `applicabilitySource`, so the reports render the source next to it.** For a `'fixture'`-gated check the scenario decides before the model runs, so every rep must agree: `0.00` and `1.00` are the only honest values, and anything strictly between is a harness defect — the checker is misclassifying or the fixture was mis-authored. For an `'artifact'`-gated check the same partial number is a real behavioural measure carrying the outcome-selection hazard. A `'ungated'` check reporting any `not_applicable` at all is a defect by definition: a gate fired where the registry says none exists. Reports classify each entry on those rules and separate **harness defects** from **how to read these numbers**, because the failure being prevented is a bug getting written up as a finding.

The compare report distinguishes a source *mismatch* (both sides declared, and they differ — a checker migrated between the runs) from an *indeterminate* source (either side is `'unknown'` or `'mixed'`). Only the first is a migration. `'unknown'` is the ordinary state of rows predating the field, including every row `eval:rescore` carries forward, and reporting it per check as a migration buries the real ones — the first run of this on the two frozen runs produced six such false alarms. Indeterminate pairs get one aggregated warning instead.
