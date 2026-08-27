---
id: ADR-0076
title: "`applicabilitySource` is declared per check, and the third value is `'ungated'`"
area: eval-harness
status: accepted
superseded_by: null
milestone: unknown
summary: >-
  The three values of `applicabilitySource` — where a check's `not_applicable`
  verdicts come from — required rather than optional so adding a check forces the
  question, and carried on the row so it keeps describing the rules it was scored
  under. Records why `'judged-check'` and `'none'` were both rejected for the third
  value.
---

Every check declares where its `not_applicable` verdicts come from: `'fixture'` (fixture-authored applicability — the scenario decides, denominator fixed before the model runs), `'artifact'` (the turn's own output — the outcome-selection hazard that made 38 of 40 reps read `not_applicable` across two checks), or `'ungated'` (reaches pass or fail every rep). Required rather than optional, with a lookup that throws on an unlisted check, so adding one forces the question rather than defaulting to a guess at the thing the field records. It goes on the row rather than being looked up from the check id at read time, because a migration changes it and a row must keep describing the rules it was scored under.

`'judged-check'` was considered for the third value and rejected. It would put a `mode` value on an applicability axis, and the two coincide only while no check is hybrid — which ended immediately: `narrating-past-a-block` and `unauditable-mapping` are both `mode: 'judged'` with artifact-sourced structural gates, so six checks are judged but only four gate on nothing. A reader would infer the value meant "this check is judged" and be wrong about a third of them. `'none'` was the first choice and was also rejected: an absence-shaped value reads as "not declared yet," which is the exact ambiguity the required field exists to eliminate.
