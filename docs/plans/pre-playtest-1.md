# Zoltar Playtest Tool — Implementation Plan

## Context

The playtest tool validates the `submit_gm_context` and `submit_gm_response` tool schemas under real play conditions before any backend exists. It's a throwaway browser-based SPA at `apps/zoltar-playtest` — standalone Vite + Svelte 5, no SvelteKit, no shared package imports. The full spec is at `docs/specs/playtest.md`.

---

## Phase 1: Project Scaffold

**Goal:** Bare-bones Vite + Svelte 5 project that compiles, installs in the monorepo, and renders a placeholder page.

**Files to create:**

| File | Purpose |
|------|---------|
| `apps/zoltar-playtest/package.json` | Standalone app. Deps: `svelte` ^5.54.0. DevDeps: `@sveltejs/vite-plugin-svelte`, `vite` ^7.3.1, `typescript` ^5.9.3, `svelte-check`. `"type": "module"`. |
| `apps/zoltar-playtest/tsconfig.json` | Target ESNext, strict, moduleResolution bundler, resolveJsonModule. |
| `apps/zoltar-playtest/vite.config.ts` | Minimal config with `svelte()` plugin (NOT `sveltekit()`). |
| `apps/zoltar-playtest/index.html` | Standard Vite SPA entry. |
| `apps/zoltar-playtest/src/main.ts` | Mounts `App.svelte` to `#app`. |
| `apps/zoltar-playtest/src/App.svelte` | Placeholder heading. |

**Key decisions:**
- No `@anthropic-ai/sdk` — it doesn't work in browsers. Later phase uses raw `fetch`.
- Root `package.json` workspaces `["packages/*", "apps/*"]` already covers the new app — no change needed.

**Verify:** `npm install` succeeds, `npm run dev -w apps/zoltar-playtest` renders the placeholder.

---

## Phase 2: TypeScript Types

**Goal:** Define every data type from the spec as the single source of truth for the rest of the implementation.

**Files to create:**

| File | Purpose |
|------|---------|
| `src/lib/types.ts` | All TS types: `MothershipCharacter`, `ResourcePool`, `ResourcePools`, `EntityState`, `Flags`, `AppState`, `GmContextStructured`, `OracleEntry`, `OracleTable`, `RollDiceOutput`, `SubmitGmResponse`. |

**Verify:** `svelte-check` passes.

---

## Phase 3: Pure Utility Modules

**Goal:** Implement all pure logic with no UI or API dependencies — dice roller, localStorage persistence, snapshot serializer.

**Files to create:**

| File | Purpose |
|------|---------|
| `src/lib/dice.ts` | `executeDiceRoll(notation): RollDiceOutput` — NdM+K parser, `Math.random()`. |
| `src/lib/storage.ts` | `loadApiKey`, `saveApiKey`, `loadState`, `saveState`, `exportState`, `importState`. Keys: `zoltar_playtest_api_key`, `zoltar_playtest_state`. |
| `src/lib/snapshot.ts` | `buildSnapshot(state): string` — formatted prose snapshot per spec. |

**Verify:** `svelte-check` passes. Functions are importable.

---

## Phase 4: Oracle Tables

**Goal:** Draft oracle JSON data files and the loader/picker logic.

**Files to create:**

| File | Purpose |
|------|---------|
| `public/oracle-tables/survivors.json` | 2-3 draft entries per the `OracleTable` schema. |
| `public/oracle-tables/threats.json` | Same. |
| `public/oracle-tables/secrets.json` | Same. |
| `public/oracle-tables/vessel-type.json` | Same. |
| `public/oracle-tables/tone.json` | Same. |
| `src/lib/oracle.ts` | `loadOracleTables(): Promise<Record<string, OracleTable>>` (fetches from `/oracle-tables/`), `pickRandom(entries): OracleEntry`. |

**Key decision:** Oracle tables go in `public/oracle-tables/` so they're served as static assets (editable without rebuild). Minor deviation from spec's flat layout.

**Verify:** Dev server serves JSON files at `/oracle-tables/*.json`.

---

## Phase 5: Reactive State Store

**Goal:** Svelte 5 rune-based reactive state with all mutation logic — pool deltas, entity updates, flag merging.

**Files to create:**

| File | Purpose |
|------|---------|
| `src/lib/state.svelte.ts` | `createAppState()` returns `$state`-powered `AppState` with defaults. `applyGmResponse(state, response)` — pool initialization/delta logic, entity updates, flag merging, npcState merging, proposedCanon push, diceRequests population. `initializePlayerPools(state, character)`. |

**Key decisions:**
- `.svelte.ts` extension — Svelte 5 runes require this in non-component files.
- `applyGmResponse` mutates the `$state` proxy directly — Svelte 5 reactivity triggers automatically.
- Pool initialization rules from spec: positive delta on unknown pool = init, negative delta on unknown pool = error.

**Verify:** `svelte-check` passes.

---

## Phase 6: Tool Definitions and API Client

**Goal:** Anthropic API integration — tool schemas, raw fetch wrapper, tool resolution loop, synthesis call, prompt builders.

**Files to create:**

| File | Purpose |
|------|---------|
| `src/lib/tools.ts` | `PLAY_TOOLS` (submit_gm_response + roll_dice) and `SYNTHESIS_TOOLS` (submit_gm_context). Exact JSON schemas from the spec. |
| `src/lib/api.ts` | `callAnthropic(apiKey, system, messages, tools, toolChoice)` — raw `fetch` to `https://api.anthropic.com/v1/messages` with `anthropic-dangerous-direct-browser-access: true` header. `runTurn(state, playerAction)` — tool resolution loop per spec. `runSynthesis(state, oracleSelections)` — synthesis call. `buildSystemPrompt(state)`, `buildSynthesisPrompt(character, selections)`. |

