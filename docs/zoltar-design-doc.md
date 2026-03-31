# Zoltar — Design Document
*Draft 4 — March 2026*

---

## Vision

Zoltar is an AI-GM platform for solo and small-group tabletop RPG play. It fills the gap between "I want to play" and "I can assemble a table" — enabling play at 11pm on a Tuesday, between sessions, or when the group's GM needs a break.

**Tagline:** Play more. Wait for no one.

Zoltar is not a GM replacement. It lowers friction for play. It may create more GMs by helping players get comfortable with systems through solo play. The target audience is TTRPG players who want to play more than their schedule or social circumstances allow — not people who want to eliminate the GM role.

---

## Honest Limitations

Before describing what Zoltar does, it's worth being clear about where the solo AI-GM experience falls short of a human GM at the table. These are not problems to be solved — they are structural properties of what Claude is. Understanding them sharpens the product.

**Creative surprise.** A human GM can have an idea that is completely outside the space of things Claude would generate — a twist that recontextualizes everything, a villain motivation that is genuinely novel, fiction that feels authored rather than assembled. Claude is sophisticated pattern completion. It executes and propagates a creative vision well, but it cannot independently originate one. The campaign is only as interesting as the thought a human put into the GM context.

**Reading the room.** A human GM watches you light up when the mystery deepens and quietly drops the combat encounter they had planned. They notice you have been quiet for twenty minutes and check in. They adjust pacing in real time based on signals that are not in the text. Claude gets the text. That is it.

**The relationship.** Part of what makes a human GM's campaign feel meaningful is that another person cared enough to build it for you. The villain's backstory exists because someone sat down and thought about what would be interesting for you specifically. That is a different thing than a well-prompted language model.

**Why this matters for product positioning:** Zoltar is not competing with a human GM at the table. It is competing with not playing. The question is not "is this as good as your best GM" — it is "is this better than nothing at 11pm on a Tuesday when no one is available." That is a much lower bar, and Zoltar clears it. It may also be better than some human GMs for specific things: perfect rules consistency, no flaking on sessions, infinite patience for cautious play.

Some of the gap may close as models improve. The creative vision gap and the relationship gap feel more irreducible — those may be structural properties of what Claude is, not engineering problems.

---

## Build Strategy

The open core self-hosted version is the primary development target. SaaS infrastructure is intentionally deferred until the 2D VTT renderer is complete and the product is genuinely worth paying for as a hosted service.

The service interfaces (AuthService, EntitlementsService, etc.) are built into the core from day one so the SaaS layer is additive when the time comes — not invasive. Building open core first also means a faster development loop: no Clerk configuration, no Stripe webhooks, no S3 bucket policies during the main build phase.

The SaaS milestone: when the 2D renderer ships and Zoltar has a visual table, build the managed hosting layer.

---

## Top-Level Requirements

- **Mobile-first:** The play interface is designed for thumb reach on a phone screen. Desktop is a first-class experience but not the primary design target. A Mothership session while waiting for the bus is a core use case.
- **Honor system secrecy:** Hidden GM information is enforced architecturally where possible and by player agreement elsewhere. No cryptographic enforcement required.
- **No undo:** "If you say it, you do it." Corrections replace undo. See Game Event Log section.
- **Raw dice rolls:** The system always works in raw unmodified rolls. Modifiers are applied by the backend. The UI makes this unambiguous at the point of entry.

---

## What Zoltar Is Not

- Not a worldbuilding assistant or GM prep tool (different product, different moment)
- Not a traditional VTT (Foundry and Roll20 own that space; Zoltar serves a different use case)
- Not trying to replace human GMs; serving the moments when one isn't available

---

## MVP Setting: Mothership

