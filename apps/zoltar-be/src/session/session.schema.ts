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
export const rollDiceInputSchema = z.object({
  notation: z.string(),
  purpose: z.string(),
});

export const rollDiceOutputSchema = z.object({
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
