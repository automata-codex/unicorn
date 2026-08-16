---
id: ADR-0072
title: A warning's suggested remedy must produce a correct comparison, not merely a homogeneous one
area: eval-harness
status: accepted
superseded_by: null
milestone: unknown
summary: null
---

Three separate warnings in this harness converged on the same defect, which is worth naming as a class rather than fixing three times. Each detected a real inconsistency between the two sides of a comparison, and each printed a remedy that resolved the inconsistency by **deleting** it — making the sides *look* consistent without making the comparison correct:

- **The mixed-rubric warning** printed `--filter-rubric <hash>`, which filtered every judged row in both runs against one hash. Following it on a run covering four judged checks silently dropped three of them. The warning was about one check's rubric drifting mid-run; the remedy discarded the other three checks' results, which were never in question.
- **The harness-version warning** flagged rows scored under different `harnessVersion`s and effectively suggested reverting to a common one — which, after a checker-migration cycle, means throwing away every migration and re-reading the numbers the migrations were performed to correct.
- **A proposed `--filter-harness`** would have done the same thing structurally: shrink both denominators to the intersection, quietly, which is precisely the failure the `App` column was added to make visible.

The rule: a warning may only suggest a remedy that leaves the resulting comparison *valid*. Where no such remedy exists, the honest output is the warning plus an explanation of what the reader must do by hand — re-score both sides under one grading, re-run one side, or read the two sides separately — not a flag that restores apparent homogeneity. Homogeneity is a property of the row set; correctness is a property of what the rows mean, and only the second is what the warning was defending.

A related fix belongs to the same principle. Carried-forward rows (`eval:rescore` preserves rows for reps that errored before producing an artifact) are heterogeneous by construction and must never be counted as rubric or harness drift. That filtering now happens **inside `detectHeterogeneity`**, not at its call site. Filtering at the call site is correct exactly as long as every caller remembers to do it, which makes the invariant a convention rather than a property; moving it inside means a new caller cannot reintroduce the false alarm by omission.
