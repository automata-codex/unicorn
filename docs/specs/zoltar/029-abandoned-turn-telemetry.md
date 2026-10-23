# 029 — Abandoned-turn telemetry

**Status:** draft for review, 2026-10-23.
**Type:** implementation spec. No plan: the build is small enough that the
order under *What gets built* is the plan.
**Review tier:** *detailed* (turn path, and a migration).
**Origin:** Workflowy card "Keep the telemetry of a turn that exhausts the tool
loop", and the maintainer's answers of 2026-10-23. `ADR-0125` records the
storage decision.

---

## The problem

A turn that hits the 20-iteration tool-loop cap writes nothing durable. Its
`adventure_telemetry` row is written inside `applyTurnAtomic`, which only runs
once `submit_gm_response` is accepted. What the turn looked up and rolled
survives as one backend log line, the message of `SessionToolLoopError`
(`session.controller.ts:202`).

That line has the queries but not their results: no `topSimilarity`, no
`sources`. Those are what tell retrieval failing apart from the Warden asking
again about a chunk it got back but could not read. `rules-extraction-findings.md
§ S82` hit this on 2026-10-16. Two turns in a row exhausted the loop on the
Wounds and Panic tables. The finding could check retrieval only on the last
*finished* turn, because the exhausted ones had no results recorded.

