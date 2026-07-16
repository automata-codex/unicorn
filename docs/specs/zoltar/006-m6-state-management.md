# M6 — GmService & State Management

**Spec status:** Claude Code handoff
**Depends on:** M5 complete (`SessionService.sendMessage` returning parsed `submit_gm_response` proposals; `svelte-spa-router` v5 wired; `submit_gm_response` tool schema locked)

---

## Goal

Close the play loop. After M5 a message round-trip produces a well-formed `submit_gm_response` but throws the proposals away; after M6 those proposals are validated, applied to `campaign_state.data`, logged to `game_events`, routed to `pending_canon` (auto-promoted in Solo Blind), and captured in `adventure_telemetry`. Invalid changes trigger a one-round correction loop that re-prompts Claude with the rejection details; the superseded response is preserved in `game_events` but never surfaces to the player.

On the frontend the first production play view ships: message log, input, character status strip, opening narration on first load. The `/campaigns/:campaignId/adventures/:adventureId/play` route is the destination of the "Begin Adventure" button that M4 wired into the post-synthesis flow.

**What ships in M6:**
- Pool definitions for Mothership in `@uv/game-systems` (`pool-definitions.ts`).
- `SessionService` state-change validator (resource pools, entities, flags, scenarioState, worldFacts).
- Transactional applier that writes validated deltas to `campaign_state.data`.
- `game_events` write path covering `player_action`, `gm_response`, `state_update`, and `correction` event types with monotonic `sequence_number`.
- Bounded correction mechanic: one re-prompt on validation rejection, `superseded_by` link between original and correction events, only the final text reaches `messages`.
- `proposedCanon` routing to `pending_canon` + auto-promote in Solo Blind (reuses `SynthesisService.autoPromoteCanon`).
- `adventure_telemetry` write path: one row per turn, `sequence_number` matching the `gm_response` event.
- Frontend play view (`/play` route, message log, input, character status).

**What does not ship in M6 (deferred by design):**
- `roll_dice` and `rules_lookup` tools, and the inner tool-use loop that consumes them — M7.
- `playerRolls` dice prompt UI on the frontend — M7 (the backend parses and persists the field, but the frontend ignores it).
- Caller enforcement and initiative mode — M8.
- `caller_transfer` handling on `submit_gm_response` — M8.
- Rolling summary — deferred (see `docs/DECISIONS.md`).
- `<character_attributes>` snapshot block — still deferred, no data source (see `docs/DECISIONS.md`).
- Auto-zeroing resource pools when entity `status` flips to `'dead'` — Claude must send explicit `resourcePools` deltas; reactivate if playtests show this drops reliably.

---

## Done When

1. `getMothershipPoolDefinition(poolName)` returns a `PoolDefinition` for known suffixes (`_hp`, `_stress`) and a permissive default for unknown pools.
2. A `SessionService`-owned validator converts a parsed `SubmitGmResponse` plus current `campaign_state.data` into a `ValidationResult` containing applied deltas and rejections.
3. On a happy-path turn: `campaign_state.data` is updated in a single transaction, three `game_events` rows (`player_action`, `gm_response`, `state_update`) are written with contiguous `sequence_number` values, an `adventure_telemetry` row is written with sequence matching the `gm_response`, and any `proposedCanon` entries land in `pending_canon` (auto-promoted in Solo Blind).
4. On a validation-rejection turn: original response persists to `game_events` as `gm_response`, Claude is re-prompted once with a structured `tool_result`, the corrected response persists as `correction` with `superseded_by` pointing at the original, only the corrected `playerText` reaches `messages`.
5. If the correction also fails validation: turn aborts with 502. The player message row and both `game_events` entries remain; `campaign_state.data` is unchanged.
6. `POST /api/v1/campaigns/:campaignId/adventures/:adventureId/messages` returns the applied deltas, threshold crossings, and final `playerText` — not the raw `proposals` shape from M5.
7. Frontend `/play` route renders opening narration on first visit, the message log on subsequent visits, and a character status strip showing HP and stress pulled from `campaign_state.data.resourcePools`.
8. `tsc --noEmit` passes frontend and backend. All new code has unit tests; the turn loop has integration tests covering happy path, successful correction, and failed correction.

---

## Documentation Corrections

### `docs/api.md` — step list no longer includes deferred work

The current post-`submit_gm_response` step list in `api.md` references LOS computation, rolling summary updates, caller transfer, and `advance_initiative` — none of which ship in M6. Update the numbered sequence to match what M6 actually does:

```
12. Claude calls submit_gm_response — backend receives structured output
13. Validate proposed state changes against pool definitions and campaign_state
14. If rejections: re-prompt Claude once with a tool_result describing them
15. Apply validated state changes to campaign_state (single transaction)
16. Write player_action, gm_response (+ correction if applicable), state_update events
17. Write proposed_canon entries to pending_canon (auto-promote in Solo Blind)
18. Write gm_updates.npc_states and notes to gm_context blob
19. Write final corrected GM response to messages table
20. Write adventure_telemetry row keyed to the gm_response sequence_number
21. Return { message, applied, rejections, thresholds } to frontend
```

Steps referencing LOS (6), rolling summary (7, 22), caller transfer (21), and initiative (20) stay as Phase 2+ commentary, not numbered in the M6 flow.

### `docs/zoltar-design-doc.md` — clarify superseded_by semantics

