# Zoltar — Playtest 1 Change Spec

*Derived from Playtest 1 session log, state, and synthesis review.*
*April 2026*

---

## Summary

Ten changes are specified across four areas: context window architecture, prompt engineering, oracle pipeline, and UI. Items are numbered for tracking; each includes a classification (Backend / Frontend / Prompt / Data) and a brief rationale.

---

## Context Window Architecture

### 1. Inject `gmContextStructured` into every request

**Classification:** Backend

Prepend the current `gmContextStructured` snapshot to every user message in a labeled XML wrapper:

```
[CURRENT GAME STATE]
<game_state>
{ ...gmContextStructured }
</game_state>

[PLAYER INPUT]
<player content>
```

The system prompt currently carries only the `gmContextBlob` (static narrative content). `gmContextStructured` mutates each turn as flags flip and entity states update, so it cannot go in the system prompt without breaking prompt cache hits. The user message prepend keeps the cacheable system prompt static while giving Claude an authoritative state snapshot on every request.

**Rationale:** Without this, Claude reconstructs current state from its own tool call history — a drift-prone pattern that produced the coordinate leak observed in Playtest 1 (see item 3).

---

### 2. Add WARDEN INSTRUCTIONS rule: `<game_state>` is authoritative

**Classification:** Prompt

Add to WARDEN INSTRUCTIONS:

> The `<game_state>` block injected at the top of each player message is the authoritative record of current world state. Your `gmUpdates` in `submit_gm_response` must reflect transitions from this state. Do not reconstruct entity states or flag values from your tool call history — the snapshot is always current.

---

### 3. Replace naive message accumulation with reconstructed context window

**Classification:** Backend

The current implementation appends every message (player input, assistant response, roll tool calls, tool results) to a growing array. By turn 21 of Playtest 1 the array had grown past the API context limit and required manual trimming.

Replace with a reconstructed prompt assembled each turn from discrete components:

| Component        | Content                                               | Notes                                                     |
|------------------|-------------------------------------------------------|-----------------------------------------------------------|
| System prompt    | Role preamble + `gmContextBlob` + WARDEN INSTRUCTIONS | Static; prompt-cached                                     |
| Game state       | `gmContextStructured` snapshot                        | Prepended to user message each turn                       |
| Canon log        | `proposedCanon` summaries from all prior turns        | Compact narrative record; replaces full tool call history |
| Recent exchanges | Last N full player/warden turns                       | Rolling window; tunable parameter                         |

The full tool call history (roll calls, `submit_gm_response` payloads, tool results) is dropped from the window after canon entries are extracted. Claude does not need to see its own prior tool calls; it needs the authoritative state snapshot and the compressed narrative record, both of which this structure provides explicitly.

The rolling window size for recent exchanges (N) is the primary tunable parameter — enough turns for dialogue continuity, short enough to keep the window bounded. Suggested starting value: 6 turns. Adjust based on session length and model.

---

## Prompt Engineering

### 4. Forbid structured internals in `playerText`

**Classification:** Prompt

Add to WARDEN INSTRUCTIONS:

> Entity IDs (any value matching the patterns `npc_*`, `threat_*`, `feature_*`), flag keys, coordinate values, and any other field names from the `<game_state>` block are forbidden in `playerText`. These values belong exclusively in `gmUpdates`. A player should never see `position (2,1)` or `secret_company_knew` in the narrative.

**Rationale:** Playtest 1 log, line 272: the GM response included `"position (2,1)"` verbatim in player-facing text, a raw coordinate from `gmContextStructured` that leaked through because Claude was pattern-matching against its own prior `gmUpdates` entries. Item 1 (authoritative state injection) reduces the likelihood of this recurrence; this rule provides an explicit prohibition as a second layer.

---

### 5. Constrain response granularity

**Classification:** Prompt

Add to WARDEN INSTRUCTIONS:

> Calibrate response size to the fictional moment. A single NPC line of dialogue warrants a single line of response, not a full interaction. A room description is one paragraph, not a scene. Do not resolve an entire exchange in one response — take the smallest meaningful turn and return control to the player. The player drives pacing.

---

### 6. GM delivers the opening prompt

**Classification:** Prompt

Add to WARDEN INSTRUCTIONS:

> At the start of a new adventure, deliver the opening scene without waiting for player input. Establish location, atmosphere, and immediate situation. End with a question or open moment that invites the player's first action.

---

### 7. Register recognition — OOC input handling

**Classification:** Prompt

Add to WARDEN INSTRUCTIONS:

> If the player is clearly addressing you as Warden rather than acting in the fiction — rules questions, requests for clarification, "can I do X?", anything directed at you rather than a character — respond conversationally without calling `submit_gm_response`. A brief out-of-character label is acceptable ("Out of character: yes, you can attempt that — roll Speed."). When ambiguous, treat the input as in-fiction intent. The player can always clarify.

---

## Oracle Pipeline

### 8. Pass complete oracle entries to synthesis

**Classification:** Backend

The synthesis step currently receives resolved oracle content without structured metadata. Claude sees the narrative seed (`claude_text`) but not the entry `id` or `interfaces` array, so it cannot reference oracle results by stable key or use interface hints to wire entries together during synthesis.

Change the synthesis input to pass the complete oracle entry for each resolved result:

```json
{
  "id": "corporate_spy",
  "player_text": "Corporate spy",
  "claude_text": "This survivor was placed on the vessel by a corporate entity...",
  "interfaces": [
    {
      "condition": "secret_company_knew",
      "note": "This survivor knew before boarding. Their fear is guilt as much as danger."
    }
  ],
  "tags": ["corporate", "information_objective", "civilian"]
}
```

Claude must have the `id` and `interfaces` at synthesis time to produce entity IDs and flag keys that are coherent across the generated GM context.

---

### 9. Unify condition namespace format

**Classification:** Data

Oracle `interfaces[].condition` values currently use colon notation (`secret:company_knew`). `initial_flags` keys use underscores (`secret_company_knew`). These must be the same format for Claude to wire interface conditions to flag keys during synthesis and `submit_gm_response`.

Adopt underscore format as canonical: `secret_company_knew`, `threat_corporate`, `survivor_corporate_affiliated`. Update all oracle table entries to match. JSON object keys cannot contain colons without quoting, making underscores the natural choice.

---

## UI

### 10. Surface die rolls as a distinct visual element

**Classification:** Frontend

Die rolls are occurring correctly via the `roll_dice` tool (visible in state.json message history) but are not rendered distinctly in the play interface. Players reported not noticing rolls happening during Playtest 1.

Render each `roll_dice` tool call and its result as a visually distinct element in the play interface — separate from GM prose, clearly legible as a mechanical event. The specific design is left to the frontend implementation; the requirement is that rolls are never invisible to the player.

---

## Spec Item Index

| #  | Area           | Classification | Title                                           |
|----|----------------|----------------|-------------------------------------------------|
| 1  | Context window | Backend        | Inject `gmContextStructured` into every request |
| 2  | Context window | Prompt         | `<game_state>` is authoritative                 |
| 3  | Context window | Backend        | Reconstructed context window                    |
| 4  | Prompt         | Prompt         | Forbid structured internals in `playerText`     |
| 5  | Prompt         | Prompt         | Constrain response granularity                  |
| 6  | Prompt         | Prompt         | GM delivers the opening prompt                  |
| 7  | Prompt         | Prompt         | Register recognition — OOC input handling       |
| 8  | Oracle         | Backend        | Pass complete oracle entries to synthesis       |
| 9  | Oracle         | Data           | Unify condition namespace format                |
| 10 | UI             | Frontend       | Surface die rolls as a distinct visual element  |
