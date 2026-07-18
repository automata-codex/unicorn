import { Test } from '@nestjs/testing';
import { and, asc, eq } from 'drizzle-orm';

import { AnthropicService } from '../src/anthropic/anthropic.service';
import { AppModule } from '../src/app.module';
import { DB_TOKEN } from '../src/db/db.provider';
import * as schema from '../src/db/schema';
import { SessionService } from '../src/session/session.service';

import type { Db } from '../src/db/db.provider';
import type { SendMessageResult } from '../src/session/session.service';
import type { EvalFixture } from './fixture.schema';

/**
 * A fully-wired `SessionService` — real `AnthropicService` (a real model
 * call happens), real `WardenPromptsService` (so a prompt-variant override
 * set via `WARDEN_PROMPT_OVERRIDE_MOTHERSHIP` before calling this actually
 * takes effect), real `DiceService`/`RulesLookupService`. Bootstraps the
 * same `AppModule` the real backend uses — simpler and safer than hand-
 * picking `SessionModule`'s transitive imports, and guarantees the harness
 * exercises exactly the module graph production does.
 *
 * **Must be run through a transform that emits correct TypeScript decorator
 * metadata** (`design:paramtypes`) — plain `tsx` (esbuild) does not, and
 * every `@Injectable()` constructor-injecting a dependency by type (which is
 * all of them here) silently receives `undefined` for that parameter
 * instead, surfacing as confusing `Cannot read properties of undefined`
 * errors deep in Nest's injector. Confirmed empirically: `AnthropicService`
 * failed reliably via plain `tsx`, and `Reflect.getMetadata('design:paramtypes', AnthropicService)`
 * came back `undefined` under it — but returned the real `[ConfigService]`
 * under `@swc-node/register`. This never surfaced inside Vitest because the
 * test configs already transform via `unplugin-swc`. The `eval:harness` CLI
 * (Part 7) invokes this module via `node -r @swc-node/register -r reflect-metadata`,
 * not `tsx`, specifically because of this.
 *
 * `moduleRef.init()` (not just `.compile()`) is required so
 * `WardenPromptsService`'s `OnModuleInit` hook actually runs — Nest only
 * runs lifecycle hooks on init, not on bare compilation. No HTTP server is
 * created — `TestingModule` is a plain `NestApplicationContext` (DI +
 * lifecycle hooks only), which is all the harness needs and avoids
 * requiring an HTTP adapter package (`createNestApplication()` defaults to
 * Express, which isn't installed — the real app runs Fastify — and neither
 * is needed here).
 *
 * Reads `DATABASE_URL`/`ANTHROPIC_API_KEY`/etc. from `process.env` at the
 * moment this is called (via `ConfigService`), same as normal app startup —
 * callers that need to point this at a specific database (e.g. tests
 * wanting `zoltar_test`, not the real dev database) must set
 * `process.env.DATABASE_URL` before calling this.
 */
export interface HarnessSession {
  db: Db;
  sessionService: SessionService;
  /** Same DI-wired instance `SessionService` itself uses — Part 5's judge
   * call reuses this rather than constructing a second Anthropic client. */
  anthropicService: AnthropicService;
  close: () => Promise<void>;
}

export async function createHarnessSession(): Promise<HarnessSession> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  await moduleRef.init();
  return {
    db: moduleRef.get<Db>(DB_TOKEN),
    sessionService: moduleRef.get(SessionService),
    anthropicService: moduleRef.get(AnthropicService),
    close: () => moduleRef.close(),
  };
}

export interface SeedScratchAdventureOptions {
  /** Disambiguates concurrent/repeated runs in `campaign.name`. */
  runId: string;
  /**
   * Explicit campaign owner. Falls back to the first user row in the
   * database (same convention as `load-synthesis`'s `PLAYTEST_LOAD_USER_ID`
   * fallback) — the caller decides whether to surface `warnings` for that
   * fallback.
   */
  userId?: string;
}