The "No undo" section describes `superseded_by` as serving rules-review corrections. In M6 it also covers validator rejections. Reword the bullet to:

> *Rules error or validation rejection:* Claude's response is flagged — either by the validator detecting an invalid state change or by a future GM ruling review. Claude re-narrates. The rejected event is logged with `superseded_by` pointing to the correction.

### `docs/tools.md` — no changes

The tool schema work was completed in M5; M6 only consumes it.

---

## Architecture

All M6 backend work lands in three existing modules, no new modules:

- `apps/zoltar-be/src/session/` — gains the validator, applier, correction loop, and expanded `sendMessage` orchestration. Renamed internally: the class stays `SessionService`, but the play-loop method is promoted from a thin passthrough to the full orchestrator. The historical `GmService` naming from the roadmap is retired — there is one session service, not two.
- `apps/zoltar-be/src/synthesis/` — `autoPromoteCanon` already exists; it's wired in from `SessionService`.
- `packages/game-systems/src/mothership/` — gains `pool-definitions.ts`.

Frontend work lands in two places:

- `apps/zoltar-fe/src/routes/Play.svelte` — new page component at `/campaigns/:campaignId/adventures/:adventureId/play`.
- `apps/zoltar-fe/src/lib/components/` — new play-view components (`MessageLog.svelte`, `MessageInput.svelte`, `CharacterStatusStrip.svelte`).

New backend files:

```
apps/zoltar-be/src/session/
  session.validator.ts         ← validateStateChanges + ValidationResult type
  session.applier.ts           ← applyStateChanges (pure function over state data)
  session.events.ts            ← game_events write helpers, sequence numbering
  session.correction.ts        ← one-round correction re-prompt loop
  session.telemetry.ts         ← adventure_telemetry write helper
  session.repository.ts        ← expanded with the DB-side methods M6 needs

packages/game-systems/src/mothership/
  pool-definitions.ts          ← getMothershipPoolDefinition
  pool-definitions.spec.ts
```

---

## Part 1: Pool Definitions

### Goal

The validator needs per-pool metadata — min, max, threshold crossings — to decide whether a delta is valid and what to tell Claude. Per `docs/DECISIONS.md` this lives in the system Zod module, not in the validator. M6 adds it.

### Location

`packages/game-systems/src/mothership/pool-definitions.ts`. Exported via the package barrel.

### Shape

```typescript
import { z } from 'zod';

export const PoolDefinitionSchema = z.object({
  min:        z.number().int().nullable(),
  max:        z.number().int().nullable(),
  thresholds: z.array(z.object({
    value:  z.number().int(),
    effect: z.string(),
    // 'death', 'unconscious', 'panic_check', 'power_critical', etc.
    // Effect strings are freeform labels; the validator does not interpret
    // them, it only reports which fired to Claude.
  })).default([]),
});

export type PoolDefinition = z.infer<typeof PoolDefinitionSchema>;
```

### Mothership definitions

```typescript
// Player HP: can go negative (death save territory), threshold fires at 0.
const HP_DEFINITION: PoolDefinition = {
  min: null,
  max: null,   // max is per-character, carried on the pool record itself
  thresholds: [
    { value: 0, effect: 'death_save_required' },
  ],
};

// Player stress: cannot go negative, no ceiling in Mothership.
// Panic checks are event-driven, not threshold-driven at specific values —
// the system prompt instructs Claude to call for a panic check when stress
// rises. The validator does not fire panic thresholds automatically.
const STRESS_DEFINITION: PoolDefinition = {
  min: 0,
  max: null,
  thresholds: [],
};

// Default for NPC/threat/scenario pools initialized by Claude during play.
// Permissive: allows negative (scenario timers can underflow), no threshold,
// and Claude is responsible for narrating consequences when a pool hits
// meaningful values.
const DEFAULT_DEFINITION: PoolDefinition = {
  min: null,
  max: null,
  thresholds: [],
};
```

### Resolver

```typescript
export function getMothershipPoolDefinition(
  poolName: string,
): PoolDefinition {
  if (poolName.endsWith('_hp'))     return HP_DEFINITION;
  if (poolName.endsWith('_stress')) return STRESS_DEFINITION;
  return DEFAULT_DEFINITION;
}
```

Suffix matching is the Phase 1 contract. When UVG or OSE land, each system provides its own resolver; the registry pattern (same as `oracleSchemas`) is introduced at that point. Do not add the registry in M6.

### Why not fold into the campaign-state schema?

`MothershipCampaignStateSchema` describes the **shape** of the state JSON — what keys exist, what values they accept. Pool definitions describe the **behavior** of named pools — what deltas are valid, what thresholds fire. Keeping them in separate modules means synthesis doesn't drag in threshold logic it doesn't care about, and the validator doesn't drag in schema validation it doesn't care about.

### Tests

`pool-definitions.spec.ts`:

- `getMothershipPoolDefinition('dr_chen_hp')` returns the HP definition with threshold at 0.
- `getMothershipPoolDefinition('vasquez_stress')` returns stress with `min: 0`.
- `getMothershipPoolDefinition('reactor_integrity')` returns the permissive default.
- `getMothershipPoolDefinition('_hp')` returns HP (edge case: the whole name is the suffix).
- `PoolDefinitionSchema.parse` rejects a threshold with a non-integer `value`.

---

## Part 2: State Change Validator

### Contract

