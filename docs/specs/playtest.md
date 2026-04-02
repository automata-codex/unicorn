# Zoltar Playtest Tool — Spec

## Purpose

A throwaway browser-based tool for manually playtesting the Zoltar GM context design before any backend exists. Validates the `submit_gm_context` and `submit_gm_response` tool schemas under real play conditions, identifies what the state snapshot needs to contain, and stress-tests oracle table entries and the synthesis prompt.

This tool produces no production code. It produces confidence that the design is right before Milestone 1.2 commits to it.

---

## Location

`apps/zoltar-playtest` in the `unicorn` monorepo.

Not a workspace package — no `@uv/` namespace, no shared package imports. Standalone Vite + Svelte 5 SPA. Add to the root `package.json` workspaces array for consistency but treat it as isolated.

---

## Stack

- Vite + Svelte 5
- TypeScript
- No UI component library — plain Svelte with minimal inline styles
- No routing library — two views managed with a simple reactive flag
- `localStorage` for persistence between page refreshes
- Anthropic API called directly from the browser (no backend)

---

## Project Structure

```
apps/zoltar-playtest/
  src/
    lib/
      api.ts          # Anthropic API client and tool loop
      tools.ts        # Tool definitions (submit_gm_context, submit_gm_response, roll_dice)
      state.ts        # Reactive state store and patch logic
      snapshot.ts     # State snapshot serializer
      dice.ts         # Client-side dice execution
      storage.ts      # localStorage read/write and export/import
      oracle.ts       # Oracle table loader and random selection
    components/
      SetupView.svelte
      PlayView.svelte
      CharacterForm.svelte
      OraclePicker.svelte
      StatePanel.svelte
      MessageLog.svelte
      DicePrompt.svelte
      ErrorBanner.svelte
    App.svelte
    main.ts
  oracle-tables/
    survivors.json
    threats.json
    secrets.json
    vessel-type.json
    tone.json
  index.html
  vite.config.ts
  tsconfig.json
  package.json
```

---

## Data Model

### MothershipCharacter (static, set at setup)

```typescript
type MothershipCharacter = {
  id: string                                // entity identifier, e.g. 'dr_chen' — underscores only
  name: string
  class: 'marine' | 'android' | 'scientist' | 'teamster'
  stats: {
    strength: number                        // percentile 0-100
    speed: number
    intellect: number
    combat: number
  }
  saves: {
    fear: number                            // percentile; effective value with any modifiers baked in
    sanity: number
    body: number
    armor: number
  }
  maxHp: number
  skills: string[]                          // free-text list
}
```

### ResourcePools

All numeric resources keyed by `{entity_id}_{pool_name}`. Player character pools are pre-populated at setup with current and max values. NPC pools are created on first reference (see Pool Initialization below).

```typescript
type ResourcePool = {
  current: number
  max: number | null    // null for NPC pools initialized on first reference
}

type ResourcePools = Record<string, ResourcePool>
```

### EntityState

```typescript
type EntityState = {
  position?: { x: number; y: number }
  visible: boolean
  npcState?: string     // working memory from gmUpdates.npcStates
}
```

### Flags

```typescript
type Flags = Record<string, boolean>
```

### AppState (full reactive store)

```typescript
type AppState = {
  // Setup
  apiKey: string
  character: MothershipCharacter | null
  gmContextBlob: string | null              // narrative section from submit_gm_context, stored as JSON string
  gmContextStructured: GmContextStructured | null

  // Play
  resourcePools: ResourcePools
  wounds: Record<string, string[]>          // entity_id → wound list
  entities: Record<string, EntityState>
  flags: Flags
  npcStates: Record<string, string>         // working memory; updated from gmUpdates.npcStates
  pendingCanon: Array<{ summary: string; context: string }>

  // Conversation
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  turn: number

  // UI
  view: 'setup' | 'play'
  loading: boolean
  pendingDiceRequests: Array<{ notation: string; purpose: string; target: number | null }>
  errors: string[]
}
```

### GmContextStructured

```typescript
type GmContextStructured = {
  entities: Array<{
    id: string
    type: 'npc' | 'threat' | 'feature'
    startingPosition?: { x: number; y: number }
    visible: boolean
    tags: string[]
  }>
  initialFlags: Record<string, boolean>
  initialState: Record<string, unknown>
}
```

---

## Oracle Table Format

Matches the format defined in the design document. Tables live as JSON files in `oracle-tables/`. The app loads them at startup. Edit the JSON externally and refresh to pick up changes.

