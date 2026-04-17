# Claude Tool Definitions

This document defines the tools available to Claude during Zoltar sessions. Tool use enforces output schemas at the API level, eliminating a whole category of malformed response runtime errors that prompt-instruction-only approaches cannot prevent.

Two categories of tools exist:

**Session tools** — available during play. Claude calls these while processing a player action.
- `submit_gm_response` — the primary response tool; Claude must call this to complete every turn
- `roll_dice` — server-side dice execution for system-generated rolls
- `rules_lookup` — vector search against the embedded rules index

**Campaign creation tools** — available only during the synthesis phase.
- `submit_gm_context` — commits the synthesized GM context blob to the database

---

## Resource Pool Conventions

All trackable numeric resources — HP, stress, ammo, power, sanity, whatever a system uses — are represented as named resource pools. Pool names use underscores and follow the pattern `{entity_id}_{pool_name}`:

```
dr_chen_hp
dr_chen_stress
vasquez_hp
vasquez_ammo
ships_power
```

Pool behavior is defined in the system Zod schema, not hardcoded in the validator. Each pool definition carries metadata the validator uses:

```typescript
const PoolDefinitionSchema = z.object({
  min:        z.number().int().nullable(),  // null = no floor; 0 = cannot go negative
  max:        z.number().int().nullable(),  // null = no ceiling
  thresholds: z.array(z.object({
    value:  z.number().int(),
    effect: z.string(),  // 'death', 'unconscious', 'panic_check', 'power_critical', etc.
  })).default([]),
});
```

**Validator behavior:** The full delta is always applied first. After application, the validator checks whether the resulting value crossed any thresholds. If a goblin has 7 HP and takes 9 damage, the result is -2 HP — the full 9 is applied, the death threshold is crossed, and Claude is notified of both the final value and which thresholds fired so it can narrate correctly. The delta is never pre-capped.

A pool with `min: null` can go negative (HP in most systems, power grids that can be overloaded). A pool with `min: 0` is floored at zero — spending more than you have is rejected and Claude is notified. `max` works the same way in the positive direction.

---

## Session Tools

### `submit_gm_response`

Claude must call this tool to complete every turn. It cannot respond with plain text — the structured output is required. The backend routes each field of the response to the appropriate write path.

```typescript
const submitGmResponseSchema = z.object({

  // Narrative text delivered to the player. Everything the player sees
  // comes from this field — Claude does not speak outside of it.
  playerText: z.string(),

  // Proposed changes to authoritative game state. The backend validates
  // all changes before applying. Invalid changes are rejected and Claude
  // is notified to re-narrate.
  stateChanges: z.object({

    // Deltas to named resource pools on any entity.
    // Negative delta = spending/losing. Positive delta = gaining.
    // All trackable numeric resources live here — HP, stress, ammo, etc.
    // Pool names use underscores: 'dr_chen_hp', 'vasquez_stress'.
    // See Resource Pool Conventions above.
    resourcePools: z.record(
      z.string(),
      z.object({ delta: z.number().int() })
    ).optional(),

    // Non-numeric entity state: narrative visibility and status label.
    // HP and other numeric resources belong in resourcePools, not here.
    // `visible` is a narrative flag (hidden threat spotted, NPC slips away) —
    // no LOS computation is performed. `status` is a short label matching
    // what `submit_gm_context` writes at synthesis time (e.g. 'wounded',
    // 'fled', 'revealed'). Entity position is not modeled in Phase 1 per
    // the spatial-system deferral in decisions.md.
    entities: z.record(
      z.string(),
      z.object({
        visible: z.boolean().optional(),
        status:  z.string().optional(),
      })
    ).optional(),

    // Boolean flags — arbitrary named flags on campaign state.
    // Example: { "airlock_sealed": true, "power_restored": false }
    flags: z.record(z.string(), z.boolean()).optional(),

  }).optional(),

  // Updates written to the GM context blob. Never shown to the player.
  gmUpdates: z.object({

    // Working memory about NPC states. Persists across turns within
    // the adventure as accumulated context. Not permanent canon.
    // Example: { "corporate_spy": "frightened, knows we found the manifest" }
    npcStates: z.record(z.string(), z.string()).optional(),

    // Freeform notes appended to the GM context blob.
    notes: z.string().optional(),

    // Improvised fiction that may warrant permanence. Routed to the
    // pending_canon queue rather than written directly to GM context.
    // In Solo Blind mode, auto-promoted. In other modes, awaits human review.
    proposedCanon: z.array(z.object({
      summary: z.string(),   // one or two sentences describing the improvisation
      context: z.string(),   // what player action or fiction prompted it
    })).optional(),

  }).optional(),

  // Dice rolls Claude needs the player to make. Returned to the frontend
  // as a dice UI prompt. The player's result is submitted as a diceResult
  // action on the next turn. Use this for player-facing rolls in soft
  // accountability or commitment mode. For system-generated rolls, call
  // the roll_dice tool instead.
  // IDs are assigned by the backend after receiving this response —
  // Claude does not generate them.
  diceRequests: z.array(z.object({
    notation: z.string(),                          // standard dice notation: '1d100', '2d6', etc.
    purpose:  z.string(),                          // shown to the player: 'Intellect save to interpret corrupted data'
    target:   z.number().int().nullable().optional(), // null in commitment mode; revealed after roll
  })).optional(),

  // Adventure mode changes.
  adventureMode: z.enum(['freeform', 'initiative']).nullable().optional(),

  // Full initiative order when entering initiative mode. Array of entity
  // identifiers in turn order. Must be present when adventureMode = 'initiative'.
  initiativeOrder: z.array(z.string()).nullable().optional(),

  // Advance to the next combatant in initiative order.
  advanceInitiative: z.boolean().optional(),

  // Transfer caller role to this player. The backend updates adventures.caller_id.
  // Claude uses this for narrative beats: "Vasquez takes charge."
  callerTransfer: z.string().uuid().nullable().optional(),

});
```

