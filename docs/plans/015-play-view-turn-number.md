# Play-view turn number — Implementation Plan

Two-part plan, each part sized for a single commit and a manual review.
Pause after Part 1 for review before starting Part 2.

## Why

During a playtest the reviewer takes notes as things go wrong. Without a
turn indicator in the UI those notes say "around turn 12 or 13," and
reconciling them against the database afterwards is guesswork. The goal is
that a note reading "on turn 14, X happened" resolves to exactly one turn
in `task playtest:review` output and to exactly one eval fixture
(`turn14-…`), with no counting.

This is a playtest instrument, not a player-facing feature. That framing
decides the ties below: match the review CLI exactly, and prefer showing
nothing over showing a number that might be wrong.

---

## The number, and why this one

**`turnNumber` is the 1-based ordinal of a turn's `gm_response` event,
ordered by `sequence_number`.** It is *not* the `sequence_number` itself.

This is the same number `playtest-review.render.ts:172` already prints:

```ts
renderSingleTurn(t, i + 1, correctionsBySeq.get(t.gmResponseSeq))
// → `### Turn ${turnIndex}  (sequence ${t.gmResponseSeq})`
```

where `t` iterates the `turn_log` view (one row per `gm_response`, ordered
by `gm_response_seq`). Matching it is the entire point of the feature, so
Part 1 derives the number from the same table rather than reinventing a
count.

### Verified against real playtest data — do not re-derive

Checked against `../unicorn-artifacts/zoltar/database-backups/backup_20260716174713.dump`
and the rendered report for adventure `18be155e-ae1f-4454-96ef-98b3eae0b665`.
These are facts about the data, not assumptions:

| Fact | Value |
|---|---|
| `gm_response` events | 42 |
| `### Turn N` headings in the report | 42 |
| `message` rows with `role = 'gm'` | 42 |
| `player_action` events | 42 |
| `message` rows with `role = 'player'` | 38 |
| `correction` events / superseded `gm_response` rows | 11 / 11 |

Spot-checks against the report headings: turn 14 → sequence 62, turn 19 →
86, turn 24 → 129, turn 28 → 151. All four match the ordinal over
`gm_response` events exactly. The fixture files corroborate from the other
side — `turn14-unauditable-mapping.json` carries
`sourceSequenceNumber: 59`, the `player_action` seq of that same turn
(`capture-fixture` requires a `player_action` seq, `reconstruct-state.ts:55-58`).

Four consequences that the implementation has to respect:

1. **Corrections do not create turns.** 11 turns were corrected; each still
   has exactly one `gm_response` and one `gm` message, and the superseded
   rows still consume an ordinal. Confirmed by the spot-checks above, which
   would have drifted by 11 otherwise. Do not filter on `superseded_by`.

2. **`gm` messages are 1:1 with `gm_response` events, with identical
   `created_at`.** Both are written inside `applyTurnAtomic`'s single
   transaction (`session.repository.ts:501` writes the events,
   `session.repository.ts:548` inserts the message), so both take the same
   transaction-start `now()`. Verified: zero timestamp mismatches across all
   42 pairs.

3. **`player` messages are *not* 1:1 with turns, in both directions.**
   - Eight turns (16, 20, 22, 27, 31, 33, 35, 37) have **no** player
     message. These are dice auto-advance turns: `submitDiceResult` calls
     `sendMessage` with `playerMessage: ''`, `writeTurnEvents` still writes
     a `player_action` event, but the message insert is skipped
     (`session.service.ts:241`, guarded on `playerMessage.length > 0`).
     **This is why naively counting user messages client-side does not
     work** — it undercounts, and every turn after the first auto-advance
     is silently wrong. Exactly the error this feature exists to remove.
   - Four turns (21, 23, 24, 32) have **two** player messages with
     identical content. The service persists the player message *outside*
     the turn transaction so a failed turn can be retried without
     re-typing (`session.repository.ts:482-484`); a failed turn therefore
     leaves an orphan. Both messages belong to the turn the retry
     eventually produced, and labelling both "Turn N" is correct.

4. **The opening narration is not in the `message` table.** The first row
   for the adventure is a `player` message. `Play.svelte` synthesises the
   opening entry client-side from `adventure.openingNarration`
   (`play-helpers.ts:157`, `id: 'opening'`). It precedes turn 1 and is not
   a turn, so it carries no number.