A turn abandoned by an unrecoverable tool-syntax leak (`SessionToolSyntaxError`)
has the same gap. Spec 026 left it open on purpose ("Durable capture of turns
abandoned in a live playtest"). This spec closes it as well, since the same
row serves both.

## What gets built

1. **The table.** Migration `V22`, and its Drizzle definition in `db/schema.ts`.
2. **The errors carry data, not just a message.** `SessionToolLoopError` and
   `SessionToolSyntaxError` both carry what the loop had collected when it
   stopped.
3. **The write.** `sendMessage` catches either error, writes the row through
   `SessionRepository`, and rethrows the same error.

The controller, the 502 bodies, and the log lines stay as they are.

## Where the real decisions are

### 1. A separate table, not a row in `adventure_telemetry`

`adventure_telemetry` is keyed by `(adventure_id, sequence_number)`, and the
sequence number is the turn's `gm_response` event's. An abandoned turn writes
no events, so it has no sequence number of its own. The other options and why
they were declined are in `ADR-0125`. In short:

- A nullable `sequence_number` would make every reader of that table handle a
  new kind of row. One reader, `latestGmContextHash`, would quietly break,
  because Postgres sorts NULLs first in a descending sort.
- A `turn_failed` game event would give the row a real sequence number, but it
  would put a non-event into the event log that replay reads.

A separate table answers the card's "so a reader cannot take it for a finished
turn" structurally. A reader of `adventure_telemetry` cannot see this row at
all. `turn_log`, the playtest review CLI, eval-v2's `replay.ts` and
`query-vocab.core.ts` are unchanged.

```sql
CREATE TABLE abandoned_turn (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  adventure_id          uuid NOT NULL REFERENCES adventure(id) ON DELETE CASCADE,
  reason                text NOT NULL,
  after_sequence_number integer NOT NULL,
  payload               jsonb NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX abandoned_turn_adventure_idx ON abandoned_turn (adventure_id);
```

### 2. What stands in for the sequence number

`after_sequence_number` is the highest `game_event.sequence_number` for the
adventure when the row is written, or 0 if there are none. It says which turns
the failure came between: it falls after every event with that number or
lower. It is not unique, because two abandoned turns in a row share it. That
happened in `§ S82`.

It is read at write time, not at the start of the turn. Concurrent turns on one
adventure could make the two differ. That is the race the card "Refuse a second
turn while one is in flight" fixes, and this spec does not work around it.

### 3. `reason` is text, not a Postgres enum

The values are `tool_loop_exhausted` and `tool_syntax_unrecoverable`, the
controller's error codes without the `gm_` prefix. The TypeScript type is a
union. A plain text column means adding a reason later, such as a failed
correction round, needs no migration.

### 4. What the payload holds

```ts
interface AbandonedTurnPayload {
  playerMessage: string;
  snapshotSent: string;
  gmContext: { hash: string; text: string };
  wardenPrompt: WardenPromptRef;
  errorMessage: string;
  toolLoopIterations: number;
  /** One entry per iteration, as `iterationLog` builds it today. */
  iterationLog: string[];
  /** With `topSimilarity` and `sources`: the point of this spec. */
  rulesLookups: RulesLookupRecord[];
  /** Rolls made in the loop. None reached `game_event`. */
  discardedRolls: DiscardedRollRecord[];
  /** Present only when there was at least one. */
  toolSyntaxLeaks?: ToolSyntaxLeakRecord[];
}
```

- **The field names match `AdventureTelemetryPayload` where the meaning is the
  same**, so code reading both can share a type for lookups and leaks.
- **Rolls are called `discardedRolls`, not `diceRolls`.** They are the loop's
  `PendingSystemRoll`s, which have no sequence numbers because they were never
  written. The name keeps anyone from reading them as game events.
- **`gmContext` always stores its text.** Abandoned turns are rare, and they
  are excluded from the store-on-change comparison that
  `adventure_telemetry` uses. Storing the text every time means each row can
  be read without needing another row.
- **No token usage.** The loop does not collect it per iteration today.
  Collecting it would mean changing the loop for a number nobody has asked for.

### 5. Both errors carry the loop's state

`runInnerToolLoop` already collects `rulesLookups`, `executedRolls`,
`iterationLog` and `toolSyntaxLeaks`. When it throws, it drops all but the leaks
and a string. Both error classes gain a field with the loop's collected state,
and the loop fills it at each throw.

`SessionToolSyntaxError` is also thrown from the correction pass, after the loop
has returned. There the service already has the loop's result, so it fills the
field from that.

eval-v2's `run.ts` keeps reading `err.leaks`, which stays. It does not read the
new table. Its scratch campaigns are deleted after each rep, and the rows go
with them through the cascade.

### 6. The write must never replace the real error

The write happens outside any transaction, after the turn has already failed.
If it throws, the service logs that at error level and rethrows the *original*
error. The player gets the same 502 either way. A failure to record a failure
must not show up as a different failure.

## Tests

- **Integration** (`session.service.spec-int.ts`, mocked Anthropic client, real
  database):
  - A turn that exhausts the loop writes one `abandoned_turn` row with reason
    `tool_loop_exhausted`. Its lookups carry `topSimilarity` and `sources`,
    its rolls are in `discardedRolls`, and no `adventure_telemetry` row or
    game event is written.
  - A turn abandoned by a leak in the loop writes one row with reason
    `tool_syntax_unrecoverable` and its leaks.
  - So does a turn abandoned by a leak in the correction pass, and that row
    also has the loop's lookups.
  - `after_sequence_number` equals the adventure's highest event sequence
    number.
  - If the write fails, the original error class still reaches the caller.
- **Unit** (`session.tool-loop.spec.ts`): the error's new field carries what
  the loop collected.
- **Schema:** none. The payload is a TypeScript interface, like
  `AdventureTelemetryPayload`, not a Zod schema.

## Not in this version

- **Showing abandoned turns in the playtest review output.** The maintainer's
  call, 2026-10-23. Until then they are read with psql:
  `SELECT * FROM abandoned_turn WHERE adventure_id = …`.
- **Failed correction rounds** (`SessionCorrectionError`). Same shape of gap. A
  new `reason` value covers it later with no migration.
- **Persisting the player's message as a game event.** It is in the payload,
  but the turn still did not happen.
- **eval-v2 reading the table.** It has the error object already.
- **Keeping the dice request open when the turn answering it fails.** That is
  a separate card on the same failure path.

## What would make this wrong

- **Abandoned turns stop being rare.** The text-every-row rule for `gmContext`
  assumes a handful per playtest. If they become common, switch to
  store-on-change.
- **Someone needs failed turns in sequence with finished ones in one query.**
  That takes a `UNION` across the two tables on `after_sequence_number`, which
  is clumsy. If it becomes routine, a view like `turn_log` is the answer, not
  a change to the table.
