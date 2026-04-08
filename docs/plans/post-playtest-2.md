# Post-Playtest 2 Changes — Implementation Plan

## Context

Ten changes from the Playtest 2 review (`docs/specs/post-playtest-2.md`) covering diagnostic instrumentation, entity lifecycle, flag reliability, prompt discipline, synthesis output, and session export. Grouped into 6 phases by dependency order. Each phase is independently committable and testable.

**App location:** `apps/zoltar-playtest/src/`

---

## Phase 1: Types & Data Model

**Goal:** Extend the type system and state shape to support all new fields before any logic touches them. No behavioral changes — just making room.

**Spec items touched:** 1.1, 1.2, 1.4, 2.1

**Changes to `lib/types.ts`:**
- Add `status: 'alive' | 'dead' | 'unknown'` to `EntityState`
- Add `turn: number` and `timestamp: string` (ISO 8601) to message objects (define a `GameMessage` type if one doesn't exist, replacing inline `{role, content}`)
- Add `TurnLogEntry` type per spec 1.1:
  ```typescript
  {
    turn: number
    snapshotSent: object
    stateChanges: object | null
    diceRolls: Array<{purpose: string, notation: string, result: number, source: 'system' | 'player'}>
    tokens: {promptTokens: number, completionTokens: number}
  }
  ```
- Add `flagTriggers: Record<string, string>` to `GmContextStructured` (or wherever initial flags live)
- Add `openingNarration: string` to synthesis output type

**Changes to `lib/state.svelte.ts`:**
- Add `turnLog: TurnLogEntry[]` to `AppState`
- Add `flagTriggers: Record<string, string>` to `AppState`
- Update `createAppState` defaults: `turnLog: []`, `flagTriggers: {}`
- Update `initializeFromGmContext` to populate `flagTriggers` from structured synthesis output
- Set `status: 'unknown'` as default when initializing entities; use explicit values from `gmContextStructured` where provided

**Verify:** App builds, existing sessions still load (new fields default gracefully).

---

## Phase 2: System Prompt & GM Context Instructions

**Goal:** Add all new behavioral rules to the system prompt and GM context blob instructions. Pure text changes to prompt strings — no logic.

**Spec items touched:** 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.9, 2.10

**Changes to `lib/api.ts` — `buildSystemPrompt`:**
- Add **Canon discipline** section (spec 2.2) — instruct Claude to propose canon on nearly every turn, with the specific guidance text from the spec
- Add **Dice roll routing** section (spec 2.3) — distinguish system rolls (`roll_dice`) from player rolls (`pendingDiceRequests`), with the specific routing rules
- Add **Entity key discipline** section (spec 2.5) — keys are permanent, dead entities keep their keys, new threats get new keys
- Add **Adventure end condition** section (spec 2.6) — when `adventure_complete` flips true, deliver closing narration and stop proposing actions
- Add **Meta-discussion suppression** (spec 2.7) — no structural/meta commentary during play
- Reinforce **internal ID suppression** (spec 2.10) — entity IDs, coordinates, flag keys, state field names must never appear in `playerText` (this was partly addressed in post-playtest-1 but the spec calls for formal reinforcement)

**Changes to `lib/api.ts` — `buildSynthesisPrompt`:**
- Add guidance that countdown timers must be initialized as resource pools (spec 2.4) — e.g., `crewman_wick_timer: {current: 4, max: 4}`
- Add guidance that mechanical notes belong in the freeform `notes` field (spec 2.9) — document this in the synthesis instructions so the scenario author knows where to put per-playtest mechanical overrides

**Verify:** Rebuild, start a new synthesis, confirm the prompt includes the new sections. No behavioral testing needed — this is prompt text only.

---

## Phase 3: Tool Schemas & State Logic

**Goal:** Update the Claude tool schemas to accept new fields, and update `applyGmResponse` to process them. Wire up turn log capture.

**Spec items touched:** 1.1, 1.2, 1.4, 2.1

**Changes to `lib/tools.ts` — `PLAY_TOOLS` (`submit_gm_response`):**
- Add `status: 'alive' | 'dead' | 'unknown'` as optional field in `stateChanges.entities[].`
- Add `stateChanges.flagTriggers: Record<string, string>` as optional field — partial merge into existing triggers
- Update description text for these fields so Claude understands their purpose

**Changes to `lib/state.svelte.ts` — `applyGmResponse`:**
- Process `stateChanges.entities[].status` — update entity status field
- When `status` flips to `'dead'`: find all resource pools whose key starts with that entity's ID and set their `current` to `0`
- Process `stateChanges.flagTriggers` — merge into `state.flagTriggers`
- Validate: reject any new flag in `stateChanges.flags` that doesn't have a corresponding entry in either existing `flagTriggers` or the incoming `stateChanges.flagTriggers` (log warning, still apply the flag)

**Changes to `lib/api.ts` — `runTurn`:**
- Before calling Claude: capture the snapshot that was sent (the game state JSON)
- Accumulate `roll_dice` calls during the tool loop (purpose, notation, result, source: `'system'`)
- After `submit_gm_response` resolves: build a `TurnLogEntry` from the captured snapshot, the `stateChanges` from the response, accumulated dice rolls, and token counts from the API response's `usage` field
- Append the entry to `state.turnLog`
- When adding messages to `state.messages`, attach `turn: state.turn` and `timestamp: new Date().toISOString()`

**Changes to `lib/snapshot.ts` — `buildGameState`:**
- Include `flagTriggers` in the state snapshot sent to Claude, adjacent to `flags`

**Changes to `lib/api.ts` — `buildUserMessage`:**
- When player dice results come in from `DicePrompt`, record them in the current turn's dice roll accumulator with `source: 'player'`

**Verify:** Rebuild, play 2-3 turns. Confirm:
- `turnLog` accumulates entries in state (check via state export or localStorage)
- Entity status changes propagate (test by having Claude mark an entity dead)
- Flag triggers merge correctly
- Messages have `turn` and `timestamp` fields

---

## Phase 4: Synthesis Pipeline

**Goal:** Update the synthesis prompt and tool schema to produce `flagTriggers`, require `adventure_complete`, and generate opening narration.

**Spec items touched:** 2.1, 2.6, 2.8

**Changes to `lib/tools.ts` — `SYNTHESIS_TOOLS` (`submit_gm_context`):**
- Add `structured.flagTriggers: Record<string, string>` — required, one entry per flag in `initialFlags`
- Add `structured.initialFlags.adventure_complete` as required (`false`)
- Add `openingNarration: string` at the top level of the tool output

**Changes to `lib/api.ts` — `buildSynthesisPrompt`:**
- Instruct Claude to produce `flagTriggers` with specific trigger conditions for every flag (spec 2.1 example)
- Instruct that `adventure_complete: false` is mandatory in `initialFlags` with a corresponding trigger (spec 2.6)
- Instruct Claude to write `openingNarration` — the ambient scene at adventure start, before player input (spec 2.8)

**Changes to `lib/state.svelte.ts` — `initializeFromGmContext`:**
- Populate `state.flagTriggers` from `structured.flagTriggers`
- Validate `adventure_complete` exists in initial flags (warn if missing)

**Changes to `lib/api.ts` — `runTurn` or play initialization:**
- When beginning play (transitioning from setup to play view), inject `openingNarration` as the first assistant message in `state.messages` with `turn: 0` and current timestamp

**Verify:** Run a fresh synthesis. Confirm:
- Output includes `flagTriggers` with one entry per flag
- `adventure_complete: false` is present
- `openingNarration` is present and injected as first message when play begins

---

## Phase 5: UI Updates

**Goal:** Update all display components to reflect new data fields and hide removed ones.

**Spec items touched:** 1.2, 1.3, 1.4, 2.6

**Changes to `components/StatePanel.svelte`:**
- **Entity status display (1.2):** Show `status` badge next to each entity. Dead entities should be visually distinct — greyed out or struck through text, but still listed
- **Hide positions (1.3):** Remove `x`, `y`, `z` / position rendering from entity list. Fields remain in state, just not displayed
- **Adventure complete (2.6):** When `flags.adventure_complete === true`, display a prominent end-of-adventure indicator (e.g., banner or visual state change in the panel)

**Changes to `components/MessageLog.svelte`:**
- **Turn numbers and timestamps (1.4):** Render `turn` and `timestamp` as small, muted text above or inline with each message bubble. Timestamp to minute precision. Group consecutive messages from the same turn visually

**Changes to `components/PlayView.svelte`:**
- **Adventure complete (2.6):** When `adventure_complete` is true, disable or visually change the input area to signal the adventure has concluded. Possibly show a "Session Complete" banner

**Changes to `components/SetupView.svelte`:**
- **Flag triggers display:** When reviewing synthesis output in step 4, show `flagTriggers` alongside initial flags so the user can review trigger conditions before starting play

**Verify:** Rebuild, play through a few turns. Confirm:
- Dead entities appear greyed/struck-through with status badge
- No position coordinates visible anywhere in UI
- Messages show turn numbers and timestamps
- Synthesis review shows flag triggers

---

## Phase 6: Session Export & Restore

**Goal:** Replace the separate export affordances with a single unified session export/import format.

**Spec items touched:** 1.5

**Changes to `components/PlayView.svelte`:**
- Replace existing Export State / Export Log / Import State buttons with:
  - **Export Session** button — produces a single JSON file
  - Keep or remove the plain-text log export as a secondary option (spec doesn't require removing it, but the unified export supersedes the state export)
- Add **Import Session** button (or integrate into existing import flow) with confirmation prompt if a session is in progress

**Define session export format:**
```typescript
{
  version: 1,
  exportedAt: string,              // ISO 8601
  turnLog: TurnLogEntry[],         // From 1.1
  messages: GameMessage[],         // With turn + timestamp per 1.4
  canonLog: CanonEntry[],          // Full canon log
  finalState: object,              // Complete state snapshot at export time
  gmContextBlob: string,           // From synthesis
  gmContextStructured: object      // From synthesis
}
```
- Filename: `zoltar-playtest-{YYYY-MM-DD}.json`

**Export logic (new function in `lib/storage.ts` or `lib/api.ts`):**
- Build the export object from current `AppState`
- Trigger browser download

**Restore logic:**
- Parse uploaded JSON file
- Validate it has the expected shape (version field, required keys)
- If a session is in progress (`state.turn > 0` or messages exist), prompt for confirmation before overwriting
- Populate `AppState` from the export: messages, turnLog, canonLog, entities, flags, flagTriggers, resourcePools, npcStates, wounds, turn counter, gmContextBlob, gmContextStructured, character
- Switch view to `'play'`

**Changes to `components/SetupView.svelte`:**
- Add session import affordance alongside existing synthesis import — e.g., a second file input or a shared import flow that detects file type (synthesis vs. session export) by checking for the `version` key

**Verify:** 
- Export a session mid-play, verify the JSON contains all expected fields
- Close the app, reopen, import the session file, confirm state is fully restored and play can continue
- Test overwrite confirmation when importing over an active session

---

## Phase Summary

| Phase | Spec Items         | Scope                                        | Key Files                                                                       |
|-------|--------------------|----------------------------------------------|---------------------------------------------------------------------------------|
| 1     | 1.1, 1.2, 1.4, 2.1 | Types, state shape, defaults                 | `types.ts`, `state.svelte.ts`                                                   |
| 2     | 2.2–2.7, 2.9, 2.10 | System prompt & synthesis prompt text        | `api.ts`                                                                        |
| 3     | 1.1, 1.2, 1.4, 2.1 | Tool schemas, applyGmResponse, turn log      | `tools.ts`, `state.svelte.ts`, `api.ts`, `snapshot.ts`                          |
| 4     | 2.1, 2.6, 2.8      | Synthesis tool schema, flagTriggers, opening | `tools.ts`, `api.ts`, `state.svelte.ts`                                         |
| 5     | 1.2, 1.3, 1.4, 2.6 | Entity display, positions, timestamps, end   | `StatePanel.svelte`, `MessageLog.svelte`, `PlayView.svelte`, `SetupView.svelte` |
| 6     | 1.5                | Unified session export/restore               | `PlayView.svelte`, `SetupView.svelte`, `storage.ts`                             |

## Spec Item Cross-Reference

| Spec Item | Description                          | Phases   |
|-----------|--------------------------------------|----------|
| 1.1       | Turn log instrumentation             | 1, 3     |
| 1.2       | Entity status field                  | 1, 3, 5  |
| 1.3       | Hide position fields                 | 5        |
| 1.4       | Turn numbers & timestamps            | 1, 3, 5  |
| 1.5       | Session export & restore             | 6        |
| 2.1       | Flag triggers system                 | 1, 3, 4  |
| 2.2       | Canon discipline                     | 2        |
| 2.3       | Roll prompting discipline            | 2        |
| 2.4       | Countdown timers as resource pools   | 2        |
| 2.5       | Entity key reuse prohibition         | 2        |
| 2.6       | Scenario end condition               | 2, 4, 5  |
| 2.7       | Suppress meta-discussion             | 2        |
| 2.8       | Opening narration                    | 4        |
| 2.9       | Mechanical notes in freeform field   | 2        |
| 2.10      | No internals in player text          | 2        |
