---
id: ADR-0048
title: Phase 1 continuity is carried by cached GM context and working-memory fields, not a rolling summary
area: claude-continuity-spatial
status: accepted
superseded_by: null
milestone: unknown
summary: null
---

The original M5 design included a rolling summary stored in `adventures.rolling_summary`, lazily generated at adventure resume to carry continuity across messages that age out of the rolling window. Dropped from M5 pending playtest evidence that the gap exists.

The cached GM context — which in Solo Blind mode accumulates auto-promoted canon as play progresses — plus `npcStates` and `worldFacts` in `campaign_state.data` already cover most of what the summary was specified to capture. The design doc's summarization guidance ("prioritize uncanonized improvised fiction, NPC behavior, lies told, relationships formed, specific physical details") maps almost entirely onto what the canon queue and the working-memory fields already preserve. The summary's unique contribution is narrow: narrative texture and sequence that didn't produce discrete canonizable facts, only relevant in adventures long enough that the message window can no longer hold the arc.

Shipping the summary now would add a second Claude call per resume, a new column for cutoff tracking, and a prompt that can't be tuned without evidence. Observing whether Phase 1 play actually suffers from narrative-continuity loss without the summary is a cheaper first step than engineering against a failure mode that may not occur.

The `adventure.rolling_summary` column from M1 remains in the schema and stays null through Phase 1. If the gap surfaces in playtest — contradictions about fiction that aged out of the window, forgotten relationships or lies, sequence errors across long adventures — the rolling summary can be added as its own milestone, likely alongside campaign canon promotion tooling in Phase 2 where the related "what persists across adventures" questions already need answering.

This decision is a deferral under uncertainty, not a final answer. The next Phase 1 playtests should watch for narrative-continuity failures of the specific kind the summary was designed to prevent. If the cached GM context plus working-memory fields hold up, the deferral is validated. If it breaks down in characteristic ways, those failure modes become the design input for the summary, to be built with evidence rather than speculation.
