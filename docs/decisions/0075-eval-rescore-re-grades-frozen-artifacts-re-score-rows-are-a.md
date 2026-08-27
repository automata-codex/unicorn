---
id: ADR-0075
title: "`eval:rescore` re-grades frozen artifacts; re-score rows are a distinct row kind"
area: eval-harness
status: accepted
superseded_by: null
milestone: unknown
summary: >-
  What `eval:rescore` is — re-grading frozen artifacts with no Warden calls and no
  database — and why it landed alone, before any checker changed, so its output could
  be validated against independently derived numbers. Records why re-score rows extend
  the run row schema rather than forking it, and why un-regradable rows are carried
  forward rather than dropped.
---

A scoring-only corpus bump or a checker change leaves every `warden-output.json` exactly as valid as it was, so re-grading in place is a real measurement rather than an approximation. `eval:rescore` does that with no Warden calls and no database. It landed alone, before any checker changed, so that it could be validated against numbers derived independently — it reproduces the hand-derived `applicability`-fix corrections in `eval-methodology.md` exactly, including the specific finding that two Sonnet 5 passes on `turn21` flip to `FAILED`.

Rows extend `scoreRowSchema` rather than forking it, so `computeRates` / `rollupByTag` / `summarizeExclusions` consume a re-score unchanged — regenerating a run's rates under new checkers is the whole point, and a second aggregation implementation would be a second thing to keep in step. The cost is that half the inherited columns change tense: `model`/`promptHash` still describe generation, while `corpusVersion`/`harnessVersion` are recomputed and describe scoring. A `rowKind` discriminator keeps the two readers from ever accepting each other's files; it is optional on the run side specifically so `eval:run`'s on-disk format stays byte-identical to every row already written, since the command exists to reproduce historical numbers and a gratuitous format change would be one more thing to rule out when a rate moves.

Rows that cannot be re-graded — the turn errored before producing an artifact — are carried forward rather than dropped, so a re-score file is a complete replacement for a run's rows. Dropping them would silently shrink the error accounting and make a re-scored report look cleaner than the run it describes.
