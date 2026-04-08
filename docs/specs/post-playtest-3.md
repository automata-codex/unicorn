# Zoltar — Playtest 3 Change Spec

*Four changes required before Playtest 4*

---

## Context

`apps/zoltar-playtest` is a frontend-only Svelte 5 SPA that calls the Anthropic API directly. It has two views: **Setup** (oracle selection, synthesis, character sheet entry) and **Play** (the session loop). The log export format is a JSON object with fields including `gmContextStructured`, `gmContextBlob`, `openingNarration`, `messages`, `turnLog`, `canonLog`, and `finalState`.

The play loop prompt structure is:

```
[GM context blob]     ← static across adventure, prompt-cached
[State snapshot]      ← current game state, sent each turn
[Rolling summary]     ← compressed prior history (not yet implemented in playtest app)
[Live message window] ← recent exchanges
```

---

## Change 1: Display Opening Narration

### Problem
The `openingNarration` field is generated correctly during the pre-play synthesis call but is never rendered to the player. Play begins without the opening scene text being shown.

### Spec
- After synthesis completes and `openingNarration` is returned, render it in the Play view before the player's first input field is shown.
- Style it identically to subsequent Warden responses — same typography, same container.
- It should not be re-sent to Claude as part of the message history (it was already generated in the pre-play call and is recorded separately).
- The log export already captures this field correctly; no change needed there.

---

## Change 2: Wire `initialState` into the State Snapshot

### Problem
The synthesis response includes a `gmContextStructured.initialState` object containing scenario-specific counters and tracked values — timers, trust levels, integrity pools, etc. This data is currently exported to the log but never loaded into the live game state. Claude therefore has no visibility into these values during play, causing continuity failures (e.g. external actors persisting past their established expiry).

### The `initialState` structure (example from Playtest 3)

```json
{
  "orbital_decay_timer": {
    "current": 9,
    "max": 9,
    "note": "Each unit represents approximately 10 minutes..."
  },
  "ember_squad_extraction_window_timer": {
    "current": 4,
    "max": 4,
    "note": "Begins counting down only after ember_squad_boarded is true..."
  },
  "maren_trust": {
    "current": 2,
    "max": 3,
    "note": "Tracks Maren's working cooperation with LX-7..."
  }
}
```

Each entry has `current`, `max`, and `note` fields. The `note` is Claude-facing — it describes the semantics of the counter and when/how it decrements.

### Spec

**Initialization:**
- On session start, copy `gmContextStructured.initialState` into a `liveState` object held in app memory.

**State snapshot construction:**
- Each turn, include the full `liveState` in the state snapshot sent to Claude, formatted as a `<scenario_state>` block:

```xml
<scenario_state>
orbital_decay_timer: 7/9 — Each unit represents approximately 10 minutes of real time. When this reaches 0, atmospheric entry begins and survival without the escape vehicle is impossible. Decrements every 10 minutes of in-fiction time regardless of player action.

ember_squad_extraction_window_timer: 2/4 — Begins counting down only after ember_squad_boarded is true. Each unit represents 10 minutes. When this reaches 0, Ember Squad's extraction window closes — their shuttle departs with or without them, and they become dangerously unpredictable. Decrements every 10 minutes after boarding.

maren_trust: 2/3 — Tracks Maren's working cooperation with LX-7. 3 = openly cooperative, 2 = cautious but aligned, 1 = withholding, 0 = actively working against LX-7.
</scenario_state>
```

Format: `key: current/max — note` on one line per entry. Omit `max` for entries where `max` is null or not meaningful.

**Mutation:**
- Claude's `submit_gm_response` tool call includes a `state_changes` field. Extend this to allow `scenario_state_updates`: a flat object of key → new `current` value.
- The playtest app applies these updates to `liveState` after each turn.
- Claude is responsible for decrementing counters in accordance with the `note` semantics. The playtest app does not attempt to auto-decrement — it only applies what Claude explicitly sets.

**Log export:**
- Add a `scenarioStateHistory` array to the log export: one entry per turn recording the `liveState` values at the end of that turn.

---

## Change 3: `world_facts` Scratchpad

### Problem
Specific facts established in narration — spatial measurements, named attributes, physical descriptions — live only in the fiction. They are not reliably available to Claude on subsequent turns, causing contradictions (e.g. a corridor described as "eight meters" on Turn 3, "four meters" on Turn 11).

### Spec

**New field in `submit_gm_response`:**
Add a `world_facts` field to the tool schema:

```typescript
world_facts?: Record<string, string>
```

Each entry is a short key and a concrete value. Examples:

```json
{
  "corridor_module1_module2_length": "approximately eight meters",
  "module3_comms_array_distance": "twelve meters from hatch",
  "centrifuge_status": "still spinning, nothing inside"
}
```

**Persistence:**
- Maintain a `worldFacts` object in app memory, initialized empty.
- After each turn, merge any `world_facts` from Claude's response into `worldFacts`. Keys are additive — Claude can update a value by writing to the same key again.

**State snapshot:**
- Include `worldFacts` in the state snapshot each turn as a `<world_facts>` block, only when non-empty:

```xml
<world_facts>
corridor_module1_module2_length: approximately eight meters
module3_comms_array_distance: twelve meters from hatch
centrifuge_status: still spinning, nothing inside
</world_facts>
```

**Warden prompt instruction:**
Add to the Warden prompt (system-specific or general layer, whichever is appropriate):

> When you establish a specific physical measurement, named spatial attribute, or concrete environmental detail for the first time, commit it to `world_facts` using a descriptive key. On subsequent descriptions of the same feature, read from `world_facts` rather than re-estimating.

**Log export:**
- Add `worldFactsHistory` to the log export: one entry per turn recording the `worldFacts` state at end of turn.

---

## Change 4: Prompt Version Management

### Problem
Iterating on the Warden prompt requires either editing it in-code (making side-by-side comparison across versions difficult) or manual copy-paste (error-prone, no automatic association between prompt version and session log).

### Spec

**File structure:**
Create `apps/zoltar-playtest/prompts/` containing one file per prompt layer:

```
apps/zoltar-playtest/prompts/
  general-warden-v1.txt
  mothership-v1.txt
```

Each file is plain text — the raw prompt content for that layer. Version is in the filename.

**Setup view:**
Add two dropdowns to the Setup screen, one per layer:

- **General Warden prompt** — lists all `general-warden-*.txt` files in `prompts/`
- **System prompt (Mothership)** — lists all `mothership-*.txt` files in `prompts/`

Default selection: highest version number in each list. The selected filenames (e.g. `general-warden-v1.txt`, `mothership-v1.txt`) are displayed as confirmation.

The Setup view already has oracle selection and character sheet entry; these dropdowns can live in a collapsible "Prompt Configuration" section to keep the default experience clean.

**Log export:**
Add a `promptVersions` field to the log export:

```json
{
  "promptVersions": {
    "generalWarden": "general-warden-v1.txt",
    "system": "mothership-v1.txt"
  },
  "promptText": {
    "generalWarden": "<full text of general-warden-v1.txt>",
    "system": "<full text of mothership-v1.txt>"
  }
}
```

Include **both** the filename and the full text. The filename enables quick identification; the full text makes the log self-contained — prompt content can be recovered from the log without needing the source files.

**Session construction:**
Concatenate the selected prompt layers in order (general Warden first, system-specific second) to form the system prompt sent to Claude. No other changes to how the session is constructed.
