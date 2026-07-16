# M5 — Claude API Client & Prompt Assembly

**Spec status:** Claude Code handoff
**Depends on:** M4 complete (`SynthesisService` writing `gm_context.blob`, `campaign_state.data`, and `adventure.status = 'ready'`; Solo Blind creation flow end-to-end)

---

## Goal

Close the outer half of the GM turn loop: from "player types a message" to "Claude returns a structured `submit_gm_response`." State change application, `game_events` writes, and `adventure_telemetry` writes are explicitly **not** in M5 — that's M6. After this milestone, a request to the messages endpoint produces a well-formed `submit_gm_response` payload, the `playerText` lands in the message log, and the proposed `stateChanges` / `proposedCanon` fields are returned to the caller for inspection but not applied to the database.

The spatial system is deferred per `docs/DECISIONS.md`. Entity positions are not included in the state snapshot, not present on the `submit_gm_response` tool schema, and no LOS computation is performed. The `grid_cell` / `grid_entity` tables remain migrated but unused.

The rolling summary is also deferred — see "Deferrals" below.

---

## Done When

1. The frontend routes through `svelte-spa-router` v5; all existing pages reachable and functional under hash URLs.
2. `submit_gm_response` is defined as a Zod schema and registered as an Anthropic tool, with `position` absent from the entity shape.
3. A state snapshot builder emits a complete, visibility-filtered XML block from `campaign_state.data` and the cached GM context, with flag triggers included only for play-introduced flags.
4. An `AnthropicService.callSession` method assembles the three-part prompt with `cache_control: ephemeral` on the GM context and returns the parsed `submit_gm_response` tool call.
5. The rolling message window selects messages by cumulative serialized size.
6. `POST /api/v1/campaigns/:campaignId/adventures/:adventureId/messages` runs the full loop, persists the player message and the GM message, and returns the parsed tool call payload. No state changes are applied. No telemetry is written.
7. `tsc --noEmit` passes.

---

## Documentation Corrections

Upstream docs carry outdated guidance that M5 must correct in the same PR as the implementation. The code written here must match the corrected text, not the current text.

### `docs/tools.md` — remove `position` from `submit_gm_response`

The `entities` field in `stateChanges` currently types as:

```typescript
entities: z.record(z.string(), z.object({
  position: z.object({
    x: z.number().int(),
    y: z.number().int(),
    z: z.number().int().default(0),
  }).optional(),
  visible: z.boolean().optional(),
})).optional(),
```

Drop the `position` subfield entirely. With spatial deferred, Claude has no coordinate grid to position entities on, and accepting a `position` payload we would never apply is an invitation to drift. The corrected shape is:

```typescript
entities: z.record(z.string(), z.object({
  visible: z.boolean().optional(),
  status:  z.string().optional(),   // narrative status label, e.g. 'wounded', 'fled', 'revealed'
})).optional(),
```

`status` is added to match the `entities` shape written by `submit_gm_context` in M4 and read from `campaign_state.data.entities` in the state snapshot — the two paths need to agree on what an entity record looks like.

Update `docs/tools.md` Section "Session Tools → `submit_gm_response` → `stateChanges.entities`" to reflect the corrected schema.

### `docs/zoltar-design-doc.md` — clarify flag trigger caching semantics

The "State snapshot" section currently describes `flagTriggers` as a "mutable object adjacent to flag values" re-emitted every turn so Claude doesn't re-read the GM context blob. Pre-cache, that made sense. With the GM context blob cached via `cache_control: ephemeral`, re-emitting triggers that are already sitting in the cached prefix is waste.

Replace the `flagTriggers` bullet with the following:

> **Flag state and triggers.** The original flag set — values and triggers — is emitted once inside the cached GM context blob. The per-turn state snapshot carries the current **value** for every flag. For flags introduced during play via `stateChanges.flags` (flags not present in the cached GM context), the snapshot additionally carries the **trigger** so Claude can narrate future state changes correctly. Original triggers never appear in the snapshot — they're already cached.

This matches what the state snapshot builder (Part 2) actually does.

### `docs/zoltar-design-doc.md` — drop rolling summary from the prompt structure

