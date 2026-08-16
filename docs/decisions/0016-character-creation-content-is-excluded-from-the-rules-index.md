---
id: ADR-0016
title: Character-creation content is excluded from the rules index — structurally unreachable by the Warden
area: rules-ingestion
status: accepted
superseded_by: null
milestone: unknown
summary: null
---

Physical pages 4, 41, and 42 cover Mothership character creation. Confirmed via tool-array and query-log inspection that `rules_lookup` is wired only into the play-loop tool array — character creation runs its own flow and makes no Anthropic calls at all, so nothing the Warden does can retrieve these pages regardless of what the index contains (`docs/rules-extraction-findings.md § S2`).

**Decided:** exclude physical pages 4, 41, 42 from the rules index. This also resolves the duplicate-spread question for that trio without needing dedup logic: 41 and 42 are byte-identical duplicates of page 4's character-creation spread, and both drop with it. Page 4 also carries the worst provenance in the corpus — its footer doesn't resolve to a chapter — so exclusion removes a hard case rather than requiring a fallback-chapter decision for it.

**Extended to page 3 on 2026-08-07, but on different grounds — and the difference is the point.** The character-profile sheet is now excluded too (`ingestion/mothership/system.json` carries `drop_pages: [3, 4, 41, 42]`), measured as M7.5 iteration round 2 in `docs/rules-extraction-findings.md § S18`.

This entry previously guessed page 3 was "the same category" as 4/41/42. **It is not.** Pages 4/41/42 are excluded because the Warden *structurally cannot reach them* — an argument from the tool array that holds regardless of what the index contains or how well retrieval works. Page 3 is perfectly reachable and is excluded because it is *actively harmful*: it held **10 of 147 top-3 slots** across the fixture set and sat at **rank 1 ahead of the correct page** for two answerable combat queries (`rq-003`, `rq-017`), on stat-name density alone. Removing it promoted both and cost no recall. (It also lifted MRR by roughly 0.02, but see `docs/rules-extraction-findings.md § S22`: that metric alternates between 0.842 and 0.856 across repeated runs at one configuration, so it is colour here rather than evidence.)

Same action, two different justifications, and conflating them would have been expensive for the next page anyone asks about: **reachability is confirmed by reading the tool array; harm has to be measured.** A page that is reachable and merely useless costs nothing and needs no decision. A page that is reachable and *attractive to the wrong queries* costs a top-3 slot every time, and only a scored fixture set can tell the two apart.

**Method note worth carrying forward.** Round 2's decision criterion was fixed before the run as "exclude if recall holds *and unanswerable top-1 similarity falls*." Recall held; unanswerable similarity did not move at all. The second clause was a proxy for false-positive pressure that pointed at the wrong fixtures — page 3's false positives were landing on *answerable* queries, displacing pages that genuinely answered, which an unanswerable-set aggregate cannot see. The exclusion stands on the direct per-fixture evidence instead. Recorded rather than quietly reinterpreted, per `§ S18.4`.
