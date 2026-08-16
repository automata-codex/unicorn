---
id: ADR-0068
title: "`eval:judge-variance` writes beside the run, not into `reps/`"
area: eval-harness
status: accepted
superseded_by: null
milestone: unknown
summary: null
---

`reps/*/scores.jsonl` rows mean "one observation of generator and grader together" — every pass-rate denominator in `eval:report`/`eval:compare` assumes that. A grader-only re-run against frozen input is a different measurement and would corrupt those denominators if appended there. Its output lives in `<run-dir>/judge-variance/<timestamp>.jsonl` instead — an extension beyond the spec, which doesn't say where this command's output goes.