```typescript
type OracleEntry = {
  id: string
  player_text: string         // shown in the oracle picker UI
  claude_text: string         // included in the synthesis prompt
  interfaces: Array<{
    condition: string
    note: string
  }>
  tags: string[]
}

type OracleTable = {
  id: string                  // e.g. 'mothership_survivor'
  system: string
  category: string            // 'survivor' | 'threat' | 'secret' | 'vessel_type' | 'tone'
  version: string
  entries: OracleEntry[]
}
```

Each category file exports one `OracleTable`. Start each file with a minimal set of draft entries — the point of playtesting is to revise them.

---

## Pool Initialization

**Player character pools** — created at setup from the character form. Initial current value defaults to max.

```
dr_chen_hp:     { current: 14, max: 14 }
dr_chen_stress: { current: 0,  max: null }   // no meaningful max for stress
```

**NPC pools** — created on first reference from `submit_gm_response`.

- Positive delta on unknown pool → initialization. Set `current` to delta value, `max` to null. Log to the UI: `"Initialized pool xenomorph_hp = 45"`.
- Negative delta on unknown pool → error. Surface in the error banner: `"Unknown pool xenomorph_hp received negative delta — set initial value first."` Do not apply the delta. Claude has made an ordering error.

**Pool application** — apply the full delta, then check thresholds. Never pre-cap.

- Pool with `min: 0` (stress, ammo): floor at zero, surface a warning if the delta would go lower.
- Pool with `min: null` (HP): allow negative values. Surface a warning when HP reaches 0 or below: `"dr_chen_hp is at {value} — death threshold crossed."` This is the playtest stand-in for the backend's threshold notification to Claude.

---

## Snapshot Format

The state snapshot is serialized as formatted prose and prepended to each user message. The snapshot format is intentionally easy to swap — it is produced by a single function in `snapshot.ts` that takes `AppState` and returns a string. To experiment with JSON format, replace that function.

```
## Current State — Turn {n}

**{Character Name}** ({class})
HP: {current}/{max} | Stress: {current} | Wounds: {wound list or 'none'}
Stats: STR {n} | SPD {n} | INT {n} | CMB {n}
Saves: Fear {n} | Sanity {n} | Body {n} | Armor {n}
Skills: {comma-separated list}

**Resource Pools**
{pool_name}: {current}{/max if known}
(one per line; omit empty/zero pools except HP and stress)

**Entities**
{entity_id}: {visible|hidden}, position ({x}, {y}){, "{npcState}" if present}
(one per line; omit entities with no state)

**Flags**
{flag_name}: {true|false}
(omit if no flags set)

**Pending Canon**
- {summary}
(omit section if empty)
```

---

## API Integration

### Model

Use `claude-sonnet-4-6` for all API calls. Same capability tier as production, without burning Opus credits on throwaway sessions.

### System Prompt

Constructed once at session start from the GM context blob. Held in memory and passed as the `system` parameter on every API call.

```
You are the Warden for a solo Mothership adventure. You are running a horror scenario on a derelict vessel.

[GM context blob — the full narrative section from submit_gm_context, formatted as prose]

WARDEN INSTRUCTIONS:
- You must call submit_gm_response to complete every turn. Never respond with plain text.
- Call roll_dice for any roll the player does not make themselves — NPC actions, GM saves, random resolutions.
- Use diceRequests in submit_gm_response for rolls the player makes.
- All numeric resources — HP, stress, ammo — are tracked via resourcePools using delta values. Pool names follow the pattern {entity_id}_{pool_name} with underscores only.
- Before referencing an NPC's resource pool in combat, establish it with a positive delta (e.g. xenomorph_hp: { delta: 45 }). A negative delta on an unknown pool is an error.
- Entity identifiers from the GM context structured section are the canonical identifiers for all tool calls. Use them exactly.
- Panic is an event, not a pool. When stress crosses a threshold requiring a panic check, call roll_dice and narrate the result. Set a flag for any lasting panic condition.
- You know everything the Warden knows. Reveal GM context secrets only when fictionally appropriate — when the character could plausibly perceive or discover them.
- playerText is the only thing the player sees. Everything else is backend state.
```

### Message Assembly

Each turn:

```typescript
const userMessage = `${buildSnapshot(state)}\n\n${playerAction}`

const apiMessages = [
  ...state.messages,
  { role: 'user', content: userMessage }
]
```

The snapshot is prepended to every new user message. Prior turns' snapshots in the history go stale but are left in place — current state is always in the most recent user message.

