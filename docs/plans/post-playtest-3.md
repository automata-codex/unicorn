# Post-Playtest 3 Changes — Implementation Plan

## Context

Four changes from the Playtest 3 review (`docs/specs/post-playtest-3.md`) covering opening narration display, scenario state wiring, a world facts scratchpad, and prompt version management. Grouped into 4 phases by dependency order. Each phase is independently committable and testable.

**App location:** `apps/zoltar-playtest/src/`

---

## Phase 1: Display Opening Narration (Change 1)

**Goal:** Fix the bug where `openingNarration` is injected as a message but never rendered because `MessageLog.buildLogEntries()` only processes assistant messages with array content (tool_use blocks), silently skipping plain string content.

**Root cause:** `beginAdventure()` in `SetupView.svelte` pushes `{ role: 'assistant', content: openingNarration, turn: 0, timestamp }` — a plain string content. But `MessageLog.buildLogEntries()` enters the assistant branch and immediately checks `if (Array.isArray(content))`, so the string falls through with no log entry created.

**Changes to `components/MessageLog.svelte` — `buildLogEntries`:**
- Add handling for assistant messages where `content` is a string (not an array). When `msg.role === 'assistant'` and `typeof msg.content === 'string'`, push a `{ type: 'gm', text: msg.content, turn: msg.turn, timestamp: msg.timestamp }` entry.
- This covers opening narration and any future plain-text assistant messages.

**Spec constraint:** Opening narration should not be re-sent to Claude in the message history. Verify that `extractRecentExchanges` in `api.ts` also handles this correctly — it iterates assistant messages looking for `submit_gm_response` tool_use blocks, so plain string assistant messages are already naturally excluded from the recent exchanges window. No change needed there.

**Verify:** Run synthesis, begin adventure, confirm opening narration appears styled identically to Warden responses. Confirm it does not appear in the `[RECENT EXCHANGES]` section of subsequent turn payloads.

---

## Phase 2: Wire `initialState` + Scenario State (Change 2)

**Goal:** Load `gmContextStructured.initialState` into a live `scenarioState` object, include it in the state snapshot sent to Claude each turn, allow Claude to mutate it via `submit_gm_response`, and capture history in the log export.

**Spec items:** initialization, snapshot construction, mutation, log export.

**Changes to `lib/types.ts`:**
- Add `ScenarioStateEntry` type: `{ current: number; max: number | null; note: string }`
- Add `scenarioState: Record<string, ScenarioStateEntry>` to `AppState`
- Add `scenarioStateUpdates?: Record<string, number>` to `SubmitGmResponse.stateChanges` (key → new `current` value)

**Changes to `lib/state.svelte.ts`:**
- Add `scenarioState: {}` to `createAppState` defaults
- In `initializeFromGmContext`: parse `structured.initialState` entries into `state.scenarioState`. Each entry has `current`, `max`, and `note` — copy them as `ScenarioStateEntry` objects. Log a warning for entries missing `current`.
- In `applyGmResponse`: process `response.stateChanges?.scenarioStateUpdates` — for each key, update `state.scenarioState[key].current` to the new value. Warn if key is unknown.

**Changes to `lib/tools.ts` — `PLAY_TOOLS` (`submit_gm_response`):**
- Add `scenarioStateUpdates` to `stateChanges` schema: `{ type: 'object', description: 'Scenario state counter updates. Key is the counter name, value is the new current value.', additionalProperties: { type: 'integer' } }`

**Changes to `lib/snapshot.ts` — `buildGameState`:**
- After the existing game state JSON block, append a `<scenario_state>` XML block if `state.scenarioState` has entries.
- Format: one line per entry — `key: current/max — note` (omit `/max` if max is null).

