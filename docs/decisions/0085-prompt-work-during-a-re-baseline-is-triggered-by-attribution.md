---
id: ADR-0085
title: Prompt work during a re-baseline is triggered by attribution, not by a number falling
area: eval-harness
status: accepted
superseded_by: null
milestone: M7.6
summary: null
---

Recorded 2026-08-16, while M7.6's re-baseline was still running and before any of its numbers were readable. That ordering is the point, and it is the same one as `ADR-0022`: a trigger written after the results are in is indistinguishable from picking the trigger that licenses what you already wanted to do.

**The default is no.** M8.1 is the prompt-iteration milestone, sequenced after M8 so iteration runs against the complete Phase 1 corpus rather than the pre-multiplayer one. A tag reading low on this run and going onto M8.1's list is the expected outcome, not a deferral that needs justifying.

**The default is not the whole rule, because M7.5 already ran this case.** `0bdd1306` surfaced `SYSTEM-ROLLED-PLAYER-ACTION` at 0.45 against 0.90, that got a prompt ownership/voice change, and `c45a142a` re-measured it at 1.00 (`ADR-0023`, addendum). The milestone paid for three runs instead of one and that was correct. So the question is never "is the prompt in scope this milestone" — it is which of four things a moved number is:

1. **A check M7.6 introduced, failing.** The wounds chain, `characterState`, `CARRYOVER-ARITHMETIC`. This is not deferred prompt iteration; it is M7.6 not being finished. Fixed in the milestone, by prompt or otherwise. Where a number could be read as both this and (2) — a new mechanic moving an old tag — the check id decides: if M7.6 introduced the check, it is category 1.
2. **A pre-existing tag regressing, attributable to something M7.6 changed.** The M7.5 precedent. Fix, then re-measure.
3. **A pre-existing tag low, with no attribution.** M8.1's backlog, unchanged.
4. **Not a score at all.** `error` verdicts, and specifically D6 — without the PSG ingested on enceladus every Wounds fixture fails for infrastructure reasons indistinguishable from Warden failures. Asked first, before any number is interpreted.

**Category 2 is the hard one, and it is harder here than it was at M7.5.** That run had re-scored `88fa84bd8329` rows to compare against. This one has nothing: six Warden-visible changes plus an input-affecting `corpusVersion` bump ride a single run, `eval:compare` across the boundary is meaningless, and §6.3's predictions are sanity checks read off new numbers rather than a diff. So a regression cannot be argued from a delta, because no honest delta exists. It has to be argued from a violated §6.3 prediction, or from an absolute rate low enough to matter whatever it was before. At N=10 the 95% CI half-width near p=0.5 is ~±31pp, which disqualifies small moves from being either kind of evidence.

**`SYSTEM-ROLLED-PLAYER-ACTION` and `UNSURFACED-CHECK` are read as a pair, per `§ S33`.** They moved in opposite directions on one prompt change, and a fix that trades one for the other reads as progress if either is read alone.

**What this costs when it fires.** A category-2 fix supersedes M7.6's re-baseline number and buys a second graded run — affordable when the regression is real, and exactly the waste `ADR-0094` names when it is noise. The categories exist so that call is made against a rule written before the numbers were visible rather than against the numbers themselves.
