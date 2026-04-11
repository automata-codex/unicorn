# Zoltar — Playtest 2 Change Spec

This document specifies changes required before the third playtest. It is divided into two parts: **Part 1** covers updates to the `zoltar-playtest` tool itself; **Part 2** covers changes to the GM context and system prompt. Both parts are required before the next run.

---

## Part 1 — Playtesting Tool Updates

### 1.1 Instrument the state change pipeline

**Problem.** Playtest 2 produced a resource pool anomaly (shells starting at 30, reaching 90 before the first snapshot) that cannot be diagnosed from the snapshot data alone. It is unknown whether the AI was ignoring the state it was given, or whether the frontend was not reflecting the previous turn's write into the next turn's snapshot.

**Change.** For every turn, capture a diagnostic record containing:

- The full state snapshot sent to Claude at the start of that turn (the exact JSON injected into the prompt)
- The full `stateChanges` object returned in `submit_gm_response` for that turn
- All `roll_dice` calls made during that turn, with their purpose annotation and result
- Prompt token count and completion token count

Append these records to an array in a separate key on the state object — call it `turnLog`. It is not displayed in the UI; it is captured for export and post-session analysis. Each record should have the shape:

```typescript
{
  turn: number,
  snapshotSent: object,         // the full state snapshot at prompt construction time
  stateChanges: object | null,  // the stateChanges payload from submit_gm_response, or null if none
  diceRolls: Array<{
    purpose: string,
    notation: string,
    result: number,
    source: 'system' | 'player'
  }>,
  tokens: {
    promptTokens: number,
    completionTokens: number
  }
}
```

This is the primary diagnostic artifact for Playtest 3. Without it, any state anomaly found in snapshots will again be undiagnosable.

---

### 1.2 Add entity status field

**Problem.** Entity liveness is currently split across two inconsistent sources: `npcStates` (freetext, written by the AI) and `resourcePools` (HP values, which the AI does not reliably zero on death). In Playtest 2, `parasitic_organism_corridor_hp` read 4 throughout the entire run despite the AI recording the entity as dead in `npcStates` from turn 21. This ambiguity makes the Flags and Entities panels misleading.

**Change.** Add a `status` field to each entity in the `entities` map. The field is an enum: `'alive' | 'dead' | 'unknown'`. Default is `'unknown'` for entities whose liveness is not established at scenario start; set explicitly in `gmContextStructured` for entities with a known starting state.

The AI should be permitted to update `status` via the `entities` block in `stateChanges`, the same way it updates `visible`. When `status` flips to `'dead'`, the frontend should zero any resource pool whose key is prefixed with that entity's ID (e.g. `parasitic_organism_corridor_hp → 0`). This enforces consistency between the two representations without requiring the AI to remember to do it manually.

Display `status` in the entity list UI. Dead entities should be visually distinct (greyed out or struck through) rather than removed, so the full entity list remains legible as a history of the encounter.

---

### 1.3 Hide position fields from the entity display

**Problem.** Entity positions are captured in the state but have no meaningful spatial system behind them in the playtesting tool. In Playtest 2 the position values produced active confusion — entities shared positions, positions never updated during movement, and the values were occasionally misleading about where things actually were in the fiction. The fields also caused at least one spatial coherence problem when a dead entity's position was reused for a new creature.

**Change.** Remove entity position (`x`, `y`, `z`) from all UI display surfaces in the playtesting tool. The fields may remain in the underlying state object for forward compatibility, but they should not be rendered anywhere in the Setup or Play views. Do not pass position data to the AI in the state snapshot.

This is not a spec change for the production backend, where position will be a live part of the spatial system. It is a playtesting tool simplification only.

---

### 1.4 Add turn numbers and timestamps to the message log

**Problem.** Cross-referencing playtest notes against the message log is time-consuming because messages have no turn markers. In Playtest 2, correlating a note like "AI should have prompted for a roll here" to the actual message required counting back through the log manually.

