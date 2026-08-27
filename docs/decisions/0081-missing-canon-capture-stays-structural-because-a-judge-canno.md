---
id: ADR-0081
title: '`missing-canon-capture` stays structural, because a judge cannot say "nothing to grade"'
area: eval-harness
status: accepted
superseded_by: null
milestone: unknown
summary: >-
  The one check reviewed for its prose dependency where the conclusion ran the other
  way. A judge asked about a detail the narration never introduces answers 'it didn't'
  and, the verdict being binary, returns a pass — turning an honest zero denominator
  into a spurious 1.00. The real defect is in the fixture, tracked separately.
---

Reviewed on the same grounds as the others — its marker-phrase gate is a prose dependency, and it had produced zero verdicts across 20 reps — and it is the one case where the conclusion runs the other way.

The verdicts are correct. All 20 reps report `not_applicable` because the narration genuinely never introduces the detail `turn02` asks about: normalising case, whitespace and dash shape finds it in 0 of 20, and a loose search for "veridian internal" alone finds 0 of 20. The near-miss hits are about a different subject entirely.

Migrating it would have made things worse. A judge asked "did the narration introduce the detail, and if so was it captured" would answer "it didn't" on all 20 reps, and — the verdict being binary — return 20 passes. An honest zero denominator would become a spurious 1.00. `not_applicable` is the right verdict and only the structural path can express it.

The real defect is in the fixture, which asks about a detail neither model reproduces and therefore grades nothing. Recapturing it, or authoring the expectation as something other than a literal phrase, is fixture work tracked separately. What the review did change: the marker now matches across dash shape and case, and `pending_canon` is attributed to the *winning* response rather than the first `gm_response`, a latent bug that would have read canon captured by a correction as a failure to capture.