```typescript
// session.validator.ts

export interface ValidationRejection {
  path:    string;       // e.g. 'resourcePools.xenomorph_hp', 'flags.new_flag'
  reason:  string;       // short, Claude-facing explanation
  received: unknown;     // what Claude proposed
}

export interface ThresholdCrossing {
  pool:     string;      // e.g. 'dr_chen_hp'
  finalValue: number;
  effect:   string;      // e.g. 'death_save_required'
}

export interface ValidationResult {
  applied: {
    resourcePools: Record<string, { current: number; max: number | null }>;
    entities:      Record<string, { visible: boolean; status: EntityStatus; npcState?: string }>;
    flags:         Record<string, { value: boolean; trigger: string }>;
    scenarioState: Record<string, { current: number; max: number | null; note: string }>;
    worldFacts:    Record<string, string>;
  };
  rejections: ValidationRejection[];
  thresholds: ThresholdCrossing[];
}

export function validateStateChanges(input: {
  proposed:    SubmitGmResponse['stateChanges'];
  currentData: MothershipCampaignState;
  poolDef:     (poolName: string) => PoolDefinition;
}): ValidationResult;
```

The validator is a pure function. No DB access. Easy to test in isolation.

### Per-field rules

**`resourcePools`**

For each `{ poolName, { delta } }`:

1. Look up the current value in `currentData.resourcePools[poolName]`.
   - If absent **and** `delta > 0`: initialize at `{ current: delta, max: null }`. This is Claude bootstrapping an NPC pool on first reference, consistent with the playtest-1 convention.
   - If absent **and** `delta <= 0`: reject with `reason: "Pool does not exist — bootstrap with a positive delta before applying damage or spending."`
2. If present: apply the full delta (per `docs/DECISIONS.md`, never pre-cap). Then:
   - If the resolved `PoolDefinition.min === 0` and `current + delta < 0`: reject with `reason: "Cannot spend more than available."` Do not apply; do not clamp.
   - Otherwise apply. Update `applied.resourcePools[poolName].current = current + delta`. `max` is preserved unchanged.
3. After application, check thresholds. For each `threshold` in the pool's definition:
   - If the delta is negative and `current >= threshold.value > (current + delta)`: threshold fired.
   - If the delta is positive and `current < threshold.value <= (current + delta)`: threshold fired.
   - Report firings via `thresholds`. The validator does not act on the effect label; it only surfaces it to the caller.

**`entities`**

For each `{ entityId, { visible?, status? } }`:

1. If the entity is absent from `currentData.entities`: initialize a new entity record with the provided fields, `visible` defaulting to `true` and `status` defaulting to `'unknown'`. This matches the synthesis write path, which may have written an entity to the GM context blob without writing it to `campaign_state.data.entities` (the snapshot does the filtering, synthesis does the authoring). Claude may reference NPCs that were only in the blob.
2. If present: merge the provided fields over the existing record. Unmentioned fields are preserved.
3. Validate `status` against `EntityStatusSchema` from `@uv/game-systems`. Reject with `reason: "status must be 'alive', 'dead', or 'unknown'"` if invalid — the Zod schema already enforces this on the `submit_gm_response` parse, so rejection here is defense-in-depth.

**`flags`**

For each `{ flagName, payload }`:

1. If the flag is absent from `currentData.flags`:
   - Payload must be `{ value, trigger }`. Missing trigger: reject with `reason: "New flag requires a trigger string."`
   - Apply: `applied.flags[flagName] = { value, trigger }`.
2. If present:
   - Payload must be `{ value }` or `{ value, trigger }`. If `trigger` is provided on an existing flag, it is **ignored** (triggers are immutable per `docs/DECISIONS.md`). Do not reject — Claude passing a trigger on an existing flag is harmless, and rejecting would force a correction round for no mechanical consequence.
   - Apply: preserve the existing trigger, update value.

**`scenarioState`**

For each `{ scenarioKey, { current } }`:

1. If the key is absent from `currentData.scenarioState`: reject with `reason: "Scenario state key does not exist — these are defined at synthesis time and cannot be introduced during play."`
   - Rationale: scenario state carries synthesis-authored `note` fields that describe what the counter means. Claude introducing a new counter mid-adventure would have no note and no semantic grounding. If a new tracked value is needed mid-adventure, Claude should use `worldFacts` or a flag.
2. If present: overwrite `current` with the provided value. `max` and `note` are preserved.

**`worldFacts`**

For each `{ key, string }`: apply verbatim. Overwrite on key collision. Never rejects.

### Determinism

The validator walks its input maps in insertion order, not sorted. Tests that assert on rejection ordering must not depend on key sort order — assert on content via `.toContainEqual`, not on array index.

### Tests

`session.validator.spec.ts`:

- Unknown pool with positive delta: initialized.
- Unknown pool with negative delta: rejected.
- `min: 0` pool spent below zero: rejected, no partial application.
- HP crossing zero: threshold `death_save_required` reported in `thresholds`.
- HP starting at -1 and healed to +2: no threshold fires (already past it).
- Entity status `'dead'` applied: accepted; no pool auto-zeroing.
- New flag without trigger: rejected.
- New flag with trigger: applied.
- Existing flag with trigger in payload: applied, trigger preserved from original.
- `scenarioState` key not in current data: rejected.
- `scenarioState` key present: `current` overwritten, `note` preserved.
- `worldFacts`: applied, always.
- Mixed batch with one rejection: valid entries land in `applied`, invalid in `rejections`, no exceptions thrown.