export interface ScratchAdventure {
  campaignId: string;
  adventureId: string;
  playerUserId: string;
  warnings: string[];
}

/** A `message` row as it appears once round-tripped through fixture JSON. */
interface SeededMessageRow {
  role: 'player' | 'gm' | 'system';
  content: string;
  createdAt: string;
}

/** A `pending_canon` row as it appears once round-tripped through fixture JSON. */
interface SeededPendingCanonRow {
  summary: string;
  context: string;
  status: 'pending' | 'promoted' | 'discarded';
  sequenceNumber: number | null;
}

/** A `dice_request` row as it appears once round-tripped through fixture JSON. */
interface SeededDiceRequestRow {
  notation: string;
  purpose: string;
  target: number | null;
  issuedAtSequence?: number;
}

/**
 * Seeds a fully self-contained scratch campaign + adventure from a
 * fixture's frozen `seededState`, ready for `runFixtureTurn` to drive one
 * real turn through. Tagged `campaign.name = "__eval__<fixture.id>__<runId>"`
 * so scratch rows are identifiable in the database and never collide with
 * real campaigns; `teardownScratchAdventure` deletes by that campaign id.
 *
 * Does not seed `character_sheet` rows — `SessionService.sendMessage` only
 * uses them to populate `gmContextBlob.playerEntityIds`, a per-request
 * prompt-building hint (never persisted, never read by any structural or
 * judged checker). A fixture's frozen `campaignState`/`gmContextBlob`
 * already carry whatever entity data actually matters; seeding a synthetic
 * character sheet on top would be guessing at an entity id this milestone
 * has no reliable way to derive from a captured fixture.
 */
export async function seedScratchAdventure(
  db: Db,
  fixture: EvalFixture,
  opts: SeedScratchAdventureOptions,
): Promise<ScratchAdventure> {
  const warnings: string[] = [];

  const [systemRow] = await db
    .select({ id: schema.gameSystems.id })
    .from(schema.gameSystems)
    .where(eq(schema.gameSystems.slug, 'mothership'))
    .limit(1);
  if (!systemRow) {
    throw new Error(
      "game_system row with slug 'mothership' not found — the target " +
        'database needs the system seeded before running the eval harness.',
    );
  }

  let userId: string;
  if (opts.userId) {
    const [userRow] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, opts.userId))
      .limit(1);
    if (!userRow) {
      throw new Error(`user "${opts.userId}" does not match any user row.`);
    }
    userId = userRow.id;
  } else {
    const [firstUser] = await db
      .select({ id: schema.users.id, email: schema.users.email })
      .from(schema.users)
      .orderBy(asc(schema.users.id))
      .limit(1);
    if (!firstUser) {
      throw new Error(
        'No users exist in the database. Pass an explicit userId or create a user first.',
      );
    }
    userId = firstUser.id;
    warnings.push(
      'no userId given — defaulting scratch campaign ownership to first ' +
        `user: ${firstUser.id} <${firstUser.email ?? 'no-email'}>`,
    );
  }

  const campaignName = `__eval__${fixture.id}__${opts.runId}`;

  const { campaignId, adventureId } = await db.transaction(async (tx) => {
    const [campaign] = await tx
      .insert(schema.campaigns)
      .values({
        systemId: systemRow.id,
        name: campaignName,
        visibility: 'private',
        diceMode: 'soft_accountability',
      })
      .returning();

    await tx.insert(schema.campaignMembers).values({
      campaignId: campaign.id,
      userId,
      role: 'owner',
    });

    await tx.insert(schema.campaignStates).values({
      campaignId: campaign.id,
      system: 'mothership',
      data: fixture.seededState.campaignState,
    });

    const [adventure] = await tx
      .insert(schema.adventures)
      .values({
        campaignId: campaign.id,
        callerId: userId,
        status: 'ready',
      })
      .returning();

    await tx.insert(schema.gmContexts).values({
      adventureId: adventure.id,
      blob: fixture.seededState.gmContextBlob,
    });

    for (const raw of fixture.seededState.messages) {
      const row = raw as unknown as SeededMessageRow;
      await tx.insert(schema.messages).values({
        adventureId: adventure.id,
        role: row.role,
        content: row.content,
        createdAt: new Date(row.createdAt),
      });
    }

    for (const raw of fixture.seededState.pendingCanon) {
      const row = raw as unknown as SeededPendingCanonRow;
      await tx.insert(schema.pendingCanon).values({
        adventureId: adventure.id,
        summary: row.summary,
        context: row.context,
        status: row.status,
        sequenceNumber: row.sequenceNumber,
      });
    }

    for (const raw of fixture.seededState.pendingDiceRequests) {
      const row = raw as unknown as SeededDiceRequestRow;
      await tx.insert(schema.diceRequests).values({
        adventureId: adventure.id,
        issuedAtSequence: row.issuedAtSequence ?? 0,
        notation: row.notation,
        purpose: row.purpose,
        target: row.target ?? null,
        status: 'pending',
      });
    }

    return { campaignId: campaign.id, adventureId: adventure.id };
  });

  return { campaignId, adventureId, playerUserId: userId, warnings };
}