**Key decisions:**
- Raw `fetch` with `anthropic-dangerous-direct-browser-access: true` header for browser API calls.
- Model: `claude-sonnet-4-6` per spec.
- Tool loop: loops on `roll_dice`, terminates on `submit_gm_response`, errors on anything else.

**Verify:** `svelte-check` passes. Tool schemas match spec exactly. Loop logic matches spec pseudocode.

---

## Phase 7: App Shell and ErrorBanner

**Goal:** Wire up App.svelte as the view router with state initialization/persistence, plus the shared ErrorBanner component.

**Files to modify/create:**

| File | Purpose |
|------|---------|
| `src/App.svelte` | **Rewrite.** Creates state via `createAppState()`, restores from localStorage on mount, auto-saves via `$effect`. Renders `SetupView` or `PlayView` based on `state.view`. |
| `src/components/ErrorBanner.svelte` | Renders `state.errors` as dismissible banners. Shared between views. |

**Verify:** App loads, restores state from localStorage on refresh. ErrorBanner renders when errors are present.

---

## Phase 8: Setup View — API Key and Character Form

**Goal:** First two steps of the setup flow — API key entry and character sheet form.

**Files to create:**

| File | Purpose |
|------|---------|
| `src/components/SetupView.svelte` | 4-step container with reactive `step` variable (1–4). Steps 3–4 are placeholders for now. |
| `src/components/CharacterForm.svelte` | All `MothershipCharacter` fields. Auto-slugifies name to entity ID. Class dropdown. Numeric inputs for stats/saves (0–100). Max HP. Skills as comma-separated text. Validates entity ID matches `^[a-z0-9_]+$`. On save, calls `initializePlayerPools`. |

**Verify:** Can enter API key (persists to localStorage), fill out character form, see validation errors, advance to step 3 placeholder.

---

## Phase 9: Setup View — Oracle Picker and Synthesis

**Goal:** Steps 3–4 of setup — oracle table browsing/selection and synthesis API call with review panel.

**Files to create/modify:**

| File | Purpose |
|------|---------|
| `src/components/OraclePicker.svelte` | Loads tables on mount. Collapsible section per category. Each entry shows `player_text` with active/inactive toggle. "Random Pick" button per category. Selected entries summary at bottom. |
| `src/components/SetupView.svelte` | **Update** steps 3–4. Step 3 renders OraclePicker. Step 4 calls `runSynthesis`, shows GM context review panel, "Begin Adventure" button transitions to play view. |

**Verify:** Full setup flow works end-to-end with a real API key. Oracle picker loads tables, random pick works. Synthesis call returns GM context. "Begin Adventure" transitions view.

---

## Phase 10: Play View — Message Log and Input

**Goal:** Core play loop — message log display, text input area, wired to `runTurn`.

**Files to create:**

| File | Purpose |
|------|---------|
| `src/components/PlayView.svelte` | Two-column layout (CSS grid, collapses on narrow viewport). Left: MessageLog + input textarea + submit button. Right: placeholder for StatePanel. Top: ErrorBanner. Input disabled while `state.loading`. Submit calls `runTurn`. |
| `src/components/MessageLog.svelte` | Scrollable turn list. Player input and GM `playerText` styled distinctly. System events (pool inits, warnings) inline in different style. Auto-scroll via `$effect`. |

**Verify:** Can send a player action, see the GM response in the message log, see system events. Loading state disables input.

---

## Phase 11: Play View — State Panel and Dice Prompt

**Goal:** Live state display, inline pool editing, and dice prompt overlay.

**Files to create/modify:**

| File | Purpose |
|------|---------|
| `src/components/StatePanel.svelte` | Character section (HP bar, stress, wounds), resource pools (current/max, click-to-edit inline), entities (visible/hidden, position, npcState), flags, pending canon. Sections render conditionally. |
| `src/components/DicePrompt.svelte` | Replaces input area when `pendingDiceRequests` is non-empty. Shows notation/purpose/target per request. "Roll for me" button (calls `executeDiceRoll`) + manual number input. Submits all results as formatted player message, clears pending requests. |
| `src/components/PlayView.svelte` | **Update** to render StatePanel in right column and DicePrompt overlay when needed. |

**Verify:** State panel updates live as GM responses arrive. Inline pool editing works. Dice prompt appears for player-facing rolls.

---

## Phase 12: Export/Import and Polish

**Goal:** Header controls for state and message log export/import. Final integration verification.

**Files to modify:**

| File | Purpose |
|------|---------|
| `src/components/PlayView.svelte` | **Update** header with Export State, Import State, Export Message Log buttons. Export: serialize to JSON Blob, trigger download via temp `<a>`. Import: hidden `<input type="file">`, `FileReader` parses JSON, replaces state. Export Message Log: format as plain text with PLAYER:/WARDEN: prefixes. |

**Verify:** Full end-to-end play session. Export/import roundtrips correctly. Message log export is readable. Page refresh restores state. All error cases surface in banner.

---

## Technical Notes

- **Formatting:** Tabs, single quotes, 100-char print width (matching zoltar-fe conventions).
- **No UI library:** Plain Svelte with `<style>` blocks, minimal CSS.
- **Props-down pattern:** App.svelte creates state and passes via props to children.
- **No routing library:** `state.view` reactive flag switches between SetupView and PlayView.
