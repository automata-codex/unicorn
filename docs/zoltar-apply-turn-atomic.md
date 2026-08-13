| #  | Table                 | Op     | Condition           | Notable fields    | Depends on                                             | Source                                         |
|----|-----------------------|--------|---------------------|-------------------|--------------------------------------------------------|------------------------------------------------|
| 1  | `campaign_state`      | update | always              | `data`            |                                                        | `session.repository.ts:applyTurnAtomic`        |
| 2  | `adventure`           | select | always              | `id`              | 1 by lock-ordering convention                          | `session.events.ts:nextSequenceNumber`         |
| 3  | `game_event`          | select | always              | `sequence_number` | 2                                                      | `session.events.ts:nextSequenceNumber`         |
| 4  | `game_event`          | insert | always              | `player_action`   | 3 (base seq)                                           | `session.events.ts:writeTurnEvents`            |
| 5  | `game_event`          | insert | per system roll     | `dice_roll`       | 4 (shared `seq` counter)                               | `session.events.ts:writeTurnEvents`            |
| 6  | `game_event`          | insert | always              | `gm_response`     | 5 (shared `seq` counter)                               | `session.events.ts:writeTurnEvents`            |
| 7  | `game_event`          | insert | correction          | `correction`      | 6 (shared `seq` counter)                               | `session.events.ts:writeTurnEvents`            |
| 8  | `game_event`          | update | correction          | `supersededBy`    | 6 (target row id) + 7 (`supersededBy` value)           | `session.events.ts:writeTurnEvents`            |
| 9  | `game_event`          | insert | always              | `state_update`    | 7 (shared `seq` counter)                               | `session.events.ts:writeTurnEvents`            |
| 10 | `dice_request`        | insert | player dice rolls   |                   | 6 (`gmResponseSeq` → `issuedAtSequence`)               | `session.repository.ts:insertDiceRequests`     |
| 11 | `pending_canon`       | insert | pending canon       | `pending`         | 6 (`gmResponseSeq` → `sequenceNumber`)                 | `canon.repository.ts:insertPendingCanon`       |
| 12 | `pending_canon`       | update | auto-promote = true | `promoted`        | 11                                                     | `canon.repository.ts:autoPromoteCanon`         |
| 13 | `gm_context`          | update | always              | `blob`            |                                                        | `session.repository.ts:applyTurnAtomic`        |
| 14 | `message`             | insert | always              | `content`         |                                                        | `session.repository.ts:applyTurnAtomic`        |
| 15 | `adventure_telemetry` | insert | always              | `payload`         | 5 (`diceRollSequences`) + 6 (`gmResponseSeq` join key) | `session.telemetry.ts:writeAdventureTelemetry` |
| 16 | `adventure`           | update | status = `ready`    | `status`          | 2                                                      | `session.repository.ts:applyTurnAtomic`        |
| 17 | `game_event`          | select | always              | `gm_response`     | 6                                                      | `session.repository.ts:applyTurnAtomic`        |