---

## Part 3: State Change Applier

### Contract

```typescript
// session.applier.ts

export function applyToCampaignState(input: {
  currentData: MothershipCampaignState;
  applied:     ValidationResult['applied'];
}): MothershipCampaignState;
```

Pure function. Takes the current campaign state data and the validator's `applied` output; returns a new campaign state with the deltas merged in. Does not mutate the input.

### Behavior

For each field in `applied`, merge over the corresponding field in `currentData`. Shallow merge semantics — a key in `applied.resourcePools` overwrites the corresponding key in `currentData.resourcePools`; keys not in `applied` are preserved. Same for `entities`, `flags`, `scenarioState`, `worldFacts`.

`schemaVersion` is preserved.

The applier does not re-validate. The validator has already decided what's legal. Separating these two concerns means the applier is a one-screen function.

### DB write

The applier produces the new state object in memory. The write is a single UPDATE in `session.repository.ts`:

```typescript
async writeCampaignState(args: {
  campaignId: string;
  data:       MothershipCampaignState;
  tx?:        DrizzleTransaction;
}): Promise<void> {
  const db = args.tx ?? this.db;
  await db
    .update(schema.campaignStates)
    .set({ data: args.data, updatedAt: sql`now()` })
    .where(eq(schema.campaignStates.campaignId, args.campaignId));
}
```

Accepts an optional transaction argument so the orchestrator can bundle state write + event writes + telemetry write in one transaction.

### Tests

`session.applier.spec.ts`:

- Empty `applied`: returned state equals input state (by value).
- Input is not mutated.
- `resourcePools` merge preserves unmentioned keys.
- Entity merge preserves unmentioned keys.
- `schemaVersion` carried through.

---

## Part 4: `game_events` Write Path

### Sequence number allocation

`sequence_number` is monotonic and contiguous per adventure. Allocation happens inside the turn transaction via a `SELECT ... FOR UPDATE` on the highest existing sequence, then increments:

```typescript
async nextSequenceNumber(
  adventureId: string,
  tx: DrizzleTransaction,
): Promise<number> {
  const [row] = await tx
    .select({ max: sql<number>`coalesce(max(${schema.gameEvents.sequenceNumber}), 0)` })
    .from(schema.gameEvents)
    .where(eq(schema.gameEvents.adventureId, adventureId))
    .for('update');   // serialize against concurrent writers
  return (row?.max ?? 0) + 1;
}
```

At M6 scale there are no concurrent writers — one player, one adventure, one turn at a time. `FOR UPDATE` is insurance for when caller transfer (M8) introduces coordination. If Drizzle's `.for('update')` isn't available on the selected builder, fall back to a raw `sql` template.

### Event shape per turn

One happy-path turn writes three events, in order:

1. `player_action` — actor_type `player`, actor_id the user ID, payload `{ content: string }` (the raw player message).
2. `gm_response` — actor_type `gm`, actor_id null, payload `{ playerText, stateChanges, gmUpdates, playerRolls, adventureMode }` (the full parsed `submit_gm_response` minus anything secret from the player — everything the tool returned).
3. `state_update` — actor_type `system`, actor_id null, payload `{ applied, thresholds }` (exactly the validator output, minus rejections which are empty on a clean turn).

On a correction turn the event list is:

1. `player_action` (same as above).
2. `gm_response` with the original, rejected payload. `superseded_by` null at insert time.
3. `correction` — actor_type `gm`, actor_id null, payload `{ playerText, stateChanges, gmUpdates, playerRolls, adventureMode }` for the corrected response.
4. `state_update` — the corrected payload's applied deltas.
5. Update the `gm_response` row's `superseded_by` to point at the `correction` row's id.

Sequence numbers are contiguous: 1 (player_action), 2 (gm_response), 3 (correction), 4 (state_update).

### Helper

```typescript
// session.events.ts

export async function writeTurnEvents(args: {
  tx:          DrizzleTransaction;
  adventureId: string;
  campaignId:  string;
  playerUserId: string;
  playerAction: { content: string };
  gmResponse:   SubmitGmResponse;
  correction?:  SubmitGmResponse;           // present only when validator rejected the first response
  applied:      ValidationResult['applied'];
  thresholds:   ThresholdCrossing[];
}): Promise<{ gmResponseEventId: string; correctionEventId?: string; stateUpdateSeq: number }>;
```

Writes the events, links `superseded_by` if a correction is present, returns identifiers the telemetry helper needs.

### Tests

`session.events.spec-int.ts` (integration — needs real DB for sequence semantics):

- Three events on happy path with contiguous sequence numbers.
- Four events on correction path with contiguous sequence numbers.
- `gm_response.superseded_by` set to the `correction` event's id after correction.
- Concurrent writers against the same adventure serialize (seed two simultaneous calls, assert disjoint sequence numbers).

---

## Part 5: Correction Mechanic

### When it fires

Any `rejections.length > 0` result from the validator on the first parsed `submit_gm_response` triggers a single re-prompt. If the corrected response also has rejections, the turn fails.

### Re-prompt construction

The correction prompt is the original request + the original assistant `tool_use` block + a `tool_result` content block carrying the rejection details + `tool_choice: submit_gm_response` again. Claude sees exactly what it sent, what was rejected, and is forced to call the tool again.

