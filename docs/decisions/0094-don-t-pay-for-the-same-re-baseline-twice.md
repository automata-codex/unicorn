---
id: ADR-0094
title: Don't pay for the same re-baseline twice
area: eval-harness
status: accepted
superseded_by: null
milestone: unknown
summary: null
---

A graded re-baseline is the expensive instrument in this project — roughly 300 Warden turns plus judge calls (2 models × 15 fixtures × N=10). The rule: a change that will force a re-baseline waits for one that is already being bought, rather than triggering its own.

**This entry records a rule that was already operating, not a new one.** It was cited by name in `ADR-0085` before it existed as an entry, and it is applied, in almost these words, in three others:

- `ADR-0012` defers M7.2's re-baseline to M7.5 because "buying it against an index about to be re-chunked means buying it twice," and identifies the same shape of waste already being guarded against by the `roll_dice` field deferral.
- `ADR-0045` lands those deferred `roll_dice` fields on a re-baseline that was being bought anyway, "rather than paying for a second one" — the fields ride the baseline the populated index was already forcing.
- `ADR-0030` records that four pool-delta fields landed simultaneously in M7.6 "to avoid paying for two re-baselines," and that every future change to that object carries the same cost.

**What the rule is not.** It is not a reason to defer a fix worth measuring on its own. A category-2 regression under `ADR-0085` supersedes the current number and buys a second graded run, and that is affordable when the regression is real. The waste named here is narrower: re-measuring the same thing after changing it out from under the measurement. Two things worth measuring separately are worth two runs.

**The practical form.** Schema changes, prompt changes, and index changes that move Warden-visible behaviour are batched onto the next re-baseline already on the calendar. When none is scheduled, the question becomes whether the change alone justifies buying one — usually it does not, and the change waits for company. The corollary, recorded in `ADR-0030`: an object that has already absorbed a batch of changes to amortise one re-baseline makes every later change to it expensive, which is an argument for watching it rather than for filing the concern away.

**Why it took this long to write down.** The rule was legible enough in application that four entries leaned on it without anyone noticing it had no home. It surfaced only when a reference migration found the citation in `ADR-0085` resolving to nothing.
