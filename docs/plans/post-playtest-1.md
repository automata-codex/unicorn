# Post-Playtest 1 Changes — Implementation Plan

## Context

Ten changes from the Playtest 1 review (`docs/specs/post-playtest-1.md`) across context window architecture, prompt engineering, oracle pipeline, and UI. Grouped into 5 phases by dependency order.

---

## Phase 1: Prompt Engineering (Items 4, 5, 6, 7)

**Goal:** Add four new WARDEN INSTRUCTIONS rules to the system prompt in `api.ts:buildSystemPrompt`. Pure text changes, no logic.

**Changes to `src/lib/api.ts`:**
- Item 4: Forbid structured internals (entity IDs, flag keys, coordinates) in `playerText`
- Item 5: Constrain response granularity — smallest meaningful turn, return control to player
- Item 6: GM delivers the opening scene without waiting for player input
- Item 7: OOC input handling — respond conversationally without `submit_gm_response` for rules questions

**Note:** Item 7 says "respond conversationally without calling `submit_gm_response`" but `tool_choice: { type: 'any' }` forces a tool call. Either change to `tool_choice: 'auto'` or accept that OOC responses still go through the tool. Recommend keeping `tool_choice: 'any'` and rewording the instruction to say "use `playerText` for OOC responses" — simpler and avoids breaking the tool loop.

**Verify:** Rebuild, start a new session, check that Claude follows the new rules.

---

## Phase 2: Oracle Data — Unify Condition Format (Item 9)

**Goal:** Replace colon notation (`secret:company_knew`) with underscore format (`secret_company_knew`) in all oracle table `interfaces[].condition` values.

**Files to modify:**
- `public/oracle-tables/survivors.json`
- `public/oracle-tables/threats.json`
- `public/oracle-tables/secrets.json`
- `public/oracle-tables/vessel-type.json`
- `public/oracle-tables/tone.json`

Bump all versions from `1.0.0` → `1.0.1` (patch: content revised per versioning conventions).

**Verify:** JSON valid, all condition values use underscores only.

---

## Phase 3: Oracle Synthesis — Complete Entries (Item 8)

**Goal:** Pass the full oracle entry JSON (id, player_text, claude_text, interfaces, tags) to the synthesis prompt instead of just `claude_text` + `interfaces`.

**Changes to `src/lib/api.ts`:**
- Rewrite `formatOracleForSynthesis` to emit the complete entry as structured JSON
- Update `buildSynthesisPrompt` accordingly

**Verify:** Rebuild, run synthesis, confirm Claude receives full entry data including `id` and `tags`.

---

## Phase 4: Context Window Architecture (Items 1, 2, 3)

**Goal:** Replace naive message accumulation with a reconstructed context window. Inject `gmContextStructured` into every request. Add the authoritative state rule.

**Changes to `src/lib/api.ts`:**
- Item 2: Add `<game_state>` authoritative rule to WARDEN INSTRUCTIONS
- Item 1: Build user messages with `gmContextStructured` in XML wrapper, prepended before player input
- Item 3: Replace `trimHistory` + raw message accumulation with a reconstructed prompt:
  - System prompt: static (role + gmContextBlob + instructions) — cached
  - User message: `<game_state>` snapshot + canon log + player action
  - Recent exchanges: last N turns (default 6) as rolling window
  - Drop full tool call history; extract canon summaries from `proposedCanon`

**Changes to `src/lib/snapshot.ts`:**
- May be simplified or removed — the formatted prose snapshot is superseded by the structured `<game_state>` block

**Changes to `src/lib/state.svelte.ts`:**
- Track `canonLog` (accumulated canon summaries across all turns) separately from `pendingCanon`

**Verify:** Rebuild, play multiple turns, confirm the API payload stays bounded and contains the game state block.

---

## Phase 5: UI — Surface Die Rolls (Item 10)

**Goal:** Render `roll_dice` tool calls and results as distinct visual elements in the message log.

**Changes to `src/components/MessageLog.svelte`:**
- Extract `roll_dice` tool calls and their results from the message history
- Render them as a visually distinct element (separate from GM prose) — e.g. a dice icon, notation, purpose, and result

**Verify:** Play a session that triggers NPC rolls, confirm they appear visually in the log.

---

## Phase Summary

| Phase | Items      | Scope                           |
|-------|------------|---------------------------------|
| 1     | 4, 5, 6, 7 | System prompt text changes      |
| 2     | 9          | Oracle JSON condition format    |
| 3     | 8          | Synthesis prompt — full entries |
| 4     | 1, 2, 3    | Reconstructed context window    |
| 5     | 10         | Die roll UI                     |