**Change.** Each message in the `messages` array must be stored with two additional fields: `turn` (the value of `state.turn` at the time the message was added) and `timestamp` (ISO 8601 wall-clock time). These fields travel with the message through export and restore — they are part of the data model, not display metadata.

In the UI, render turn number and timestamp as small, muted text above or inline with each message bubble. Timestamp display should be to minute precision. The treatment should be unobtrusive — context for analysis, not a prominent UI element.

---

### 1.5 Session export and restore

**Problem.** Playtest 2 produced 25 snapshot files taken manually across three sessions. There is no structured way to export or restore a session.

**Change.** This item replaces the existing separate message log and state export affordances with a single unified export/restore format.

**Export.** Add an **Export Session** button to the Play view. When tapped, it produces a single JSON file containing:

- The complete `turnLog` array (from 1.1)
- The complete `messages` array, including `turn` and `timestamp` fields per 1.4
- The complete `canonLog` array
- The final state snapshot
- The `gmContextBlob` and `gmContextStructured` from the synthesis

The exported file should be named `zoltar-playtest-{date}.json` using the current date.

**Restore.** Add an **Import Session** affordance to the Setup view alongside the existing synthesis import. When a session export file is loaded, the tool fully restores state: all messages, the turn log, the canon log, the state snapshot, and the GM context. The player should be returned to the Play view exactly as if they had never left, and can continue the adventure from where it was exported. Restore replaces whatever state is currently loaded — if a session is in progress, prompt for confirmation before overwriting it.

---

## Part 2 — GM Context and System Prompt Changes

### 2.1 Flag system

**Problem.** Several flags in Playtest 2 never flipped despite the triggering events clearly occurring in the fiction. `player_fear_save_triggered` never changed despite two fear events. `research_notes_accessed` never changed despite three detailed canon entries drawn directly from Draven's datapad and terminal. The AI did not connect the narrative action to the flag name.

