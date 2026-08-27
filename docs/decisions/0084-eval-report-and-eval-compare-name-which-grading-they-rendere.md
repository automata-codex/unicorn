---
id: ADR-0084
title: "`eval:report` and `eval:compare` name which grading they rendered, and share one default"
area: eval-harness
status: accepted
superseded_by: null
milestone: unknown
summary: >-
  Once `eval:rescore` exists, 'the report for this run' stops being a well-defined
  request. `--scoring` selects, defaulting to the most recent re-score and naming the
  resolved grading in the title, a header bullet and stderr. It lives on both
  `eval:report` and `eval:compare` through one resolver, because a default that moved
  only one would manufacture the cross-grader comparison the flag exists to prevent.
---

Once `eval:rescore` exists a run directory holds several sets of verdicts over the same generator output: the run's own `reps/<nnn>/scores.jsonl` plus one file per re-score pass. "The report for this run" stopped being a well-defined request, and the failure mode is not a crash — it is two people quoting numbers graded by different checker code at each other.

`--scoring run | rescore | rescore=<timestamp>` selects. With no flag the most recent re-score wins, falling back to the run's own scores when there is none: a re-score exists precisely because the run's grades are known stale. That default is only defensible because it is never silent — the resolved grading appears in the report title, in a `- Scoring:` header bullet naming the exact file, and on stderr.

The flag lives on **both** commands, resolved by one shared `resolveScoring`. A default that changed `eval:report` while `eval:compare` kept reading `reps/` would have manufactured the exact cross-grader comparison the flag exists to prevent. `eval:compare` additionally warns when its two sides end up on different gradings — different kinds, or two re-scores under different harness versions — since one `--scoring auto` can still land differently on two runs.
