import {
  EntityStatusSchema,
  MOTHERSHIP_CHARACTER_POOL_NAMES,
  MothershipConditionEnum,
} from '@uv/game-systems';
import { z } from 'zod';

/**
 * The Wounds Table's five columns (PSG §29.1). Required whenever a change
 * applies a Wound, because the column — not just the `1d10` — decides the
 * result, and nothing else in the payload carries it.
 */
export const damageTypeSchema = z.enum([
  'blunt_force',
  'bleeding',
  'gunshot',
  'fire_explosives',
  'gore_massive',
]);

export type DamageType = z.infer<typeof damageTypeSchema>;

/**
 * One change to one pool.
 *
 * **`owner`, not `entityId`.** Most owners are entity ids, but pools belonging
 * to no entity take the reserved owner `_scenario` (D1-A.1), and a field named
 * `entityId` that legally holds `_scenario` contradicts itself in the one
 * document the model reads most carefully. The spec and `decisions.md` write
 * `entityId` here; both predate the owner-keyed amendment and are corrected
 * alongside this.
 *
 * Nesting the *state* does not force nesting the *payload*: self-describing
 * entries avoid string parsing on ingest without asking the Warden to generate
 * nested JSON.
 */
const resourcePoolChangeSchema = z.object({
  owner: z
    .string()
    .min(1)
    .describe(
      'The owning entity id exactly as the state snapshot spells it, or the ' +
        'reserved owner "_scenario" for a pool belonging to no entity — a ' +
        'countdown, a station subsystem.',
    ),
  pool: z
    .string()
    .min(1)
    .describe(
      'The bare pool name, never a prefix. A player character carries ' +
        `exactly these: ${MOTHERSHIP_CHARACTER_POOL_NAMES.join(', ')}. ` +
        'Other owners may carry pools outside that set — NPC timers, station ' +
        'subsystems, anything synthesis created.',
    ),
  delta: z
    .number()
    .int()
    .describe(
      "Signed change to the pool's current value. Taking a Wound is " +
        '`{ pool: "wounds", delta: 1 }` — the wounds pool counts up from ' +
        'zero toward its maximum, and this is how a Wound is recorded. Do ' +
        'not use `maxDelta` for it.',
    ),
  maxDelta: z
    .number()
    .int()
    .optional()
    .describe(
      "Signed change to the pool's ceiling. Only for effects that move the " +
        'ceiling itself — Maximum Health lost on the Death table, Maximum ' +
        'Wounds lost to Panic 19, which removes a Wound *slot*. Omit it for ' +
        'ordinary damage and healing, and for taking a Wound: that is a ' +
        '`delta` against the wounds pool, not a change to its maximum.',
    ),
  reason: z
    .string()
    .min(1)
    .describe(
      'Why this change happened, in a few words: "gunshot from contractor ' +
        'Alpha", "stress from witnessing UNIT-7 shut down". This is the ' +
        'record of what a number means; a delta without one cannot be ' +
        'audited later.',
    ),
  damageType: damageTypeSchema
    .optional()
    .describe(
      'Required when this change applies a Wound — it selects the Wounds ' +
        'Table column.',
    ),
});

export type ResourcePoolChange = z.infer<typeof resourcePoolChangeSchema>;

/**
 * One change to a character's non-pool state, discriminated on `op`.
 *
 * Every entry carries `entityId` — here it really is an entity, since a
 * scenario has no conditions.
 *
 * **No `reason` field**, unlike `resourcePools`. These are deliberately outside
 * the delta stream (D3): nobody has asked to audit a bleeding counter, and half
 * an audit mechanism is worse than none because it reads as provenance it
 * cannot supply.
 */
const characterStateChangeSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('condition_add'),
    entityId: z.string().min(1),
    condition: MothershipConditionEnum,
    parameter: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Required for exactly two Conditions and forbidden for the rest. ' +
          '"frightened" stores what frightened the character, in a few ' +
          'words. "loss_of_confidence" stores which skill loses its bonus, ' +
          'and must name a skill the character actually has.',
      ),
  }),
  z.object({
    op: z.literal('condition_remove'),
    entityId: z.string().min(1),
    condition: MothershipConditionEnum,
  }),
  z.object({
    op: z.literal('armor_damage'),
    entityId: z.string().min(1),
    apDelta: z
      .number()
      .int()
      .describe(
        'Negative, and large enough to take the armor to 0 AP. Armor Points ' +
          'are a threshold, not a pool: a hit below AP is ignored entirely ' +
          'and wears nothing down, so the only AP change damage produces is ' +
          'to zero. Send this only when one hit met or exceeded AP.',
      ),
    destroyed: z
      .literal(true)
      .describe(
        'Always true. A hit that reaches AP destroys the armor (PSG §28.3), ' +
          'and a hit that does not reach it is not a change at all. Damage ' +
          'Reduction is unaffected and still applies.',
      ),
  }),
  z.object({
    op: z.literal('roll_modifier_add'),
    entityId: z.string().min(1),
    effect: z
      .enum(['advantage', 'disadvantage'])
      .describe(
        'Mothership has no additive roll bonus. A durable penalty is ' +
          'Disadvantage — roll twice, take the worse — and a durable boon is ' +
          'Advantage. Never a number.',
      ),
    scope: z
      .enum(['all_rolls', 'stat', 'save', 'skill'])
      .describe(
        'Use "all_rolls" for the Wounds Table\'s "[-] on all rolls". The ' +
          'other three name what they apply to in `target`.',
      ),
    target: z
      .string()
      .max(100)
      .optional()
      .describe(
        'The Stat, Save or skill this applies to. Omit for "all_rolls".',
      ),
    source: z
      .string()
      .min(1)
      .max(200)
      .describe(
        'Where it came from: "Wounds Table: skull fracture". This is the key ' +
          'a later roll_modifier_remove names, so make it specific.',
      ),
  }),
  z.object({
    op: z.literal('roll_modifier_remove'),
    entityId: z.string().min(1),
    source: z
      .string()
      .min(1)
      .describe('The `source` of the modifier to clear, exactly as written.'),
  }),
  z.object({
    op: z.literal('bleeding_set'),
    entityId: z.string().min(1),
    value: z
      .number()
      .int()
      .min(0)
      .describe(
        'The total, not a delta — sum the Wounds Table grants yourself. 0 ' +
          'clears it.',
      ),
  }),
  z.object({
    op: z.literal('death_save_pending'),
    entityId: z.string().min(1),
    roundsRemaining: z
      .number()
      .int()
      .min(0)
      .nullable()
      .describe(
        'Rounds until the Death Save the Lethal Injury row sets in motion. ' +
          'null clears it. Nothing counts down for you.',
      ),
  }),
  z.object({
    op: z.literal('minimum_stress_set'),
    entityId: z.string().min(1),
    value: z
      .number()
      .int()
      .min(2)
      .describe(
        'The new floor, as an absolute value. Raising it above current ' +
          'Stress also requires a resourcePools delta in the same turn.',
      ),
  }),
]);

export type CharacterStateChange = z.infer<typeof characterStateChangeSchema>;

/**
 * Claude's per-turn response. Claude must call `submit_gm_response` exactly
 * once to complete every turn — see `docs/tools.md`. The backend routes each
 * field of this response to the appropriate write path; in M5 the routing is
 * deferred (this payload is parsed and returned to the caller but not applied
 * to state — M6 owns validation and write).
 */