Flags serve two purposes that are both worth preserving: establishing known-false baseline conditions at scenario start (things the scenario author guarantees haven't happened yet), and recording emergent story beats the author couldn't anticipate. Both categories need trigger conditions — without them the AI has no structured reminder of what action flips a flag, and flags drift into irrelevance.

**Change — flag triggers as mutable state.** `flagTriggers` is a mutable object in the state, not a static block in `initialState`. It is included in every state snapshot sent to Claude, adjacent to the current flag values, so trigger conditions are always in context when the AI is deciding whether to flip a flag.

Every flag — whether defined at setup or added during play — must have a corresponding entry in `flagTriggers`. The entry must name the specific in-fiction action or event that flips the flag, not just describe what the flag represents.

Initial `flagTriggers` are authored alongside `initialFlags` in the synthesis output. Example:

```json
"flags": {
  "research_notes_accessed": false,
  "player_fear_save_triggered": false,
  "player_second_fear_trigger_active": false,
  "adventure_complete": false
},
"flagTriggers": {
  "research_notes_accessed": "Flip to true when Jones physically accesses Draven's datapad or terminal and reads the synthesis notes. Accessing the room is not sufficient — the notes must be read.",
  "player_fear_save_triggered": "Flip to true the first time Jones encounters a directly threatening organism at close range and a Fear save is called. The first encounter with the corridor organism is the mandatory trigger — do not defer this.",
  "player_second_fear_trigger_active": "Flip to true when a second distinct Fear trigger occurs after player_fear_save_triggered is already true.",
  "adventure_complete": "Flip to true when the adventure end condition is met. See end condition below."
}
```

**Change — on-the-fly flags.** When the AI proposes a new flag via `stateChanges.flags` during play, it must simultaneously submit a trigger description for that flag via a new `stateChanges.flagTriggers` field — a partial update that merges into the existing `flagTriggers` object. The playtesting tool applies both writes together. A flag without a trigger entry is not valid.

**Change — `adventure_complete` is a required initial flag.** Every scenario must include `adventure_complete: false` in `initialFlags` with a corresponding trigger in `flagTriggers` that names the specific end condition. See 2.6.

---

### 2.2 Canon discipline

**Problem.** Multiple Playtest 2 issues share a common root cause: the canon log was not being updated frequently enough. The canon log was empty for the first 67 turns, producing the geography confusion. The AI stopped acknowledging Jones's sealed armor mid-session because the armor state was established in initial setup but never written to canon, and aged out of active context as the message history grew. NPC states recorded only in `npcStates` freetext were similarly fragile. Strong, frequent canon updates are the primary fix for all of these.

**Change.** Add an explicit canon cadence instruction to the GM context blob:

> **Canon discipline.** Propose a canon entry on nearly every turn. The canon log is the adventure's persistent memory — anything that needs to remain true across the full session must be written there. Do not rely on the message history to carry facts forward; it will eventually scroll out of context.
>
> Propose canon for: any spatial fact established or changed (where an entity is, what corridor connects to what, what is sealed or open), any persistent character state (armor sealed, active wounds, equipment carried), any NPC state change (disposition shift, death, new knowledge), any named story beat (secret revealed, objective completed, new threat identified). A canon entry does not need to be long — one precise sentence is sufficient.
>
> The test: if you were resuming this adventure from scratch with only the GM context and the canon log, would you have everything you need? If not, write the missing entry now.

---

### 2.3 Roll prompting discipline

**Problem.** `pendingDiceRequests` was empty at every captured snapshot in Playtest 2. The Draven combat resolved without player rolls. The corridor creature combat required manual prompting. The AI was calling `roll_dice` internally for what should have been player-facing rolls, and the distinction between the two modes was not clear enough in the prompt.

**Change.** Add an explicit section to the GM context blob covering roll routing:

> **Dice roll routing.** Two paths exist for dice resolution and they are not interchangeable.
>
> Use `roll_dice` (system roll) for: rolls made on behalf of NPCs or creatures, rolls the player would not make at a physical table (behind-the-screen GM rolls), environmental or procedural rolls with no player agency.
>
> Use `pendingDiceRequests` (player roll) for: any save the player's character must make (Fear, Sanity, Body, Armor), any attack roll made by the player's character, any skill check initiated by the player. If the player's character is acting and a roll is required, it is a player roll.
>
> Do not substitute a system roll for a player roll because the player has not explicitly asked to roll. The player rolls whenever their character's action requires resolution. This is not optional.

---

### 2.4 Countdown timers as resource pools

**Problem.** The `wick_degradation_timer` was specified as 4 in `initialState` but never initialized as a resource pool. The AI tracked it only in working memory, making it invisible to the state layer and unverifiable in post-session analysis.

**Change.** Any mechanic that involves a number counting down over the course of an adventure must be initialized as a named resource pool in `resourcePools` at scenario start. The naming convention is `{entity_id}_timer` for degradation timers, e.g. `crewman_wick_timer: { current: 4, max: 4 }`.

The AI should be instructed to decrement the pool via `stateChanges.resourcePools` using a delta of `-1` whenever the timer advances, using the same mechanism as HP or ammo. The current value is then visible in the state panel and captured in every delta log entry.

This is an authoring rule for GM context construction, not a code change. Document it in the playtest tool's setup instructions so it becomes standard practice.

---

### 2.5 Prohibition on entity key reuse

**Problem.** When the corridor organism reappeared in the second half of Playtest 2, the AI updated the existing `parasitic_organism_corridor` entity rather than creating a new one. The HP jumped from the stale post-death value of 4 to 16, and the position moved to Engineering — producing both a spatial inconsistency and a misleading HP history.

**Change.** Add an explicit instruction to the GM context blob:

> **Entity key discipline.** Entity keys are permanent identifiers, not recycled slot labels. When a new threat or NPC enters the adventure that was not present at setup, create a new entity with a new key via `stateChanges.entities`. Do not reuse the key of a dead or absent entity for a new one, even if the new entity is narratively similar. Dead entities remain in the entity list with `status: 'dead'`; they are not replaced.

---

### 2.6 Scenario end condition

**Problem.** Playtest 2 continued past its natural narrative resolution because the AI had no signal for when the adventure was over. The player ended the session manually.

**Change.** Every scenario must include an explicit end condition in the GM context blob. The format:

> **Adventure end condition.** The adventure concludes when [specific condition]. When this condition is met, deliver closing narration in `playerText` that brings the immediate scene to rest — do not leave the player in mid-action. Set `adventure_complete: true` in `stateChanges.flags`. Do not propose further player actions after setting this flag.

`adventure_complete: false` is a required entry in `initialFlags` for every scenario, per 2.1. The playtesting tool should display a visible end-of-adventure state when this flag flips to true, distinct from a mid-session pause.

---

### 2.7 Suppress in-session meta-discussion

**Problem.** The AI revealed scenario structure during the adventure when asked about geography — explaining what was scripted, what was improvised, and offering to sketch a verbal map. This is appropriate post-session behavior but breaks immersion mid-session.

**Change.** Add to the system prompt:

> Do not discuss the structure of the adventure, what was planned versus improvised, oracle origins, or any meta-level description of how the scenario was constructed while the adventure is in progress. If the player asks a geography question you cannot answer confidently within the fiction, answer within the fiction ("The layout from here looks like...") or acknowledge uncertainty as the character would experience it. Out-of-character map sketches and structural explanations are post-session content only.

---

### 2.8 Opening narration in synthesis output

**Problem.** The adventure begins with the player needing to send a first message to receive any narration, creating a cold-start delay. The AI already knows the starting situation in full — there is no reason to wait for player input before establishing the scene.

**Change.** The synthesis output should include an `openingNarration` field alongside `gmContextBlob` and `gmContextStructured`. This is the first message the AI would deliver if the player's first action were "look around" — the ambient scene at the moment the player character enters the adventure, before any player agency. The playtesting tool should inject this as the first assistant message in the conversation when beginning play, so the player's first experience is the GM speaking, not a blank input field.

The synthesis prompt should instruct Claude to write opening narration that establishes the immediate physical situation, conveys the atmosphere, and contains one concrete detail the player did not put there — something that signals the world has already been in motion without them.

---

### 2.9 Scenario-specific mechanical notes in the freeform notes field

**Problem.** The base GM context prompt is intentionally system-agnostic and should remain so. But specific playtests benefit from explicit mechanical guidance that would be inappropriate in a production prompt — e.g., designating a specific encounter as a mandatory Fear check.

**Convention.** Mechanical playtest instrumentation belongs in the freeform `notes` field of the synthesis request, not in the base GM context prompt. Before Playtest 3, include in the notes:

> The first time the player character encounters a hostile organism at close range, this is a mandatory Fear save. Do not skip or defer it. Call for the roll explicitly before resolving the encounter outcome.

This keeps the base prompt clean while allowing targeted mechanical coverage per playtest.

---

### 2.10 Coordinates and internal IDs must not appear in player-facing text

**Problem.** Playtest 1 produced a raw entity coordinate leak in `playerText`: *"there's a man aboard that ship — position (2,1), crew mess, Deck 2."* This was flagged in Playtest 1 analysis but has not been formally addressed in the prompt.

**Change.** Add to the system prompt:

> The following must never appear in `playerText`: entity IDs (e.g. `parasitic_organism_corridor`), grid coordinates (e.g. `position (2,1)`, `x: 3, y: 2`), flag key names (e.g. `marsh_is_cooperative`), or any other internal state field name. These are implementation details. If spatial or character information needs to be communicated to the player, express it in natural language within the fiction.