/** The full row set a structural or judged checker needs to inspect. */
export interface TurnExecutionResult {
  gameEvents: (typeof schema.gameEvents.$inferSelect)[];
  /** The turn's telemetry row, if the turn reached `applyTurnAtomic` (the
   * `diceResult` path without auto-advance never writes one). */
  telemetry: typeof schema.adventureTelemetry.$inferSelect | null;
  pendingCanon: (typeof schema.pendingCanon.$inferSelect)[];
  campaignState: Record<string, unknown>;
  diceRequests: (typeof schema.diceRequests.$inferSelect)[];
  /** Whatever `SessionService`'s own call returned, for debugging/report detail. */
  serviceResult:
    | { kind: 'message'; result: SendMessageResult }
    | {
        kind: 'diceResult';
        result: Awaited<ReturnType<SessionService['submitDiceResult']>>;
      };
}

/**
 * The `gm_response`/`correction` event whose `playerText`/`gmUpdates` is
 * what actually reached the player this turn: the correction's, if a
 * correction fired (`writeTurnEvents` always writes it immediately after
 * the original, before `state_update`, so the higher-sequence one of the
 * two is always the winner), otherwise the original `gm_response`'s.
 * Shared by `NARRATING-PAST-A-BLOCK` and the judge call — both need "the
 * text the player actually saw," not the (possibly-superseded) original.
 */
export function getWinningResponseEvent(
  result: TurnExecutionResult,
): typeof schema.gameEvents.$inferSelect | undefined {
  return result.gameEvents
    .filter(
      (e) => e.eventType === 'gm_response' || e.eventType === 'correction',
    )
    .sort((a, b) => b.sequenceNumber - a.sequenceNumber)[0];
}

/**
 * `playerInput.content` for a `'diceResult'` fixture is a JSON string of
 * `{results: number[], source?: 'player_entered'|'system_generated', autoAdvance?: boolean}`
 * — `requestId`/`notation` are never in the fixture file, since a scratch
 * adventure's seeded `dice_request` row gets a fresh DB-assigned id every
 * run. Requires `seededState.pendingDiceRequests` to contain exactly one
 * entry; ambiguous otherwise (which pending request does this fixture mean
 * to resolve?).
 */
interface DiceResultPlayerInputContent {
  results: number[];
  source?: 'player_entered' | 'system_generated';
  autoAdvance?: boolean;
}

/**
 * Runs the fixture's one turn through the real `SessionService`, then reads
 * every row a checker might need fresh from the database — not just
 * whatever `SessionService`'s own return value carried — so checkers always
 * see the real persisted state.
 */