Mothership (Warden's Edition) is the recommended first iteration target:

- Rules are minimal — percentile rolls, a handful of saves, Stress and Panic as core mechanical drama
- Setting is self-contained — a derelict ship scenario requires no supplements or faction lore
- Horror atmosphere rewards the LOS and grid system (not knowing what's around the corner is the game)
- Tight natural scope for a first playtest — a three-person crew, one NPC survivor with an agenda, one hidden threat, one corporate secret

**Suggested first scenario:** A crew responds to a distress beacon on a mining vessel. The rules lookup tool has almost nothing to index. The dice rolling tool covers nearly every resolution case.

**Phase 1 map support:** Mothership is designed for theater-of-the-mind play. Claude is the Warden — it knows the spatial truth from the grid state and GM context and narrates what the player's character perceives as they move through the space. The GM context at campaign setup contains a text description of the location: deck layout, room connections, key features, what's hidden where, where the threat is, where the survivor is hiding. There are no visual maps in phase 1. The fiction is the map, as it would be at a real table running theater-of-the-mind. The grid tracks entity positions mechanically. Visual maps arrive with the 2D renderer in phase 3.

---

## Supported Systems (Phased)

**Phase 1:** Mothership

**Phase 2:** UVG (Ultraviolet Grasslands), OSE

**Phase 3:** Infinity 2d20, D&D 5e (with rules engine layer)

**System and setting are decoupled.** The rules engine knows about mechanics — hit points, resource pools, action economy, conditions. It knows nothing about the fiction. The GM context is where the setting lives — factions, history, geography, tone — and that content is entirely freeform. A homebrew D&D setting is simply a campaign where the GM context describes your world instead of a published one, running on the 5e rules engine. Savage Worlds homebrew works the same way once the Savage Worlds engine exists. Homebrew settings are first-class citizens.

**Generally good fits:** Settings-forward, exploration or investigation focused, rules that create stakes rather than invite optimization. Mystery/investigation with hidden NPC agendas. Horror with spatial tension.

**Generally poor fits:** Tactical grid combat requiring positioning math (PF2e at full crunch), heavy dice pool systems (Shadowrun), physically-mediated mechanics (Dread/Jenga), fundamentally multiplayer social games (Fiasco, Microscope).

**Adaptation support:** Settings can be run with different systems (UVG + 2d20, Infinity + Forged in the Dark). Custom settings can be designed collaboratively and locked into the GM context. The adaptation rules live in the GM context, fixed at campaign creation.

---

## Core Architecture

### The GM-in-a-Box Model

The fundamental architectural insight: hidden information lives in the database, not in the conversation. Claude receives a visibility-filtered state snapshot with each request and never holds authoritative state between requests.

```
Player action → NestJS backend
Backend fetches GM context + current state snapshot from DB
Backend constructs Claude API prompt (state injected, secrets included)
Claude calls submit_gm_response tool with structured output
Backend validates state changes, applies them to DB
Backend returns player_text to Svelte frontend
GM context updates stored server-side only — never sent to client
```

### The Hidden Layer

Zoltar uses two distinct mechanisms for hidden information. They work differently and should not be conflated.

**GM context secrets** — NPC agendas, the true answer to the mystery, faction loyalties, what's actually in the vault — are included in Claude's prompt in full. Claude is the Warden. It knows everything the Warden knows. It is instructed to reveal GM context secrets only when fictionally appropriate — when the player's character could plausibly perceive or discover them. This is behavioral: Claude is playing the Warden role faithfully, not being prevented from speaking.

**Spatial secrets** — entities outside the party's line of sight — are structurally absent from the visibility-filtered state snapshot. Claude doesn't choose not to mention the goblin behind the column; it genuinely doesn't receive that entity's position data. The goblin isn't in the prompt.

```
Visible cells: B3, B4, C3, C4 (partial — column at D4 blocks further east)
Entities in visible cells: none
Sounds: scratching from unknown direction
Hidden (not in prompt): goblin_skirmisher at E4, watching through gap
```

This is structural secrecy for spatial information specifically — not for GM context generally.

### Claude as Consequence Engine

Claude is narrator and consequence engine. It observes what happened fictionally, determines what the mechanical consequences are, and issues structured change requests via the `submit_gm_response` tool. The backend is the bookkeeper — it validates, applies, and stores authoritative state.

Claude never holds authoritative state. It sees the snapshot at request time, issues change requests, and the backend is the single source of truth. The moment an exchange completes and results are written to the DB, Claude's working memory of it is irrelevant — the next request includes the updated snapshot.

The analogy: a player at a real table says "I cast fireball — that's 8d6 damage to everything in the area." They've identified the consequence. The Warden (the backend) determines what actually changes — checks saves, applies damage, updates HP, notes who died. Claude proposes consequences; the backend decides what actually happens.

### Stateless Design and Scaling

The backend is designed stateless with respect to connections from day one. All authoritative state lives in Postgres. No shared mutable state in application memory. This means multiple NestJS instances can run without coordination for everything except WebSockets.

WebSocket real-time sync (Ably) handles cross-instance message delivery for the SaaS deployment. Self-hosted single-droplet deployments run one instance and have no cross-instance concern. When SaaS real-time is built, Ably's infrastructure manages the coordination rather than requiring a Redis adapter.

---

## Tech Stack

| Layer         | Technology                                                                      |
|---------------|---------------------------------------------------------------------------------|
| Frontend      | Svelte SPA                                                                      |
| Backend       | NestJS                                                                          |
| Database      | PostgreSQL                                                                      |
| AI            | Claude API (Sonnet 4)                                                           |
| Auth          | Clerk (SaaS) / Auth.js (self-hosted)                                            |
| Real-time     | Ably (SaaS, phase 2+) / Noop (self-hosted default)                              |
| Asset storage | S3 (SaaS) / Local or MinIO (self-hosted)                                        |
| Deployment    | DigitalOcean Droplet (self-hosted) / DigitalOcean App Platform (SaaS, phase 3+) |

---

## Database Schema Approach

**Hybrid: typed relational tables for universal concepts, JSONB with Zod validation for system-specific state.**

### Universal relational tables

```typescript
campaigns         { id, org_id (nullable), name, system, created_at, gm_context_id }
sessions          { id, campaign_id, created_at, caller_id, mode }
messages          { id, session_id, role, content, created_at }
gm_context        { id, campaign_id, blob: jsonb }
character_sheets  { id, campaign_id, player_id, system, schema_version, data: jsonb }
campaign_state    { id, campaign_id, system, schema_version, data: jsonb }
```

The grid earns proper relational tables because it's a genuine relational query problem:

```typescript
grid_cells        { id, campaign_id, x, y, z, terrain_type, blocks_los, blocks_movement, climbable, elevation }
grid_entities     { id, campaign_id, entity_ref, x, y, z, visible, tags: jsonb }
```

### System-specific state via Zod schemas

Each game system has a Zod schema definition that is the source of truth for its state shape. Adding a new system means writing a schema, not a migration. A `schema_version` field enables lazy migration at read time.

```typescript
const schemas = {
  mothership: MothershipStateSchema,
  uvg:        UVGCampaignStateSchema,
  fived:      FiveDCampaignStateSchema,
  ose:        OSECampaignStateSchema,
}
```

### Multi-tenancy note

`org_id` is nullable in the core schema. Self-hosted installations leave it null — there's only one implicit tenant. SaaS installations populate it and enforce isolation via Postgres Row Level Security. No schema divergence between deployment modes.

---

## The Grid and LOS System

### Data model

```typescript
grid_cells {
  id, campaign_id, x, y, z,
  terrain_type,
  blocks_los: boolean,
  blocks_movement: boolean,
  climbable: boolean,
  elevation: integer    // Z-value for high ground
}

grid_entities {
  id, campaign_id,
  entity_ref,           // references character, NPC, or terrain feature
  x, y, z,
  visible: boolean      // to player party
}
```

Terrain types: full blockers (columns, walls, closed doors), partial blockers (low walls, crates — block LOS standing, not prone), transparent blockers (iron bars — block movement not LOS), difficult terrain (movement cost modifier), elevation.

### LOS computation

Shadowcasting or Bresenham raycast computed server-side. Light sources are positioned entities with a radius value. The visibility-filtered snapshot sent to Claude excludes entities the party cannot see — structural secrecy, not behavioral.

### ECS architecture note

The grid entity model is ECS-inspired — entities with component-like data stored in Postgres, systems implemented as NestJS services. This is the right level of abstraction for a request/response API server. Full ECS architecture system-wide is not used — the performance benefits of ECS apply to real-time game loops with thousands of entities, not to a request/response backend. The renderer layer will follow whatever pattern BabylonJS favors when that time comes.

### Sub-cell geometry (future requirement)

The current cell-centric model handles most cases well — terrain features occupy cells. However, sub-cell features like a 1-foot diameter column at the intersection of four squares don't map cleanly to any single cell. This is a known future requirement as the VTT layer matures toward Foundry-level spatial fidelity.

The geometry layer and cell grid can coexist — the grid provides movement and positioning framework, a separate geometry layer handles precise LOS blocking. A stub table is reserved now to avoid a painful retrofit later:

```typescript
map_geometry {
  id
  campaign_id
  type        // 'wall' | 'door' | 'point_feature'
  shape       // jsonb — GeoJSON or simple coordinate array
  blocks_los
  blocks_movement
}
```

Not implemented in phase 1-2. The cell model handles those phases cleanly.

### Grid rendering (future)

The grid API returns raw cell/entity data that any renderer can consume. Phase 1 uses text descriptions. Phase 3+ adds a canvas renderer. The rendering layer is intentionally decoupled from the data layer.

**Future VTT consideration:** BabylonJS for 3D rendering and STL model support is a long-term ambition. The Z-value on grid entities is included in the schema from day one to avoid a painful retrofit. The renderer decision (2D canvas vs BabylonJS 3D) is intentionally deferred to phase 3 when the VTT layer is actually being built. The 3D renderer will live in a separate private repository — see Monorepo and Repository Structure section.

### AI map generation (phase 3+ feature)

When the 2D renderer exists, AI-generated maps become a meaningful feature. The design intent is a two-step pipeline: Claude generates a structured map description and a separate map compiler translates that into grid data.

Map generation prompt engineering should incorporate:
- Layered location history as generative constraints (who built it, who occupied it after, who's there now — each layer leaving traces in the design)
- Good dungeon design principles (multiple entrances and exits, chokepoints, the reasons behind layout decisions)
- Procedural room placement logic ("start with the escape route, then add the laboratory, which needs to be lower than the river so it can be flooded in an emergency")
- An interactive supervision workflow during campaign creation — "here's a draft layout based on your history constraints, want the laboratory closer to the river entrance?"

Human supervision of the generation process is recommended at least initially. Map generation is not a one-shot prompt but a collaborative back-and-forth during campaign setup.

---

## Claude API Integration

### Structured response via tool use

Claude is required to call a `submit_gm_response` tool to submit its response. Tool use enforces the schema at the API level rather than relying on prompt instructions, which eliminates a whole category of malformed response runtime errors.

```typescript
// Tool definition
submit_gm_response({
  player_text: string,          // narrative delivered to the player
  state_changes: {
    resource_pools?: Record<string, { delta: number }>,
    entities?: Record<string, { hp?: { delta: number }, position?: Position }>,
    flags?: Record<string, boolean>
  },
  gm_updates: {
    npc_states?: Record<string, string>,
    notes?: string,             // stored in gm_context, never shown to player
    proposed_canon?: Array<{    // improvised fiction that may warrant permanence
      summary: string,          // one or two sentence description of the improvisation
      context: string           // why it came up — what player action or fiction prompted it
    }>
  },
  dice_requests?: Array<{
    notation: string,
    purpose: string,
    target?: string
  }>,
  session_mode?: 'freeform' | 'initiative' | null,
  initiative_order?: string[],
  advance_initiative?: boolean,
  caller_transfer?: string      // player_id to transfer caller role to
})
```

### The pending canon queue

Claude's `gm_updates.npc_states` field lets it write situational notes mid-session — "Goblin_2 is frightened, just watched its companion die." These are working memory: they persist across turns within a session because they accumulate in the GM context blob, but they only become meaningful long-term fiction if they are intentionally promoted.

`proposed_canon` is a separate field for a different category of improvisation: things Claude invented mid-session that might deserve to be permanent facts about the campaign world. A goblin lieutenant who displayed unusual tactical patience. A sound suggesting the dungeon connects to something larger. A detail that emerged from play and feels like it should be true from now on.

The backend routes `proposed_canon` entries to a review queue rather than writing them directly to the GM context blob. At session end — or on demand via a dedicated UI — the GM reviews pending proposals and makes the editorial call:

```
Proposed canon additions:

  The Ironteeth goblin lieutenant held position rather than pursuing
  the retreating party, contrary to typical goblin behavior.
  Context: Emerged during room 7 combat when the fighter withdrew.
  [Promote to GM context]  [Discard]

  The east passage appears to connect to a larger complex.
  Context: Goblin_2 fled east with apparent familiarity. Claude inferred
  a known route.
  [Promote to GM context]  [Discard]
```

Promoted entries are appended to the GM context blob and become part of the permanent cached context on every subsequent request. Discarded entries are logged but never written.

This mirrors how good tabletop GMing actually works — you improvise something in session, you decide after whether it is canon, and you write it into your notes if it is. Zoltar makes that workflow explicit rather than hoping Claude propagates interesting fiction consistently across session boundaries.

**The distinction from npc_states:** `npc_states` is tactical working memory within a session — "frightened, low on arrows." `proposed_canon` is durable world-building that emerged from play — "this clan of goblins is different." The former is always written; the latter always requires a human editorial decision.

**Phase:** Phase 1. This affects the core solo experience and the integrity of the GM context across sessions. It is not optional polish.

### State changes validation

The backend validates all proposed state changes before applying:
- Resource deductions: does the entity have enough to spend?
- HP changes: any positive delta is valid; negative deltas check for death/unconscious thresholds
- Flag changes: always valid
- If a resource isn't available, the backend rejects and tells Claude, which narrates accordingly

### Prompt caching

The GM context — the hidden truth doc, faction agendas, location facts — is identical on every request. It sits at the top of the prompt and qualifies for prompt caching. Cache reads cost ~10% of base input price, making the "we're sending a lot of data" concern largely moot after the first request.

---

## Tools (Day One)

### Dice rolling (non-negotiable)

```typescript
roll_dice(notation: string): { results: number[], total: number, notation: string }
```

Results are computed outside Claude's narration, logged server-side before Claude narrates, and auditable. Claude receives the actual number and narrates from it. The audit log records whether the roll was system-generated or player-entered.

### Rules lookup

A vector-embedded rules index for each supported system. Claude calls this rather than confabulating rules from training data. Supplement text can be pasted in at campaign setup and embedded into the index.

### Location/random table generation (UVG and similar)

```typescript
generate_location(region: string, tags: string[]): LocationResult
```

Backend rolls and records the result before Claude narrates it. Location truth is in the database before description. Consistent if the party ever revisits.

### Tools deferred to later phases

- **Faction/NPC agenda advancement** (phase 2) — design the advancement logic after real sessions reveal the patterns
- **Session summarization** (phase 2) — automate when the manual process gets annoying
- **Image generation** (phase 3) — pure polish, skip until the core experience is solid

---

## Dice Rolling Modes

Set at campaign creation. Two options:

### Soft Accountability
The player rolls physical dice and enters the result. The system accepts what they enter and logs it. The audit trail records "player-entered roll" vs "system-generated roll" so the pattern is visible over time. No enforcement — just visibility. "I trust myself. I roll my own dice, I enter what I rolled. The log remembers."

### Commitment Mode
The player enters or generates their dice result before the difficulty or outcome is revealed. The machine decides what the number meant. Mirrors how physical dice work at a real table — you roll before you know what you need. "I commit before I know the target."

One affordance in commitment mode: **Ask the GM** — Claude describes whether the roll is easy, moderate, or hard without giving the number. Enough information to decide whether to attempt something, not enough to game the target.

**The UI offers both paths at every resolution moment.** In soft accountability mode, both a "roll for me" button and manual entry fields are presented. Both paths hit the same logging endpoint.

**Raw rolls only.** The system always works in raw unmodified dice results — the number showing on the die. Modifiers are applied by the backend from the character sheet. The UI makes this explicit at the point of entry:

```
Roll 2d10
Enter your dice: [ _ ] [ _ ]
(enter the numbers showing on the dice — modifiers applied automatically)
```

Entering pre-modified rolls is a known source of incorrect results from playtesting. The affordance eliminates this error mode.

**Toggle:** Players can switch between manual and system rolls on the fly, saved as a user preference but overridable per-roll. The default matches whatever mode was set at campaign creation.

**Mobile consideration:** On mobile without physical dice, commitment mode is somewhat academic since the phone is rolling anyway. A gentle UI note surfaces this when commitment mode is enabled on a mobile device.

---

## Multiplayer: The Caller Model

Adapted from Gygax's AD&D caller concept. Players coordinate in a back channel (voice chat for synchronous sessions, Discord for async play). One player is designated the caller and is the only one who can submit input to Zoltar. The race condition problem disappears entirely — there's always exactly one active voice.

### Session data model

```typescript
sessions {
  id, campaign_id,
  mode: 'freeform' | 'initiative',
  caller_id,              // one player, globally, at all times
}
```

### Caller transfer

- **Voluntary pass** — current caller selects recipient, instant transfer
- **Request** — non-caller requests the role; current caller sees a notification and can accept or ignore; request auto-approves after a configurable timeout for async play
- **Offline claim** — if the caller disconnects, any player can claim the caller role
- **Narrative transfer** — Claude can transfer the caller role as a narrative beat via `caller_transfer` in the structured response ("Sergeant Vasquez takes charge, barking orders")

### Combat: initiative mode

When Claude declares initiative, session mode flips and the initiative order is stored in the session record. In initiative mode the active "caller" is implicitly whoever's turn it is in the sequence. The UI highlights the active player. Between turns, the back channel handles coordination. `advance_initiative: true` in Claude's structured response moves to the next combatant.

### Party splits

Handled by the caller model naturally — no parallel queues, no world state contention. The caller acts for their group, hands off to someone in the other group, they act, they hand back. There is still just one active caller globally at any moment. Party splits are maintained in the fiction by players and Claude — no formal group tracking is needed in the data model. Grid positions already capture who is where. Message visibility is honor-system, as at a real table.

### Live typing preview (phase 2-3)

All players can see the caller's input field updating in real time as they type, before submission. Enables back-channel proofreading and corrections before an action is committed. Requires the Ably real-time layer. Preview should be visually marked as "drafting" to distinguish it clearly from a submitted action.

### Private actions (phase 2)

A separate affordance for individual character actions not taken on behalf of the party — slipping poison into the wine while the caller describes the diplomatic approach. Visible only to the submitting player and Claude, with the result visible only to that player.

---

## Game Event Log / Audit Trail

ES-flavored without full ES. The session message log plus a game events table provides everything needed without the overhead of a complete event sourcing implementation.

```typescript
game_events {
  id
  campaign_id
  session_id
  sequence_number       // monotonically increasing, never gaps
  event_type            // player_action | gm_response | dice_roll | state_update | correction
  actor                 // player_id | 'system' | 'gm'
  payload: jsonb        // full content
  created_at
  superseded_by         // nullable — points to correction event
}
```

`superseded_by` gives correction without deletion. Original events are always in the log. Corrections are additive. Full session reconstruction is possible for any past session.

### No undo

"If you say it, you do it" — authentic to TTRPG experience. At a real table you don't undo; you live with consequences.

**Correction mechanic instead:**
- *Player input error:* Cancel within a short window before GM processing — not undo, just cancel
- *Rules error:* GM ruling review — flag the response, Claude re-examines, issues a logged correction with `superseded_by` pointing to the original
- *Technical failure:* Admin-level state rollback from snapshots, not a player-facing feature

---

## Rules System

### Three Tiers

The rules system has three tiers with distinct authorship models. Understanding which tier a rule belongs to determines who can create it and how it's enforced.

**Tier 1 — Structured overrides** (engineer-implemented, user selects from available options)

Named parameters the backend knows how to interpret. A finite, curated set of well-understood mechanical switches. Users choose from options already implemented. Adding a new override type requires an engineer.

```json
{
  "spell_system": "spell_points",
  "crit_range": 19,
  "rest_system": "gritty_realism"
}
```

**Tier 2 — JSON constraint modules** (engineer-built evaluator, user-authored content)

The rule evaluator is a platform. Users author constraint modules — JSON objects with trigger/condition/constraint schema — that run on that platform without engineer involvement. Verified modules ship in the library. Community members can submit modules for review. Self-hosters can author custom modules for their campaigns.

```json
{
  "rule": "minimum_healing",
  "trigger": "dice_request_resolved",
  "condition": { "tags": ["healing", "spell"] },
  "constraint": { "type": "floor", "target": "result", "value": 1 }
}
```

**Tier 3 — Natural language house rules** (user-authored, Claude-enforced)

Freeform text in the GM context for rules that don't fit the constraint schema — narrative guidelines, flavor rules, idiosyncratic table conventions. "The crew of the Persephone never swear in front of the android." Claude applies these consistently because they're always in the prompt. Honor-system enforcement.

### Which layer enforces a given rule

Structured overrides configure both the backend rule evaluator and Claude's behavioral prompt, and which layer a given override lands on depends on whether the rule is a question of mechanical state or fictional reasoning. This distinction matters for understanding what the system can actually guarantee.

**Backend-enforced overrides** are arithmetic operations on known quantities that the rule evaluator can verify without understanding the fiction. `crit_range: 19` is a clear example — when a roll result comes in, the evaluator checks `roll >= crit_range` and upgrades the hit mechanically. Spell slot and spell point cost tables work the same way. The backend rejects a state change if the resource isn't available. These guarantees are hard.

**Claude-enforced overrides** are rules that require understanding the narrative state. `rest_system: gritty_realism` is the clearest example — short rests take 8 hours of in-fiction time, but the backend cannot verify whether 8 hours have passed in the fiction. That is a temporal and narrative question. The override injects a behavioral instruction into Claude's prompt: "short rests require 8 hours of in-fiction time." Claude is the one deciding whether sufficient time has passed; the backend can refuse to apply rest healing if Claude does not request it, but Claude must make the judgment call. These guarantees are behavioral, not structural — they depend on Claude following its instructions faithfully.

**Many overrides configure both layers.** The spell points example: the backend enforces the cost table arithmetically, and Claude understands "you are using spell points, not slots" when narrating and making decisions. The override touches both the rule evaluator and the prompt.

This layering means not all structured overrides offer the same strength of guarantee. Backend-enforced rules are reliable by construction. Claude-enforced rules are reliable to the extent Claude maintains consistent behavior across a session and across sessions — which in practice is very high, but is not identical to a hard mechanical constraint.

### How the tiers interact

The tiers compose. A single mechanic can span multiple tiers. The spell points example:

**Structured override** selects the system (engineer-implemented, user selects):
```json
{ "spell_system": "spell_points" }
```

**Verified library constraint module** implements the default cost table (ships with platform):
```json
{
  "rule": "spell_point_cost_standard",
  "trigger": "resource_spent",
  "condition": { "resource_type": "spell_points", "tags": ["spell"] },
  "constraint": { "type": "lookup", "table": "spell_point_cost_dmg_standard" }
}
```

**User-authored constraint module** overrides the cost table for a specific campaign (no engineer needed):
```json
{
  "rule": "spell_point_cost_custom",
  "trigger": "resource_spent",
  "condition": { "resource_type": "spell_points", "tags": ["spell"] },
  "constraint": { "type": "lookup", "table": "custom_cost_table" }
}
```

The priority system in the rule evaluator determines which constraint fires when multiple match. More specific or more recently added campaign-level constraints override library defaults.

### Constraint schema

Trigger types (finite enumerated set, engineer-extends): `dice_request_resolved`, `state_change_requested`, `action_declared`, `resource_spent`

Condition expressions evaluated via a constrained expression library (e.g. `filtrex`) — not arbitrary code execution. Supports property access (`entity.hp_max`), arithmetic (`entity.hp_max * 0.5`), comparison operators, and tag matching.

Constraint types: `floor`, `cap`, `multiply`, `add`, `replace`, `lookup`, `conditional`

### Rule evaluation engine

```
Claude issues state_change via submit_gm_response tool
  → Rule evaluator loads active constraints for this campaign
  → Evaluates each relevant constraint (trigger → condition → apply)
  → Modifies the proposed change if a constraint fires
  → Logs which constraints were applied
  → Applies the modified change to DB
  → Returns applied result to Claude for narration
```

Claude receives the actual applied outcome including which rules fired, so it can narrate correctly.

**Scope:** ~3-4 weeks of focused engineering for a solid, tested rule evaluator. Comprehensive test suite (property-based testing recommended) is as much work as the evaluator itself. Phase 3 feature.

### Phase gating

**Phase 1:** Rules as code, no overrides, ship it. Clean abstractions from the start: `resource_pool` not `spell_slots`, `condition` not `poisoned`.

**Phase 2:** Structured overrides for the most common variants (rest rules, crit rules, death saves, spell systems). Low effort, high value.

**Phase 3:** Full constraint module system, community library, natural language house rules field, rule evaluation engine.

---

## Auth Architecture

**SaaS:** Clerk — email/password, OAuth (Google, Discord — priority for gaming audience), magic links, MFA. Discord OAuth is day-one given the TTRPG demographic. Clerk Organizations maps onto the multi-tenant SaaS model.

**Self-hosted:** Auth.js — self-hosters who want Clerk can configure ClerkAuthService instead of AuthJsService by bringing their own Clerk account and API keys. This is a config choice, no code change needed.

**The abstraction layer:**

```typescript
interface AuthService {
  validateToken(token: string): Promise<User>
  getUserById(id: string): Promise<User>
}
```

NestJS DI selects the concrete implementation at bootstrap based on environment config.

---

## Service Interfaces and Self-Hosted Configuration

Every SaaS/self-hosted divergence point is a NestJS provider interface. SaaS implementations live in a closed-source package not included in the open source repository.

| Interface           | SaaS Implementation       | Self-hosted Default       | Self-hosted Alternative                      |
|---------------------|---------------------------|---------------------------|----------------------------------------------|
| AuthService         | ClerkAuthService          | AuthJsService             | ClerkAuthService (bring your own account)    |
| EntitlementsService | StripeEntitlementsService | ConfigEntitlementsService | —                                            |
| MeteringService     | BillingMeteringService    | NoopMeteringService       | —                                            |
| EmailService        | ResendEmailService        | SmtpEmailService          | —                                            |
| AssetStorageService | S3StorageService          | LocalStorageService       | MinIOStorageService                          |
| RealtimeService     | AblyRealtimeService       | NoopRealtimeService       | AblyRealtimeService (bring your own account) |
| FeatureFlagService  | LaunchDarklyService       | ConfigFeatureFlagService  | —                                            |

**Configuration-driven selection:**

```
DEPLOYMENT_MODE=selfhosted   # or 'saas'
AUTH_PROVIDER=authjs         # or 'clerk'
REALTIME_PROVIDER=noop       # or 'ably'
STORAGE_PROVIDER=local       # or 's3' or 'minio'
```

Self-hosters who want Ably for real-time sync (e.g. a game store running a semi-public installation) set `REALTIME_PROVIDER=ably` and provide their own Ably API key. Self-hosters who want Clerk set `AUTH_PROVIDER=clerk` and provide their own Clerk credentials. No code changes required for either.

**Testing strategy:**

Unit tests verify each service implementation independently against the interface contract. If both implementations correctly fulfill the interface, and application code only depends on the interface, application behavior is correct regardless of which implementation is active.

Integration tests cover the two primary configurations: SaaS (Clerk+Ably) and self-hosted default (AuthJs+Noop). The other two permutations (Clerk+Noop, AuthJs+Ably) are edge cases covered implicitly by unit tests, with manual smoke testing on major releases. The key discipline is keeping interface boundaries genuinely clean — application code must never reach through an interface and call implementation-specific methods.

**What degrades gracefully without Ably (NoopRealtimeService):**
- Async play works fully
- Synchronous play works — players submit actions and receive responses, no real-time push
- No live typing preview
- No presence indicators (who is currently online)
- No "caller is typing" affordance

The core game is fully playable without Ably. Real-time features are progressive enhancement. Self-hosters who want presence and live typing set `REALTIME_PROVIDER=ably` and provide their own Ably credentials. Ably's free tier covers substantial headroom for a small gaming group — many self-hosters will never incur a cost.

---

## Open Core / SaaS Model

### License: Elastic License 2.0 (ELv2)

Consistent with existing Automata Codex projects. Short, readable, clear restriction: cannot offer the software as a managed service to third parties without permission. Self-hosting for personal or internal use is unrestricted. Chosen from day one — no community expectations to disappoint later.

### Single-tenancy by design

The open core is single-tenant — not by technical enforcement, but by omission. Multi-tenancy simply isn't built into the core. `org_id` is nullable. There are no RLS policies, no per-tenant configuration, no subdomain routing, no tenant-aware query layer.

A self-hosted installation can have multiple user accounts, multiple campaigns, multiplayer sessions — all fully supported. What it cannot do is serve multiple independent groups with strict data isolation, per-tenant billing, or commercial hosting of other groups' data. That's the ELv2 restriction made technically real.

### RLS is not a service interface

Row Level Security is worth distinguishing from the service interfaces (AuthService, EntitlementsService, etc.). The service interfaces are application-layer abstractions swapped via NestJS dependency injection at runtime. RLS is a Postgres-level configuration applied to the database schema itself — it cannot be injected or swapped the way a service implementation can.

In the open core, the `org_id` column exists but is nullable and no RLS policies are defined. Queries don't filter by org. In the SaaS deployment, migration scripts add the RLS policies to the database and NestJS middleware sets `app.current_org_id` as a Postgres session variable on every request. The policies then enforce tenant isolation transparently at the database level.

This means multi-tenancy is a database migration and middleware concern that lives entirely in the closed SaaS layer — not a runtime configuration choice like selecting Clerk vs Auth.js. The core ships without the policies; the SaaS deployment applies them on top.

### Deployment modes

**Self-hosted (core):**
- Single-tenant by design
- User brings their own Anthropic API key
- Auth via Auth.js (or Clerk with own account)
- Storage via local filesystem or MinIO
- No managed updates, no social/discovery features
- DigitalOcean Droplet deployment

**SaaS (phase 3+):**
- Multi-tenant via RLS on `org_id`
- Managed Anthropic API key proxying with usage attribution
- Clerk auth, S3 storage, Ably real-time
- Stripe billing — GM pays model (players join campaigns free)
- DigitalOcean App Platform for managed scaling

### Access control model

Three distinct concepts that don't collapse into each other:
- **Org** — billing unit, mostly invisible to users. Created automatically at signup.
- **Campaign** — access primitive. Alice invites Bob by email; Bob gets a `campaign_members` record and never joins Alice's org.
- **User** — identity.

Campaign visibility: `private` (solo), `invite` (shared by member list), `org` (game store / club open sessions).

**GM pays model:** Alice's subscription covers API usage for her campaigns. Bob plays as a guest. Players don't need subscriptions. Pricing scales with features the GM uses, not player headcount. Consistent with TTRPG cultural expectations — the GM buys the books, the GM does the prep.

### Future: Creator economy

Long-term possibility. Alice sets up a campaign, charges players a nominal fee, platform takes a cut. Requires Stripe Connect, KYC, tax reporting, money transmission compliance. Not a phase 1-4 feature. Stripe Connect is additive — no architecture decisions needed now.

---

## Monorepo and Repository Structure

### Repository topology

```
automata-codex/           # GitHub organization
  hexcrawl/               # @achm — Hexcrawl Manager family (existing, separate repo)
  unicorn/                # @uv — Unicorn/Zoltar product family (this project)
  renderer-3d/            # Private, proprietary 3D renderer (separate private repo, future)
```

### Naming rubric

Name repositories after the product family, not the technology or contents. Someone looking at the GitHub organization should understand the portfolio structure from repo names alone. Products that share a release surface, a dependency graph, or infrastructure belong in the same monorepo. Products that are genuinely independent belong in separate repos.

The test: if I change a shared package, which products need to be retested? Everything in that blast radius belongs in one monorepo.

Whether future products (Automata Codex Campaign Manager, Automata Codex Character Builder) belong in the Unicorn monorepo is determined when they're built — if they import `@uv` packages on day one, they belong here. If they don't, they get their own repo.

### Unicorn monorepo structure

```
unicorn/
  packages/
    @uv/renderer          # 2D grid, LOS, canvas — open source, ELv2
    @uv/rules-engine      # dice, constraint evaluator, state machine — open source, ELv2
    @uv/auth-core         # service interface definitions — open source, ELv2
  apps/
    zoltar/               # Svelte SPA — AI-GM frontend
    unicorn/              # Svelte SPA — traditional VTT frontend
    zoltar-api/           # NestJS backend — Zoltar
    unicorn-api/          # NestJS backend — Unicorn VTT
  infra/                  # Docker Compose, deployment config, CI/CD
  docs/                   # Design docs, ADRs
```

Packages are not published to npm — they are workspace packages resolved locally by pnpm workspaces or Turborepo.

### 3D renderer: separate private repository

The 3D BabylonJS/STL renderer lives in a separate private repository (`renderer-3d`) with a proprietary license. Rationale: open sourcing the 3D renderer provides no meaningful benefit (community contributions are unlikely for this specialized work) and removes even the soft legal deterrent against commercial exploitation. The 2D renderer is not a competitive differentiator and is open source in the Unicorn monorepo. The 3D renderer is a potential differentiator — no other VTT currently offers STL model support in a web-native 3D environment — and stays closed.

Note: copyright protects expression, not ideas. A clean-room reimplementation of the same approach is likely not infringement. The real moat is execution, UX polish, and head start — keeping the code closed raises the friction for would-be competitors without being a perfect defense.

### Branding

Products use evocative names where they have strong identities (Zoltar, Unicorn VTT) and descriptive names where they are genuinely utilities (Automata Codex Hexcrawl Manager). "By Automata Codex" appears consistently as the studio attribution across all products. The studio name builds portfolio credibility over time. `automatacodex.com` serves as the portfolio page connecting all products.

---

## SaaS Infrastructure Roadmap (Phase 3+)

SaaS infrastructure is intentionally deferred until the 2D VTT renderer is complete. The service interfaces built into the core from day one make the SaaS layer additive rather than invasive when the time comes.

**Minimum SaaS surface for first revenue-generating version:**
- Clerk replacing Auth.js
- Stripe for subscription billing (GM pays model)
- S3 for asset storage
- EntitlementsService checking subscription tier
- UsageMeteringService attributing API costs to orgs
- Multi-tenant RLS policies on Postgres

**Deployment shift:** From a single DigitalOcean Droplet to DigitalOcean App Platform for managed scaling, with Postgres managed database.

---

## Phase Plan

### Phase 1 — MVP (Open Core)

- Mothership system (rules as code)
- NestJS backend, PostgreSQL, Svelte SPA
- GM context and hidden information layer (two-mechanism model)
- Grid and LOS system (2D, shadowcasting, cell-centric)
- `submit_gm_response` tool with typed schema including `proposed_canon` field
- Pending canon review queue and session-end review UI
- Dice rolling tool — soft accountability and commitment modes, raw rolls only
- Rules lookup tool (Mothership rules embedded)
- Caller model for multiplayer input — freeform and initiative modes
- Auth (Auth.js for self-hosted)
- Basic campaign and session management
- Solo and basic multiplayer (async-first)
- Mobile-first responsive UI
- ELv2 license
- Docker Compose for self-hosted deployment
- DigitalOcean Droplet deployment target

**Deferred to later phases:** Faction/NPC agenda advancement tool, session summarization tool, image generation tool, structured rule overrides, visual maps, real-time sync

### Phase 2

- UVG and OSE system support
- Location/random table generation tool (UVG)
- Faction/NPC agenda advancement tool
- Session summarization tool
- Structured override layer for common rule variants
- Initiative mode polish
- Ably real-time for synchronous multiplayer
- Live typing preview for caller input
- Private action affordance
- Caller transfer UI polish

### Phase 3

- Infinity 2d20 and D&D 5e
- Rule module system with constraint evaluation engine
- Community rule module library
- Rules engine arithmetic layer for 5e (attack resolution, action economy, conditions)
- 2D VTT canvas renderer (renderer technology TBD — Pixi.js or BabylonJS)
- Asset management (token images, map backgrounds, S3 stub)
- AI map generation (two-step pipeline: Claude describes, compiler generates grid data)
- Sub-cell geometry layer implementation
- **SaaS infrastructure begins** (Clerk, Stripe, S3, EntitlementsService, RLS)

### Phase 4+

- Full VTT feature set
- 3D renderer with STL support (separate private repo)
- Creator economy / Stripe Connect (if demand justifies)
- Additional system support based on user demand
- Campaign Manager evaluation (separate product or Unicorn module — decide when Phase 3 is complete)

---

## App Name

**Zoltar** — from the fortune teller machine in *Big* (1988). A mysterious machine that knows things you don't, dispenses fate on demand, and has an uncanny relationship with wish fulfillment. The reference is recognizable without being on-the-nose.

*Not Zoltan. There is no character named Zoltan in Flash Gordon (that's Prince Vultan, played by Brian Blessed). The G.I. Joe character is Zartan. Zoltar is yours, clean.*

---

*Draft 4 adds: pending canon queue mechanic (proposed_canon field, session-end review flow); clarification on which structured overrides are backend-enforced vs Claude-enforced and what guarantees each provides; Honest Limitations section establishing product positioning against "not playing" rather than against a human GM. Repository setup and ENVIRONMENTS.md to follow in separate threads.*
