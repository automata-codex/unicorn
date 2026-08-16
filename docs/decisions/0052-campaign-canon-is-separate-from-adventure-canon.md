---
id: ADR-0052
title: Campaign canon is separate from adventure canon
area: api-data-model
status: accepted
superseded_by: null
milestone: unknown
summary: null
---

Adventure GM context blobs are scoped to a single narrative arc. Promoted canon within an adventure is correct at that scope. But facts with campaign-level significance — an overarching antagonist's scheme, a surviving NPC, a faction relationship — need a persistent home that synthesis for future adventures can read.

`campaign_canon` is that home. It mirrors the `pending_canon` lifecycle (same status enum, same review pattern) but scoped to the campaign. Promotion to campaign canon is a second, deliberate editorial step at adventure completion — not automatic, because not every adventure-level fact warrants permanence at the campaign level.

The alternative (feeding prior adventure summaries and GM context blobs directly into synthesis) was rejected because synthesis complexity would grow with campaign length, and there would be no explicit record of what the campaign author considered canonical world truth vs. adventure-local detail.