export async function runFixtureTurn(
  db: Db,
  sessionService: SessionService,
  fixture: EvalFixture,
  seeded: ScratchAdventure,
): Promise<TurnExecutionResult> {
  let serviceResult: TurnExecutionResult['serviceResult'];

  if (fixture.playerInput.type === 'message') {
    const result = await sessionService.sendMessage({
      adventureId: seeded.adventureId,
      campaignId: seeded.campaignId,
      playerUserId: seeded.playerUserId,
      playerMessage: fixture.playerInput.content,
    });
    serviceResult = { kind: 'message', result };
  } else {
    const pending = await db
      .select()
      .from(schema.diceRequests)
      .where(
        and(
          eq(schema.diceRequests.adventureId, seeded.adventureId),
          eq(schema.diceRequests.status, 'pending'),
        ),
      );
    if (pending.length !== 1) {
      throw new Error(
        `fixture "${fixture.id}" has playerInput.type "diceResult" but its ` +
          `scratch adventure has ${pending.length} pending dice_request ` +
          'row(s) — expected exactly 1. Seed seededState.pendingDiceRequests ' +
          'with exactly one entry for a diceResult-triggered fixture.',
      );
    }
    const [request] = pending;
    const content = JSON.parse(
      fixture.playerInput.content,
    ) as DiceResultPlayerInputContent;

    const result = await sessionService.submitDiceResult({
      adventureId: seeded.adventureId,
      campaignId: seeded.campaignId,
      actorUserId: seeded.playerUserId,
      submission: {
        requestId: request.id,
        notation: request.notation,
        results: content.results,
        source: content.source ?? 'player_entered',
        autoAdvance: content.autoAdvance,
      },
    });
    serviceResult = { kind: 'diceResult', result };
  }

  const [
    gameEvents,
    telemetryRows,
    pendingCanonRows,
    campaignStateRow,
    diceRequestRows,
  ] = await Promise.all([
    db
      .select()
      .from(schema.gameEvents)
      .where(eq(schema.gameEvents.adventureId, seeded.adventureId))
      .orderBy(asc(schema.gameEvents.sequenceNumber)),
    db
      .select()
      .from(schema.adventureTelemetry)
      .where(eq(schema.adventureTelemetry.adventureId, seeded.adventureId))
      .orderBy(asc(schema.adventureTelemetry.sequenceNumber)),
    db
      .select()
      .from(schema.pendingCanon)
      .where(eq(schema.pendingCanon.adventureId, seeded.adventureId)),
    db
      .select({ data: schema.campaignStates.data })
      .from(schema.campaignStates)
      .where(eq(schema.campaignStates.campaignId, seeded.campaignId))
      .limit(1),
    db
      .select()
      .from(schema.diceRequests)
      .where(eq(schema.diceRequests.adventureId, seeded.adventureId)),
  ]);

  return {
    gameEvents,
    telemetry: telemetryRows.at(-1) ?? null,
    pendingCanon: pendingCanonRows,
    campaignState: (campaignStateRow[0]?.data ?? {}) as Record<string, unknown>,
    diceRequests: diceRequestRows,
    serviceResult,
  };
}

/**
 * Deletes the scratch `campaign` row; cascading FKs (`adventure`,
 * `campaign_state`, `campaign_member`, and everything keyed off
 * `adventure` in turn) take care of everything under it. Never touches the
 * `user`/`game_system` rows — those are looked up and reused, not created,
 * by `seedScratchAdventure`.
 *
 * Not called automatically by `runFixtureTurn` — the `eval:harness` CLI
 * owns calling this (or not, under `--keep-scratch`), so this module stays
 * a pure building block with no opinion on cleanup policy.
 */
export async function teardownScratchAdventure(
  db: Db,
  campaignId: string,
): Promise<void> {
  await db.delete(schema.campaigns).where(eq(schema.campaigns.id, campaignId));
}