The "Message History and Context Window" section describes a four-part prompt structure that includes the rolling summary. With the summary deferred, this becomes three-part. Update the section accordingly: `[GM context blob] → [state snapshot] → [last N kb of messages]`. The rolling summary paragraph and its summarization-guidance text should be removed from the design doc and preserved only in the `docs/DECISIONS.md` deferral entry.

---

## Part 0: Router Migration (Frontend)

The homegrown router in `apps/zoltar-fe/src/App.svelte` (writable store + regex switch) has carried M2–M4 adequately but won't extend cleanly into the M6 play view. Migrate now so M6 starts on solid ground.

### Dependency

```bash
cd apps/zoltar-fe
npm install svelte-spa-router@^5
```

### Hash URLs, not history mode

`svelte-spa-router` uses hash-based URLs (`/#/campaigns`) and does not support `history.pushState`. This is the chosen tradeoff: hash URLs do not require a Traefik catch-all and are acceptable for a self-hosted product where URLs are rarely shared. See the M3 spec's "Router graduation note" for the full reasoning — do not reopen that decision here.

### Route table

Define routes in `apps/zoltar-fe/src/routes.ts`:

```typescript
import SignIn         from './pages/SignIn.svelte';
import CampaignList   from './pages/CampaignList.svelte';
import CampaignDetail from './pages/CampaignDetail.svelte';
import OracleFilter   from './pages/OracleFilter.svelte';
import CharacterCreate from './pages/CharacterCreate.svelte';
import NotFound       from './pages/NotFound.svelte';

export default {
  '/':                                               CampaignList,
  '/signin':                                         SignIn,
  '/campaigns':                                      CampaignList,
  '/campaigns/:campaignId':                          CampaignDetail,
  '/campaigns/:campaignId/characters/new':           CharacterCreate,
  '/campaigns/:campaignId/adventures/:adventureId/oracle': OracleFilter,
  '*':                                               NotFound,
};
```

Preserve the current route behavior exactly. The `OracleFilter` path is the same URL the M3 spec wired up, now expressed in the `svelte-spa-router` param syntax.

### `App.svelte` wiring

Replace the existing `writable(pathname)` + switch with:

```svelte
<script lang="ts">
  import Router from 'svelte-spa-router';
  import routes from './routes';
</script>

<Router {routes} />
```

