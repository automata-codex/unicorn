---
id: ADR-0034
title: State snapshot field consolidation deferred to Milestone 1.2
area: claude-tool-schemas-state
status: accepted
superseded_by: null
milestone: unknown
summary: null
---

The snapshot has accumulated fields across playtesting — `initialState` counters, `world_facts` scratchpad, character state, entity positions, and flags — each solving a distinct problem as it was discovered. At 1.2, when the tool schema is being locked, both sides of the read/write contract should be rationalized together: what Claude reads in the snapshot and what it writes via tools. Doing this earlier would be premature; the playtest data doesn't exist yet to inform good consolidation decisions.