### Tool Resolution Loop

The API call is a loop, not a single fetch. Claude may call `roll_dice` one or more times before calling `submit_gm_response`. The loop terminates on `submit_gm_response`.

```typescript
async function runTurn(state: AppState, playerAction: string): Promise<void> {
  const messages = assembleMessages(state, playerAction)

  while (true) {
    const response = await callAnthropicApi({
      system: buildSystemPrompt(state),
      messages,
      tools: TOOL_DEFINITIONS,
      tool_choice: { type: 'any' }
    })

    const toolUse = extractToolUse(response)

    if (toolUse.name === 'roll_dice') {
      const result = executeDiceRoll(toolUse.input.notation)
      // Append Claude's tool call and the tool result to messages
      messages.push({ role: 'assistant', content: response.content })
      messages.push({ role: 'user', content: buildToolResult(toolUse.id, result) })
      // Loop continues — Claude will respond again
    }

    else if (toolUse.name === 'submit_gm_response') {
      applyGmResponse(state, toolUse.input)
      // Append to conversation history and exit loop
      messages.push({ role: 'assistant', content: response.content })
      state.messages = messages
      state.turn++
      break
    }

    else {
      // Unexpected tool or plain text — surface as error and break
      state.errors.push(`Unexpected response type: ${toolUse?.name ?? 'plain text'}`)
      break
    }
  }
}
```

### Applying submit_gm_response

```typescript
function applyGmResponse(state: AppState, response: SubmitGmResponse): void {
  // playerText — append to message log
  appendToLog(state, 'gm', response.playerText)

  // stateChanges.resourcePools
  for (const [poolName, { delta }] of Object.entries(response.stateChanges?.resourcePools ?? {})) {
    if (!(poolName in state.resourcePools)) {
      if (delta > 0) {
        state.resourcePools[poolName] = { current: delta, max: null }
        logInfo(state, `Initialized pool ${poolName} = ${delta}`)
      } else {
        state.errors.push(`Unknown pool ${poolName} received negative delta — set initial value first.`)
      }
    } else {
      applyDelta(state, poolName, delta)
    }
  }

  // stateChanges.entities
  for (const [entityId, update] of Object.entries(response.stateChanges?.entities ?? {})) {
    state.entities[entityId] ??= { visible: true }
    if (update.position !== undefined) state.entities[entityId].position = update.position
    if (update.visible !== undefined) state.entities[entityId].visible = update.visible
  }

  // stateChanges.flags
  Object.assign(state.flags, response.stateChanges?.flags ?? {})

  // gmUpdates.npcStates
  Object.assign(state.npcStates, response.gmUpdates?.npcStates ?? {})
  // Merge npcStates into entity working memory
  for (const [entityId, npcState] of Object.entries(response.gmUpdates?.npcStates ?? {})) {
    state.entities[entityId] ??= { visible: true }
    state.entities[entityId].npcState = npcState
  }

  // gmUpdates.proposedCanon
  state.pendingCanon.push(...(response.gmUpdates?.proposedCanon ?? []))

  // diceRequests — surface in UI; assign client-side IDs
  if (response.diceRequests?.length) {
    state.pendingDiceRequests = response.diceRequests.map(r => ({ ...r }))
  }
}
```

---

## Tool Definitions

Passed to every API call. Matches the schemas in `docs/tools.md` exactly. Do not simplify or abbreviate for the playtest — the goal is to validate the real schemas.

### submit_gm_response

```typescript
{
  name: 'submit_gm_response',
  description: 'Submit the Warden\'s response for this turn. Must be called to complete every turn.',
  input_schema: {
    type: 'object',
    properties: {
      playerText: { type: 'string', description: 'Narrative text delivered to the player.' },
      stateChanges: {
        type: 'object',
        properties: {
          resourcePools: {
            type: 'object',
            additionalProperties: {
              type: 'object',
              properties: { delta: { type: 'integer' } },
              required: ['delta']
            }
          },
          entities: {
            type: 'object',
            additionalProperties: {
              type: 'object',
              properties: {
                position: {
                  type: 'object',
                  properties: {
                    x: { type: 'integer' },
                    y: { type: 'integer' }
                  },
                  required: ['x', 'y']
                },
                visible: { type: 'boolean' }
              }
            }
          },
          flags: {
            type: 'object',
            additionalProperties: { type: 'boolean' }
          }
        }
      },
      gmUpdates: {
        type: 'object',
        properties: {
          npcStates: {
            type: 'object',
            additionalProperties: { type: 'string' }
          },
          notes: { type: 'string' },
          proposedCanon: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                summary: { type: 'string' },
                context: { type: 'string' }
              },
              required: ['summary', 'context']
            }
          }
        }
      },
      diceRequests: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            notation: { type: 'string' },
            purpose: { type: 'string' },
            target: { type: ['integer', 'null'] }
          },
          required: ['notation', 'purpose']
        }
      }
    },
    required: ['playerText']
  }
}
```

