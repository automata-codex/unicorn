# M7 — Tools (`roll_dice` & `rules_lookup`)

**Spec status:** Claude Code handoff
**Depends on:** M6 complete (`SessionService.sendMessage` applying validated state, writing `game_events`, routing `pending_canon`, writing `adventure_telemetry`; play view shipping message log, input, character status strip, threshold banner)

---

## Goal

Wire dice and rules lookup into the play loop. After M6 the outer turn is closed but Claude improvises mechanics from training data and any roll that happens is narrated rather than executed. After M7:

- Claude can call `roll_dice` server-side for system-generated rolls (NPC actions, GM saves, panic checks, random table resolutions). Results are computed in the backend, written to `game_events` as `dice_roll` rows with `roll_source = 'system_generated'`, and returned to Claude as tool results before narration.
- Claude can call `rules_lookup` to retrieve rules text from a per-system pgvector index, instead of confabulating mechanics from training data.
- Claude may call either tool multiple times per turn before finally calling `submit_gm_response` (the inner tool-use loop).
- Player-facing rolls travel through `diceRequests` on the outbound HTTP response; the player submits results via a `diceResult` action, which writes a `dice_roll` event with `roll_source = 'player_entered'`.
- The play view grows a dice-entry affordance: a "Roll for me" button (client-side execution mirroring the backend parser) and raw-roll manual entry fields, matching the soft-accountability design in `docs/zoltar-design-doc.md § Dice Rolling Modes`.

### M7's relationship to playtesting

M7 is the first milestone where the loop is closed enough to be worth playtesting against — dice resolve, rules_lookup is wired. The wrinkle: the Mothership `rules_chunk` index will be **empty** at the end of M7. Ingestion is scoped to the sibling milestone **M7.2 — Rules Ingestion Pipeline**, which runs the Python pipeline against a Mothership PDF and populates `rules_chunk`.

Playing against an empty index for Mothership is a deliberate experiment, not a limitation to route around. Mothership is a slim ruleset and well-represented in Claude's training data; a playtest run where `rules_lookup` consistently returns `{ results: [] }` surfaces where Claude's confabulation holds and where it drifts. That evidence is the right input to M7.2's priorities — which parts of the rulebook need to be in the index first, what chunk granularity matters, whether heading-aware chunking is sufficient. Shipping ingestion before playtest means guessing at those priorities.

M7.1 (playtest review tooling) is scoped to earn its keep against M7 runs — empty index or no, M7 produces enough signal to review. M7.2 lands after playtest feedback informs it.

**What ships in M7:**

- `roll_dice` and `rules_lookup` Zod schemas and `Anthropic.Tool` registrations in `apps/zoltar-be/src/session/session.tools.ts`.
- Dice notation parser in `@uv/game-systems` (`dice.ts`), consumed by both the backend handler and the frontend "Roll for me" affordance.
- `DiceService` in the backend: server-side execution, `game_events` write path for `dice_roll` rows.
- `VoyageService` — a thin wrapper around Voyage AI for query-time embedding (`input_type="query"`). Document-mode embedding for ingestion is used in M7.2 but not exercised in M7 runtime.
- `RulesLookupService` — pgvector cosine-similarity search against `rules_chunk` filtered by `system_id`, with explicit empty-result handling (the expected path in M7 until M7.2 ingests data).
- Inner tool-use loop in `SessionService.sendMessage`: `tool_choice: { type: "any" }`, bounded iteration count, routes `roll_dice` and `rules_lookup` tool calls back to Claude as tool results until `submit_gm_response` lands.
- `diceRequests` persistence: backend assigns UUIDs to entries returned on `submit_gm_response`, persists them in a new `dice_request` table, and resolves them on a subsequent `diceResult` action submission.
- `POST …/actions` grows a `diceResult` action branch: writes a `dice_roll` event with `roll_source = 'player_entered'`, threads the result into the next turn's player input construction.
- Frontend `DicePrompt` component on the play view: "Roll for me" vs. manual raw-roll entry, blocks narrative submission while dice are pending, visually distinct rendering of dice events in the message log.
- Warden system prompt additions describing when to use `roll_dice` vs. `diceRequests`, when to call `rules_lookup`, and how to proceed gracefully when `rules_lookup` returns nothing.
- `adventure_telemetry.payload.diceRolls` populated with one entry per executed roll; new `rulesLookups` array capturing queries and retrieved chunk IDs (which will mostly be empty in M7 and worth tracking as a signal for M7.2).
- **Rename:** `submit_gm_response.playerRolls` → `submit_gm_response.diceRequests` to align backend with `docs/tools.md`, `docs/api.md`, and the playtest prototype. Details in the Documentation Corrections section.

**What does not ship in M7 (deferred by design):**

- **Rules ingestion pipeline (Python, marker → chunk → Voyage-embed → SQL insert) — M7.2.** The runtime plumbing is in place in M7; the content that populates `rules_chunk` lands in M7.2, prioritized by what M7 playtesting reveals.
- Caller role enforcement on `diceResult` action submission — M8. Any campaign member may submit a dice result in M7.
- Initiative mode and `advance_initiative` handling — M8.
- `caller_transfer` handling on `submit_gm_response` — M8.
- Structured override layer (crit ranges, rest rules, spell systems) — Phase 2+.
- Commitment mode UI behaviour (hidden target until roll committed) — surfaced via data (`target: null`) but not visually differentiated in M7; the soft-accountability UI covers both modes adequately for Phase 1.
- Pre-built SRD rules indexes for 5e / OSE — Phase 2+, per `docs/rules-ingestion.md § Per-system posture`.
- Query-string caching of common rules lookups — deferred until latency is observed to be a problem at Phase 1 scale.
- Rolling summary — still deferred per `docs/DECISIONS.md`.
- Playtest review tooling (SQL views, CLI markdown report) — M7.1.

---

## Done When

