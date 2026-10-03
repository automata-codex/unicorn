# Telemetry and Playtest Review

Telemetry is recorded during a playtest adventure and then read back during review of the playtest. Almost every field in the telemetry payload was added after an investigation couldn't answer a question. Three examples:

- The `gm_context` row gets overwritten in place and keeps no history. In the 2026-08-16 playtest, nine turns overwrote an NPC's agenda, and afterward nothing could say which turns had seen the original and which had seen the replacement. So now every turn records a hash of the GM context, and the full text whenever it changes.
- The parsed response looks the same whether Claude returned a clean tool call or something went wrong on the way, and the same investigation had to guess. So the shape of the raw response is now recorded.
- I expected to change prompts between turns, so every row records the filename and hash of the Warden prompt that was used.

## Recording

The `AdventureTelemetryPayload` is defined at `apps/zoltar-be/src/session/session.telemetry.ts:187`. It stores the player message, a summary of the original request, the full parsed response, and, if a correction fired, the rejections and the corrected response. It also includes the applied state, thresholds, dice rolls, rules lookups, and other information about the turn.

The telemetry payload is built during `applyTurnAtomic` and then saved to the database during the turn transaction. A block of telemetry data is passed to `applyTurnAtomic` when it is called during the `sendMessage` loop (`apps/zoltar-be/src/session/session.service.ts:480`; see "[Turn Path](./turn-path.md)"). The data is saved to the `adventure_telemetry` table keyed by adventure and sequence number, with the payload as JSONB.

Data is stored in full, by reference, on change, or as a summary, as indicated below:

  - **In full:** the player's message, the state snapshot, and the parsed response.
  - **By reference:** the Warden prompt, as a filename and hash, because the file is in the repo.
  - **On change:** the GM context text.
  - **As a summary:** the request itself, which is only the model, block and message counts, and token usage.

## Reading

There are SQL views, `turn_log` and `correction_log`, that join `game_event` (the adventure's own record of what happened) with `adventure_telemetry`. These views are used by the `apps/zoltar-be/scripts/playtest-review.ts` script, which can be invoked with the `task playtest:review -- <adventure-id>` command. The script queries these views to render a Markdown report of the playtest. 

Older rows may be missing newer fields. Several fields are marked optional only because rows from before they existed don't have them, so anything reading telemetry has to cope with the missing fields.

The report is the durable record, as the dev database may be wiped at any point during development. 

Telemetry is also used outside playtest review. The eval harness saves each replayed turn's telemetry row with its results, and the retrieval tools (`eval:query-vocab` and `eval:retrieval-probe`) read the rules-lookup queries from there.
