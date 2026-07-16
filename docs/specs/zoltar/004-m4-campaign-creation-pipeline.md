# M4 — Solo Blind Campaign Creation Pipeline

**Spec status:** Claude Code handoff  
**Depends on:** M3 complete (oracle tables seeded, character creation flow wired, `apps/zoltar-fe` oracle filtering and character creation UI built)

---

## Goal

End-to-end adventure creation: oracle selections in, GM context in the database, adventure status `ready`. After M4 a player can complete character creation, reach the synthesis step, trigger synthesis, and receive a fully playable adventure context — all via the production backend. No game loop yet (that's M5/M6), but everything upstream of play is complete.

**What ships in M4:**
- `submit_gm_context` tool schema finalized (merged flags structure, `openingNarration` — both absent from `docs/tools.md`)
- `SynthesisService` — constructs the synthesis prompt, calls Claude, handles coherence check
- `submit_gm_context` write path — validates the tool call output, writes `gm_context`, initializes `campaign_state`, populates `grid_entity`, flips adventure to `ready`
- Pending canon auto-promote for Solo Blind mode
- `POST /api/v1/campaigns/:campaignId/adventures/:adventureId/synthesize` endpoint
- Frontend: full Solo Blind creation flow wired end-to-end through the real backend

---

## Part 1: Tool Schema — `submit_gm_context` Corrections

Two things are missing or wrong in `docs/tools.md` relative to the canonical design. Fix them before implementing the backend.

### 1.1 `openingNarration` (top-level field)

The first thing the player sees when the adventure begins. Generated during synthesis so the player's first experience is the GM speaking, not a blank input field. Injected as the first assistant message on adventure start — it is not part of the GM context blob and is not re-sent to Claude.

```typescript
// Top-level field, sibling to narrative and structured:
openingNarration: z.string().optional(),
```

Write path: stored in `gm_context.blob` under a top-level `openingNarration` key. Returned to the frontend in the synthesis response as a distinct field.

### 1.2 Merged flags structure (replaces `initialFlags`)

The canonical Mothership Campaign State Schema (in the design doc) stores each flag as `{ value: boolean, trigger: string }` — value and trigger are co-located under one key, not spread across two parallel maps. `docs/tools.md` incorrectly shows `initialFlags` and a separate `flagTriggers` record. Use the merged structure throughout.

```typescript
// structured.flags replaces structured.initialFlags
flags: z.record(z.string(), z.object({
  value:   z.boolean(),
  trigger: z.string(),
})),
// Example:
// {
//   "distress_beacon_active": {
//     "value": false,
//     "trigger": "Flip to true when the player or an NPC activates the beacon at the bridge console."
//   },
//   "adventure_complete": {
//     "value": false,
//     "trigger": "Flip to true when the player escapes the vessel via the emergency pod with the manifest."
//   }
// }
```

`narrative.flagTriggers` is gone — no separate map, no cross-validation needed. The `adventure_complete` required-flag check (see Part 5.1) still applies: reject input that is missing this key.

This is what gets written to `campaign_state.data.flags` verbatim. The `trigger` value is the Warden's behavioral instruction for when to flip the flag — it persists in state so the state snapshot can surface it to Claude each turn without re-reading the GM context blob.

### 1.3 Updated full schema

```typescript
export const submitGmContextSchema = z.object({

  openingNarration: z.string().optional(),

  narrative: z.object({
    location:          z.string(),
    atmosphere:        z.string(),
    npcAgendas:        z.record(z.string(), z.string()),
    hiddenTruth:       z.string(),
    oracleConnections: z.string(),
  }),

  structured: z.object({
    entities: z.array(z.object({
      id:               z.string(),
      type:             z.enum(['npc', 'threat', 'feature']),
      startingPosition: z.object({
        x: z.number().int(),
        y: z.number().int(),
        z: z.number().int().default(0),
      }).optional(),
      visible: z.boolean(),
      tags:    z.array(z.string()),
    })),
    flags:        z.record(z.string(), z.object({
      value:   z.boolean(),
      trigger: z.string(),
    })),
    initialState: z.record(z.string(), z.unknown()),
  }),

});

export type SubmitGmContext = z.infer<typeof submitGmContextSchema>;
```

Place this schema in `apps/zoltar-be/src/synthesis/synthesis.schema.ts`. Update `docs/tools.md` to match — remove `initialFlags`, remove `flagTriggers` from `narrative`, add the merged `flags` definition.

---

## Part 2: Synthesis Endpoint

### 2.1 Route

```
POST /api/v1/campaigns/:campaignId/adventures/:adventureId/synthesize
```

**Auth:** authenticated user, must be a member of `campaignId`.

**Request body:**
```typescript
const synthesizeRequestSchema = z.object({
  // Oracle selections: one resolved entry per category, keyed by category slug.
  // Shape is system-specific — validated against the system's oracle schema in the service layer,
  // not at the HTTP boundary. Each entry is the full oracle JSON object
  // (id, player_text, claude_text, interfaces, tags).
  oracleSelections: z.record(z.string(), z.unknown()),
  // Optional player addendum — freeform additional direction injected at end of synthesis prompt.
  addendum: z.string().optional(),
});
```

**System-specific oracle validation** lives in `packages/game-systems`, not in the endpoint. `SynthesisService` looks up the appropriate schema by `campaign.system_id` before calling the prompt builder:

```typescript
// packages/game-systems/src/mothership/oracle.ts
export const MothershipOracleSelectionsSchema = z.object({
  survivor:    OracleEntrySchema,
  threat:      OracleEntrySchema,
  secret:      OracleEntrySchema,
  vessel_type: OracleEntrySchema,
  tone:        OracleEntrySchema,
});

// packages/game-systems/src/index.ts — registry pattern, same as state schemas
export const oracleSchemas: Record<string, z.ZodTypeAny> = {
  mothership: MothershipOracleSelectionsSchema,
  // uvg: UVGOracleSelectionsSchema,  ← Phase 2 addition, no endpoint changes required
};
```

`SynthesisService` parses `oracleSelections` against the system's schema and returns a 422 if validation fails. The prompt builders are also system-specific — `buildMothershipSynthesisPrompt` in `synthesis.prompts.ts`, with additional builders added per system in Phase 2.

**Preconditions (return 409 if violated):**
- Adventure status must be `synthesizing`
- A character sheet must exist for the authenticated user in this campaign
- `oracleSelections` must pass the system-specific oracle schema validation (422 on failure)

**Response:** `202 Accepted` with body `{ "status": "synthesizing" }`. Synthesis runs asynchronously. The client polls `GET /campaigns/:id/adventures/:id` and watches `status` for transition to `ready` or `failed`.

**On synthesis failure:** Set `adventure.status = 'failed'`. Optionally write a failure reason to `gm_context.blob` as `{ "error": "..." }` for debugging. Do not expose the raw Anthropic error to the client.

### 2.2 Module and service location

```
apps/zoltar-be/src/synthesis/
  synthesis.module.ts
  synthesis.controller.ts
  synthesis.service.ts
  synthesis.schema.ts       ← submitGmContextSchema lives here
  synthesis.prompts.ts      ← system-specific prompt construction functions

packages/game-systems/src/mothership/
  oracle.ts                 ← MothershipOracleSelectionsSchema + OracleEntrySchema
  (state.ts, character.ts already exist from M1/M3)
```

`SynthesisModule` imports `DrizzleModule` and `AnthropicModule` (M5 will add the full Claude client; for M4, add a lightweight `AnthropicModule` that wraps `@anthropic-ai/sdk` with just enough to make a messages call). Register `SynthesisModule` in `AppModule`.

---

## Part 3: Synthesis Prompt Construction

These are the canonical prompts pulled from `apps/zoltar-playtest`. Implement them verbatim in `synthesis.prompts.ts`.

### 3.1 System prompt

```typescript
export const SYNTHESIS_SYSTEM_PROMPT =
  'You are a GM context synthesizer for a Mothership RPG adventure.';
```

### 3.2 Character sheet formatting

```typescript
function formatCharacterProse(sheet: MothershipCharacterSheet): string {
  const d = sheet.data; // the JSONB data blob, validated as MothershipCharacter
  return `${d.name} (${d.class})
Stats: STR ${d.stats.strength}, SPD ${d.stats.speed}, INT ${d.stats.intellect}, CMB ${d.stats.combat}
Saves: Fear ${d.saves.fear}, Sanity ${d.saves.sanity}, Body ${d.saves.body}, Armor ${d.saves.armor}
HP: ${d.maxHp}
Skills: ${d.skills.join(', ')}`;
}
```

### 3.3 Oracle entry formatting

Each oracle entry is serialized as full JSON so Claude can read `id`, `claude_text`, `interfaces`, and `tags`. The `player_text` field is also present but Claude should not incorporate player-facing text verbatim into the GM context.

```typescript
function formatOracleEntry(label: string, entry: OracleEntry): string {
  return `${label}:\n${JSON.stringify(entry, null, 2)}`;
}
```

### 3.4 User message

```typescript
export function buildMothershipSynthesisPrompt(
  characterSheet: MothershipCharacterSheet,
  selections: MothershipOracleSelections,
  addendum?: string,
): string {
  const sections = [
    `You are synthesizing a GM context for a solo Mothership adventure.`,
    `CHARACTER:\n${formatCharacterProse(characterSheet)}`,
    `ORACLE RESULTS:\n${[
      formatOracleEntry('Survivor',    selections.survivor),
      formatOracleEntry('Threat',      selections.threat),
      formatOracleEntry('Secret',      selections.secret),
      formatOracleEntry('Vessel Type', selections.vessel_type),
      formatOracleEntry('Tone',        selections.tone),
    ].join('\n\n')}`,
    `Each oracle entry includes an id, claude_text (the narrative seed), interfaces (hints for how entries connect across categories), and tags. Use the id values as the basis for entity IDs and flag keys in the structured output. Use the interfaces array to wire entries together coherently — condition values indicate which other entries this one connects to. Synthesize a coherent GM context from these elements and call submit_gm_context when complete.`,
    `FLAGS:\nEach flag in the structured output must include both a value (boolean) and a trigger (the specific in-fiction action or event that flips it). Example: { "distress_beacon_active": { "value": false, "trigger": "Flip to true when the player or an NPC activates the beacon at the bridge console. Approaching the console is not sufficient." } }`,
    `REQUIRED FLAG — adventure_complete:\nEvery scenario must include adventure_complete: { value: false, trigger: "..." } where the trigger names the specific end condition for this adventure.`,
    `COUNTDOWN TIMERS:\nAny mechanic that involves a number counting down over the course of the adventure must be initialized as a named resource pool in initialState. Use the naming convention {entity_id}_timer — e.g. crewman_wick_timer: { current: 4, max: 4 }. Do not track countdowns as freeform state or narrative-only values.`,
    `OPENING NARRATION:\nWrite an openingNarration — the ambient scene at the moment the player character enters the adventure, before any player agency. Establish the immediate physical situation, convey the atmosphere, and include one concrete detail the player did not put there — something that signals the world has already been in motion without them.`,
  ];

  if (addendum?.trim()) {
    sections.push(`ADDITIONAL DIRECTION:\n${addendum.trim()}`);
  }

  return sections.join('\n\n');
}
```

### 3.5 Tool definition passed to Claude

Pass `submit_gm_context` as the only tool, with `tool_choice: { type: 'any' }` to force Claude to call it rather than respond with text.

```typescript
export const SYNTHESIS_TOOLS: Anthropic.Tool[] = [
  {
    name: 'submit_gm_context',
    description:
      'Commit the synthesized GM context to the database. Call this exactly once when synthesis is complete.',
    input_schema: zodToJsonSchema(submitGmContextSchema),
  },
];
```

Use `zod-to-json-schema` to derive the JSON Schema from `submitGmContextSchema`. Add this package to `apps/zoltar-be` dependencies if not already present.

---

## Part 4: Coherence Check

The coherence check runs between oracle selection and synthesis. It is implemented in `SynthesisService.checkCoherence()` and called before `buildSynthesisPrompt`. The check is a Claude API call, not a deterministic algorithm.

**Three-tier resolution (in order):**

**Tier 1 — Silent reroll.** Claude detects a hard contradiction between two oracle results and returns a replacement entry for the conflicting slot, drawn from the active pool. The player never knows. Reroll is only possible if the active pool for the affected category has more than one entry.

**Tier 2 — Silent synthesis resolution.** Conflict is subtle or the pool is too constrained to reroll. Claude returns the original selections unchanged. The tension is resolved during synthesis — Claude makes the combination cohere through narrative means.

**Tier 3 — Player surfacing.** Genuinely unresolvable conflict where the active pool cannot produce a coherent scenario. Return the conflict description to the frontend so the player can adjust their filter settings. This should be rare — the interface hints in oracle entries are designed to prevent it.

**Implementation note:** The coherence check is a separate lightweight Claude call (not the synthesis call). Its only job is to detect hard contradictions and optionally suggest a reroll. Keep the prompt short. If the check returns no conflicts, proceed directly to synthesis with the original selections.

```typescript
// Coherence check prompt (system)
const COHERENCE_SYSTEM_PROMPT =
  'You are checking oracle table selections for a Mothership RPG adventure for hard contradictions.';

// Coherence check response schema (tool: report_coherence)
const coherenceReportSchema = z.object({
  conflicts: z.array(z.object({
    category:    z.string(),           // the conflicting category: 'survivor', 'threat', etc.
    description: z.string(),           // what the conflict is
    rerollable:  z.boolean(),          // can it be resolved by rerolling this slot?
  })),
  resolution: z.enum(['proceed', 'reroll', 'surface']),
  rerollCategory: z.string().optional(),  // present if resolution === 'reroll'
});
```

If `resolution === 'reroll'`: draw a new random entry from the active pool for `rerollCategory` (excluding the current selection) and substitute it. If no alternative exists in the pool, escalate to `surface`. Log the reroll at `debug` level.

If `resolution === 'proceed'` or `'reroll'` (after substitution): call `buildSynthesisPrompt` with the final selections and proceed.

If `resolution === 'surface'`: do not call Claude for synthesis. Return `409 Conflict` with body:
```json
{
  "error": "coherence_conflict",
  "conflicts": [ { "category": "...", "description": "..." } ]
}
```

---

## Part 5: `submit_gm_context` Write Path

When Claude calls `submit_gm_context`, `SynthesisService` receives the tool input and executes the following writes in a single database transaction. On any validation failure, roll back and set `adventure.status = 'failed'`.

### 5.1 Validation before writes

1. Verify `adventure_complete` is present in `structured.flags` with `value: false`. Fail if missing.
2. Validate `structured.initialState` against `MothershipStateSchema` (the system Zod schema). Fail if invalid.
3. Verify no entity `id` in `structured.entities` is duplicated within the call. Fail if duplicates found.

### 5.2 Write `gm_context`

Insert a row into `gm_context`:

```typescript
await db.insert(gmContext).values({
  adventureId,
  blob: {
    openingNarration: input.openingNarration ?? null,
    narrative: input.narrative,             // includes flagTriggers
    entities: input.structured.entities,   // for reference; canonical store is grid_entity
  },
});
```

`gm_context.blob` is the authoritative store for the narrative section plus `openingNarration`. The `entities` array is duplicated here for convenience (e.g. prompt assembly) but `grid_entity` is the authoritative spatial store.

### 5.3 Write `campaign_state`

Upsert a row into `campaign_state` with `flags` and `initialState` merged into `data`:

```typescript
const initialData = {
  flags:         input.structured.flags,   // { [flagKey]: { value, trigger } }
  resourcePools: buildResourcePools(input.structured.initialState, input.structured.entities),
};

await db.insert(campaignState).values({
  campaignId,
  system: 'mothership',
  schemaVersion: 1,
  data: initialData,
}).onConflictDoUpdate({
  target: campaignState.campaignId,
  set: { data: initialData, updatedAt: sql`now()` },
});
```

`buildResourcePools` takes `initialState` (keyed resource pools with `current`/`max`) and the entities array, and merges them into the canonical resource pool map. Player character HP and stress pools (initialized during character creation in M3) are already in `campaign_state`; do not overwrite them — merge carefully.

### 5.4 Write `grid_entity`

Insert one row per entity in `structured.entities` that has a `startingPosition`:

```typescript
for (const entity of input.structured.entities) {
  if (!entity.startingPosition) continue;
  await db.insert(gridEntity).values({
    campaignId,
    entityRef: entity.id,
    x:       entity.startingPosition.x,
    y:       entity.startingPosition.y,
    z:       entity.startingPosition.z,
    visible: entity.visible,
    tags:    entity.tags,
  });
}
```

Entities without a `startingPosition` exist in the narrative but not on the grid — they may appear later via `stateChanges.entities` in session play. This is valid.

### 5.5 Flip adventure status to `ready`

```typescript
await db.update(adventures)
  .set({ status: 'ready' })
  .where(eq(adventures.id, adventureId));
```

This is the transition defined in M2's `V9__adventure_status.sql`. M4 is where it actually fires.

### 5.6 Auto-promote pending canon (Solo Blind)

Solo Blind is the only campaign creation mode in Phase 1. All `pending_canon` entries for this adventure are auto-promoted immediately. There is no human review queue in M4 — the queue infrastructure (V6 table) is in place, but Solo Blind bypasses it.

```typescript
await db.update(pendingCanon)
  .set({ status: 'promoted', reviewedAt: sql`now()` })
  .where(and(
    eq(pendingCanon.adventureId, adventureId),
    eq(pendingCanon.status, 'pending'),
  ));
```

This function will also be called at the end of each turn in M6 (when `submit_gm_response` proposes canon and the campaign is Solo Blind). Extract it into a shared helper: `SynthesisService.autoPromoteCanon(adventureId: string)`.

---

## Part 6: Synthesis Response to Frontend

Once all writes succeed, return to the waiting frontend poll via the adventure status endpoint. No SSE in M4 — the frontend polls `GET /campaigns/:id/adventures/:id` until `status !== 'synthesizing'`.

Add `openingNarration` to the adventure GET response when `status === 'ready'`:

```typescript
// GET /campaigns/:campaignId/adventures/:adventureId response (M4 additions)
{
  "id": "uuid",
  "campaignId": "uuid",
  "status": "ready",
  "mode": "freeform",
  "callerId": "uuid",
  "openingNarration": "The emergency lights cast everything in amber...",
  "createdAt": "...",
  "completedAt": null
}
```

`openingNarration` is read from `gm_context.blob.openingNarration`. It is null when status is not `ready`.

---

## Part 7: Frontend — Solo Blind Creation Flow

Wire the existing M3 UI components through the real backend. The playtest tool's four-step setup flow (`API Key → Character → Oracle → Synthesis`) maps to the production flow as follows.

### 7.1 Flow steps

**Step 1 — Character creation (M3 UI, already wired to backend)**  
No changes. M3 implemented character creation and `PUT /campaigns/:id/character-sheet`.

**Step 2 — Oracle filtering and selection (M3 UI)**  
No changes to the UI. On "Synthesize Adventure" confirm, POST selections to the synthesis endpoint.

**Step 3 — Synthesis in progress**  
Display a loading state. Poll `GET /campaigns/:id/adventures/:id` every 2 seconds. If `status === 'failed'`, display an error with a retry affordance that re-POSTs to the synthesis endpoint. If `status === 'ready'`, proceed to step 4.

**Step 4 — Synthesis review and begin**  
Display the opening narration. Show entity summary (entity IDs, types, visible flags) as a GM-layer-only review panel — this is internal state, not player-facing. A "Begin Adventure" button transitions to the play view. The opening narration is injected as the first assistant message in the message log before the player's first input.

### 7.2 Coherence conflict handling

If the synthesis endpoint returns `409 { "error": "coherence_conflict" }`, display the conflicts inline on the oracle selection step with a message like: "These selections conflict and couldn't be automatically resolved. Adjust your filters and try again." Include the `description` from each conflict entry.

### 7.3 Polling timeout

If synthesis has not resolved after 60 seconds of polling, display: "Synthesis is taking longer than expected. You can continue waiting or try again later." Do not auto-retry — wait for user action.

---

## Part 8: Anthropic Client (Minimal, M4 Scope)

M5 will build the full `ClaudeApiClient` for session play. M4 needs a minimal client for synthesis only. Keep them separate — do not prematurely generalize.

```
apps/zoltar-be/src/anthropic/
  anthropic.module.ts
  anthropic.service.ts    ← wraps SDK; exposes callMessages()
```

`AnthropicService.callMessages()`:

```typescript
async callMessages(params: {
  system:    string;
  messages:  Anthropic.MessageParam[];
  tools:     Anthropic.Tool[];
  toolChoice: Anthropic.ToolChoiceAny;
  model?:    string;
  maxTokens?: number;
}): Promise<Anthropic.Message>
```

- Default model: `claude-sonnet-4-6`
- Default `maxTokens`: `8192` (synthesis responses are large)
- API key from `ConfigService` (`ANTHROPIC_API_KEY` env var — already in `.env.example` from M1)
- No retry logic in M4. Surface Anthropic SDK errors to the caller; `SynthesisService` sets `adventure.status = 'failed'` on catch.

---

## Testing

Follow the standards in `docs/CLAUDE.md`.

**Unit tests (`synthesis.service.spec.ts`):**
- `buildSynthesisPrompt` produces expected string shape for known inputs (character + selections)
- Coherence check: `proceed` path calls synthesis; `reroll` path substitutes the correct category; `surface` path returns 409
- Write path: all DB writes fire in a transaction; failure in any write rolls back and sets `failed` status
- Missing `adventure_complete` flag rejects input with a descriptive error
- Oracle selections validation: unknown system slug returns 422; missing required category for Mothership returns 422

**Integration tests (against test DB):**
- Full synthesis round trip with a mocked Anthropic client returning a valid `submit_gm_context` payload: verify `gm_context`, `campaign_state`, `grid_entity`, and `adventure.status` are all written correctly
- Auto-promote: after synthesis, all `pending_canon` rows for the adventure have `status = 'promoted'`

**Do not** write integration tests that call the real Anthropic API. Mock `AnthropicService.callMessages` in all tests.

---

## Deferred

- Synthesis progress streaming (SSE) — deferred until M7 UX polish
- Collaborative and Solo Authored creation modes — Phase 2; `SynthesisService` is designed to accept them without refactoring (same `submit_gm_context` schema, different prompt construction path)
- Campaign canon read during synthesis (second-adventure continuity) — Phase 2
- Coherence check prompt tuning — the prompt above is a starting point; iterate based on observed behavior
