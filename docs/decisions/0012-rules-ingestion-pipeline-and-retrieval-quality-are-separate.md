---
id: ADR-0012
title: Rules ingestion pipeline and retrieval quality are separate milestones
area: rules-ingestion
status: accepted
superseded_by: null
milestone: unknown
summary: null
---

M7.2's original spec included post-ingestion validation — an eval re-baseline and a dedicated playtest — as its own Part 6. Both moved out to a new milestone, M7.5 (Rules Retrieval Quality), during M7.2 implementation.

**Why.** M7.5 exists to iterate on chunking quality, potentially as far as a hand-curated Markdown replacement for automated extraction. That iteration changes what's in the index. The re-baseline costs roughly 300 Warden turns plus judge calls (2 models × 15 fixtures × N=10) — buying it against an index about to be re-chunked means buying it twice. Same shape of waste the `roll_dice` schema-field deferral (below) was already guarding against, except worse: that was an unavoidable confound between two things worth measuring together; this would be pure waste, re-measuring the same thing after changing it out from under the measurement.

**What makes deferring the re-baseline safe rather than merely postponing it:** the retrieval eval harness (`task eval:retrieval`) reads index quality for the price of a few Voyage calls — no Anthropic spend at all. "Is this index worth baselining?" gets answered long before anyone pays to baseline it. Without that harness the deferral would just be procrastination with an extra step.

**The completion-criteria split, not just the reasoning, is why they're separate milestones rather than one milestone with a later Part 6.** M7.2's criteria are binary — the CLI runs, rows land, the harness scores. M7.5's is a quality bar — chunking iteration continues until the bar is met or a stopping rule fires. Milestones with quality-bar criteria absorb whatever is adjacent to them; folding the re-baseline into M7.2 would have made M7.2 itself open-ended, defeating the reason for having Done-When criteria at all.

**Consequence:** M7.2 ends with a populated index and a way to measure it — not with evidence the Warden is actually better off. That evidence is M7.5's. The three entries below waiting on a populated-index re-baseline (`ADR-0023`, `ADR-0044`, `ADR-0045`) stay open one milestone longer than an M7.2-only plan would have implied.
