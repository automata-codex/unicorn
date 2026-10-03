# Applying the Warden's Changes

Once the tool loop finishes and the final `submit_gm_response` is in, the system must apply the response to the current game state. This proceeds in three stages:

1. Validation
2. Merging data
3. Persisting changes

## Validation

The validation stage does more than just check the response for a correct form; it makes sure that the response is valid in light of the current game state. The validator function (`apps/zoltar-be/src/session/session.validator.ts:66`) returns a four-part result:

- **`applied`** holds the new values for just the parts of the state this turn changed and can include resource pools, character state, entities, and so on. Changes are applied in order, one after another. `resourcePools` is a list, not a map, because one pool can change twice in a turn. For example, in _Mothership_, the wounds chain drives HP to zero and then resets it. The order carries information, and the schema's own description says so. Merging lays the new values over the previous state, so anything the turn didn't touch is carried forward unchanged.
- **`npcAgendas`** are sent separately. `applied` updates the game state while NPC agendas are stored in the GM context.
- **`rejections`** are data that failed the validation. A non-empty array here will trigger the single retry loop. If any rejections remain after the retry, the turn is aborted. Rejections include the dotted path to the field with the error, the value received, and a reason addressed to Claude describing the problem.
- **`thresholds`** state when pool changes have crossed a threshold for that pool and what the effect of the threshold-crossing is. Thresholds are checked as each change is applied, and only downward crossings count. For example, if an NPC takes multiple hits that take it below zero HP, that counts as the pool reaching zero even though no single step stopped at zero. Changes aren't capped: a goblin with 7 HP that takes 9 damage ends at −2, and the threshold fires with that final value.

The types of errors that the validator rejects include:

- Pools or entities that don't exist, or that Claude was never shown.
- Values out of range.
- A new flag with no trigger.
- Changes to character state that don't fit the character, like damaging armor that isn't worn.
- A change addressed to a misspelling of the player character's ID.

## Merging Data

Validated data is applied to the prior state and GM context through simple object expansion and merging. It's a pure function and performs no I/O, and it is reused by the replay functionality. The exception is that an NPC's agenda _replaces_ the NPC's current agenda rather than merging with it, which is why Claude is instructed to send the whole agenda. 

## Persisting Changes

Changes are written to the database with `applyTurnAtomic`, which is already detailed in the "[Turn Path](./turn-path.md)" article.