```typescript
// session.correction.ts

interface CorrectionPromptArgs {
  originalRequest:   Anthropic.MessageCreateParams;   // the message that produced the rejected response
  originalAssistant: Anthropic.Message;               // Claude's rejected response
  rejections:        ValidationRejection[];
}

export function buildCorrectionRequest(args: CorrectionPromptArgs): Anthropic.MessageCreateParams {
  const toolUseBlock = args.originalAssistant.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'submit_gm_response',
  );
  if (!toolUseBlock) throw new Error('Original assistant response had no submit_gm_response tool_use');

  const rejectionText = args.rejections
    .map(r => `- ${r.path}: ${r.reason}`)
    .join('\n');

  return {
    ...args.originalRequest,
    messages: [
      ...args.originalRequest.messages,
      { role: 'assistant', content: args.originalAssistant.content },
      {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: toolUseBlock.id,
          is_error: true,
          content: [
            {
              type: 'text',
              text:
                `The backend rejected ${args.rejections.length} proposed state change(s):\n\n` +
                `${rejectionText}\n\n` +
                `Re-narrate this turn. Call submit_gm_response again with corrected stateChanges that the backend will accept. Keep the narration faithful to the fiction — if an action is impossible, describe why in character rather than silently dropping it.`,
            },
          ],
        }],
      },
    ],
    tool_choice: { type: 'tool', name: 'submit_gm_response' },
  };
}
```

### Hard failure