1. `roll_dice` and `rules_lookup` appear in the `SESSION_TOOLS` array, with Zod-derived JSON schemas matching `docs/tools.md`.
2. A `submit_gm_response` round-trip that does not require a roll still works exactly as it did in M6 (regression check).
3. Claude can chain `roll_dice` and `rules_lookup` calls before issuing `submit_gm_response`. The inner loop terminates once `submit_gm_response` arrives or once the iteration cap is hit (hard 502 with a distinct error code on cap exhaustion).
4. Every `roll_dice` tool call writes exactly one `dice_roll` row to `game_events` with `roll_source = 'system_generated'` and the correct `actor_type`, before Claude's narration references it.
5. `rules_lookup` returns the top-N chunks for a given system, ranked by cosine similarity. Against an empty `rules_chunk` table (the M7 default), it returns `{ results: [] }` without error, and Claude proceeds per the Warden-prompt guidance for empty lookups.
6. A `submit_gm_response` with non-empty `diceRequests` causes the backend to assign UUIDs, persist them to `dice_request`, and return them on the HTTP response. The next action from the frontend as a `diceResult` resolves them and clears the block on narrative input.
7. The play view renders a `DicePrompt` component when `diceRequests` is non-empty, disabling the narrative input until every pending request is resolved. `roll_dice` events and player-entered roll results both render in the message log as visually-distinct mechanical events (per Playtest 1 spec item 10).
8. `adventure_telemetry.payload.diceRolls` contains one entry per roll executed during the turn; `adventure_telemetry.payload.rulesLookups` contains one entry per lookup (with `resultCount: 0` entries preserved — they're the signal M7.2 will use to prioritize ingestion).
9. `tsc --noEmit` passes on both apps and the `@uv/game-systems` package. All new unit and integration tests green.

---

## Part 1: Tool Schemas

### 1.1 `submit_gm_response` — rename `playerRolls` to `diceRequests`

The current backend Zod schema names this field `playerRolls`. `docs/tools.md`, `docs/api.md`, and the playtest prototype all use `diceRequests`. M7 aligns the backend on the canonical name.

Update `apps/zoltar-be/src/session/session.schema.ts`:

```typescript
// Was:
// playerRolls: z.array(z.object({ ... })).optional(),

diceRequests: z.array(z.object({
  notation: z.string(),                          // standard dice notation: '1d100', '2d6+3'
  purpose:  z.string(),                          // shown to the player: 'Intellect save to interpret corrupted data'
  target:   z.number().int().nullable().optional(), // null in commitment mode
})).optional(),
```

Claude must not supply IDs; the backend assigns them after parsing the tool call (see Part 7).

**Ripple updates in the same PR:**

- `session.telemetry.ts` (`AdventureTelemetryPayload.originalResponse` and the correction response consumers — they embed `SubmitGmResponse`, so the rename flows through by inference).
- `session.telemetry.spec.ts` — rename the stubbed field.
- Any other consumer that reads `parsed.playerRolls` (grep and rename in place).
- `apps/zoltar-playtest/src/lib/tools.ts` — already uses `diceRequests`; confirm consistency only.

### 1.2 `roll_dice`

Transcribe from `docs/tools.md`. Location: `apps/zoltar-be/src/session/session.schema.ts` alongside `submitGmResponseSchema`.

```typescript
export const rollDiceInputSchema = z.object({
  notation: z.string(),  // '1d100', '2d6+3', '3d10'
  purpose:  z.string(),  // logged to game_events; not shown to the player
});

export const rollDiceOutputSchema = z.object({
  notation: z.string(),
  results:  z.array(z.number().int()),  // individual die results before modifier
  modifier: z.number().int().default(0),
  total:    z.number().int(),           // sum of results + modifier
});

export type RollDiceInput  = z.infer<typeof rollDiceInputSchema>;
export type RollDiceOutput = z.infer<typeof rollDiceOutputSchema>;
```

### 1.3 `rules_lookup`

```typescript
export const rulesLookupInputSchema = z.object({
  query: z.string(),
  limit: z.number().int().min(1).max(5).default(3),
});

export const rulesLookupOutputSchema = z.object({
  results: z.array(z.object({
    text:       z.string(),
    source:     z.string(),
    similarity: z.number(),  // cosine similarity 0–1
  })),
});

export type RulesLookupInput  = z.infer<typeof rulesLookupInputSchema>;
export type RulesLookupOutput = z.infer<typeof rulesLookupOutputSchema>;
```

### 1.4 Tool registration

Update `apps/zoltar-be/src/session/session.tools.ts`. The stale `M6 additions — not registered yet` comment is removed.

```typescript
import { zodToJsonSchema } from 'zod-to-json-schema';

import {
  rollDiceInputSchema,
  rulesLookupInputSchema,
  submitGmResponseSchema,
} from './session.schema';

import type Anthropic from '@anthropic-ai/sdk';

export const SUBMIT_GM_RESPONSE_TOOL: Anthropic.Tool = {
  name: 'submit_gm_response',
  description:
    'Submit the GM response for this turn. Call this exactly once to complete every turn. ' +
    'The narrative for the player goes in playerText; state changes are proposals the backend will validate. ' +
    'Use roll_dice for any roll the GM makes on the world\'s behalf; use diceRequests for player-facing rolls. ' +
    'Call rules_lookup before adjudicating any mechanic you are not certain about.',
  input_schema: zodToJsonSchema(submitGmResponseSchema, { $refStrategy: 'none' }) as Anthropic.Tool['input_schema'],
};

export const ROLL_DICE_TOOL: Anthropic.Tool = {
  name: 'roll_dice',
  description:
    'Execute a dice roll server-side. Use for system-generated rolls — NPC actions, GM saves, panic checks, ' +
    'random resolutions. The result is computed by the backend, logged to the audit trail, and returned to you ' +
    'before you narrate. For player-facing rolls where the player interacts with the dice, use diceRequests in ' +
    'submit_gm_response instead.',
  input_schema: zodToJsonSchema(rollDiceInputSchema, { $refStrategy: 'none' }) as Anthropic.Tool['input_schema'],
};

export const RULES_LOOKUP_TOOL: Anthropic.Tool = {
  name: 'rules_lookup',
  description:
    'Semantic search against the rules index for the active game system. Call this instead of inferring mechanics ' +
    'from memory. Query with natural language. Returns the top matching rules chunks with source citations. ' +
    'May return an empty result set if the system\'s index has not been populated; proceed with a best-effort ' +
    'ruling and note the gap in gmUpdates.notes so reviewers can catch divergence.',
  input_schema: zodToJsonSchema(rulesLookupInputSchema, { $refStrategy: 'none' }) as Anthropic.Tool['input_schema'],
};

export const SESSION_TOOLS: Anthropic.Tool[] = [
  SUBMIT_GM_RESPONSE_TOOL,
  ROLL_DICE_TOOL,
  RULES_LOOKUP_TOOL,
];
```

---

## Part 2: Dice Notation Parser

Lives in `@uv/game-systems` so the frontend can use the same parser for the "Roll for me" button, guaranteeing parity with the backend.

File: `packages/game-systems/src/dice.ts`

```typescript
export interface ParsedNotation {
  count:    number;
  sides:    number;
  modifier: number;
}

export class DiceNotationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiceNotationError';
  }
}

const NOTATION_REGEX = /^(\d+)d(\d+)([+-]\d+)?$/;

export function parseDiceNotation(notation: string): ParsedNotation {
  const match = notation.trim().match(NOTATION_REGEX);
  if (!match) {
    throw new DiceNotationError(`Invalid dice notation: ${notation}`);
  }
  const count    = parseInt(match[1], 10);
  const sides    = parseInt(match[2], 10);
  const modifier = match[3] ? parseInt(match[3], 10) : 0;

  if (count <= 0 || count > 100) {
    throw new DiceNotationError(`Dice count out of range (1–100): ${count}`);
  }
  if (![2, 3, 4, 6, 8, 10, 12, 20, 100].includes(sides)) {
    throw new DiceNotationError(`Unsupported die sides: d${sides}`);
  }
  return { count, sides, modifier };
}

export interface DiceRollResult {
  notation: string;
  results:  number[];
  modifier: number;
  total:    number;
}

/**
 * Unbiased integer in [0, sides) drawn from the platform's CSPRNG.
 *
 * Uses globalThis.crypto.getRandomValues, which is available in all modern
 * browsers and in Node 20+ (matching NestJS 11's minimum). The single entry
 * point works for both FE and BE — no platform fork.
 *
 * Rejection sampling eliminates modulo bias. For any sides value in our
 * allowlist, the rejection probability is below 2^-32, so in expectation
 * this is a single-iteration loop.
 */
export function webCryptoRandomInt(sides: number): number {
  const buffer = new Uint32Array(1);
  const maxUnbiased = Math.floor(0x1_0000_0000 / sides) * sides;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    globalThis.crypto.getRandomValues(buffer);
    if (buffer[0] < maxUnbiased) return buffer[0] % sides;
  }
}

export function executeDiceRoll(
  notation: string,
  randomInt: (sides: number) => number = webCryptoRandomInt,
): DiceRollResult {
  const { count, sides, modifier } = parseDiceNotation(notation);
  const results = Array.from({ length: count }, () => randomInt(sides) + 1);
  const total   = results.reduce((a, b) => a + b, 0) + modifier;
  return { notation, results, modifier, total };
}
```

Design notes:

- Randomness source is the Web Crypto API (`globalThis.crypto.getRandomValues`), cryptographically strong and available on both Node 20+ and every browser we care about. One function works everywhere — no FE/BE divergence, no `Math.random` fallback.
- The `randomInt` parameter is injected for tests. Its contract is "returns an unbiased integer in `[0, sides)`" — tests pass a deterministic implementation (e.g. a round-robin counter, or a fixed-sequence generator) rather than a `Math.random`-shaped `() => number`. This pushes the modulo-bias concern entirely out of the executor.
- Modulo-bias avoidance via rejection sampling: a direct `buffer[0] % sides` would bias results toward lower values when `sides` does not evenly divide `2^32`. For d100 and d20 the effect is statistically detectable at scale, even if not player-visible. The rejection loop discards values in the non-uniform tail; expected iterations per roll is `1 + ε` where `ε` is negligible.
- Bounded `count` rejects abuse (`999d100` spam) without per-call rate limits.
- The `sides` allowlist covers Mothership (d100, d20, d10, d6) plus the common polyhedrals. Extend in Phase 2 when UVG/5e land.
- `parseDiceNotation` throws `DiceNotationError` rather than returning a discriminated union — the backend handler surfaces this as a `tool_result` with `is_error: true` so Claude can recover by re-calling with corrected notation.

Exports added to `packages/game-systems/src/index.ts`: `parseDiceNotation`, `executeDiceRoll`, `webCryptoRandomInt`, `DiceNotationError`, and the types.

Unit tests at `packages/game-systems/src/dice.spec.ts`:

- Parsing: happy path, modifier handling, invalid format, out-of-range count, unsupported sides.
- Execution with a deterministic injected `randomInt` (e.g. a generator that returns `[0, 1, 2, …]`), asserting result arrays and totals are reproducible.
- `webCryptoRandomInt` statistical sanity: draw 10,000 values for d100, assert each of the 100 buckets is hit at least once and no bucket receives more than, say, 3× the mean. This is a smoke test, not a rigorous uniformity proof — it catches gross bugs (off-by-one on the rejection threshold, returning `[1, sides]` instead of `[0, sides)`), and it runs in under a second.
- Environment availability: a test that confirms `globalThis.crypto.getRandomValues` exists under vitest's default Node environment. If a future Node change removes it, fail loudly.

---

## Part 3: `DiceService` and the `dice_roll` Write Path

### 3.1 Service

File: `apps/zoltar-be/src/dice/dice.service.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { DiceNotationError, executeDiceRoll } from '@uv/game-systems';

import type { RollDiceInput, RollDiceOutput } from '../session/session.schema';

export class DiceInvocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiceInvocationError';
  }
}

@Injectable()
export class DiceService {
  rollForGm(input: RollDiceInput): RollDiceOutput {
    try {
      return executeDiceRoll(input.notation);
    } catch (err) {
      if (err instanceof DiceNotationError) {
        throw new DiceInvocationError(err.message);
      }
      throw err;
    }
  }
}
```

The service is intentionally tiny — parsing and execution live in the shared package. The service exists so `SessionService` depends on an injectable, which keeps tests clean (mock `DiceService.rollForGm` to return fixed outputs).

Register `DiceModule` in `AppModule` and import it from `SessionModule`.

### 3.2 `game_events` write path for `dice_roll`

Dice rolls are first-class events. Every executed roll — whether system-generated from `roll_dice` or player-entered via `diceResult` — writes exactly one `dice_roll` row.

Extend `SessionRepository`:

```typescript
async insertDiceRollEvent(args: {
  tx:             DrizzleTransaction;
  adventureId:    string;
  campaignId:     string;
  sequenceNumber: number;
  actorType:      'gm' | 'player';
  actorId:        string | null;
  rollSource:     'system_generated' | 'player_entered';
  payload: {
    notation: string;
    purpose:  string;            // '' if absent (player-entered rolls reuse the originating request's purpose)
    results:  number[];
    modifier: number;
    total:    number;
    requestId?: string;          // present for player-entered rolls resolving a dice_request
  };
}): Promise<{ id: string }>;
```

The sequence-number allocator from M6 is reused. `actor_id` for system-generated rolls is null (the Warden is not a user). For player-entered rolls, `actor_id` is the submitting user's `user_id` — M8 will enforce caller-only; M7 just records whoever posted.

### 3.3 Sequence ordering within a turn

With the inner tool loop, the event sequence for a single turn grows past M6's fixed `[player_action, gm_response, state_update]` pattern:

```
sequence N:      player_action
sequence N+1:    dice_roll         ← first roll_dice call
sequence N+2:    dice_roll         ← second roll_dice call (if any)
…
sequence N+k+1:  gm_response
sequence N+k+2:  state_update      ← if stateChanges present
sequence N+k+3:  correction        ← if M6 validator-correction fired
```

`rules_lookup` does not write a `game_event`. It is captured in `adventure_telemetry.rulesLookups` only — lookups are metadata about how Claude arrived at a decision, not state changes.

Update `session.events.spec-int.ts` to cover the expanded ordering — a turn with two intervening dice rolls produces events `[player_action, dice_roll, dice_roll, gm_response, state_update]` in sequence.

---

## Part 4: Voyage AI Client

### 4.1 Service

File: `apps/zoltar-be/src/voyage/voyage.service.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type EmbeddingInputType = 'query' | 'document';

export class VoyageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VoyageError';
  }
}

@Injectable()
export class VoyageService {
  private readonly apiKey: string;
  private readonly model:  string;

  constructor(config: ConfigService) {
    this.apiKey = config.getOrThrow<string>('VOYAGE_API_KEY');
    this.model  = config.get<string>('VOYAGE_EMBED_MODEL') ?? 'voyage-3-lite';
  }

  async embed(input: string, inputType: EmbeddingInputType): Promise<number[]> {
    const response = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        input:      [input],
        model:      this.model,
        input_type: inputType,
      }),
    });
    if (!response.ok) {
      throw new VoyageError(`Voyage API error ${response.status}: ${await response.text()}`);
    }
    const json = await response.json() as { data: Array<{ embedding: number[] }> };
    if (!json.data?.[0]?.embedding) {
      throw new VoyageError('Voyage API returned no embedding');
    }
    return json.data[0].embedding;
  }
}
```

Notes:

- Uses `fetch` rather than the Voyage SDK to keep the dependency surface small — the request is a single well-documented POST.
- `input_type` matters: `query` at lookup time, `document` at ingestion time. The `document` path is exercised by M7.2's Python pipeline (separate code path, separate language); the TypeScript `VoyageService` ships in M7 with both types supported but only `query` exercised at runtime.
- `VOYAGE_EMBED_MODEL` env var overrides the default. `voyage-3-lite` matches the `vector(1024)` column declaration. M7.2 must use the same model as whatever M7 ships with — mismatched models produce meaningless cosine distances.
- Single-input calls only in M7. Batching is a future optimization.

### 4.2 Environment configuration

Update `apps/zoltar-be/src/config/env.schema.ts` (Zod env schema):

```typescript
VOYAGE_API_KEY:     z.string().min(1),
VOYAGE_EMBED_MODEL: z.string().default('voyage-3-lite'),
```

Update `.env.example` and `docs/ENVIRONMENTS.md` accordingly.

Register `VoyageModule` in `AppModule`.

### 4.3 Tests

`voyage.service.spec.ts`: mock `fetch`, assert POST body shape and both input types, assert error translation on non-2xx responses and missing-embedding responses.

No integration test against the real Voyage API in CI — that would require a live API key and budget. Alex runs one manual verification locally before merging.

---

## Part 5: `RulesLookupService` and pgvector Query

### 5.1 Service

File: `apps/zoltar-be/src/rules/rules-lookup.service.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { DbProvider } from '../db/db.provider';
import { VoyageService } from '../voyage/voyage.service';

import type { RulesLookupInput, RulesLookupOutput } from '../session/session.schema';

@Injectable()
export class RulesLookupService {
  constructor(
    private readonly db:     DbProvider,
    private readonly voyage: VoyageService,
  ) {}

  async lookup(
    systemId: string,
    input:    RulesLookupInput,
  ): Promise<RulesLookupOutput> {
    const embedding = await this.voyage.embed(input.query, 'query');
    const limit     = input.limit ?? 3;

    const rows = await this.db.drizzle.execute<{
      source:     string;
      content:    string;
      similarity: number;
    }>(sql`
      SELECT source,
             content,
             1 - (embedding <=> ${embedding}::vector) AS similarity
      FROM rules_chunk
      WHERE system_id = ${systemId}
      ORDER BY embedding <=> ${embedding}::vector
      LIMIT ${limit}
    `);

    return {
      results: rows.rows.map((r) => ({
        text:       r.content,
        source:     r.source,
        similarity: Number(r.similarity),
      })),
    };
  }
}
```

Notes:

- `<=>` is the pgvector cosine-distance operator. Similarity = `1 - distance`, returned in the result.
- The `system_id` filter is essential — cross-system contamination would serve Mothership rules for a 5e campaign.
- The Drizzle raw-SQL escape is used because Drizzle's query builder does not yet express pgvector operators cleanly. When Drizzle adds first-class pgvector support this can migrate.

### 5.2 Empty-index behaviour — the M7 default

`rules_chunk` is empty at the end of M7; M7.2 is the milestone that populates it. The empty-index path is the **expected runtime state** during M7, not an edge case. It must work cleanly.

When `rules_chunk` has zero rows for the requested `system_id`, the query returns zero rows. The service returns `{ results: [] }` to the tool consumer — no exception, no warning, no short-circuit around Voyage. The Voyage call still fires (we pay the embedding cost even on empty results) because M7 telemetry wants to record every query attempt and its response time, which becomes input to M7.2's ingestion priorities.

Claude receives the empty array as a valid tool result. The Warden prompt (Part 9) tells Claude what to do with it: proceed with a best-effort ruling and record the miss in `gmUpdates.notes` so M7.1 review tooling can highlight "rulings made without rulebook support."

### 5.3 Tests

`rules-lookup.service.spec.ts`: unit test with mocked Voyage and mocked DB, asserting SQL shape and result mapping.

`rules-lookup.service.spec-int.ts`: integration test against the test Postgres. Covers three cases:

- **Empty index:** no `rules_chunk` rows seeded, query returns `{ results: [] }` without error. This is the explicit M7 regression test — M7.2 will fill the table, but M7 must behave correctly when it's empty.
- **Populated index:** seeds three `rules_chunk` rows with known-distinct vectors (hand-chosen fixed arrays of length 1024, not Voyage-embedded — the test controls similarity ordering directly), queries, asserts ordering.
- **System filter:** seeds rows under two different `system_id` values, confirms only the requested system's rows are returned.

In all cases, `VoyageService.embed` is mocked to return a fixed vector matching whatever row the test wants ranked first.

Register `RulesModule` in `AppModule` and import from `SessionModule`.

---

## Part 6: Inner Tool-Use Loop in `SessionService`

### 6.1 Shape of the loop

M6's `sendMessage` calls Claude once, parses `submit_gm_response`, and proceeds. M7 replaces that single call with an inner loop that keeps calling Claude until `submit_gm_response` arrives, routing `roll_dice` and `rules_lookup` tool calls through their respective services in between.

```typescript
// session.service.ts (M7 shape — replaces callClaudeOnce usage inside sendMessage)

const INNER_TOOL_LOOP_CAP = 8;  // roll_dice + rules_lookup calls combined; conservative upper bound

async runInnerToolLoop(args: {
  adventureId:  string;
  campaignId:   string;
  systemId:     string;
  initialRequest: CallSessionParams;
  tx:           DrizzleTransaction;
  playerActionSequence: number;  // for allocating subsequent dice_roll sequence numbers
  actorUserId:  string | null;
}): Promise<{
  finalRequest:   CallSessionParams;
  finalResponse:  Anthropic.Message;
  finalParsed:    SubmitGmResponse;
  diceRolls:      ExecutedRollRecord[];
  rulesLookups:   RulesLookupRecord[];
  iterations:     number;
}> {
  let request = args.initialRequest;
  let iteration = 0;
  const diceRolls:    ExecutedRollRecord[] = [];
  const rulesLookups: RulesLookupRecord[]  = [];

  while (iteration < INNER_TOOL_LOOP_CAP) {
    const response = await this.anthropic.callSession(request);

    // Scan the response for tool_use blocks.
    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );

    // Preferred case: submit_gm_response is present. Parse and return.
    const submitGmCall = toolUses.find((t) => t.name === 'submit_gm_response');
    if (submitGmCall) {
      const parsed = submitGmResponseSchema.safeParse(submitGmCall.input);
      if (!parsed.success) {
        throw new SessionOutputError(
          `submit_gm_response schema validation failed: ${parsed.error.message}`,
        );
      }
      return {
        finalRequest:  request,
        finalResponse: response,
        finalParsed:   parsed.data,
        diceRolls,
        rulesLookups,
        iterations:    iteration + 1,
      };
    }

    // Otherwise: execute each tool call, append a tool_result user turn, loop.
    if (toolUses.length === 0) {
      throw new SessionOutputError(
        'Claude returned no tool_use blocks and no submit_gm_response',
      );
    }

    const toolResultBlocks: Anthropic.ContentBlockParam[] = [];
    for (const use of toolUses) {
      if (use.name === 'roll_dice') {
        const parsed = rollDiceInputSchema.safeParse(use.input);
        if (!parsed.success) {
          toolResultBlocks.push({
            type:        'tool_result',
            tool_use_id: use.id,
            is_error:    true,
            content:     `Invalid roll_dice input: ${parsed.error.message}`,
          });
          continue;
        }
        try {
          const result = this.dice.rollForGm(parsed.data);
          // Allocate next sequence, write dice_roll event INSIDE tx.
          const sequenceNumber = await this.repo.nextSequenceNumber({
            tx:          args.tx,
            adventureId: args.adventureId,
          });
          await this.repo.insertDiceRollEvent({
            tx:             args.tx,
            adventureId:    args.adventureId,
            campaignId:     args.campaignId,
            sequenceNumber,
            actorType:      'gm',
            actorId:        null,
            rollSource:     'system_generated',
            payload: {
              notation: result.notation,
              purpose:  parsed.data.purpose,
              results:  result.results,
              modifier: result.modifier,
              total:    result.total,
            },
          });
          diceRolls.push({
            source:         'system_generated',
            sequenceNumber,
            notation:       result.notation,
            purpose:        parsed.data.purpose,
            results:        result.results,
            modifier:       result.modifier,
            total:          result.total,
          });
          toolResultBlocks.push({
            type:        'tool_result',
            tool_use_id: use.id,
            content:     JSON.stringify(result),
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          toolResultBlocks.push({
            type:        'tool_result',
            tool_use_id: use.id,
            is_error:    true,
            content:     message,
          });
        }
        continue;
      }

      if (use.name === 'rules_lookup') {
        const parsed = rulesLookupInputSchema.safeParse(use.input);
        if (!parsed.success) {
          toolResultBlocks.push({
            type:        'tool_result',
            tool_use_id: use.id,
            is_error:    true,
            content:     `Invalid rules_lookup input: ${parsed.error.message}`,
          });
          continue;
        }
        try {
          const result = await this.rules.lookup(args.systemId, parsed.data);
          rulesLookups.push({
            query:          parsed.data.query,
            limit:          parsed.data.limit ?? 3,
            resultCount:    result.results.length,
            topSimilarity:  result.results[0]?.similarity ?? null,
            sources:        result.results.map((r) => r.source),
          });
          toolResultBlocks.push({
            type:        'tool_result',
            tool_use_id: use.id,
            content:     JSON.stringify(result),
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          toolResultBlocks.push({
            type:        'tool_result',
            tool_use_id: use.id,
            is_error:    true,
            content:     message,
          });
        }
        continue;
      }

      // Unknown tool name. Return an error result rather than throwing — this
      // most likely means Claude hallucinated a tool; give it a chance to recover.
      toolResultBlocks.push({
        type:        'tool_result',
        tool_use_id: use.id,
        is_error:    true,
        content:     `Unknown tool: ${use.name}`,
      });
    }

    // Append the assistant response and the tool_result user turn, then loop.
    request = {
      ...request,
      messages: [
        ...request.messages,
        { role: 'assistant', content: response.content },
        { role: 'user',      content: toolResultBlocks },
      ],
    };
    iteration++;
  }

  throw new SessionToolLoopError(
    `Inner tool loop did not terminate within ${INNER_TOOL_LOOP_CAP} iterations`,
  );
}
```

A few shape notes:

- `tool_choice` on the outer call changes from `{ type: 'tool', name: 'submit_gm_response' }` to `{ type: 'any' }`. Update `buildSessionRequest` and its spec accordingly. Claude is still forbidden from returning plain text (any tool is required), but it chooses which tool to call.
- The loop runs inside the same transaction as the rest of the turn. Voyage API latency (100–200ms per lookup) will extend transaction hold time. Acceptable at Phase 1 scale; revisit if transaction contention becomes observable.
- `INNER_TOOL_LOOP_CAP = 8` is a sanity ceiling, not a design target. A typical turn is zero or one rules lookups plus zero to two dice rolls. Hitting 8 means Claude is stuck in a loop or doing something pathological.
- A new error type `SessionToolLoopError` is translated to `502` with error code `gm_tool_loop_exhausted` so the controller and frontend can distinguish it from `gm_correction_failed`.
- The `ExecutedRollRecord` and `RulesLookupRecord` types live alongside the telemetry types in `session.telemetry.ts`.

### 6.2 Composition with the M6 correction loop

Per decision captured in this spec's elicitation pass: **the inner tool loop resolves fully before correction can fire.** The correction loop from M6 applies only to the final `submit_gm_response`.

Concretely:

1. `sendMessage` invokes `runInnerToolLoop` and receives a `finalParsed: SubmitGmResponse`.
2. The M6 validator runs against `finalParsed.stateChanges`.
3. If rejections fire, `buildCorrectionRequest` builds a one-shot correction prompt using the *final* state of the tool loop's `request` (which already contains all the intervening tool-use turns) as the base. Claude is re-prompted with `tool_choice: { type: 'tool', name: 'submit_gm_response' }` forcing a direct resubmit — no further roll/lookup round-trips on the correction pass.
4. If the correction's `submit_gm_response` validates, proceed. If not, throw `SessionCorrectionError` as in M6.

Rationale: dice and rules retrieval are inputs to Claude's reasoning. By the time `submit_gm_response` arrives, those tools have already done their work. If the proposed state changes are invalid, the fix is narrative (restate the same fiction with a valid delta), not mechanical (re-roll). Letting the correction path re-invoke `roll_dice` would also make dice-outcome manipulation possible ("that wasn't the result I wanted, reroll until validation passes") — a principle violation that's easy to avoid by construction.

Document this decision in `docs/DECISIONS.md`:

> **Correction loop does not re-enter the inner tool loop**
> When M6's validator rejects `submit_gm_response`, the M7 correction re-prompt forces `submit_gm_response` directly rather than allowing additional `roll_dice` or `rules_lookup` calls. Rolls are inputs, not retry levers; a validation rejection is a narrative/delta problem, not a mechanical one.

### 6.3 Telemetry hook

`ExecutedRollRecord[]` and `RulesLookupRecord[]` from the loop are threaded into `buildAdventureTelemetryPayload` (Part 8). They populate `payload.diceRolls` and `payload.rulesLookups` respectively.

### 6.4 Tests

`session.tool-loop.spec.ts` (new file, mocked Anthropic + mocked Dice/Rules services):

- Happy: `submit_gm_response` on the first call. No dice, no lookups. Identical to M6 behaviour.
- One `roll_dice` then `submit_gm_response`: dice event written with correct sequence, tool result returned to Claude, `submit_gm_response` parsed and returned, iteration count = 2.
- Two `roll_dice` calls in a single assistant turn then `submit_gm_response`: both events written, both results threaded back in one tool_result user turn, iteration count = 2.
- `rules_lookup` then `roll_dice` then `submit_gm_response` across three iterations: correct ordering, correct records.
- `rules_lookup` returning `{ results: [] }` (empty-index path, the M7 runtime default): threaded back correctly as an empty-array tool result, `rulesLookups` record has `resultCount: 0` and `topSimilarity: null`.
- Dice-notation error returns `is_error: true` tool_result; Claude recovers and resubmits.
- Unknown tool name returns error tool_result; Claude recovers.
- Iteration cap exhaustion throws `SessionToolLoopError`.
- Claude returning no `tool_use` block at all throws `SessionOutputError`.

`session.service.spec-int.ts`: extend M6 tests with a roll-and-respond happy path against the test Postgres; assert dice_roll event lands at the right sequence.

---

## Part 7: `dice_request` Persistence and the `diceResult` Action

### 7.1 New migration: V10 — `dice_request`

File: `infra/db/migrations/V10__dice_request.sql`

```sql
CREATE TYPE dice_request_status AS ENUM ('pending', 'resolved', 'cancelled');

CREATE TABLE dice_request (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  adventure_id             uuid        NOT NULL REFERENCES adventure(id) ON DELETE CASCADE,
  issued_at_sequence       integer     NOT NULL,   -- gm_response sequence_number that issued the request
  notation                 text        NOT NULL,
  purpose                  text        NOT NULL,
  target                   integer,                -- null in commitment mode
  status                   dice_request_status NOT NULL DEFAULT 'pending',
  resolved_at_sequence     integer,                -- dice_roll sequence_number that resolved it
  resolved_at              timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX dice_request_adventure_idx        ON dice_request (adventure_id);
CREATE INDEX dice_request_adventure_status_idx ON dice_request (adventure_id, status);
```

Drizzle schema update in the same PR; add `diceRequestStatusEnum` and the `diceRequests` table to `apps/zoltar-be/src/db/schema.ts`.

Update `docs/schema.md` with the new table definition and migration entry.

### 7.2 Write path on `submit_gm_response`

After M6's validation-and-apply block succeeds, but before returning to the controller, insert one `dice_request` row per entry in `finalParsed.diceRequests`:

```typescript
const persistedDiceRequests = await Promise.all(
  (finalParsed.diceRequests ?? []).map((req) =>
    this.repo.insertDiceRequest({
      tx,
      adventureId:       args.adventureId,
      issuedAtSequence:  gmResponseSequence,
      notation:          req.notation,
      purpose:           req.purpose,
      target:            req.target ?? null,
    }),
  ),
);
```

`persistedDiceRequests` carries the backend-assigned `id` for each entry. The HTTP response replaces the raw `diceRequests` from the tool call with this enriched list:

```typescript
return {
  playerText:    finalParsed.playerText,
  diceRequests:  persistedDiceRequests.map((r) => ({
    id:       r.id,
    notation: r.notation,
    purpose:  r.purpose,
    target:   r.target,
  })),
  applied:       validation.applied,
  thresholds:    validation.thresholds,
};
```

### 7.3 The `diceResult` action branch

`POST /api/v1/campaigns/:campaignId/adventures/:adventureId/actions` grows a second action type:

```typescript
const diceResultActionSchema = z.object({
  type:      z.literal('diceResult'),
  requestId: z.string().uuid(),
  notation:  z.string(),              // echoed from the request for audit; must match the persisted notation
  results:   z.array(z.number().int()),
  source:    z.enum(['player_entered', 'system_generated']),  // system_generated = client used "Roll for me"
});
```

`SessionService.submitDiceResult` handles this branch:

1. Load the `dice_request` row by `id`. Return 409 if missing, not pending, or scoped to a different adventure.
2. Verify `notation` matches the persisted notation. Return 422 if it does not (defensive — the client should never alter notation).
3. Re-parse `notation` with `parseDiceNotation` and verify `results.length === count` and every result is in range `[1, sides]`. Return 422 on mismatch.
4. Compute `modifier = 0` (player-entered rolls are raw; per `docs/zoltar-design-doc.md` modifiers are applied elsewhere) and `total = sum(results) + modifier`.
5. Inside a transaction: allocate next sequence number, write the `dice_roll` event with `actor_type: 'player'`, `actor_id: <user_id>`, `roll_source: <source>`, `payload.requestId: <requestId>`; update the `dice_request` row to `resolved` with `resolved_at_sequence` and `resolved_at`.
6. Do **not** call Claude. Player-submitted results accumulate until all `dice_request` rows from the most recent `gm_response` are resolved; the next call to Claude folds them into the prompt (see 7.4).

Return payload:

```typescript
{
  requestId:          string;
  accepted:           true;
  pendingRequestIds:  string[];   // remaining pending dice_requests for this adventure, if any
}
```

### 7.4 Folding player-entered results into the next Claude call

`buildSessionRequest` (from M5) is extended: before the current-turn player message, if any `dice_roll` events with `roll_source = 'player_entered'` and sequence numbers after the last `gm_response` sequence exist, they are rendered into a synthetic user message immediately before the narrative input:

```
[Dice results]
Intellect save (1d100): 34  → target 65, success
Body save (1d100): 71       → target 50, failure (narrate the consequence)
```

The snippet format follows the playtest-app convention from `docs/specs/zoltar-playtest/pre-playtest-1.md`. If multiple rolls resolved, all are listed. Target and success/failure annotations are included when `dice_request.target` is non-null.

On a turn where the player submits only narrative text (no pending dice), the block is omitted — existing M6 behaviour is preserved.

### 7.5 Tests

`dice.service.spec.ts`: parser + execution (already covered by game-systems tests).

`session.service.spec.ts`: unit, mocked DB + Anthropic — `submit_gm_response` carrying two `diceRequests` entries produces two `insertDiceRequest` calls and the response carries both backend-assigned IDs.

`session.diceResult.spec-int.ts` (new integration test):

- Happy flow: issue a request → submit a result → event written, request marked resolved.
- Submitting a `diceResult` with wrong `notation` returns 422.
- Submitting a `diceResult` with `requestId` for another adventure returns 409.
- Submitting a `diceResult` for an already-resolved request returns 409.
- Submitting only a subset of pending results blocks a narrative action (validated by a controller-level test).

`session.prompt.spec.ts`: extend — a window containing resolved player-entered dice events produces the `[Dice results]` prefix on the player message.

### 7.6 Controller guard: narrative action while dice pending

Add to the `narrative` action branch: if any `dice_request` rows for this adventure have `status = 'pending'`, return 409 with `error: 'dice_pending'` and the list of pending request IDs in the response body. The frontend already blocks submission UI-side (Part 10) — this is a defensive server-side guard matching the invariant.

---

## Part 8: Adventure Telemetry Update

The M6 `AdventureTelemetryPayload` leaves `diceRolls: never[]` and has no `rulesLookups` field. M7 populates both.

### 8.1 Updated payload shape

```typescript
export interface ExecutedRollRecord {
  source:          'system_generated' | 'player_entered';
  sequenceNumber:  number;
  notation:        string;
  purpose:         string;
  results:         number[];
  modifier:        number;
  total:           number;
  requestId?:      string;   // present only for player_entered rolls
}

export interface RulesLookupRecord {
  query:          string;
  limit:          number;
  resultCount:    number;
  topSimilarity:  number | null;  // null if zero results
  sources:        string[];        // citation strings only, not full chunk text
}

export interface AdventureTelemetryPayload {
  playerMessage:    string;
  snapshotSent:     string;
  originalRequest:  { /* unchanged from M6 */ };
  originalResponse: SubmitGmResponse;
  notes:            { original: string | null; correction: string | null };
  correction?:      { /* unchanged from M6 */ };
  applied:          ValidationResult['applied'];
  thresholds:       ThresholdCrossing[];
  diceRolls:        ExecutedRollRecord[];     // was never[] in M6
  rulesLookups:     RulesLookupRecord[];       // new in M7
  toolLoopIterations: number;                  // new in M7 — 1 if no tools called
}
```

### 8.2 Population

`buildAdventureTelemetryPayload` takes three new arguments: `diceRolls: ExecutedRollRecord[]`, `rulesLookups: RulesLookupRecord[]`, and `toolLoopIterations: number`. `SessionService.sendMessage` passes through the values collected by `runInnerToolLoop`.

Player-entered rolls submitted via `diceResult` before the current turn started landed between turns. Decision: player-entered rolls are captured in the telemetry row of the turn they resolved in — the turn whose `gm_response` references them via the `[Dice results]` prefix. `sendMessage` queries for any `dice_roll` events with `roll_source = 'player_entered'` between the last `gm_response` sequence and the current turn's `player_action`, and includes them in `diceRolls` alongside the system-generated rolls from the inner tool loop.

Rationale: telemetry is a per-turn replay artifact, and a turn that consumed player dice should show those dice in its record. Playtest review (M7.1) reads from the same row.

### 8.3 `rulesLookups` records are M7.2 ingestion priorities data

`rulesLookups` entries with `resultCount: 0` (the common case in M7) are not noise — they are the primary signal for M7.2. Every zero-result lookup is a rulebook area Claude wanted but couldn't find. M7.1's CLI report should surface these prominently. When M7.2 scopes its ingestion priorities, the top-queried missing topics drive chunking and coverage decisions.

Preserve the records faithfully: do not filter out empty-result lookups, do not downsample, do not collapse identical queries.

### 8.4 Rulebook — no chunk text in telemetry

`RulesLookupRecord` stores `sources` (citations) and `topSimilarity` but not the full retrieved `text`. Reasons:

- Telemetry rows are `jsonb` in Postgres; storing full chunk text bloats rows without marginal benefit (the query and source citations are what reviewers need to evaluate retrieval quality).
- Re-running the query against `rules_chunk` at review time produces the same chunks deterministically as long as the index has not been re-ingested.

If Phase 2 playtest review surfaces a need for full-text capture, add a `texts: string[]` field then.

### 8.5 Tests

`session.telemetry.spec.ts`: extend M6 tests.

- `diceRolls` carries one entry per executed system-generated roll, in sequence order.
- `diceRolls` includes player-entered rolls resolved between this turn and the previous `gm_response`.
- `rulesLookups` carries one entry per `rules_lookup` call, with sources captured.
- `rulesLookups` includes empty-result lookups with `resultCount: 0` and `topSimilarity: null`.
- `toolLoopIterations` matches the actual iteration count.

---

## Part 9: Warden System Prompt Additions

The Mothership Warden prompt grows a new section describing the three tools and their usage discipline. This is the Claude-facing instruction, separate from the tool description strings (which Claude also sees but which are kept short).

Add to `apps/zoltar-be/src/session/wardens/warden.mothership.ts` (or wherever the Mothership system prompt is assembled — match the current file layout):

```text
TOOLS

You have three tools available: submit_gm_response, roll_dice, and rules_lookup.
Call tools in whatever order the situation requires. Every turn must end with
exactly one call to submit_gm_response.

WHEN TO CALL roll_dice
- NPC attacks, saves, and reactions that the player does not physically roll for.
- Panic checks triggered by the fiction (stress accumulation, monstrous reveal,
  witnessing a teammate die).
- Random table resolutions (wound tables, encounter rolls, loot).
- Any outcome the world determines rather than the player — if a character is
  not pressing a button to resolve it, the Warden rolls.

Do not pre-roll dice you haven't needed yet. Do not narrate a result you have
not executed — call the tool, wait for the result, then narrate.

WHEN TO CALL diceRequests (in submit_gm_response)
- Any roll the player's character makes to resolve their own action.
- Saves the player must physically make to resist a threat (Fear save against a
  reveal, Body save against pressure loss).

Include one entry per roll the player needs to make. The player submits results
via a follow-up action; you will see those results at the top of their next
message.

WHEN TO CALL rules_lookup
- Before adjudicating any mechanic you are not certain about: panic table
  results, wound severity, combat order, recovery rules, stress thresholds.
- When the player asks a rules question you do not have a confident answer for.
- When you are about to narrate a mechanical outcome whose specific numbers
  matter — armor interaction, weapon damage, class ability effects.

Query in natural language. "panic check result of 73" outperforms "panic 73".

WHEN rules_lookup RETURNS NOTHING
The rules index may not yet contain the area you queried. An empty result is
normal, not an error. When this happens:
- Proceed with your best-effort ruling based on the fiction and what you know
  about the Mothership system.
- Keep the ruling internally consistent — if you invoke a number (save
  difficulty, damage amount, duration), use it consistently for the rest of
  the adventure.
- Add a one-line note to gmUpdates.notes: "Ruled without rulebook support:
  <topic>". This does not surface to the player; it lets a reviewer identify
  gaps.

Do not retry the same query hoping for different results. Do not narrate
reluctance to the player ("I'm not sure how this works…") — the player
experiences confident refereeing regardless of what the index contains.
```

Do not add lengthy examples inline — the Warden prompt is already long and expensive to cache. The tool description strings and this short section are sufficient; Claude interprets the rest from the tool names and descriptions.

Update the Warden prompt's prompt-cache ephemeral boundary marker so this new block is part of the cached static region.

### 9.1 Registration of the Warden prompt version

If the project tracks Warden prompt versions (per `userMemories`: "Prompt versioning: flat files with a Setup screen dropdown"), bump the Mothership Warden version to `mothership-m7` and ensure log exports capture it. If no versioning exists yet in the production backend (it exists in the playtest app), do not introduce it in M7 — add a follow-up ticket.

---

## Part 10: Frontend — Dice Entry UI

The play view needs two things: (a) a `DicePrompt` block that appears when the latest GM response carries pending `diceRequests`, blocking narrative input until every request is resolved; and (b) distinct rendering of dice-roll events in the message log so the player can see mechanical outcomes, addressing Playtest 1 spec item 10.

### 10.1 `DicePrompt.svelte`

Location: `apps/zoltar-fe/src/lib/components/DicePrompt.svelte`

Props:

```typescript
interface Props {
  requests: Array<{
    id:       string;
    notation: string;
    purpose:  string;
    target:   number | null;
  }>;
  diceMode: 'soft_accountability' | 'commitment';
  onSubmit: (results: Array<{
    requestId: string;
    notation:  string;
    results:   number[];
    source:    'player_entered' | 'system_generated';
  }>) => Promise<void>;
}
```

Layout (mobile-first, stacks on narrow viewports per the existing design system):

- Heading: "Rolls needed" with the pending count.
- One card per request:
  - `purpose` as a prominent label (e.g. "Intellect save to interpret corrupted data").
  - `notation` displayed (e.g. "Roll 1d100").
  - If `target !== null` in `soft_accountability` mode, show "vs. target N". In `commitment` mode, target is hidden regardless.
  - Two paths:
    - **Roll for me** — a primary button. On click, calls `executeDiceRoll(notation)` from `@uv/game-systems`, fills the manual-entry fields with the results (greyed out, read-only), marks `source: 'system_generated'`.
    - **Manual entry** — one numeric input per die. Explicit label: "enter the number showing on each die — modifiers applied automatically" (per `docs/zoltar-design-doc.md § Raw rolls only`). Submit enabled only when all dice have valid values (integer in `[1, sides]`).
- Footer: "Submit rolls" button, disabled until every request has a complete result.

On submit, `onSubmit` is called with one entry per request. The parent view (play route) POSTs each to `/actions` as a `diceResult` action. The UI optimistically clears the prompt and re-renders the narrative input, then reconciles on server response.

### 10.2 Play view integration

Modify `Play.svelte` (from M6):

- Hold a `$state` variable `pendingDiceRequests`, populated from the most recent `submit_gm_response` response or from server state on mount (adventure bootstrap endpoint must return any persisted `pending` `dice_request` rows).
- When `pendingDiceRequests.length > 0`, the narrative input textarea is disabled and the `DicePrompt` renders above it.
- When the last `diceResult` submission succeeds (server returns `pendingRequestIds: []`), `pendingDiceRequests` clears and the narrative input re-enables.
- Adventure bootstrap (`GET /campaigns/:id/adventures/:id`) response grows a `pendingDiceRequests` field so returning users land in the prompt if they left mid-roll. Update the controller read path accordingly.

### 10.3 Message log — rendering dice events

The message log currently renders `player` and `gm` messages (M6). M7 adds rendering for dice-roll events pulled from `game_events`.

Extend the play view's initial-load and post-turn fetch logic to also fetch `game_events` of type `dice_roll` for the current adventure. Merge them into the message log timeline by `sequence_number`.

`DiceRollBubble.svelte`:

- Visually distinct from player/GM bubbles: monospaced, muted background, inline icon or label indicating roll source (system vs player).
- Displays: `purpose` (if present), `notation`, individual results, total, and target/success-or-failure if the originating `dice_request.target` is non-null.
- Aligned left regardless of source — it's a mechanical event, not a character turn.

Example rendering:

```
● Panic check for Dr. Chen
  1d100 → [73]  total 73
```

```
● Intellect save to interpret corrupted data
  1d100 → [34]  target 65, success
```

### 10.4 "Roll for me" client-side parity

The frontend imports `parseDiceNotation` and `executeDiceRoll` from `@uv/game-systems`. The shared package guarantees notation-parsing and execution parity between the backend's `roll_dice` handler and the frontend's "Roll for me" button. No backend round-trip is required for client-side rolls — the result is submitted as part of the `diceResult` action with `source: 'system_generated'`.

### 10.5 Tests

Svelte component tests at `apps/zoltar-fe/src/lib/components/__tests__/`:

- `DicePrompt.test.ts` — renders one card per request, submit disabled until all filled, "Roll for me" populates fields, manual entry accepts valid values and rejects invalid.
- `DiceRollBubble.test.ts` — renders notation and result, distinguishes source visually, handles target/success annotations.
- `Play.svelte` integration — mounting with `pendingDiceRequests` shows the prompt; narrative input disabled; submit clears; log renders dice events interleaved with messages.

---

## Documentation Corrections

Alongside the implementation PR (or as a separate small PR landed first), these documentation or in-code discrepancies are fixed:

1. **`playerRolls` → `diceRequests` rename.** Backend Zod schema renames `playerRolls` to `diceRequests` to match `docs/tools.md`, `docs/api.md`, and the playtest prototype. Affects `session.schema.ts`, `session.telemetry.ts` (type inference), `session.telemetry.spec.ts` (stub). No behaviour change, purely naming.
2. **Stale comment in `session.tools.ts`.** The comment `// \`roll_dice\` and \`rules_lookup\` are M6 additions — not registered yet.` incorrectly cites M6. M7 registers both tools and the comment is deleted.
3. **`docs/tools.md` — tool call routing section.** The routing diagram in `docs/tools.md` already matches M7's behaviour. No change required, but verify during review that the description still reads correctly with `tool_choice: { type: 'any' }` (current text says `tool_choice: { type: "any" }` — correct, no change).
4. **`docs/api.md` — action endpoint.** `docs/api.md` already describes both narrative and diceResult action types. M7 implements them. Cross-check during review that the documented request/response shapes match the implementation.

---

## Testing Summary

Per `docs/CLAUDE.md`.

**Unit tests:**

- `packages/game-systems/src/dice.spec.ts` — parser, executor with injected `randomInt`, and a statistical sanity check on `webCryptoRandomInt` uniformity.
- `apps/zoltar-be/src/dice/dice.service.spec.ts` — service-level happy and error paths.
- `apps/zoltar-be/src/voyage/voyage.service.spec.ts` — mocked fetch, asserts request shape and error translation.
- `apps/zoltar-be/src/rules/rules-lookup.service.spec.ts` — mocked Voyage + mocked DB.
- `apps/zoltar-be/src/session/session.tool-loop.spec.ts` — the full matrix of inner-loop scenarios, including the empty-index `rules_lookup` path.
- `apps/zoltar-be/src/session/session.prompt.spec.ts` — extended for `[Dice results]` prefix.
- `apps/zoltar-be/src/session/session.telemetry.spec.ts` — extended for `diceRolls`, `rulesLookups`, `toolLoopIterations`.
- `apps/zoltar-be/src/session/session.service.spec.ts` — extended for `diceRequests` rename and dice_request persistence.

**Integration tests (backend, against test Postgres):**

- `rules-lookup.service.spec-int.ts` — three cases: empty index, populated index with known vectors, system-id filter.
- `session.service.spec-int.ts` — extended with a roll-and-respond path; dice_roll event lands at expected sequence.
- `session.events.spec-int.ts` — expanded ordering assertions (dice_roll events between player_action and gm_response).
- `session.diceResult.spec-int.ts` — end-to-end `diceResult` action flow, including rejection paths.

**Frontend tests:**

- `DicePrompt.test.ts`, `DiceRollBubble.test.ts`, `Play.svelte` integration.

**Typecheck:**

- `tsc --noEmit` passes on both apps and `@uv/game-systems`.

---

## Documentation PR checklist

All updates land in the same PR as the implementation, or as a small preceding cleanup PR where called out:

- `docs/tools.md` — no schema changes needed (already canonical); verify tool descriptions still read correctly after the Warden prompt additions. If the descriptions drift from the in-code tool descriptions after implementation, update `docs/tools.md` to match — the code is the source of truth for descriptions.
- `docs/schema.md` — add the `dice_request` table definition under a new subsection after `pending_canon`; add `V10__dice_request.sql` to the migration list.
- `docs/api.md` — verify the `diceResult` action branch, the dice_request persistence in the `/actions` response, and `pendingDiceRequests` in the adventure bootstrap response all match `docs/api.md`; update if implementation diverges.
- `docs/zoltar-design-doc.md` — no structural updates expected; dice rolling modes section already describes the M7 behaviour.
- `docs/DECISIONS.md` — three new entries:
  - "Correction loop does not re-enter the inner tool loop" (per Part 6.2).
  - "Rules lookups are not written to `game_events`" (captured in `adventure_telemetry.rulesLookups` only; lookups are metadata, not state-changing events).
  - "Rules ingestion is scoped as a separate milestone (M7.2), not a sub-part of M7" (with rationale: different language stack, independently testable, playtest evidence should drive ingestion priorities rather than precede them).
- `docs/roadmap.md`:
  - Check off M7 items as they land.
  - Add a one-line note pointing at `docs/specs/zoltar/m7-tools.md` for the spec.
  - **Insert a new M7.2 — Rules Ingestion Pipeline milestone between M7.1 and M8**, scoped to: Python ingestion pipeline under `ingestion/` (marker → chunk → Voyage-embed → SQL insert), one-time local seed of the Mothership rules chunks, fixup patch scaffolding, hash-verification step, ingestion smoke tests. Spec at `docs/specs/zoltar/m7.2-rules-ingestion.md`.
- `docs/ENVIRONMENTS.md` — add `VOYAGE_API_KEY` and `VOYAGE_EMBED_MODEL` (default `voyage-3-lite`) to the environment-variable table. These are runtime variables for `rules_lookup` query embedding; M7.2 adds ingestion-side variables separately.
- The spec itself lives at `docs/specs/zoltar/m7-tools.md`. This file is the source.

---

## Out of Scope for M7

Deferred, in scope for later milestones. Do not implement:

- **Rules ingestion pipeline — M7.2.** Python pipeline, marker extraction, heading-aware chunking, Voyage document-mode embedding, Postgres seed path, fixup patches, hash verification. Runtime plumbing ships in M7; content ships in M7.2.
- Caller role enforcement on `diceResult` action submissions — M8.
- `caller_transfer` narration and backend state change on `submit_gm_response` — M8.
- Initiative mode (`adventureMode` flip, `advance_initiative` handling) — M8.
- Structured override layer (crit ranges, rest rules, spell systems, house rules) — Phase 2+.
- Commitment mode UI differentiation (hidden target, commit-before-reveal flow) — Phase 2.
- Pre-built SRD rules indexes for 5e / OSE — Phase 2+.
- Query-string embedding cache for common lookups — defer until observed latency problem.
- Rolling summary — still deferred per `docs/DECISIONS.md`.
- `<character_attributes>` snapshot block — still deferred, no data source.
- Playtest review tooling (SQL views, CLI markdown report over `adventure_telemetry` + `game_events`) — M7.1.
- Multi-caller / multi-PC playtest flow — Phase 2 (per `docs/DECISIONS.md`, dedicated playtest not combined with mechanical coverage).
- Campaign canon promotion at adventure completion — Phase 2.

---

## Deferrals Introduced in M7

### Full-text rules chunks in telemetry

`rulesLookups` records capture `sources` and `topSimilarity` but not retrieved chunk text. Re-running the query at review time reproduces the chunks deterministically until the index is re-ingested. Add `texts: string[]` to the record if playtest review (M7.1) surfaces a need; no anticipated need in M7.

### Voyage embedding cache

Common `rules_lookup` queries (panic table, wound severity, stress thresholds) could be pre-embedded to avoid per-turn Voyage round-trips. Deferred until observed latency or cost is a problem. Phase 2 candidate.

### Warden prompt versioning in production

The playtest app tracks Warden prompt versions via a Setup dropdown. The production backend does not yet. M7 does not introduce versioning; it's a follow-up ticket (likely M7.1 or M9 depending on how playtest review surfaces the need).

### Dice outcome narrative coupling

A valid Warden response must narrate from actual roll results. Nothing enforces that Claude's narration corresponds to what `roll_dice` returned — the Warden prompt asks for this behaviourally. If playtest evidence shows narration drift (Claude rolls, then narrates a different result), a post-response consistency check could be added comparing `playerText` against dice events issued in the same turn. Deferred pending evidence that this is a real failure mode.

---

## Open Questions

1. **Dice UI visual density at 3+ concurrent requests.** Mothership panic checks sometimes cascade (Fear save → Sanity save → stress gain → another panic). If Claude routinely issues 3–4 `diceRequests` in one response, the `DicePrompt` layout needs to stay compact. Start with a vertical stack; measure during first M7 playtest.
2. **Empty-index query economics.** Every `rules_lookup` in M7 still pays the Voyage embedding cost even though it returns zero results. Cheap per call (~$0.0002 at `voyage-3-lite` rates), but across a playtest session it could add up. Acceptable for M7 because every lookup is also signal for M7.2 prioritization. Revisit after M7.2 lands and the empty-result rate drops.
3. **How empty is empty.** If Claude issues `rules_lookup` aggressively in M7 (for every mechanical decision) and every lookup returns nothing, that's lots of round-trip latency per turn for no rulebook gain. The Warden prompt tells Claude not to retry, but it doesn't throttle initial calls. If playtest turn times get painful, consider adding a per-turn rules_lookup cap (e.g. 3) separate from the overall inner tool loop cap.