Remove the following from the codebase:
- The `currentPath` writable store and any imports of it
- The `navigate` helper (replaced by `svelte-spa-router`'s `push`)
- The manual regex matching in `App.svelte`

Update all callers of the old `navigate(path)` to `push(path)` from `svelte-spa-router`.

### Route params in page components

Page components receive route params via the `params` prop. Update `CampaignDetail.svelte` and `CharacterCreate.svelte` to read `campaignId` from props instead of parsing the URL:

```svelte
<script lang="ts">
  let { params }: { params: { campaignId: string } } = $props();
</script>
```

### Sign-in redirect

The auth guard that currently lives in `App.svelte` needs to move to a conditional wrapper. If unauthenticated and not on `/signin`, push to `/signin`. Implement as a single effect in the top-level component that runs on session state changes.

### Not in scope for Part 0

The play view (`/campaigns/:campaignId/adventures/:adventureId/play`) route is not added in M5. That's M6. The router migration stops at parity with the existing application.

---

## Part 1: `submit_gm_response` Tool Schema

### Location

All session-time Claude integration lives under a new NestJS module:

```
apps/zoltar-be/src/session/
  session.module.ts
  session.controller.ts
  session.service.ts
  session.schema.ts          ← submitGmResponseSchema
  session.tools.ts           ← Anthropic.Tool definitions
  session.snapshot.ts        ← state snapshot builder
  session.prompt.ts          ← prompt assembly
  session.window.ts          ← rolling message window
  session.repository.ts      ← DB reads (gm_context, campaign_state, messages)
```

This mirrors the `synthesis/` module structure established in M4. `SessionModule` imports `DrizzleModule` and `AnthropicModule`.

### Schema

`apps/zoltar-be/src/session/session.schema.ts`:

```typescript
import { z } from 'zod';

export const submitGmResponseSchema = z.object({

  // Narrative text delivered to the player. Everything the player sees
  // comes from this field.
  playerText: z.string(),

  // Proposed changes to authoritative game state. Returned from M5 but
  // not applied — M6 owns validation and write.
  stateChanges: z.object({

    resourcePools: z.record(
      z.string(),
      z.object({ delta: z.number().int() }),
    ).optional(),

    entities: z.record(
      z.string(),
      z.object({
        visible: z.boolean().optional(),
        status:  z.string().optional(),
      }),
    ).optional(),

    // Only new flags introduced during play carry a trigger. For existing
    // flags, submit only the new value.
    flags: z.record(
      z.string(),
      z.union([
        z.object({ value: z.boolean() }),
        z.object({ value: z.boolean(), trigger: z.string() }),
      ]),
    ).optional(),

    // Non-entity numeric state (oxygen, power, countdown timers).
    scenarioState: z.record(
      z.string(),
      z.object({ current: z.number().int() }),
    ).optional(),

    // Additive world-fact writes. Same key overwrites.
    worldFacts: z.record(z.string(), z.string()).optional(),

  }).optional(),

  gmUpdates: z.object({
    npcStates: z.record(z.string(), z.string()).optional(),
    notes:     z.string().optional(),
    proposedCanon: z.array(z.object({
      summary: z.string(),
      context: z.string(),
    })).optional(),
  }).optional(),

  // Player-facing dice prompts. Backend assigns IDs on receipt.
  playerRolls: z.array(z.object({
    notation: z.string(),
    purpose:  z.string(),
    pool:     z.string().optional(),   // which resource pool the result affects
  })).optional(),

  // Adventure mode transition, if any.
  adventureMode: z.enum(['freeform', 'initiative']).nullable().optional(),

});

export type SubmitGmResponse = z.infer<typeof submitGmResponseSchema>;
```

### Tool registration

`apps/zoltar-be/src/session/session.tools.ts`:

```typescript
import { zodToJsonSchema } from 'zod-to-json-schema';
import { submitGmResponseSchema } from './session.schema';
import type Anthropic from '@anthropic-ai/sdk';

const submitGmResponseJsonSchema = zodToJsonSchema(submitGmResponseSchema, {
  $refStrategy: 'none',
});

export const SUBMIT_GM_RESPONSE_TOOL: Anthropic.Tool = {
  name: 'submit_gm_response',
  description:
    'Submit the GM response for this turn. Call this exactly once to complete every turn. The narrative for the player goes in playerText; state changes are proposals the backend will validate.',
  input_schema: submitGmResponseJsonSchema as Anthropic.Tool['input_schema'],
};

export const SESSION_TOOLS: Anthropic.Tool[] = [SUBMIT_GM_RESPONSE_TOOL];
```

`roll_dice` and `rules_lookup` are M6 additions — do not register them yet.

---

## Part 2: State Snapshot Builder

### Contract

The builder is a pure function:

```typescript
// apps/zoltar-be/src/session/session.snapshot.ts
export function buildStateSnapshot(input: {
  gmContextBlob:    GmContextBlob;      // from gm_context.blob
  campaignStateData: CampaignStateData; // from campaign_state.data
}): string;
```

Returns a single XML-wrapped string intended to sit as the content of the first user message. Never cached. Constructed fresh on every call.

### Visibility semantics

Visibility in Zoltar is a narrative property, not a spatial one. Each entity carries a `visible: boolean` field written at synthesis time by `submit_gm_context` based on Claude's judgment ("the shadow_threat starts hidden; the engineer starts visible") and mutated during play via `submit_gm_response.stateChanges.entities.visible`. When Claude decides a hidden threat is spotted, an NPC slips away, or a corpse is discovered, it toggles the flag. No LOS computation is performed; no coordinate grid is consulted.

The snapshot builder reads the current `visible` value from `campaign_state.data.entities` and elides hidden entities from the emitted snapshot entirely — Claude must not learn of a hidden entity's existence from the snapshot. The exception is the player's own character entities, which are always emitted regardless of `visible` (the player knows where they are).

This mechanism does the whole job Phase 1 needs from visibility. A spatial system — if one is ever built — would add a second visibility layer that could override narrative visibility (a hidden entity becomes visible because a torch illuminates its cell). Phase 1 doesn't need that second layer.

### Output shape

```xml
<state_snapshot>

<resource_pools>
dr_chen_hp: 8/10
dr_chen_stress: 2/20 (thresholds: panic_check at 6, breakdown at 14)
vasquez_hp: 10/10
vasquez_stress: 0/20 (thresholds: panic_check at 6, breakdown at 14)
ship_oxygen: 87/100
emergency_timer: 6/9 (each unit ~10 minutes real time; at 0, atmospheric entry begins)
</resource_pools>

<entities>
engineer_kowalski: visible, status=wounded
corporate_liaison: visible, status=cooperative
</entities>

<flags>
distress_beacon_active: false
airlock_sealed: true
adventure_complete: false
corporate_spy_revealed: true (trigger: Flip to true when the player confronts the liaison with the manifest evidence)
</flags>

<scenario_state>
hull_breach_progression: 2/5 — Increments when combat occurs in module sections with external walls.
</scenario_state>

<world_facts>
corridor_module1_module2_length: approximately eight meters
module3_comms_array_distance: twelve meters from the aft hatch
ship_layout: Three decks connected by central ladder shaft. Upper: bridge, comms, captain's quarters. Mid: crew berths, mess, medbay. Lower: cargo, engine, airlock.
</world_facts>

<character_attributes>
dr_chen: armor=vaccsuit, loadout=[flashlight, multitool, medkit], conditions=[]
vasquez: armor=combat_vest, loadout=[pulse_rifle, sidearm], conditions=[]
</character_attributes>

</state_snapshot>
```

Note in the example above: `shadow_threat` is absent from `<entities>` because its `visible` flag is false. Claude won't see a reference to it until a `stateChanges.entities.shadow_threat.visible = true` is applied in M6.

### Field-by-field rules

**`<resource_pools>`** — every entry in `campaignStateData.resourcePools`. Format: `{poolName}: {current}/{max}` (omit `/{max}` when max is null). When the pool's definition in the system's Zod schema carries thresholds, append them in parentheses: `(thresholds: {effect} at {value}, ...)`. Timer pools get the `note` field from their definition appended if present.

**`<entities>`** — iterate `campaignStateData.entities`. Emit only entities where `visible` is true, plus the player's own character entities regardless of `visible`. For each: `{entity_id}: {visible|hidden}, status={status}`. Hidden entities are elided entirely. Position fields are not read and not emitted.

**`<flags>`** — iterate `campaignStateData.flags`. Emit every flag's `value`. A flag's `trigger` is emitted only if the flag key is **not** present in `gmContextBlob.structured.flags` — i.e., it was introduced during play. Original flags' triggers live in the cached GM context; re-emitting them is waste.

**`<scenario_state>`** — iterate `campaignStateData.scenarioState`. Format: `{key}: {current}/{max} — {note}` (drop `/{max}` when null, drop ` — {note}` when empty).

**`<world_facts>`** — iterate `campaignStateData.worldFacts`. Format: `{key}: {value}`. No filtering; all entries are visible context for Claude.

**`<character_attributes>`** — iterate `campaignStateData.characterAttributes` (one entry per PC). Format as shown. Exact subfields depend on the system's character attribute shape; emit whatever is present.

### Ordering

Deterministic alphabetical order within each block. This is not a correctness requirement — it's a caching-adjacent nicety: identical state produces identical snapshot text, which makes test fixtures stable and makes diffing two snapshots possible.

### Empty blocks

Omit an entire block if its source is empty or missing. A snapshot with no world facts simply has no `<world_facts>` section. Do not emit empty tags.

---

## Part 3: Anthropic Client with Prompt Caching

The official Anthropic SDK (`@anthropic-ai/sdk`) was introduced in M4. M5 does not add a new client — it extends the existing `AnthropicService`. No SDK version bump is required unless needed for types; pin what M4 pinned.

### Extending `AnthropicService`

M4 landed `AnthropicService.callMessages` that takes `system: string`. Add a session-specific method that takes `system` as an array of text blocks — the array form is what enables `cache_control` on individual blocks:

```typescript
// apps/zoltar-be/src/anthropic/anthropic.service.ts

export interface CallSessionParams {
  systemBlocks: Anthropic.TextBlockParam[];  // first block cacheable
  messages:     Anthropic.MessageParam[];
  tools:        Anthropic.Tool[];
  toolChoice:   Anthropic.ToolChoiceAny;
  model?:       string;
  maxTokens?:   number;
}

async callSession(params: CallSessionParams): Promise<Anthropic.Message> {
  return this.client.messages.create({
    model:       params.model ?? DEFAULT_SYNTHESIS_MODEL,
    max_tokens:  params.maxTokens ?? 4096,
    system:      params.systemBlocks,
    messages:    params.messages,
    tools:       params.tools,
    tool_choice: params.toolChoice,
  });
}
```

`callMessages` stays as-is for synthesis; `callSession` is additive.

### Cache control on the GM context

In `session.prompt.ts`, the GM context is wrapped in a system block with ephemeral caching:

```typescript
const systemBlocks: Anthropic.TextBlockParam[] = [
  {
    type: 'text',
    text: formatGmContextBlob(gmContextBlob),   // the serialized context
    cache_control: { type: 'ephemeral' },
  },
  {
    type: 'text',
    text: WARDEN_SYSTEM_PROMPT_MOTHERSHIP,      // system prompt text
  },
];
```

Two blocks, GM context first (the larger, slow-changing one) and the Warden system prompt second. Only the first has `cache_control`. A `cache_control` marker applies to everything up to and including that block — placing it on the first block caches only the GM context. The Warden prompt is small and stable enough that caching it separately offers negligible savings.

Prompt caching is generally available on the Anthropic API — no beta header required. Minimum cache size is 1024 tokens; GM context blobs run well above this.

### Model and token defaults

Use `claude-sonnet-4-6` (the existing `DEFAULT_SYNTHESIS_MODEL` constant). Default `maxTokens: 4096` for session calls — GM responses are bounded by `playerText` length, which runs much smaller than synthesis output.

### Formatting the GM context blob

`formatGmContextBlob` serializes the structured GM context into a human-readable block Claude reads at turn time. The exact format is not prescriptive but should cover: narrative (location, atmosphere, NPC agendas, hidden truth, oracle connections), the original structured entities, flags (value + trigger), initial state. Place `openingNarration` last or omit — Claude has already used it.

---

## Part 4: Prompt Assembly

The turn request has three parts, in order:

1. **GM context blob** — cached, in the system block (see Part 3).
2. **State snapshot** — the content of the first user message.
3. **Message window** — the remaining messages in the window as separate message entries, followed by the new player message.

### Structure

```typescript
// apps/zoltar-be/src/session/session.prompt.ts

export function buildSessionRequest(input: {
  gmContextBlob:     GmContextBlob;
  campaignStateData: CampaignStateData;
  windowMessages:    DbMessage[];           // already trimmed by Part 5
  playerMessage:     string;                // the new turn input
}): CallSessionParams;
```

The first user message carries the snapshot as tag-wrapped text, followed by normal message history, and ends with the new player message:

```typescript
const messages: Anthropic.MessageParam[] = [];

// Opening user message: snapshot
messages.push({
  role: 'user',
  content: buildStateSnapshot({ gmContextBlob, campaignStateData }),
});

// Prior messages in window
for (const m of windowMessages) {
  messages.push({ role: m.role, content: m.content });
}

// The new player input
messages.push({ role: 'user', content: playerMessage });
```

### Tool choice

Force the model to call `submit_gm_response`:

```typescript
const toolChoice: Anthropic.ToolChoiceAny = {
  type: 'tool',
  name: 'submit_gm_response',
};
```

This eliminates the "Claude responds with plain text instead of a tool call" failure class entirely — the API rejects any other response shape.

---

## Part 5: Rolling Message Window

### Threshold

40 KB, defined as a constant:

```typescript
// session.window.ts
export const MESSAGE_WINDOW_MAX_BYTES = 40 * 1024;
```

Midpoint of the 32–48 KB range the roadmap calls out. Configurable via `MESSAGE_WINDOW_MAX_BYTES` env var in a future milestone if observed behavior warrants.

### Algorithm

```typescript
export function buildMessageWindow(
  messages: DbMessage[],   // most recent LAST (ORDER BY created_at ASC)
  maxBytes = MESSAGE_WINDOW_MAX_BYTES,
): DbMessage[] {
  const window: DbMessage[] = [];
  let bytes = 0;

  // Walk backward from newest, accumulating until the next message would
  // push past the limit. Return in chronological order.
  for (let i = messages.length - 1; i >= 0; i--) {
    const size = Buffer.byteLength(JSON.stringify(messages[i]), 'utf8');
    if (bytes + size > maxBytes) break;
    window.unshift(messages[i]);
    bytes += size;
  }

  return window;
}
```

### Measurement

`Buffer.byteLength(JSON.stringify(message), 'utf8')` — serialized size matches what actually travels over the wire. Counting characters or tokens would diverge from the transport reality.

### Edge cases

- First turn (no prior messages): empty window, prompt is snapshot + new player message only.
- A single message larger than the threshold: included anyway, on the theory that truncation mid-turn is worse than one oversized prompt. Log a warning.
- Dropped messages: messages that fall out of the window are not lost from the DB — they're preserved for forensics and future milestones. Phase 1 relies on the cached GM context (with auto-promoted canon) plus `npcStates` and `worldFacts` in `campaign_state.data` to carry continuity across dropped messages.

---

## Part 6: Messages Endpoint

### Route

```
POST /api/v1/campaigns/:campaignId/adventures/:adventureId/messages
```

**Auth:** authenticated user, must be a campaign member, and must be the active caller if adventure mode is `initiative` (for M5, always `freeform` — caller enforcement is M7).

**Request:**
```typescript
const messagesRequestSchema = z.object({
  content: z.string().min(1),
});
```

**Preconditions (409 if violated):**
- `adventure.status = 'ready'` (not `synthesizing`, `failed`, or `completed`)

**Response:** `200 OK`:
```typescript
{
  message: {                          // the persisted GM message
    id:        string;
    role:      'assistant';
    content:   string;                // submitGmResponse.playerText
    createdAt: string;
  };
  proposals: SubmitGmResponse;        // the full parsed tool call, for inspection
}
```

The `proposals` field is the full `submit_gm_response` payload returned for debugging and to preview what M6 will eventually apply. The frontend may display parts of it (e.g. rendering `playerRolls` as dice prompts), but it is not persisted to game state in M5.

### Flow inside `SessionService`

1. Load `gm_context.blob`, `campaign_state.data`, the adventure, and message history.
2. Build the message window (Part 5).
3. Persist the incoming player message to `messages` with `role = 'user'`.
4. Assemble the prompt (Part 4).
5. Call `AnthropicService.callSession` with `tool_choice: submit_gm_response`.
6. Parse the tool call from the response. If the response contains no `tool_use` block for `submit_gm_response`, throw — this should be impossible given `tool_choice`, but surface a clear error if the API behaves unexpectedly.
7. Validate the tool input against `submitGmResponseSchema`. On parse failure, throw — this is a Claude output bug, not a user error, and deserves visible failure in logs.
8. Persist the `playerText` as a new `messages` row with `role = 'assistant'`.
9. Return `{ message, proposals }`.

### What M5 does **not** do in step 8

- Does not apply `stateChanges` to `campaign_state.data`.
- Does not route `proposedCanon` to `pending_canon`.
- Does not write `game_events`.
- Does not write `adventure_telemetry`.
- Does not call `roll_dice` or `rules_lookup` (those tools aren't registered in M5).

All of the above are M6.

### Error handling

- Anthropic SDK errors — log with adventure ID, return 502.
- Tool call parsing errors — log with raw response, return 502. Do not persist the GM message.
- Schema validation errors — same.

On error, the player message is already persisted (step 3). This is intentional: the player's input is a valid action even if the response failed to generate, and re-submitting a duplicate is worse than an unanswered message. The frontend may surface a retry affordance in M6.

---

## Testing

Follow `docs/CLAUDE.md`.

**Unit tests — snapshot builder (`session.snapshot.spec.ts`):**
- Empty campaign state produces a snapshot with no block tags at all.
- Hidden entities are elided; player-owned entities are always included regardless of `visible`.
- An entity toggled from `visible: true` to `visible: false` between snapshots disappears on the second snapshot.
- Flag triggers are emitted only for flags absent from the cached GM context.
- Ordering is deterministic across permuted input.
- `max: null` on a pool produces no `/{max}` in output.

**Unit tests — window builder (`session.window.spec.ts`):**
- Empty input returns empty window.
- Window never exceeds max bytes except for single-message overflow.
- Chronological order is preserved.
- Single oversized message is included with a logged warning.

**Unit tests — prompt assembly (`session.prompt.spec.ts`):**
- System blocks are in the expected order with `cache_control` only on the GM context block.
- First user message contains the tag-wrapped snapshot.
- `tool_choice` forces `submit_gm_response`.

**Integration tests (against test DB, mocked Anthropic):**
- Full round trip: POST a message, verify the player message is persisted, the GM message is persisted with `role = 'assistant'`, the response includes the full `SubmitGmResponse` payload.
- No state changes applied: after the call, `campaign_state.data` is byte-identical to pre-call. `pending_canon` has no new rows. `game_events` has no new rows.
- Precondition 409s: adventure in `synthesizing` or `failed` state rejects the request.

**Do not** call the real Anthropic API in tests. Mock `AnthropicService.callSession` everywhere.

---

## Deferrals

### Rolling summary — deferred out of Phase 1

The original M5 roadmap bullet included a rolling summary stored in `adventure.rolling_summary`, lazily generated at resume. It has been dropped from M5 pending playtest evidence that it's needed.

Rationale: the cached GM context (which accumulates auto-promoted canon in Solo Blind mode) plus `npcStates` and `worldFacts` in `campaign_state.data` already cover the continuity needs the summary was specified to address. The design doc's summarization guidance — "prioritize uncanonized improvised fiction, NPC behavior, lies told, relationships formed, specific physical details" — maps almost entirely onto what canon auto-promotion and the working-memory fields capture today. The summary's unique contribution is narrow: narrative texture and sequence that didn't produce discrete canonizable facts, only relevant in adventures long enough that the message window can no longer hold the arc.

Shipping the summary now would add a second Claude call per resume, a new column for cutoff tracking, a migration, and a prompt that can't be tuned without evidence. Observing whether Phase 1 play actually suffers from narrative-continuity loss without the summary is a cheaper first step than engineering against a failure mode that may not occur.

The `adventure.rolling_summary` column from M1 remains in the schema and stays null through Phase 1. If the gap shows up in playtests, rolling summary can be added as its own milestone — likely alongside campaign canon promotion tooling in Phase 2, where the related "what persists across adventures" questions already need answering.

**Action for the user:** add a `docs/DECISIONS.md` entry capturing this deferral and its rationale, mirroring the spatial-system deferral in structure. Update the M5 bullet in `docs/roadmap.md` to strike the rolling-summary line. Update `docs/zoltar-design-doc.md` per the Documentation Corrections section above.

---

## Out of Scope for M5

Deferred, in scope for later milestones. Do not implement:

- State change application (M6)
- Backend state validation — resource deductions, HP thresholds, threshold crossings (M6)
- `pending_canon` runtime routing and auto-promote during play (M6 — synthesis-time auto-promote already ships in M4)
- `game_events` write path (M6)
- `adventure_telemetry` write path (M6)
- `roll_dice` and `rules_lookup` tools (M6)
- Correction mechanic (`superseded_by`) (M6)
- Frontend play view (M6)
- Caller model and initiative mode (M7)
- Spatial system — no LOS, no entity positions, no grid population. Per `docs/DECISIONS.md`, prose-based spatial consistency via `worldFacts` is the Phase 1 approach.
- Rolling summary — deferred pending playtest evidence. See "Deferrals" above.
