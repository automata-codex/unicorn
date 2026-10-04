---
id: ADR-0120
title: The Warden eval harness is rebuilt from the smallest version, because the maintainer could not explain the first one
area: eval-harness
status: accepted
superseded_by: null
milestone: M7.9
summary: >-
  Raised 2026-09-28, decided 2026-09-29 after a night's sleep. The M7.4 harness
  grew one reasonable step at a time into something its maintainer could not
  explain, so it is replaced rather than walked through and trimmed. The replacement
  (`apps/zoltar-be/eval-v2/`, `task ev2:*`) starts as the smallest harness that
  answers one question — a pass rate over labeled cases, marked by hand — and grows
  only when a real problem calls for it. The old harness stays runnable as the
  answer key, but no further full-corpus run is planned on it; M7.4 and M7.7 close
  unfinished and M7.8 is not built.
---

## The problem

**A blog post about the harness would not come together.** Several attempts in
September 2026 kept stalling on the harness's own concepts — applicability
provenance, what "fixture-gated" means, why a fixture and a check that does not
apply to it are paired at all — and the last one was abandoned on 2026-09-18.

**The maintainer's own statement of it, 2026-09-28:** "I definitely wish I had
taken more time to educate myself and guide you in implementing them, rather
than just letting the LLM do all the work. Now I have a system that I don't
fully understand and can't really explain."

**The harness had also outgrown the project.** Some of it exists because a
number once came out wrong — a false pass, a denominator that shrank to 2, a
comparison that looked like-for-like and was not — and those lessons are real.
Much of the rest is bookkeeping built on bookkeeping: identity hashes with their
goldens, the corpus-bump taxonomy, pre-registration, checks on whether each run
was recorded. That is rigor for a team publishing results, not for one person
deciding whether a prompt change helped. It was added one reasonable step at a
time, and nobody asked whether the whole was still in proportion.

## What was decided

**Rebuild from scratch, starting from the smallest harness that answers one
question.** A question is a pass rate over labeled cases with a stated bar. The
first one, and its result, are in `$ZOLTAR_EVAL_ROOT/eval-v2-runs/README.md`.

**The first version has no automated grader.** Each rep is marked `pass`, `fail`
or `na` by hand. Those marks are also what a later judge is checked against
(spec 025 § 1).

**It grows only when a real problem calls for it.** A judge is built when
marking by hand is what stops a run from happening. The dice-result replay path
is built when a case needs it. Nothing is added because the old harness had it.

**It lives beside the old harness and shares nothing with its outputs.** Code in
`apps/zoltar-be/eval-v2/`, tasks under `ev2:`, runs under
`$ZOLTAR_EVAL_ROOT/eval-v2-runs/`, which `baseline-check` does not read. It does
reuse the old harness's captured fixtures as its cases, and `capture-fixture`
as the way to get more.

**The old harness is the answer key, not a parts bin.** When a number from the
new harness looks wrong, the first step is to work out why, and the second is to
see how the old one handled the same thing. Its fix is adopted where it is now
understood and needed, and declined where it is not worth its cost here.

**The order was: understand the rest of the system first.** Milestone summaries
and flow docs in `docs/human/` came before any rebuild code, so that the
maintainer could tell which parts of the old harness were worth carrying over.
The rebuild itself then started from a one-sentence statement of the question.

**The working rules are part of the decision.** They are in `CLAUDE.md § Working
With Claude`: most review happens at the spec and plan, nothing merges that the
maintainer could not explain in a paragraph, and review depth follows risk.

**Who writes the code changed once.** On 2026-09-29 the rule was that the
maintainer writes the harness and Claude explains and reviews, because a rebuild
"fixes that only if you drive the rewrite". On 2026-10-03 the maintainer asked
Claude to write it instead, with a reviewed spec and plan first and the
maintainer writing the `docs/human/` article for each piece once it is built.

## Alternatives

**Walk through the existing harness and cut what cannot be justified.** Offered
on 2026-09-28 as the lighter option: go through it one component at a time, the
maintainer explaining each back, and remove anything that fails. It was
described then as "less satisfying than starting fresh, but faster". The rebuild
was chosen over it the next morning, for two reasons the maintainer supplied on
2026-10-04: building it from nothing was expected to give the best handle on
the harness, and it is more satisfying than walking through the existing one.
The second reason counts. On a solo project, the route that actually gets
worked on beats the faster one that stalls.

**Have the LLM rebuild it.** Rejected on 2026-09-28: the system was not the main
problem, the maintainer not understanding it was, and a second LLM-built harness
would be a cleaner system that still could not be explained.

**Throw out the whole backend and start fresh.** The maintainer raised this the
same evening and set it aside: "There's a lot of good code there." Most of the
backend does what it should; what was missing was understanding, and a rewrite
is an expensive way to get that. The human docs were the answer to it.

## Costs, accepted

**Two milestones close unfinished and one is not built.** M7.4's fixture-count
bar is never met, M7.7's steered playtest moves to M7.9, and M7.8 is superseded.

**Recorded work on the old harness goes unscored.** No further full-corpus
`eval:run` is planned. `docs/eval-findings.md § S41` is a pre-registration that
will never get a result, and the `assemblyHash` move of 2026-08-31 was never
measured. Both are dispositioned in `docs/eval-methodology.md § Current baseline N`.

**The old harness's numbers and the new one's are not the same measurement.** A
failure-mode tag's rate under a judge and a question's rate under hand marks
can be set side by side on the same fixture, and a difference is a prompt to
work out why, not a movement.

**Hand marking is slow and the criterion drifts.** What counts as a pass shifts
as outputs are read. The criterion is written down per question and dated when
it changes, and earlier runs are re-marked or labeled with the version they
were marked under.

**The old code stays in the repository**, unlinted and no longer grown.

## What would reverse this

No reversal condition was discussed when the decision was made. These were
written with this entry on 2026-10-04.

- **The new harness becomes unexplainable too.** That would mean the cause was
  the way of working and not the old code, and a second rebuild would not fix it.
- **Questions keep needing the old machinery.** If run identity, applicability
  or re-scoring have to be rebuilt one after another, trimming the original
  would have been cheaper.
- **A judge cannot be brought into agreement with hand marks.** Then every run
  stays hand-marked, and the harness cannot grow past what one person can read.