**Changes to `lib/storage.ts`:**
- Add `scenarioState` to `SessionExport.finalState`
- Add `scenarioStateHistory: Array<{ turn: number; scenarioState: Record<string, ScenarioStateEntry> }>` to `SessionExport`
- In `exportSession`: build `scenarioStateHistory` from `turnLog` entries (each turn log entry captures the snapshot, which will now include scenario state). Alternatively, capture scenario state snapshots per-turn directly — simpler to add a per-turn capture in `runTurn` alongside the existing turn log entry.
- In `restoreSession`: restore `scenarioState` from `finalState`

**Changes to `lib/api.ts` — `runTurn`:**
- After `applyGmResponse`, capture `{ turn: state.turn, scenarioState: structuredClone(state.scenarioState) }` into a history array that gets included in the turn log or exported separately. The simplest approach: add `scenarioStateSnapshot` to `TurnLogEntry` so it's captured alongside everything else.

**Verify:** Run a synthesis that produces `initialState` entries. Confirm they appear in the `<scenario_state>` block in the first turn's snapshot. Play a turn where Claude decrements a counter. Confirm the updated value appears in the next turn's snapshot. Export session and confirm `scenarioStateHistory` is populated.

---

## Phase 3: World Facts Scratchpad (Change 3)

**Goal:** Add a `worldFacts` scratchpad that Claude can write to via `submit_gm_response`, persisted across turns in the state snapshot.

**Changes to `lib/types.ts`:**
- Add `worldFacts: Record<string, string>` to `AppState`
- Add `worldFacts?: Record<string, string>` to `SubmitGmResponse` (top-level, alongside `stateChanges` and `gmUpdates`)

**Changes to `lib/state.svelte.ts`:**
- Add `worldFacts: {}` to `createAppState` defaults
- In `applyGmResponse`: merge `response.worldFacts` into `state.worldFacts` (additive — same key overwrites)

**Changes to `lib/tools.ts` — `PLAY_TOOLS` (`submit_gm_response`):**
- Add `worldFacts` to the tool schema: `{ type: 'object', description: 'Concrete facts established in narration. Key is a descriptive identifier, value is the established fact. Write here when establishing a specific measurement, spatial attribute, or environmental detail for the first time. Update existing keys if a fact changes.', additionalProperties: { type: 'string' } }`

**Changes to `lib/snapshot.ts` — `buildGameState`:**
- After the `<scenario_state>` block, append a `<world_facts>` XML block if `state.worldFacts` has entries.
- Format: one line per entry — `key: value`

**Changes to `lib/api.ts` — `buildSystemPrompt`:**
- Add a WORLD FACTS instruction to the Warden prompt:
  > When you establish a specific physical measurement, named spatial attribute, or concrete environmental detail for the first time, commit it to `world_facts` using a descriptive key. On subsequent descriptions of the same feature, read from `world_facts` rather than re-estimating.

**Changes to `lib/storage.ts`:**
- Add `worldFacts` to `SessionExport.finalState`
- Add `worldFactsHistory: Array<{ turn: number; worldFacts: Record<string, string> }>` to `SessionExport`
- Capture per-turn snapshots in `runTurn` (same approach as scenario state — add to `TurnLogEntry` or build at export time)
- In `restoreSession`: restore `worldFacts` from `finalState`

**Changes to `components/StatePanel.svelte` (optional but useful):**
- Display `worldFacts` in a new section in the sidebar so the player can see what facts are tracked.

**Verify:** Play a few turns. Confirm Claude writes to `world_facts`. Confirm values appear in the `<world_facts>` block in subsequent turn snapshots. Confirm values persist across turns. Export and confirm `worldFactsHistory` is populated.

---

## Phase 4: Prompt Version Management (Change 4)

**Goal:** Extract the system prompt into versioned text files, add prompt layer selection to the Setup view, and record prompt versions + full text in the log export.