**Validation behavior:**
- `resourcePools` deltas are applied in full. The validator checks threshold crossings after application, not before. Claude is notified of the final value and any thresholds crossed.
- Pools with `min: 0` reject deltas that would go negative. Pools with `min: null` allow negative values. Behavior is defined in the system Zod schema pool definition.
- `entities` visibility and status changes are always accepted.
- `flags` changes are always accepted.
- `adventureMode: 'initiative'` requires `initiativeOrder` to be present and non-empty.
- `callerTransfer` must reference a user who is a member of the campaign.

---

### `roll_dice`

Server-side dice execution. The result is computed outside Claude's narration, logged to `game_events` before Claude narrates, and fully auditable. Claude receives the actual rolled result and narrates from it.

Use this tool for system-generated rolls — saves the GM makes on the player's behalf, NPC actions, random table resolutions, or any roll where the player does not interact with the dice. For player-facing rolls in accountability or commitment mode, use `diceRequests` in `submit_gm_response` instead.

```typescript
const rollDiceInputSchema = z.object({
  notation: z.string(),  // '1d100', '2d6+3', '3d10', etc.
  purpose:  z.string(),  // logged to game_events; not shown to player
});

const rollDiceOutputSchema = z.object({
  notation: z.string(),
  results:  z.array(z.number().int()),  // individual die results before modifier
  modifier: z.number().int().default(0),
  total:    z.number().int(),           // sum of results + modifier
});
```

**Example:**
```json
// Input
{ "notation": "1d100", "purpose": "Panic check for Dr. Chen" }

// Output
{ "notation": "1d100", "results": [73], "modifier": 0, "total": 73 }
```

---

### `rules_lookup`

Semantic search against the vector-embedded rules index for the active game system. Claude calls this instead of confabulating rules from training data. Supplement text pasted in at campaign setup is embedded into the same index.

```typescript
const rulesLookupInputSchema = z.object({
  query:  z.string(),       // natural language query: 'panic table result 73'
  limit:  z.number().int().min(1).max(5).default(3),
});

const rulesLookupOutputSchema = z.object({
  results: z.array(z.object({
    text:       z.string(),   // the relevant rules text chunk
    source:     z.string(),   // e.g. 'Mothership Warden\'s Operations Manual p.42'
    similarity: z.number(),   // cosine similarity score 0–1
  })),
});
```

**Usage guidance:**
- Query with natural language, not keyword search. "What happens when a character reaches 0 HP" outperforms "HP 0 death".
- Call this before making any mechanical ruling Claude is uncertain about.
- The index is system-specific — it contains only rules for the active campaign's game system.

---

## Campaign Creation Tools

### `submit_gm_context`

Commits the synthesized GM context to the database. Called once at the end of the synthesis phase. After this call the adventure transitions from `synthesizing` to `ready` and play can begin.

The entity identifiers in the `structured.entities` array are the canonical identifiers used by session tools throughout the adventure. Getting alignment right at synthesis time is critical — if synthesis produces `corporate_spy_1` as an entity ID, every subsequent `npcStates` update and entity position change in `submit_gm_response` must use that same identifier.

