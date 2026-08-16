---
id: ADR-0041
title: Correction loop bounded at one re-prompt
area: claude-turn-loop-correction
status: accepted
superseded_by: null
milestone: unknown
summary: null
---

When Claude's proposed state changes fail validation, the backend re-prompts once with a structured `tool_result` describing the rejections and waits for a corrected `submit_gm_response`. If that second response also fails validation, the turn aborts with 502 and the entire turn transaction rolls back — leaving only the player-message row that was persisted before the Claude call. Not two retries, not a budget — a hard cap at one re-prompt.

The cost of a correction round is one extra Claude API call on a path that should be rare in practice; compounding two rounds doubles that cost and masks the real problem, which is either a bug in the validator rules or a model that needs prompt work. Playtest evidence should drive validator tuning and prompt revision, not a larger retry budget. If the cap proves too aggressive, loosen it only after identifying a specific class of rejection that a second retry would have fixed without just papering over a validator-or-prompt bug.