**File creation — `apps/zoltar-playtest/prompts/`:**
- Create `general-warden-v1.txt` — extract the general Warden instructions from `buildSystemPrompt` (everything from "WARDEN INSTRUCTIONS:" through "META-DISCUSSION SUPPRESSION:" and the world facts instruction added in Phase 3). This is the system-agnostic layer.
- Create `mothership-v1.txt` — extract the Mothership-specific content: the preamble ("You are the Warden for a solo Mothership adventure..."), any Mothership-specific mechanical rules (panic as event not pool, stress threshold behavior, etc.). This is the system-specific layer.

The split should be clean: general-warden covers behaviors that apply to any game system; mothership covers Mothership-specific mechanics. The GM context blob (`gmContext`) is injected separately and is not part of either file.

**Changes to `lib/types.ts`:**
- Add `promptVersions: { generalWarden: string; system: string }` to `AppState` (filenames)
- Add `promptText: { generalWarden: string; system: string }` to `AppState` (loaded content)

**Changes to `lib/state.svelte.ts`:**
- Add defaults: `promptVersions: { generalWarden: 'general-warden-v1.txt', system: 'mothership-v1.txt' }`, `promptText: { generalWarden: '', system: '' }`

**New utility — `lib/prompts.ts`:**
- `listPromptFiles(layer: 'general-warden' | 'mothership'): Promise<string[]>` — fetch the directory listing. Since this is a Vite SPA, use `import.meta.glob` to discover files matching `../../prompts/general-warden-*.txt` and `../../prompts/mothership-*.txt` at build time.
- `loadPromptFile(filename: string): Promise<string>` — fetch the file content as text. Use the glob imports or dynamic `fetch` against the public path.
- Sort files by version number, default to highest.

**Changes to `lib/api.ts` — `buildSystemPrompt`:**
- Replace the hardcoded prompt string with concatenation of `state.promptText.generalWarden` and `state.promptText.system`, with `gmContext` injected between them (or at the top, matching current structure).
- The structure becomes: `[system-specific preamble + gmContext] + [general warden instructions]`

**Changes to `components/SetupView.svelte`:**
- Add a collapsible "Prompt Configuration" section (collapsed by default) containing two dropdowns:
  - **General Warden prompt** — lists `general-warden-*.txt` files, defaults to highest version
  - **System prompt (Mothership)** — lists `mothership-*.txt` files, defaults to highest version
- On selection change, load the file content into `state.promptText` and update `state.promptVersions`.
- On initial mount (or when entering step 1), auto-load the default prompt files if `promptText` is empty.

**Changes to `lib/storage.ts`:**
- Add `promptVersions` and `promptText` to `SessionExport`
- In `restoreSession`: restore both fields

**Verify:** Confirm prompts load from files on app start. Change selection in dropdown, confirm the system prompt changes. Run a session, export, confirm `promptVersions` and `promptText` appear in the export. Create a `v2` prompt file, confirm it appears in the dropdown and is selectable.

---

## Phase Summary

| Phase | Change | Scope                                       | Key Files                                                   |
|-------|--------|---------------------------------------------|-------------------------------------------------------------|
| 1     | 1      | Opening narration display fix               | `MessageLog.svelte`                                         |
| 2     | 2      | Scenario state init, snapshot, mutation, log | `types.ts`, `state.svelte.ts`, `tools.ts`, `snapshot.ts`, `storage.ts`, `api.ts` |
| 3     | 3      | World facts scratchpad                       | `types.ts`, `state.svelte.ts`, `tools.ts`, `snapshot.ts`, `storage.ts`, `api.ts`, `StatePanel.svelte` |
| 4     | 4      | Prompt version management                    | `prompts/*.txt`, `types.ts`, `state.svelte.ts`, `prompts.ts` (new), `api.ts`, `SetupView.svelte`, `storage.ts` |

## Spec Item Cross-Reference

| Change | Description                    | Phase |
|--------|--------------------------------|-------|
| 1      | Display opening narration      | 1     |
| 2      | Wire initialState into state   | 2     |
| 3      | World facts scratchpad         | 3     |
| 4      | Prompt version management      | 4     |