If the correction response also fails validation, `SessionService.sendMessage` throws `SessionCorrectionError` (new). The controller returns 502. The `player_action` row in `game_events` is already written (the player's action is still a valid action). The `gm_response` and `correction` events are **not** written — the transaction rolls back, leaving only the `player_action` row and the player message row. The frontend surfaces a retry affordance.

This keeps the data layer clean: failed turns don't pollute `game_events` with dangling rejected-plus-rejected pairs that have no narrative payoff. The `player_action` row alone is enough for forensics.

### Bounding

One re-prompt. Not three, not a retry budget. The cost of a correction round is one extra Claude API call per turn on a path that should be rare in practice; two rounds compounds that cost and masks the real problem (bad validator rules or a model that needs prompt work).

### Tests

`session.correction.spec.ts`:

- Correction request includes the original assistant message and a `tool_result` block with `is_error: true`.
- `tool_use_id` on the `tool_result` matches the original tool call id.
- Rejection text includes every rejection, one per line.
- `tool_choice` is preserved.

`session.service.spec-int.ts` (integration):

- Happy path: one Claude call, three events, state applied, telemetry row written.
- Correction path: two Claude calls, four events, state reflects corrected deltas, `superseded_by` set, messages table has only corrected text.
- Correction-fails-too path: two Claude calls, one event (`player_action`), state unchanged, no telemetry row, `SessionCorrectionError` thrown.

---

## Part 6: Proposed Canon Routing

### Write path

After state application succeeds, each entry in `gmUpdates.proposedCanon` becomes a `pending_canon` row:

```typescript
await tx.insert(schema.pendingCanon).values(
  gmUpdates.proposedCanon.map(entry => ({
    adventureId: args.adventureId,
    summary:     entry.summary,
    context:     entry.context,
    status:      'pending',
  })),
);
```

### Auto-promote in Solo Blind

Campaign creation mode is carried on `campaign.creation_mode` (Phase 1: always `solo_blind`; other modes Phase 2). After inserting the pending rows, if the mode is `solo_blind`, call the existing `SynthesisRepository.autoPromoteCanon(adventureId)` inside the same transaction. The method already exists and was extracted during M4 for exactly this reuse.

In Phase 1 the mode check is effectively a no-op — every campaign is Solo Blind — but the conditional is written now so Phase 2's Solo Authored and Collaborative modes drop in without touching the session service.

```typescript
if (campaign.creationMode === 'solo_blind') {
  await this.synthesisRepo.autoPromoteCanon(args.adventureId, tx);
}
```

`autoPromoteCanon` currently takes only `adventureId`; extend it to accept an optional transaction so it can run inside the turn transaction rather than opening its own. Default to `this.db` when omitted to preserve the M4 call site.

### GM context blob merges

`gmUpdates.npcStates` merges into `gm_context.blob.narrative.npcAgendas` (overwrite on key collision).

`gmUpdates.notes` is **not** persisted to the blob in M6. The tool schema already accepts the field and Claude may emit it; the value is captured in `adventure_telemetry.payload.notes` (see Part 7) for playtest review. Whether notes earn a persistence path is a question playtest data will answer — reactivate if review shows Claude using the field meaningfully and the content would have carried value into subsequent turns.

The cached GM context blob is therefore unchanged by notes writes, which also avoids the cache-invalidation cost of appending to a cached prefix every turn.

### Tests

`session.service.spec-int.ts`:

- Happy turn with `proposedCanon`: rows land in `pending_canon`, immediately promoted to `'promoted'` (Solo Blind).
- Happy turn with no `proposedCanon`: no rows inserted.
- `gmUpdates.npcStates` merges into the blob's `npcAgendas`.
- `gmUpdates.notes` is captured in `adventure_telemetry.payload.notes` and is **not** written to the blob.

---

## Part 7: `adventure_telemetry` Write Path

### One row per turn

After all other writes succeed, write one `adventure_telemetry` row with `sequence_number` matching the `gm_response` event. On a correction turn, the sequence still matches the original `gm_response` event (sequence 2 in the 4-event example) — telemetry is keyed to "the first thing Claude said this turn," because that's what lets you replay the pipeline.

### Payload

```typescript
{
  playerMessage:   string;
  snapshotSent:    string;                // the serialized <state_snapshot> block from M5
  originalRequest: {                      // what went to Claude on the first call
    model:          string;
    systemBlocks:   number;               // count only, not content (content is in gm_context)
    messageCount:   number;
    promptTokens:   number | null;        // from Anthropic usage on the first response
    completionTokens: number | null;
  };
  originalResponse: SubmitGmResponse;     // the full parsed tool call, including rejected stateChanges
  notes: {                                // captured from gmUpdates.notes on both original and correction
    original:   string | null;
    correction: string | null;            // null when no correction fired
  };
  correction?: {                          // present only when correction fired
    rejections:       ValidationRejection[];
    correctionRequest: {
      promptTokens:     number | null;
      completionTokens: number | null;
    };
    correctionResponse: SubmitGmResponse;
  };
  applied:     ValidationResult['applied'];
  thresholds:  ThresholdCrossing[];
  diceRolls:   [];                        // populated in M7
}
```

`diceRolls` is included empty in M6 so the payload shape is stable when M7 adds roll records.

### Helper

```typescript
// session.telemetry.ts

export async function writeAdventureTelemetry(args: {
  tx:             DrizzleTransaction;
  adventureId:    string;
  sequenceNumber: number;              // matches the gm_response event's sequence
  payload:        AdventureTelemetryPayload;
}): Promise<void>;
```

### Tests

`session.telemetry.spec.ts`:

- Payload structure matches the spec shape, no missing fields.
- `diceRolls` defaults to `[]`.
- `notes.original` carries the value of `gmUpdates.notes` from the original response; `notes.correction` is null when no correction fired.

`session.service.spec-int.ts`:

- Happy turn writes one telemetry row with sequence matching the `gm_response` event.
- Correction turn writes one telemetry row, also keyed to the `gm_response` sequence, with the `correction` block populated.
- Failed-correction turn writes no telemetry row.

---

## Part 8: SessionService Integration

### The new `sendMessage`

Replaces the M5 implementation entirely. The shape:

```typescript
async sendMessage(args: SendMessageArgs): Promise<SendMessageResult> {
  // 1. Preconditions (unchanged from M5):
  //    Load gm_context.blob, campaign_state.data, campaign (for creation mode),
  //    player entity ids, and prior messages. Throw SessionPreconditionError
  //    if gm_context or campaign_state is missing.

  // 2. Persist the player message (unchanged from M5).

  // 3. Build prompt and call Claude (M5 code, extracted into a helper).
  const { request: originalRequest, response: originalResponse, toolCall: originalToolCall } =
    await this.callClaudeOnce({ /* ... */ });

  // 4. Validate.
  let finalToolCall  = originalToolCall;
  let correctionCall: typeof originalToolCall | null = null;
  let correctionResponse: Anthropic.Message | null = null;
  let validation    = validateStateChanges({
    proposed:    originalToolCall.stateChanges,
    currentData: campaignStateData,
    poolDef:     getMothershipPoolDefinition,
  });

  // 5. If rejected: one correction round.
  if (validation.rejections.length > 0) {
    const correctionRequest = buildCorrectionRequest({
      originalRequest,
      originalAssistant: originalResponse,
      rejections: validation.rejections,
    });
    correctionResponse = await this.anthropic.callSessionRaw(correctionRequest);
    const parsed = parseSubmitGmResponse(correctionResponse);   // shared helper
    correctionCall = parsed;
    validation = validateStateChanges({
      proposed:    parsed.stateChanges,
      currentData: campaignStateData,
      poolDef:     getMothershipPoolDefinition,
    });
    if (validation.rejections.length > 0) {
      throw new SessionCorrectionError(/* ... */);
    }
    finalToolCall = parsed;
  }

  // 6. Apply in a single transaction:
  //    - apply state changes to campaign_state
  //    - write player_action, gm_response, (correction), state_update events
  //    - write proposedCanon → pending_canon, auto-promote if solo_blind
  //    - update gm_context blob (npcStates, notes)
  //    - insert final playerText into messages
  //    - write adventure_telemetry row
  const result = await this.repo.applyTurnAtomic({ /* ... */ });

  // 7. Return the persisted message + applied deltas + thresholds + rejections
  //    (empty on a correction-succeeded turn; populated on a happy turn that
  //    had no correction — just empty arrays).
  return {
    message:    result.persistedMessage,
    applied:    validation.applied,
    thresholds: validation.thresholds,
  };
}
```

### Errors

New error classes in `session.service.ts`:

- `SessionCorrectionError` → 502 in the controller. Message includes the first-round rejections and the second-round rejections for debugging.
- `SessionOutputError` (existing, M5) → 502. Covers "Claude didn't call the tool" and "parse failed."
- `SessionPreconditionError` (existing, M5) → 409. Covers missing `gm_context` / `campaign_state`.

### `applyTurnAtomic`

New method on `SessionRepository`. Bundles state write, event writes, canon routing, blob update, message insert, and telemetry into one transaction. On any failure inside the transaction, everything rolls back except the player message row (which was written outside the transaction in step 2 — that's intentional, per the M5 pattern of preserving player input even on downstream failure).

### Tests

See `session.service.spec-int.ts` lines referenced in earlier sections — the three paths (happy, correction-succeeds, correction-fails) cover the orchestration.

Also add unit tests in `session.service.spec.ts` for the error-translation:

- `SessionCorrectionError` is thrown when both validation rounds reject.
- `SessionOutputError` is still thrown on Claude-side failures (unchanged from M5).
- `SessionPreconditionError` is still thrown when gm_context or campaign_state is missing (unchanged from M5).

---

## Part 9: Messages Endpoint Response Shape

### New response

```typescript
{
  message: {
    id:        string;
    role:      'assistant';
    content:   string;      // final corrected playerText
    createdAt: string;
  };
  applied: {
    resourcePools: Record<string, { current: number; max: number | null }>;
    entities:      Record<string, { visible: boolean; status: EntityStatus; npcState?: string }>;
    flags:         Record<string, { value: boolean; trigger: string }>;
    scenarioState: Record<string, { current: number; max: number | null; note: string }>;
    worldFacts:    Record<string, string>;
  };
  thresholds: Array<{ pool: string; finalValue: number; effect: string }>;
}
```

The M5 `proposals` field is removed. The frontend no longer needs the raw tool call — it needs to know what changed (so it can update the character status strip) and what thresholds fired (so it can surface a "death save required" affordance — M7 will actually wire this to a dice request UI; M6 just displays the badge).

### Controller

Unchanged from M5 except for the response type. Error translation:

- `SessionPreconditionError` → 409.
- `SessionOutputError` → 502.
- `SessionCorrectionError` → 502 with a distinct error code `gm_correction_failed` in the body so the frontend can distinguish it from transient pipeline errors (different retry UX is possible later).

---

## Part 10: Frontend Play View

### Route

Register in `App.svelte`'s route table (already using `svelte-spa-router` v5 from M5):

```typescript
{
  '/campaigns/:campaignId/adventures/:adventureId/play': Play,
}
```

### Page component

`apps/zoltar-fe/src/routes/Play.svelte`.

Reads route params via `$props()`. On mount:

1. Fetch the adventure via `GET /campaigns/:campaignId/adventures/:adventureId` to confirm `status === 'ready'`. If not, redirect to the campaign detail page with an error banner.
2. Fetch message history via `GET /campaigns/:campaignId/adventures/:adventureId/messages`. The endpoint exists in M5 as a POST; add a GET that returns the full message log sorted chronologically.
3. If message list is empty, render the `openingNarration` from the adventure GET response as the first GM bubble. Do not render it if messages exist — it's already in the log (first `gm` message will be it once a turn has run).
4. Fetch `campaign_state.data.resourcePools` via a new `GET /campaigns/:campaignId/state` endpoint returning the current state (backend add: thin read-only endpoint on `CampaignController`, auth-gated to campaign members, returns the data JSONB). Subscribe to its update via re-fetch after each turn.

### Layout

Three regions per the M2.5 mobile sketches:

- **Top strip** — character status: name, HP bar, stress bar, condition chips if any (M6 sources `conditions` from `entities[playerEntityId].npcState` displayed as a single line; the structured `<character_attributes>` block is still deferred).
- **Middle** — message log, scrollable, auto-scrolls to bottom on new messages. Two bubble styles: player (right-aligned, dimmer), GM (left-aligned, full-width, Warden voice typography).
- **Bottom** — text input + send button. Disabled while a turn is in flight.

Components:

```
apps/zoltar-fe/src/lib/components/play/
  CharacterStatusStrip.svelte
  MessageLog.svelte
  MessageBubble.svelte
  MessageInput.svelte
  ThresholdBanner.svelte        ← surfaces `thresholds` from the last response
```

All styled against the Mothership theme using M2.5's semantic token layer.

### Turn flow

On send:

1. Optimistically append the player message as a `player` bubble.
2. Disable the input, show a subtle "Warden is typing" indicator (single pulsing dot under the last message).
3. POST to the messages endpoint.
4. On 200: append the GM message as a `gm` bubble. If `thresholds` is non-empty, render a ThresholdBanner above the bubble (e.g. "Dr. Chen at 0 HP — death save required"). Refresh the character status strip from the `applied.resourcePools` field of the response.
5. On 409 (precondition failure): show an error banner, route back to campaign detail.
6. On 502 with `gm_correction_failed`: show a retry button. On 502 otherwise: show a generic retry button. The retry re-POSTs with the same message content — the player message row was already persisted, so the backend must handle idempotent retry; for M6 the simplest path is to allow duplicate player messages (retry creates a second row), and if this becomes a real problem a client-generated nonce is added in M7.

### Not in scope for M6 frontend

- `playerRolls` dice prompts — M7. Backend returns the field; frontend ignores it.
- Any visualization of `pending_canon` or corrections — internal state, not player-facing.
- Private actions, caller transfer, presence indicators — Phase 2.
- Real-time updates from other players — M8 / Phase 2 (Ably).

### Tests

Frontend tests are lighter than backend — mostly component-level rendering tests against mock data. At minimum:

- `MessageLog` renders a list of player/GM bubbles in order.
- `CharacterStatusStrip` renders HP and stress bars with correct fill percentages.
- `ThresholdBanner` renders when `thresholds` is non-empty, hidden when empty.
- `Play.svelte` integration test with mocked fetch: initial load shows opening narration for empty log; post-send shows player bubble immediately and GM bubble after response.

---

## Out of Scope for M6

Deferred, in scope for later milestones. Do not implement:

- `roll_dice` tool (M7).
- `rules_lookup` tool and the vector embedding pipeline (M7).
- Tool-use loop allowing Claude to call `roll_dice` / `rules_lookup` before `submit_gm_response` (M7).
- Dice entry UI (M7).
- Caller role enforcement and transfer (M8).
- Initiative mode (M8).
- `advance_initiative` handling (M8).
- Self-hosted deployment polish (M9).
- Rolling summary (Phase 2, per `docs/DECISIONS.md`).
- Multi-caller/multi-PC playtest flow (Phase 2).
- Campaign canon promotion at adventure completion (Phase 2).
- Spatial system — still deferred per `docs/DECISIONS.md`. `stateChanges` carries no positions; the play view has no map.
- `<character_attributes>` snapshot block — still deferred, no data source. `CharacterStatusStrip` reads from pools, not this block.
- Playtest review tooling (views, CLI report over `adventure_telemetry` + `game_events`) — M7.1.

---

## Deferrals Introduced in M6

### Auto-zero pools on `status: 'dead'`

When `entities[id].status` transitions to `'dead'`, the validator does not automatically zero pools prefixed with that entity's id. Claude must send explicit `resourcePools: { id_hp: { delta: -N } }` alongside the status flip. Rationale: one fewer magic behavior, cleaner correction semantics (a delta rejection surfaces the problem directly), and playtest data on whether Claude drops this is cheap to collect.

Reactivate if playtests show Claude forgetting to zero pools on dying entities and that omission drives narrative drift. The fix is a three-line addition to the applier: on `applied.entities[id].status === 'dead'` transition from a prior non-dead status, walk `applied.resourcePools` and set any key with prefix `${id}_` to `current: 0`.

Add an entry to `docs/DECISIONS.md`:

> **Entity death does not auto-zero prefixed pools**
>
> When an entity's `status` flips to `'dead'`, the validator does not automatically zero resource pools whose keys are prefixed with that entity's id. Claude must send explicit pool deltas alongside the status change. An earlier playtest-tool prototype auto-zeroed to work around Claude forgetting; M6 opts for explicit behavior to keep the correction mechanism as the single channel for state-change feedback. Revisit if playtest data shows the omission happens often enough to cause drift.

### Playtest review tooling — M7.1

M6 starts writing `adventure_telemetry` rows but nothing reads them. Playtest review tooling (SQL views over `game_events` + `adventure_telemetry`, a CLI script that produces a turn-by-turn markdown report) is scoped to **M7.1**, not M6 — "real" playtesting needs dice and rules lookups in place first, and building a reader against a telemetry shape that's still growing produces a tool that gets rewritten before it earns its keep.

Cheap insurance during M6: after the first end-to-end smoke test run, eyeball one adventure's `adventure_telemetry` payload directly via `psql` and confirm the shape is actually useful. Fifteen minutes before M7 starts calcifying expectations around it. This is not tooling — it's a sanity check.

---

## Testing Summary

Per `docs/CLAUDE.md`.

**Unit tests (backend):**
- `pool-definitions.spec.ts` — resolver and schema.
- `session.validator.spec.ts` — every field rule, happy and rejection cases.
- `session.applier.spec.ts` — merge semantics, no mutation.
- `session.correction.spec.ts` — correction request construction.
- `session.telemetry.spec.ts` — payload shape.
- `session.service.spec.ts` — error translation (add new `SessionCorrectionError` cases to the existing file).

**Integration tests (backend):**
- `session.events.spec-int.ts` — sequence number allocation, `superseded_by` linking, concurrent-writer serialization.
- `session.service.spec-int.ts` — the three end-to-end paths (happy, correction-succeeds, correction-fails). Add to the existing M5 file; the existing tests that assert "no state mutation / no pending_canon / no events" become obsolete (they were documenting the M5 non-behavior) and should be replaced with assertions that these writes now happen.

**Frontend tests:**
- Component tests for `MessageLog`, `MessageBubble`, `CharacterStatusStrip`, `ThresholdBanner`.
- `Play.svelte` integration test with mocked fetch covering initial-load and post-send flows.

**Typecheck:**
- `tsc --noEmit` passes on both apps and the game-systems package.

---

## Documentation PR checklist

All updates land in the same PR as the implementation:

- `docs/api.md` — updated step list per the Documentation Corrections section above.
- `docs/zoltar-design-doc.md` — `superseded_by` semantics updated per the Documentation Corrections section.
- `docs/DECISIONS.md` — two new entries: "Entity death does not auto-zero prefixed pools" and "Correction loop bounded at one re-prompt" (capturing the rationale for the hard cap at one round).
- `docs/roadmap.md` — check off the M6 items as they land; add a one-line note pointing at `docs/specs/zoltar/m6-gm-service-and-state-management.md` for the spec. Insert a new **M7.1 — Playtest Review Tooling** milestone between M7 and M8, scoped to: SQL views joining `game_events` and `adventure_telemetry` (per-turn, per-state-history, per-correction), a CLI script that produces a turn-by-turn markdown report for a given adventure id, no web UI. Rationale: M7 is the first milestone that produces playtest-worthy adventures (dice and rules lookups in place), so review tooling earns its keep there rather than against M6's smoke-test-only turns.
- The spec itself lives at `docs/specs/zoltar/m6-gm-service-and-state-management.md`. This file is the source.