```typescript
const submitGmContextSchema = z.object({

  // The first thing the player sees when the adventure begins —
  // generated during synthesis and injected as the first assistant
  // message on adventure start. Not part of the GM context blob
  // re-sent to Claude; stored once and replayed from the message log.
  openingNarration: z.string().optional(),

  narrative: z.object({

    // Spatial truth: deck layout, room connections, what is where,
    // what the crew would observe on entry to each space.
    location: z.string(),

    // Tone, sensory detail, pacing notes for the Warden to maintain
    // across the adventure.
    atmosphere: z.string(),

    // NPC agendas keyed by entity identifier. What each NPC wants,
    // what they know, what they're hiding, what they'll do.
    npcAgendas: z.record(z.string(), z.string()),

    // The actual answer to the adventure's central mystery. Never
    // revealed to the player except through discovery in play.
    hiddenTruth: z.string(),

    // How the oracle results connect to each other — the coherent
    // narrative that emerged from synthesis.
    oracleConnections: z.string(),

  }),

  structured: z.object({

    // All entities that exist in the adventure from turn one.
    // Includes NPCs, threats, and significant terrain features.
    entities: z.array(z.object({
      id:               z.string(),   // canonical identifier; used by session tools
      type:             z.enum(['npc', 'threat', 'feature']),
      startingPosition: z.object({
        x: z.number().int(),
        y: z.number().int(),
        z: z.number().int().default(0),
      }).optional(),
      visible: z.boolean(),           // visible to player party at adventure start
      tags:    z.array(z.string()),   // e.g. ['corporate', 'armed', 'injured']
    })),

    // Flags that exist at adventure start. Each flag pairs its boolean
    // value with the in-fiction trigger that flips it — co-located so
    // the state snapshot can surface the trigger to Claude every turn
    // without re-reading the GM context blob.
    //
    // Every scenario must include an `adventure_complete` flag whose
    // trigger names the specific end condition for the adventure.
    //
    // Example:
    //   {
    //     "distress_beacon_active": {
    //       "value": false,
    //       "trigger": "Flip to true when the player or an NPC activates the beacon at the bridge console."
    //     },
    //     "adventure_complete": {
    //       "value": false,
    //       "trigger": "Flip to true when the player escapes the vessel via the emergency pod with the manifest."
    //     }
    //   }
    flags: z.record(z.string(), z.object({
      value:   z.boolean(),
      trigger: z.string(),
    })),

    // Initial system-specific campaign state. Entries that match the
    // resource pool shape ({ current: number, max: number | null })
    // are written to campaign_state.data.resourcePools. Non-pool
    // entries are silently ignored — use worldFacts for string state.
    initialState: z.record(z.string(), z.unknown()),

    // Non-numeric initial state the Warden needs to remember across
    // turns. Starting deck/location, environmental details that must
    // stay consistent (specific console readout text, graffiti content),
    // NPC cover identities, etc. Keys are descriptive snake_case,
    // values are plain strings. Merged into campaign_state.data.worldFacts.
    worldFacts: z.record(z.string(), z.string()).optional(),

  }),

});
```

---

## Tool Call Routing

The backend's `GmService` routes tool calls as follows:

```
Claude API call initiated
  │
  ├─ Claude calls roll_dice
  │    → Backend executes roll, writes to game_events
  │    → Result returned to Claude as tool response
  │    → Claude continues (may call more tools)
  │
  ├─ Claude calls rules_lookup
  │    → Backend queries pgvector index
  │    → Results returned to Claude as tool response
  │    → Claude continues (may call more tools)
  │
  └─ Claude calls submit_gm_response
       → Backend validates and applies state changes
       → Threshold crossings detected and reported back to Claude
       → pending_canon entries routed to queue
       → gm_context blob updated
       → Messages and game_events written
       → player_text and diceRequests (with backend-assigned IDs) returned to frontend
       → Tool call cycle ends
```

`submit_gm_response` terminates the tool call cycle. Claude may call `roll_dice` and `rules_lookup` multiple times before calling `submit_gm_response`, but it must call `submit_gm_response` exactly once per turn. The Claude API call is configured with `tool_choice: { type: "any" }` to ensure Claude always uses a tool rather than responding with plain text.

`submit_gm_context` is only available during the synthesis phase. It is not present in the session tool list and cannot be called during play.

---

## Phase 2+ Additions

- `generate_location` tool — random table generation for UVG and similar systems
- `advance_faction` tool — NPC agenda advancement between adventures
- Private action tool variant — result visible only to the submitting player
