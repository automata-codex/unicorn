---
id: ADR-0020
title: No similarity floor for `rules_lookup` — the distributions overlap, and the free-looking threshold is fitted to noise
area: rules-retrieval
status: accepted
superseded_by: null
milestone: M7.5
summary: >-
  No similarity floor for `rules_lookup`: the answerable and unanswerable
  distributions interleave rather than abut. The part worth reading is why the
  free-looking 0.34 threshold is rejected — its zero measured cost is an artifact of
  being fitted to a sample minimum — and what would actually make a floor derivable,
  which sits upstream of retrieval.
---

M7.5 Part 4, decided 2026-08-07 against the final index (61 chunks, `drop_pages: [3, 4, 41, 42]`), per `docs/rules-extraction-findings.md § S20`. `RulesLookupService.lookup()` is unchanged: it returns whatever `findByCosineSimilarity` gives back, with no threshold.

**The distributions overlap and interleave.** Answerable-with-a-correct-hit spans 0.342–0.600 (n=35); unanswerable spans 0.270–0.416 (n=12). The overlap zone 0.342–0.416 contains 5 correct answers and 6 unanswerable queries, mixed rather than merely abutting. That is the spec's stated criterion for "no honest floor exists yet," and it is not met.

**The part worth recording is the threshold that looks free.** A floor at 0.34 — just under the answerable minimum — discards **0 of 35** correct answers and suppresses **5 of 12** unanswerable queries. It is the obvious thing to ship.

It is rejected because its measured cost is zero *by construction*. 0.342 is not the lowest similarity a correct answer has; it is the lowest one had in a 35-point sample, and a threshold placed just beneath a sample minimum is fitted to an order statistic. The quantity that would justify it — the distribution's true left tail — is exactly what 35 points cannot estimate.

The asymmetry settles it. A suppressed unanswerable query costs nothing: the Warden already handles empty results correctly, with a prompt block for it and a `gmUpdates.notes` convention for recording the gap. A suppressed *correct* chunk costs a wrong ruling with no trace that anything was withheld. **Recorded rather than merely decided, because the table is persuasive and will be persuasive to the next person who builds it.**

**What would actually make a floor derivable, and it is not chunking.** Three iteration rounds moved these distributions by 0.001 (`§ S15.4` measured 0.342–0.416 on the M7.2 index; `§ S20.1` measures the same on the final one). They could not have moved it: the excluded pages were displacing correct answers on *answerable* queries, while an unanswerable query's top hit was already a legitimate topically-adjacent chunk. Unanswerable queries score 0.27–0.42 because they ask about absent mechanics in *present* vocabulary — `flanking` and `opposed rolls` are not in the book, but `combat`, `armor`, and `cover` are — so the embedding is measuring real proximity and is not wrong.

A floor becomes available when the unanswerable distribution shifts down, and the only lever that moves it is upstream of retrieval: stop generating concept-absent queries, which `§ S9.3` measured at 130 of 344 out-of-corpus queries (37.8%). That is the mechanical-model primer in M7.5 Part 4.6. **Re-derive the floor after the primer has been measured, not after the next chunking change.**