### roll_dice

```typescript
{
  name: 'roll_dice',
  description: 'Execute a dice roll server-side. Use for system-generated rolls — NPC actions, GM saves, random resolutions. For player-facing rolls, use diceRequests in submit_gm_response.',
  input_schema: {
    type: 'object',
    properties: {
      notation: { type: 'string', description: 'Standard dice notation: 1d100, 2d6+3, etc.' },
      purpose: { type: 'string', description: 'Why this roll is being made. Not shown to the player.' }
    },
    required: ['notation', 'purpose']
  }
}
```

### submit_gm_context

Available only during the synthesis API call, not during play.

```typescript
{
  name: 'submit_gm_context',
  description: 'Commit the synthesized GM context to the adventure. Call this once when synthesis is complete.',
  input_schema: {
    type: 'object',
    properties: {
      narrative: {
        type: 'object',
        properties: {
          location: { type: 'string' },
          atmosphere: { type: 'string' },
          npcAgendas: { type: 'object', additionalProperties: { type: 'string' } },
          hiddenTruth: { type: 'string' },
          oracleConnections: { type: 'string' }
        },
        required: ['location', 'atmosphere', 'npcAgendas', 'hiddenTruth', 'oracleConnections']
      },
      structured: {
        type: 'object',
        properties: {
          entities: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                type: { type: 'string', enum: ['npc', 'threat', 'feature'] },
                startingPosition: {
                  type: 'object',
                  properties: { x: { type: 'integer' }, y: { type: 'integer' } },
                  required: ['x', 'y']
                },
                visible: { type: 'boolean' },
                tags: { type: 'array', items: { type: 'string' } }
              },
              required: ['id', 'type', 'visible', 'tags']
            }
          },
          initialFlags: { type: 'object', additionalProperties: { type: 'boolean' } },
          initialState: { type: 'object' }
        },
        required: ['entities', 'initialFlags', 'initialState']
      }
    },
    required: ['narrative', 'structured']
  }
}
```

---

## Dice Execution (Client-Side)

`roll_dice` is handled locally — no backend. Parse standard dice notation and execute with `Math.random()`.

```typescript
function executeDiceRoll(notation: string): RollDiceOutput {
  // Parse: NdM+K where N = count, M = sides, K = optional modifier
  const match = notation.match(/^(\d+)d(\d+)([+-]\d+)?$/)
  if (!match) throw new Error(`Invalid dice notation: ${notation}`)

  const count = parseInt(match[1])
  const sides = parseInt(match[2])
  const modifier = parseInt(match[3] ?? '0')

  const results = Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1)
  const total = results.reduce((a, b) => a + b, 0) + modifier

  return { notation, results, modifier, total }
}
```

---

## Views

### Setup View

**Step 1 — API Key**
Text input for Anthropic API key. Stored in `localStorage` (key: `zoltar_playtest_api_key`). Pre-populated on load if present. Displayed as a password field.

**Step 2 — Character Sheet**
Form fields matching `MothershipCharacter`. Entity ID field (defaults to a slugified version of the name). Class dropdown. Stat and save fields (numeric, 0–100). Max HP field. Skills as a comma-separated text input (split on save). On submit, validates that required fields are filled and the entity ID contains only underscores and alphanumerics.

On character save, initialize player resource pools:
```
{character.id}_hp:     { current: character.maxHp, max: character.maxHp }
{character.id}_stress: { current: 0, max: null }
```

**Step 3 — Oracle Tables**
Display each category (survivors, threats, secrets, vessel_type, tone) as a collapsible section. Each entry shown with its `player_text` and a toggle (active/inactive). Default: all entries active. A "Random Pick" button per category selects one active entry at random and highlights it — this is the oracle selection for synthesis.

Display the selected entry per category in a "Selected" summary at the bottom before synthesis.

**Step 4 — Synthesis**
"Synthesize Adventure" button. Constructs a synthesis prompt from selected oracle entries and character sheet, calls the Anthropic API with `submit_gm_context` as the only available tool.

