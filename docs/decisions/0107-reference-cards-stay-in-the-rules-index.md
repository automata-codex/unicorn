---
id: ADR-0107
title: The reference-card duplicates stay in the rules index — a close call settled on a pre-fixed criterion
area: rules-retrieval
status: accepted
milestone: M7.5
superseded_by: null
summary: null
---

**Decided 2026-08-09.** Mothership's printed pp. 1 and 44 are cheat sheets that restate
body content, so their chunks are near-duplicates competing with the pages they summarize
in cosine ranking. The question was whether dropping them improves retrieval enough to
justify losing the cards themselves.

**Run as chunking round 4** (`docs/rules-extraction-findings.md § S28`): physical p.43 —
printed p.44, the back-cover cheat sheet — dropped, paired with
`--include-section-headers`, against a criterion **fixed before the run**: keep the change
only if `recall@3` holds at 97.3% or better and no fixture regresses.

**Every aggregate came back identical.** `recall@3` 97.3%, `warden-observed` 95.7%, MRR
0.883. The mechanism worked exactly as intended — p.44's share of the 147 top-3 slots went
14 → 0. But `rq-010` regressed rank 1 → 2, deterministically: verified across five
pre-round-4 runs and three round-4 runs, so it is not the run-to-run reordering `§ S22`
catalogued.

**Reverted on the criterion.** One fixture regressed, the criterion said no fixture may,
and the criterion was written down first. The revert is explicitly to avoid a close call
being settled by whoever most wanted the result — every aggregate was neutral, which is
precisely the condition under which a pre-registered rule earns its keep.

**Standing decision:** `drop_pages: [3, 4, 41, 42]` in
`ingestion/mothership/system.json`. The reference cards stay in the index. Pages 3, 4, 41
and 42 are excluded for unrelated reasons — see [[0016-character-creation-content-is-excluded-from-the-rules-index]].

**What would settle it properly, and why it is not scoped here.** The real conclusion is
that this fixture set can no longer discriminate at this level: 36 of 37 passing leaves one
fixture of headroom, so any change is being judged on a single data point. `§ S28.4` records
the remedy — re-run round 4 once the fixture set is extended with equipment coverage. That
extension is retrieval-fixture work, and was deliberately left outside M7.5's scope.
