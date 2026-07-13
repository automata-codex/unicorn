# Playtest Review: Snapshot Campaign

**Adventure ID:** 00000000-0000-0000-0000-000000000030
**Campaign ID:** 00000000-0000-0000-0000-000000000020
**Game system:** Mothership
**Turns:** 3
**Date range:** 2026-04-24T12:00:20Z — 2026-04-24T12:01:50Z

## Warden prompts used

- `mothership-m7.txt` (hash `f6093ebd`) — seq 2, seq 5, seq 11

## Turns

### Turn 1  (sequence 2)

**Warden:** `mothership-m7.txt` (hash `f6093ebd`)

**Player:**
> I check the airlock.

**Warden response:**
> You approach the inner hatch. The indicator panel is dark.

**Dice rolls:**
_(none)_

**Rules lookups:**
- `"airlock operation procedure"` — 0 results ⚠️

**Applied state changes:**
- flag `airlock_inspected` → true (Player examined the airlock controls)

**Thresholds crossed:**
_(none)_

**Warden notes:** "Player is circling — hint next turn if they stall."

**Token usage:** 1,500 prompt / 420 completion — 2 tool loop iterations

### Turn 2  (sequence 5)

**Warden:** `mothership-m7.txt` (hash `f6093ebd`)

**Player:**
> I force the door.

**Warden response:**
> You throw your shoulder into the door — it flexes but holds. Reinforced.

**Dice rolls:**
_(none)_

**Rules lookups:**
_(none)_

**Applied state changes:**
- pool `dr_chen_hp` → current 8 / 10
- fact `inner_door` → "reinforced composite, not a standard airlock latch"

**Thresholds crossed:**
_(none)_

**Warden notes (post-correction):** "Post-correction ruling: door is reinforced, not locked."

**Token usage:** 1,900 prompt / 510 completion — 1 tool loop iteration

**Correction fired:**

- Rejections: 1
  - `stateChanges.resourcePools.ghost_hp` unknown resource pool (received: {"delta":-3})
- Original narration:
  > The lock shatters under your palm.
- Corrected narration:
  > You throw your shoulder into the door — it flexes but holds. Reinforced.
- Correction tokens: 2,100 prompt / 220 completion

### Turn 3  (sequence 11)

**Warden:** `mothership-m7.txt` (hash `f6093ebd`)

**Player:**
> I try to calm myself.

**Warden response:**
> Your breathing hitches. The hum of the fluorescents feels like it is inside your skull.

**Dice rolls:**
- [system] `1d100` — Panic check — stress threshold crossed: [73] → total 73
- [system] `1d10` — Panic table roll: [6] → total 6

**Rules lookups:**
- `"panic table result 6"` — 2 results, top sim 0.890

**Applied state changes:**
- pool `dr_chen_stress` → current 4 / 20

**Thresholds crossed:**
- `dr_chen_stress` reached 4 — Panic check required — 1d100 vs stress

**Token usage:** 2,400 prompt / 310 completion — 4 tool loop iterations

## Correction events

### Correction at gm_response seq 5 (correction seq 6)

**Rejections (1):**
- `stateChanges.resourcePools.ghost_hp` unknown resource pool (received: {"delta":-3})

**Original narration:**
> The lock shatters under your palm.

**Corrected narration:**
> You throw your shoulder into the door — it flexes but holds. Reinforced.

**Correction tokens:** 2,100 prompt / 220 completion

## Summary

- **Total turns:** 3
- **Total corrections:** 1 (33%)
- **Total token usage:** 5,800 prompt / 1,240 completion
- **Mean tool loop iterations:** 2.33
- **Rules lookups with zero results:**  ← M7.2 ingestion priority signal
  - `"airlock operation procedure"` × 1
- **Warden notes digest:**
  - _turn 1_: "Player is circling — hint next turn if they stall."
  - _turn 2 (correction)_: "Post-correction ruling: door is reinforced, not locked."

## Prompt texts

### `mothership-m7.txt` (recorded hash `f6093ebd`)

```
Fixture Warden prompt.

Body paragraph.
```