Synthesis prompt structure:
```
You are synthesizing a GM context for a solo Mothership adventure.

CHARACTER:
{character sheet formatted as prose}

ORACLE RESULTS:
Survivor: {claude_text for selected survivor entry}
{interfaces for this entry if relevant}

Threat: {claude_text for selected threat entry}
{interfaces}

Secret: {claude_text for selected secret entry}
{interfaces}

Vessel Type: {claude_text for selected vessel type entry}
{interfaces}

Tone: {claude_text for selected tone entry}
{interfaces}

Synthesize a coherent GM context from these elements. Make connections between the oracle results — the interface hints suggest natural combinations. Call submit_gm_context when complete.
```

On successful `submit_gm_context` call:
- Store `narrative` as `gmContextBlob` (formatted as readable JSON)
- Store `structured` as `gmContextStructured`
- Initialize entity states from `structured.entities`
- Initialize `flags` from `structured.initialFlags`
- Show a synthesis review panel: display the full narrative section so it can be evaluated before play begins
- Show a "Begin Adventure" button

**Begin Adventure** transitions to the Play view.

---

### Play View

Two-column layout (or stacked on narrow viewports):

**Left — Message Log**
Scrollable list of turns. Each turn shows player input and GM response (`playerText`). System events (pool initializations, warnings, errors) shown inline in a distinct style. Auto-scrolls to bottom on new message.

**Right — State Panel**
Live display of current state. Sections: Character (HP bar, stress, wounds), Resource Pools (all non-zero pools), Entities (all known entities with visible state and npcState), Flags (all set flags), Pending Canon (list of proposed canon entries). Each section only rendered if it has content.

Pool values shown as `{current}/{max}` if max is known, `{current}` if max is null. HP displayed as a bar when max is known.

Manual edit affordance on each pool value — click to edit current value inline. For correcting initialization errors or mid-session adjustments.

**Bottom — Input Area**
Textarea for player action. Submit button (or Cmd/Ctrl+Enter). Disabled while `loading` is true.

**Dice Prompt**
When `pendingDiceRequests` is non-empty, an overlay or inline panel replaces the normal input. Shows each pending dice request with notation, purpose, and target (if revealed). For each: a "Roll for me" button (executes client-side and fills the result) and a manual number input. Player submits all dice results together. Results are formatted as the next player action:

```
[Dice results]
Intellect save (1d100): 34
Body save (1d100): 71
```

After dice submission the pending requests are cleared.

**Error Banner**
Dismissible banner at the top of the play view. Accumulates errors (unknown pool with negative delta, unexpected API response, parse failures). Each error shown with a dismiss button.

**Header Controls**
- Export State button — downloads current `AppState` as JSON
- Import State button — file picker, loads a previously exported state
- Export Message Log button — downloads the full conversation as plain text (for session review)

---

## Persistence

`localStorage` keys:

| Key                       | Contents                   |
|---------------------------|----------------------------|
| `zoltar_playtest_api_key` | API key string             |
| `zoltar_playtest_state`   | Serialized `AppState` JSON |

State is written to `localStorage` after every turn and after every state edit. On page load, state is read from `localStorage` and restored. If no saved state, start at the setup view.

Export/import uses the same `AppState` JSON shape as `localStorage`. Import replaces the entire state and navigates to the appropriate view based on `state.view`.

---

## Error Handling

All API calls wrapped in try/catch. Errors displayed in the error banner, never swallowed silently.

Specific cases:
- **API key missing** — prompt in the setup view before any API call is allowed
- **API error (4xx/5xx)** — display status and message in error banner, re-enable input
- **Unknown pool, negative delta** — error banner, delta not applied
- **Unexpected tool call or plain text response** — error banner, turn loop broken
- **Dice notation parse failure** — error banner, roll not executed

---

## What to Observe During Playtesting

Track these questions across sessions. Document findings before starting 1.2 work.

- Is the GM context rich enough to sustain a full session? Where does it feel thin?
- Does the `claude_text` for each oracle entry produce strong, specific output or generic output?
- Are the interface hints doing work? Which combinations are they helping with?
- How long does the GM context get in practice? Measure token count.
- Are the `submit_gm_response` stateChanges correct turn to turn, or does Claude drift from entity identifiers?
- Does Claude establish NPC pools correctly before referencing them in combat?
- Which fields of the structured section turn out to be necessary? Which are unused?
- Are there state changes Claude wants to make that the schema doesn't accommodate?
