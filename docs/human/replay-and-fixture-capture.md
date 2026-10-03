# Replay and Fixture Capture

Replay recreates the game state at any turn and is used to capture fixtures for the eval harness. See the spec `docs/specs/zoltar/009-m7.3-turn-state-replay-spec.md`. Its § "What Investigation Found" explains why replaying from events was chosen over saving a snapshot every turn.

Replay starts from the starting snapshot, which is recorded in the `adventure_synthesis_snapshots` table. It is stored as one row per adventure and is only written once, never updated. 

The function `reconstructStateAsOfTurn` works by first loading the turn-0 baseline. Then it folds every prior turn's validated deltas forward, using the `applyValidatedTurn` function described in "[Applying the Warden's Changes](./applying-the-wardens-changes.md)." Finally, it loads the pending canon and message history and returns its payload. Only two kinds of event feed the fold: the `state_update` events, which carry the applied changes, and the agenda changes from the winning `gm_response` or `correction`. Player actions and dice rolls are skipped. Replay reproduces history faithfully, bugs included. A replay that fixed old bugs would no longer show what the Warden actually saw.

"The state at turn N" means the state going **into** turn N: everything before it, including the player's message that starts turn N, but not the Warden's response to it. That response is the thing a replay regenerates. The sequence number you pass must be a turn's `player_action` event or the function throws.

The command `task eval:capture-fixture -- <adventure-id> <sequence-number> --tag <tag> --id <fixture-id> --output <path>` is used to capture a fixture. It uses `reconstructStateAsOfTurn` to rebuild the game state. It determines if there are any pending dice requests, finds the preceding committed turn, and finds the player entity IDs for the adventure. It then constructs the fixture, using placeholders for information that must be filled by the human author. Specifically, the player input, the assertion, and the applicability entries are all placeholders. The applicability stubs are written so the fixture fails until someone completes them.

A fixture is self-contained. It stores the rebuilt state as JSON in the file. That matters because the dev database gets wiped: once captured, a fixture no longer needs the original adventure to exist. It's the main reason fixtures are files. 

When the eval harness runs a fixture, the fixture is loaded directly into the database in a single transaction: a new campaign and adventure, the GM context, the campaign state, the messages, pending canon, and any pending dice requests. No turns are played to get there. The real `SessionService` is used to send the fixture's player input through `sendMessage`, exactly as live play would. Then it reads back everything the checks might need from the database. Once the checks are complete, the scratch adventure is removed from the database.

The `load-synthesis` script can be used to clone an adventure's turn-0 starting state so that a scenario can be replayed manually, using different inputs from the player and Warden but the same starting conditions.