### The assignment rule

One rule covers every case above:

> A message belongs to the **earliest `gm_response` whose `created_at` is
> not before the message's own `created_at`**. If no such event exists, the
> message has no turn number.

- `gm` message → matches its own event by timestamp equality (fact 2).
- `player` message → its turn's `gm_response` is strictly later, and the
  previous turn's is strictly earlier. Verified: zero ordering violations
  across all 38 player messages.
- orphan `player` message from a failed turn → resolves forward to the
  successful retry's turn (fact 3), which is the intended reading.
- trailing `player` message with no `gm_response` after it (turn in
  flight, or a turn that never succeeded) → **null**, and the UI shows
  nothing.

This rule assumes `created_at` order agrees with `sequence_number` order
for `gm_response` events. Turns are serialised per adventure, and the
assumption holds across all 42 events in the dump, but the query below
orders by `sequence_number` for the ordinal so only the *matching* leans
on timestamps.

---

## Part 1 — Backend: derive and expose `turnNumber`

### 1.1 New repository method

Add to `session.repository.ts`. **Do not modify `getMessagesAsc`** — it
also feeds `buildMessageWindow` on the prompt path
(`session.service.ts:211`), which must not start carrying turn numbers into
Claude's context.

```ts
/**
 * Messages for the play view, each tagged with the 1-based ordinal of the
 * turn it belongs to — the same number `playtest-review.render.ts` prints
 * as `### Turn N`, so a playtest note taken against the UI resolves
 * against the review report without counting.
 *
 * Assignment: a message belongs to the earliest `gm_response` at or after
 * its own `created_at`. GM messages match their own event exactly (both
 * are written in `applyTurnAtomic`'s transaction and share its `now()`);
 * player messages resolve forward to the turn they initiate. `null` means
 * no turn followed — an in-flight turn, or one that never completed.
 *
 * See `docs/plans/015-play-view-turn-number.md` for the data this was
 * verified against, including why player messages are neither one-per-turn
 * nor at-most-one-per-turn.
 */
async listMessagesWithTurnNumber(adventureId: string): Promise<
  Array<{
    id: string;
    role: DbMessage['role'];
    content: string;
    createdAt: Date;
    turnNumber: number | null;
  }>
>
```

Query shape:

```sql
WITH turns AS (
  SELECT created_at,
         sequence_number,
         ROW_NUMBER() OVER (ORDER BY sequence_number) AS turn_number
  FROM game_event
  WHERE adventure_id = ${adventureId}
    AND event_type = 'gm_response'
)
SELECT m.id,
       m.role,
       m.content,
       m.created_at,
       (SELECT t.turn_number
          FROM turns t
         WHERE t.created_at >= m.created_at
         ORDER BY t.sequence_number ASC
         LIMIT 1) AS turn_number
FROM message m
WHERE m.adventure_id = ${adventureId}
ORDER BY m.created_at ASC
```

Note that `db.execute` does not apply Drizzle's column mapping — parse
`created_at` and `turn_number` explicitly, as `listDiceRollEvents` already
does (`session.repository.ts:283-286`).

### 1.2 Service

`SessionService.listMessages` (`session.service.ts:600`) switches to the new
repository method and adds `turnNumber: number | null` to its return type.
The existing `player`/`gm`/`system` → `user`/`assistant`/`system` role
mapping is unchanged.

### 1.3 Turn number on the POST response

`TurnPayload.message` (`session.controller.ts:45`) gains
`turnNumber: number`, populated by `serializeTurn`. Both write paths already
funnel through it — `POST /messages` and the auto-advance branch of
`POST /dice-results`.

Source the value inside `applyTurnAtomic`'s transaction, where the
just-written `gm_response` is by definition the latest:

```sql
SELECT count(*) FROM game_event
WHERE adventure_id = $1 AND event_type = 'gm_response'
```

Add it to `ApplyTurnAtomicResult` and thread it out through
`SendMessageResult`. Counting inside the transaction avoids a second
round-trip and cannot race a concurrent turn.

### 1.4 Tests

Integration (`session.repository.spec-int.ts`, `npm run test:integration`
in `apps/zoltar-be`) — seed a multi-turn adventure and assert
`turnNumber` for each of the four cases fact 3 and the rule above call out:

- a normal turn: player message and GM message both read turn N;
- an auto-advance turn (`gm_response` with no player message): the GM
  message reads turn N, and the *next* player message reads N+1 — the
  regression guard for the undercounting bug;
- a duplicated player message from a failed-then-retried turn: both rows
  read the same N;
- a trailing player message with no following `gm_response`: `null`.

Also assert that a corrected turn (a `correction` event superseding its
`gm_response`) does not consume an extra ordinal.

Unit — `serializeTurn` returns the `turnNumber` it was handed; the
`SessionService` unit test's repository mock gains the new method.

Per `CLAUDE.md`, run the integration suite against a volume wiped with
`docker compose down -v` — this query reads `game_event` ordinals, and a
warm volume can mask ordering assumptions.

---

## Part 2 — Frontend: render the turn number

Read `docs/design-system.md` before writing any code in this part.

### 2.1 Wire and timeline types

`timeline.ts`: `MessageWire` and `NarrativeTimelineEntry` both gain
`turnNumber: number | null`; `mergeTimeline` passes it through. Dice-roll
entries are unchanged — see the assumption note below.

### 2.2 `MessageBubble`

New optional prop `turnNumber?: number | null`. When non-null, render a
`Turn {n}` marker above the bubble text; when null, render nothing (no
placeholder, no dash — an unlabelled bubble is the honest rendering of
"this message is not attached to a completed turn").

Styling follows the existing metadata pattern in this component set:
`--font-size-xs`, `--color-text-ghost`, `--label-tracking`, aligned to the
same edge as the bubble it labels (right for `user`, left for `assistant`).
Confirm against `docs/design-system.md` rather than copying these tokens on
faith.

`MessageLog.svelte` passes `turnNumber={entry.turnNumber}` through.

### 2.3 The optimistic message

`Play.svelte:177` appends the player's message with a `local-` id before the
POST returns. Per the decision on this feature, it renders **unlabelled**
until the turn completes, then takes the number from the response.

Extract the stamping into a pure function in `play-helpers.ts` so it is
testable without mounting a component, per the frontend testing standard in
`CLAUDE.md`:

```ts
/**
 * Stamp a completed turn's number onto the trailing player message that
 * initiated it. The optimistic append in `postNarrative` has no turn
 * number — the backend only learns it once the turn is written — so it
 * renders unlabelled until this runs.
 *
 * Only the trailing run of unnumbered player messages is stamped: an
 * auto-advance turn has no player message at all, and must not reach back
 * and relabel an earlier one.
 */
export function stampPendingPlayerTurn(
  messages: MessageWire[],
  turnNumber: number,
): MessageWire[]
```

`applyTurn` (`Play.svelte:150`) calls it before appending the assistant
message, which carries `turn.message.turnNumber` directly.

A turn that fails leaves its optimistic message unlabelled — correct, since
no turn was recorded. It picks up the retry's number on the next successful
turn, matching the backend rule for orphaned player messages.

### 2.4 Tests

- `timeline.test.ts`: `turnNumber` survives the merge, including `null`.
- `play-helpers.test.ts`: `stampPendingPlayerTurn` stamps a trailing
  unnumbered player message; leaves already-numbered messages alone; is a
  no-op when the trailing message is an assistant message (the
  auto-advance case); is a no-op on an empty list.

---

## Assumptions worth a second look at review time

- **Dice-roll bubbles carry no turn number.** They always sit between the
  labelled player and GM bubbles of their own turn, so the turn is
  unambiguous from position, and `DiceRollTimelineEntry` already carries a
  `sequenceNumber` that would read confusingly next to a differently-scaled
  turn ordinal. Cheap to add later if the playtest notes want it.
- **Both messages of a turn are labelled**, per the decision on this
  feature. It is deliberately redundant; the redundancy is what makes a
  note taken mid-turn unambiguous.
- **No migration, no stored column.** The number is derived at read time
  from `game_event`, which means it cannot drift from what the review CLI
  prints — both read the same rows. The alternative (a `message.turn_number`
  column with a backfill) buys a cheaper query and nothing else at this
  scale.