export const submitGmResponseSchema = z.object({
  playerText: z
    .string()
    .describe(
      'The narration the player reads this turn, and nothing else: prose, ' +
        'ending where the narration ends. Never write a closing tag, a ' +
        'parameter tag, or any other tool-call markup inside this string — ' +
        'that markup is how a call is transmitted, not something you author, ' +
        'and a turn that appends it here loses everything after the ' +
        'narration. Every other part of the response — state changes, ' +
        'private notes, dice the player must roll — is a sibling parameter ' +
        'on this tool, sent alongside this one rather than written into it.',
    ),

  stateChanges: z
    .object({
      resourcePools: z
        .array(resourcePoolChangeSchema)
        .describe(
          'Resource pool changes, in the order they occur. An array rather ' +
            'than a map because one pool can change more than once in a turn ' +
            '— the wounds chain drives hp to zero and then resets it — and ' +
            'because the entries are applied in order against a running ' +
            'state, so their order is information.',
        )
        .optional(),

      characterState: z
        .array(characterStateChangeSchema)
        .describe(
          'Changes to per-character state that is not a pool: conditions, ' +
            'armor, bleeding, minimum stress, and a pending Death Save. ' +
            'Applied in order, like resourcePools, and rejected together ' +
            'with it — a turn writes both halves of a wounds chain or ' +
            'neither.',
        )
        .optional(),

      entities: z
        .record(
          z.string(),
          z.object({
            visible: z
              .boolean()
              .optional()
              .describe(
                'Line of sight: can a player character perceive this entity ' +
                  'right now? Changes in both directions and often — the ' +
                  'goblin ducks behind a column (false), then steps back out ' +
                  '(true). It is NOT a record of whether the players know the ' +
                  'entity exists; that is `revealed`, and losing sight of ' +
                  'something does not un-discover it.',
              ),
            revealed: z
              .boolean()
              .optional()
              .describe(
                'Discovery: have the players found out this entity exists at ' +
                  'all? One-way — once true it can never go back to false, ' +
                  'and an attempt is rejected. Set it true on the turn the ' +
                  'players first learn of the entity. To take an entity out ' +
                  'of sight afterwards, set `visible: false` and leave this ' +
                  'alone.',
              ),
            status: EntityStatusSchema.optional().describe(
              'Whether the entity is living: `alive`, `dead`, or `unknown`. ' +
                'Nothing else — it is not a place for what the entity is ' +
                'doing, feeling, or has just done. That is `npcState`.',
            ),
            npcState: z
              .string()
              .optional()
              .describe(
                'Disposition: what this NPC is doing or feeling now, in your ' +
                  'own words. "Hostile — cornered, low ammo", "Panicked, fled ' +
                  'to the galley". Free text, replaced whole each time you ' +
                  'write it, omitted when nothing changed. This is where ' +
                  "tactical and narrative detail goes. It is NOT the NPC's " +
                  'agenda — their durable motivation is ' +
                  '`gmUpdates.npcAgendas`.',
              ),
          }),
        )
        .optional()
        .describe(
          'Changes to entities already in play, keyed by entity id. An id ' +
            'that is not in play is rejected — introduce one with ' +
            '`newEntities`.',
        ),

      /**
       * Entities introduced during play, as a member of their own rather than
       * an inferred side effect of naming an unrecognized id in `entities`
       * (`ADR-0101`, spec 019 § Part 5).
       *
       * `entities` used to create an entity silently whenever it did not
       * recognize the key, which made a genuine mid-adventure NPC and a
       * mistyped or hallucinated id indistinguishable — the first is ordinary
       * play and the second silently forks the entity into two records that
       * drift apart. Creation is now stated. An id already in play is rejected
       * here, and an id not in play is rejected in `entities`; each member has
       * exactly one job.
       *
       * A create carries full initial state, so it needs no accompanying
       * `entities` update, and its id becomes a legal resource-pool owner for
       * the remainder of the same turn.
       */
      newEntities: z
        .record(
          z.string(),
          z.object({
            visible: z
              .boolean()
              .describe('Can a player character perceive it right now?'),
            revealed: z
              .boolean()
              .describe(
                'Do the players know it exists? An entity you are ' +
                  'introducing into the scene in front of them is `true`; ' +
                  'one moving unseen is `false`. `visible: true` with ' +
                  '`revealed: false` is rejected — something in sight has ' +
                  'been discovered.',
              ),
            status: EntityStatusSchema.optional().describe(
              'Living or not; defaults to `unknown`.',
            ),
            npcState: z
              .string()
              .optional()
              .describe('Starting disposition, if it has one.'),
          }),
        )
        .optional()
        .describe(
          'Entities entering play this turn, keyed by a new entity id. Use ' +
            'this for an NPC, threat or feature that did not exist before — ' +
            'creating one is something a turn has to say out loud, so naming ' +
            'an unknown id in `entities` is rejected rather than treated as ' +
            'a create. An id already in play is rejected here.',
        ),

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
    .describe(
      'Everything this turn changed about the world, as a proposal the ' +
        'backend validates before applying: pool deltas, character state, ' +
        'entity line of sight, discovery, status and disposition, new ' +
        'entities, flags, scenario counters, world facts. Send it on any ' +
        'turn that moved state, however small the move; omit it entirely on ' +
        'a turn that moved none. A change described only in the narration is ' +
        'a change that did not happen.',
    )
    .optional(),

  gmUpdates: z
    .object({
      /**
       * Amendments to an NPC's **agenda** — what they want and why, the
       * durable motivation synthesis authored. Replaces the prior value for
       * that entity outright, because an explicit agenda write is a stated
       * intent rather than an accumulation.
       *
       * This replaces `npcStates`, which was the same map under a name that
       * described the wrong thing. It merged into `narrative.npcAgendas`
       * (`ADR-0101`), so a turn recording that an NPC was rattled overwrote
       * the conditions governing their central secret and every later turn
       * read the mood note under an `npc_agendas:` heading. Nine of 58 turns
       * in the 2026-08-16 playtest wrote it, and the cartographer's agenda did
       * not survive.
       *
       * **Disposition — what an NPC is doing or feeling right now — is
       * `stateChanges.entities[id].npcState`, not this.** The two are
       * separately named and neither can reach the other's field.
       */
      npcAgendas: z
        .record(z.string(), z.string())
        .optional()
        .describe(
          "Amendments to an NPC's agenda — their durable motivation: what " +
            'they want, why, and what would make them act differently. Keyed ' +
            "by entity id, and replaces that NPC's agenda outright, so send " +
            'the whole new agenda rather than a fragment. Only send one when ' +
            'the motivation itself has genuinely changed. What an NPC is ' +
            'doing or feeling right now is NOT this — that is ' +
            '`stateChanges.entities[id].npcState`. An observation that is ' +
            'not about one specific NPC belongs in `notes`; a key naming ' +
            'neither an entity in play nor an NPC with an existing agenda is ' +
            'rejected.',
        ),
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
    .describe(
      "Warden-private updates the player never sees: how an NPC's agenda " +
        'shifted, notes for the reviewer reading this turn later, and canon ' +
        'proposals. Use notes for a ruling you are unsure about or a gap you ' +
        'had to work around — it is the only channel that reaches a human.',
    )
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
    .describe(
      'Rolls the player makes themselves, one entry per roll, issued when ' +
        'their own declared action needs resolving. The backend assigns ids ' +
        'and the results arrive on a later turn. For a roll the world makes ' +
        'rather than the player, call roll_dice instead and narrate the ' +
        'result you get back.',
    )
    .optional(),

  adventureMode: z
    .enum(['freeform', 'initiative'])
    .nullable()
    .optional()
    .describe(
      'The turn structure the adventure is running under. Send it only on a ' +
        'turn that actually changes the structure — combat starting or ' +
        'ending. Omit it on every other turn; it is not a field to restate.',
    ),
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
  /**
   * Carries the roll's meaning, not just its subject — and it is the only
   * place that meaning is recorded.
   *
   * `UNAUDITABLE-MAPPING` grades this text and read 0.00 for three runs
   * because the Warden wrote the subject alone ("gauge honesty vs
   * deflection") and settled what the number meant after seeing it. Nothing
   * had ever asked otherwise: this field had no description and
   * `mothership-m7.txt` did not mention it
   * (`docs/rules-extraction-findings.md § S36`).
   *
   * The GM roll path has no `target`, unlike the player path
   * (`diceRequests` above), so a threshold stated here is the whole record
   * of it. That asymmetry is real and out of scope for plan 021.
   */
  purpose: z
    .string()
    .describe(
      'What the roll is for AND what its results mean, fixed before the die ' +
        'is read. Name the threshold for a Stat Check or Save ("roll under ' +
        "the cartographer's Instinct 35\"), the row or range for a table, or " +
        'the bands for anything decided by die ("1d6 for what she notices: ' +
        '1-2 nothing, 3-4 distant movement, 5-6 the contractor"). A purpose ' +
        'naming only the subject leaves the number meaning whatever the ' +
        'Warden decides after seeing it.',
    ),
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
