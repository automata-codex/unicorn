---
id: ADR-0022
title: The retrieval stopping rule is measured on the metrics with headroom, not on the saturated one
area: rules-retrieval
status: accepted
superseded_by: null
milestone: M7.5
summary: null
---

`docs/specs/zoltar/013-m7.5-rules-retrieval-quality.md § The stopping rule`
originally closed M7.5 "after three full iteration rounds that do not
improve `recall@3` on the `authored` set by more than 5 percentage points in
aggregate."

**`authored` recall@3 is 100.0%** (`docs/rules-extraction-findings.md
§ S15.2`, confirmed in `§ S16.1`). It cannot improve by any amount, so that
condition fires after round three unconditionally — including after a round
that took `warden-observed` from 91.3% to 100%. The rule was measuring
progress on the one axis with no headroom left, which makes it a round
counter dressed as a quality test.

**Decided:** the no-progress test is evaluated on `recall@3` over the
**answerable set as a whole** and on **`warden-observed`** specifically, with
`authored` held as a **regression floor** rather than a growth target. The
5 pp threshold and the three-round budget are unchanged; only the axis moves.
A round that drops `authored` below 100% has made things worse regardless of
what it did elsewhere, and is logged as such.

**Corrected before round 1 ran, not after.** That ordering is the whole point
— a stopping rule amended once results are in is indistinguishable from
moving the goalposts, which is the same hazard as choosing a bar after seeing
the numbers. The spec was amended in place and this entry written before any
lever was pulled.

**The general lesson, which is not about this rule.** A metric that is
saturated at authoring time is a bad progress test and a fine regression
test, and the two roles are easy to conflate because the same number serves
both. `authored` at 100% still earns its place in the report — a chunking
change that broke it would be caught immediately — but "did this round help"
has to be asked of a number that can answer. Worth checking whenever a
threshold is written against a metric that is already at its ceiling.
