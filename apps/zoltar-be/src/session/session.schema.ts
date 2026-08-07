import { z } from 'zod';

/**
 * Claude's per-turn response. Claude must call `submit_gm_response` exactly
 * once to complete every turn — see `docs/tools.md`. The backend routes each
 * field of this response to the appropriate write path; in M5 the routing is
 * deferred (this payload is parsed and returned to the caller but not applied
 * to state — M6 owns validation and write).
 */
export const submitGmResponseSchema = z.object({
  playerText: z.string(),

  stateChanges: z
    .object({
      resourcePools: z
        .record(z.string(), z.object({ delta: z.number().int() }))
        .optional(),

      entities: z
        .record(
          z.string(),
          z.object({
            visible: z.boolean().optional(),
            status: z.string().optional(),
          }),
        )
        .optional(),

      // Only flags introduced during play carry a trigger. For existing
      // flags, submit only the new value.
      flags: z
        .record(
          z.string(),
          z.union([
            z.object({ value: z.boolean() }),
            z.object({ value: z.boolean(), trigger: z.string() }),
          ]),
        )
        .optional(),

      scenarioState: z
        .record(z.string(), z.object({ current: z.number().int() }))
        .optional(),

      worldFacts: z.record(z.string(), z.string()).optional(),
    })
    .optional(),

  gmUpdates: z
    .object({
      npcStates: z.record(z.string(), z.string()).optional(),
      notes: z.string().optional(),
      proposedCanon: z
        .array(
          z.object({
            summary: z.string(),
            context: z.string(),
          }),
        )
        .optional(),
    })
    .optional(),

  // Player-facing dice prompts. Backend assigns IDs on receipt.
  diceRequests: z
    .array(
      z.object({
        notation: z.string(),
        purpose: z.string(),
        target: z.number().int().nullable().optional(),
      }),
    )
    .optional(),

  adventureMode: z.enum(['freeform', 'initiative']).nullable().optional(),
});

export type SubmitGmResponse = z.infer<typeof submitGmResponseSchema>;

/**
 * `roll_dice` tool — server-side execution of a dice roll. Used for
 * system-generated rolls (NPC actions, GM saves, panic checks, random
 * resolutions). The result is computed by the backend, logged to
 * `game_events`, and returned to Claude as a tool_result before narration.
 * Player-facing rolls travel through `diceRequests` on `submit_gm_response`
 * instead.
 */
/**
 * What kind of roll this is. **Descriptive, not load-bearing** — no checker
 * reads it today.
 *
 * It ships anyway, and `docs/decisions.md § rollType / gatedByRollId /
 * actingEntityId…` is the reason: adding a field to `roll_dice` changes the
 * tool schema, which invalidates every frozen eval artifact and forces a
 * fresh baseline on both models. That is affordable once. This milestone is
 * already buying one for the other two fields, so a field with a modest
 * honest purpose costs an enum here and a whole re-baseline later.
 *
 * The M7.4 record gives it no measurement role — it appears there only as a
 * hypothetical example of a field some future check might need — so this
 * enum is chosen for reporting value rather than reverse-engineered from a
 * requirement that was never written down.
 */
export const rollTypeSchema = z.enum([
  'check',
  'save',
  'damage',
  'panic_check',
  'table',
  'other',
]);

export type RollType = z.infer<typeof rollTypeSchema>;

export const rollDiceInputSchema = z.object({
  notation: z.string(),
  purpose: z.string(),
  /**
   * The entity this roll is *for*, by its state identifier (`dr_chen`,
   * `corporate_spy_1`).
   *
   * Required, because an omitted field and an absent one are the same thing
   * at scoring time. `system-rolled-player-action` exists to distinguish a
   * Warden-side roll standing in for an NPC from one standing in for the
   * player, and `actorType` is `'gm'` for both — so until this field exists
   * and is populated, that check has to bind by matching the player's name
   * in `purpose` prose, which is the last prose dependency in the structural
   * checks (`eval/checks/structural/attribution.ts`).
   */
  actingEntityId: z.string().min(1),
  rollType: rollTypeSchema,
  /**
   * The `rollId` of an earlier roll **this turn** whose outcome determined
   * whether this roll happens at all — a damage roll naming its to-hit.
   *
   * Genuinely optional: most rolls have no gate, and a required field would
   * make "ungated" indistinguishable from "the model filled in the required
   * field with something." Absent means ungated.
   *
   * This is what lets `out-of-order-resolution` adjudicate the *in-turn*
   * case. Sequence numbers record what happened first, not what depended on
   * what, and a to-hit followed by damage is correct while damage followed
   * by a to-hit is not — the same two events in either order, told apart
   * only by a dependency the payload had no way to record until now.
   */
  gatedByRollId: z.string().min(1).optional(),
});

export const rollDiceOutputSchema = z.object({
  /**
   * Per-turn identifier for this roll, allocated by the backend in issue
   * order (`roll_1`, `roll_2`, …) — underscores only, per
   * `docs/decisions.md § Entity and resource pool identifiers use
   * underscores only`.
   *
   * It has to be minted here rather than reusing the `game_events` row id,
   * because that id is a UUID generated when the turn is written — *after*
   * the tool loop ends. Claude cannot reference an identifier that does not
   * exist yet while it is choosing its next call, so `gatedByRollId` needs
   * an id that is handed back the moment a roll resolves.
   */
  rollId: z.string(),
  notation: z.string(),
  results: z.array(z.number().int()),
  modifier: z.number().int().default(0),
  total: z.number().int(),
});

export type RollDiceInput = z.infer<typeof rollDiceInputSchema>;
export type RollDiceOutput = z.infer<typeof rollDiceOutputSchema>;

/**
 * `rules_lookup` tool — semantic search against the per-system rules index.
 * Empty `results` is a valid (and in M7, expected) outcome: the index is
 * populated by the separate M7.2 ingestion pipeline.
 */
export const rulesLookupInputSchema = z.object({
  query: z.string(),
  limit: z.number().int().min(1).max(5).default(3),
});

export const rulesLookupOutputSchema = z.object({
  results: z.array(
    z.object({
      text: z.string(),
      source: z.string(),
      similarity: z.number(),
    }),
  ),
});

export type RulesLookupInput = z.infer<typeof rulesLookupInputSchema>;
export type RulesLookupOutput = z.infer<typeof rulesLookupOutputSchema>;

/**
 * Player-submitted dice result in response to a backend-issued `dice_request`.
 * The client echoes `notation` for audit-side defense-in-depth; the backend
 * re-validates it against the persisted request and rejects mismatches.
 *
 * `source` distinguishes the client path: `player_entered` means the player
 * typed raw die faces; `system_generated` means the client used the "Roll
 * for me" button (executed via the shared `@uv/game-systems` parser, same
 * code path as the backend's `roll_dice` tool).
 *
 * `autoAdvance` asks the backend to immediately run a Claude turn with no
 * narrative input once this submission resolves the last pending dice_request
 * for the adventure. The `[Dice results]` block carries the turn — the
 * tabletop equivalent of "rolled 73" triggering the GM to narrate the
 * outcome, with no player text required. Ignored if other requests are still
 * pending after this one.
 */
export const diceResultActionSchema = z.object({
  requestId: z.string().uuid(),
  notation: z.string(),
  results: z.array(z.number().int()).min(1),
  source: z.enum(['player_entered', 'system_generated']),
  autoAdvance: z.boolean().optional(),
});

export type DiceResultAction = z.infer<typeof diceResultActionSchema>;
