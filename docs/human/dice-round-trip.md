# Dice Round-trip

When the Warden decides that it is time for the player to roll the dice, it includes the `diceRequests` field in the `submit_gm_response` tool call. The back-end assigns each dice request an ID, saves it as a row in the `dice_request` table during `applyTurnAtomic`, and returns it to the browser as part of the turn ending. While any dice request is pending, the player can't send a message. The front-end disables the "Send" button (the message text field stays editable), and the server refuses with a 409 `dice_pending`. This is the guard just underneath "Send message" in the turn-path diagram in "[Turn Path](./turn-path.md)."

In the browser, the player presses "Roll for me," which generates a random result for the roll, or enters the result of dice the player has rolled themself. This is a "soft accountability" design: the player is explicitly trusted to enter their roll accurately or be on their own recognizance about cheating. Regardless of how the result is generated, the dice result is sent to `POST /dice-results`.

`submitDiceResult` (`session.service.ts:551`) checks the result against the saved request, matching notation, the right number of dice, and each die in range. A mismatch is a 422, while an unknown or already-resolved request is a 409. The back-end then writes a `dice_roll` event and marks the request resolved, in its own transaction with its own sequence number. This is the one write path outside a turn that allocates a sequence number, as mentioned in the turn-path sequence-number note in "[Turn Path](./turn-path.md)."

The front-end can handle multiple dice requests for one turn. Each one is a separate HTTP request. The back-end checks that no requests are still pending before advancing.

When submitting the final dice result, the front-end sets `autoAdvance: true` if the player has not entered any text in the message field, and the server runs the next turn right away, without a player message. The dice-results block is that turn's only input. This corresponds to the "auto-advance turn" discussed in § "Player Message" in "[What Claude Sees](./what-claude-sees.md)".

If the player has entered text, every submission uses `autoAdvance: false`. Once all the rolls are resolved, the front-end submits the player's message through `POST /messages`. When that arrives, `playerDiceRollsSinceLastGmResponse` picks up the dice results, and they appear in the "[Dice results]" block described in "[What Claude Sees](./what-claude-sees.md)".
