import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { and, asc, eq } from 'drizzle-orm';

import { AnthropicService } from '../src/anthropic/anthropic.service';
import { AppModule } from '../src/app.module';
import { DB_TOKEN } from '../src/db/db.provider';
import * as schema from '../src/db/schema';
import { SessionService } from '../src/session/session.service';

import { RecordingAnthropicService } from './runs/recording-anthropic';

import type { Db } from '../src/db/db.provider';
import type { EvalFixture } from './fixture.schema';
import type { TurnExecutionResult } from './turn-result';

export { getWinningResponseEvent } from './turn-result';

export type { TurnExecutionResult } from './turn-result';

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
   * call reuses this rather than constructing a second Anthropic client.
   * When `createHarnessSession` was called with `{model, temperature}`,
   * this is actually the `RecordingAnthropicService` below, typed as
   * `AnthropicService` because that's the token every consumer (including
   * `SessionService` itself) resolves it through. */
  anthropicService: AnthropicService;
  /** Set only when `createHarnessSession` was called with `{model,
   * temperature}` — the same instance as `anthropicService`, narrowed to
   * the type that exposes `beginFixture()`/`takeCaptured()`. The runner
   * drains this per fixture. */
  recorder?: RecordingAnthropicService;
  close: () => Promise<void>;
}

export interface CreateHarnessSessionOptions {
  model: string;
  temperature: number;
}

/**
 * With no options, behaves exactly as before this milestone: a plain
 * `SessionService` backed by the real `AnthropicService`, model/temperature
 * left at the API defaults. With `{model, temperature}`, the `AnthropicService`
 * provider is overridden with a `RecordingAnthropicService` — constructed
 * from a fresh real `AnthropicService` via the module's own `ConfigService`,
 * not by wrapping the about-to-be-replaced provider, since that would be
 * circular — so every Warden call in this session is forced onto that
 * model/temperature and recorded for `eval:run` to write to disk.
 */
export async function createHarnessSession(
  options?: CreateHarnessSessionOptions,
): Promise<HarnessSession> {
  let builder = Test.createTestingModule({ imports: [AppModule] });

  if (options) {
    builder = builder.overrideProvider(AnthropicService).useFactory({
      factory: (config: ConfigService) =>
        new RecordingAnthropicService(
          new AnthropicService(config),
          options.model,
          options.temperature,
        ),
      inject: [ConfigService],
    });
  }

  const moduleRef = await builder.compile();
  await moduleRef.init();

  const anthropicService = moduleRef.get(AnthropicService);
  return {
    db: moduleRef.get<Db>(DB_TOKEN),
    sessionService: moduleRef.get(SessionService),
    anthropicService,
    recorder: options
      ? (anthropicService as unknown as RecordingAnthropicService)
      : undefined,
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
 * The player entity ids a fixture declares, in declaration order, or `[]`.
 *
 * Reads the same `gmContextBlob.playerEntityIds` the checkers read via
 * `attributionContext`, deliberately: one declaration drives what the Warden
 * is validated against at run time and what the checker resolves against at
 * scoring time, so the two cannot disagree about who the player is.
 *
 * **Order is significant** — the first entry is the canonical id, the one
 * seeded into `character_sheet` and therefore the only one the running Warden
 * is allowed to use. Later entries are aliases the checker tolerates when
 * grading older artifacts.
 */
function seededPlayerEntityIds(fixture: EvalFixture): string[] {
  const blob = fixture.seededState.gmContextBlob as {
    playerEntityIds?: unknown;
  };
  return Array.isArray(blob.playerEntityIds)
    ? blob.playerEntityIds.filter((v): v is string => typeof v === 'string')
    : [];
}

/**
 * Seeds a fully self-contained scratch campaign + adventure from a
 * fixture's frozen `seededState`, ready for `runFixtureTurn` to drive one
 * real turn through. Tagged `campaign.name = "__eval__<fixture.id>__<runId>"`
 * so scratch rows are identifiable in the database and never collide with
 * real campaigns; `teardownScratchAdventure` deletes by that campaign id.
 *
 * Seeds one `character_sheet` row per entity id the fixture declares in
 * `seededState.gmContextBlob.playerEntityIds`.
 *
 * This reverses an earlier decision here, and the reason is worth keeping.
 * The original note said seeding would mean "guessing at an entity id this
 * milestone has no reliable way to derive from a captured fixture," and that
 * `playerEntityIds` was a prompt-building hint "never read by any structural
 * or judged checker." Both premises have since changed: fixtures now declare
 * the ids outright, and `rollActsFor` resolves `actingEntityId` against them.
 *
 * Not seeding is no longer neutral. `SessionService` overwrites the blob's
 * `playerEntityIds` with the repository's answer, so an unseeded run reports
 * `[]`, which silently disables `actingEntityId` validation in the tool loop
 * — the run would grade a code path production does not take.
 */
/**
 * Fills `revealed` on seeded entities that predate it, from `visible`.
 *
 * `ADR-0101` made `revealed` required on `EntitySchema`, and
 * `V20__entity_revealed_backfill.sql` back-fills the database. The eval corpus
 * is not in the database — it is literal JSON captured into fixture files — so
 * the migration cannot reach it, and every fixture captured before 2026-08-21
 * carries entities with `visible` and no `revealed`.
 *
 * Normalizing here rather than editing the files is what keeps `ADR-0101`'s
 * "no fixture re-capture" guarantee true. `corpusVersion` hashes fixture bytes
 * (`corpus-version.ts:70-74`), so a load-time fill moves nothing and no frozen
 * run needs re-scoring; rewriting 22 files to add a derivable boolean would
 * bump the corpus and invalidate every baseline on disk to no purpose.
 *
 * Same rule as the migration — `revealed := visible` — and the same
 * leave-alone for entities that already carry it, so a fixture captured after
 * this lands is passed through untouched.
 */
function backfillEntityRevealed(
  campaignState: Record<string, unknown>,
): Record<string, unknown> {
  const entities = campaignState.entities;
  if (typeof entities !== 'object' || entities === null) return campaignState;

  const filled: Record<string, unknown> = {};
  for (const [id, entity] of Object.entries(
    entities as Record<string, unknown>,
  )) {
    if (typeof entity !== 'object' || entity === null) {
      filled[id] = entity;
      continue;
    }
    const record = entity as Record<string, unknown>;
    filled[id] =
      'revealed' in record
        ? record
        : { ...record, revealed: record.visible !== false };
  }

  return { ...campaignState, entities: filled };
}

export async function seedScratchAdventure(
  db: Db,
  fixture: EvalFixture,
  opts: SeedScratchAdventureOptions,
): Promise<ScratchAdventure> {
  const warnings: string[] = [];

  // A fixture that declares no player entity id cannot be run, and the
  // failure it produces instead is silent. Without a declared id no
  // `character_sheet` gets seeded below; `SessionService.sendMessage` then
  // resolves `playerEntityIds` to `[]` and *overwrites* the seeded blob with
  // it, which switches off `actingEntityId` validation in the tool loop. The
  // run completes, scores, and reports — having graded a code path production
  // never takes. Nothing in the output says so.
  //
  // That is the mechanism behind the voided 2026-08-20 re-baseline
  // (`ADR-0103` open item 3), and it was reachable because `capture-fixture`
  // emitted the field for nobody: all 21 fixtures of the era carried
  // hand-added values, so one omission was one unremarkable editing slip.
  // `capture-fixture` now derives and requires it, which closes the
  // production side; this guard closes the consumption side, for the
  // hand-authored and hand-edited fixtures derivation cannot reach.
  //
  // Loud and early, before any row is written: a run that cannot be valid
  // should cost nothing and stop at the fixture that is wrong, rather than
  // report a number nobody can act on.
  const declaredPlayerEntityIds = seededPlayerEntityIds(fixture);
  if (declaredPlayerEntityIds.length === 0) {
    throw new Error(
      `fixture "${fixture.id}" declares no ` +
        'seededState.gmContextBlob.playerEntityIds. Seeding it would leave the ' +
        'scratch campaign without a character_sheet, which resolves ' +
        'playerEntityIds to [] at run time and silently disables ' +
        'actingEntityId validation in the tool loop — the run would grade a ' +
        'code path production does not take (ADR-0103 open item 3). Add the ' +
        "player's entity id to the fixture, canonical id first.",
    );
  }

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
      data: backfillEntityRevealed(fixture.seededState.campaignState),
    });

    const [adventure] = await tx
      .insert(schema.adventures)
      .values({
        campaignId: campaign.id,
        callerId: userId,
        status: 'ready',
      })
      .returning();

    // `schemaVersion` is left to the column default of 1, which is correct:
    // every fixture in the corpus was captured before `ADR-0118` and carries
    // `narrative.location`. The run reads this back through
    // `SessionRepository.getGmContextBlob`, which migrates it — which is why
    // the rename needed no fixture re-capture and moved no `corpusVersion`.
    //
    // **A fixture captured in a later shape would be mislabelled here**, and
    // the fixture schema has no version field to read one from. Today that is
    // harmless — v1→v2 is a no-op on an already-renamed blob — but that is a
    // property of this particular migration, not a guarantee. A future step
    // that restructures rather than renames would corrupt such a fixture.
    // Re-capturing the corpus means teaching this insert the fixture's version.
    await tx.insert(schema.gmContexts).values({
      adventureId: adventure.id,
      blob: fixture.seededState.gmContextBlob,
    });

    // `SessionService.sendMessage` reads player entity ids from
    // `character_sheet`, not from the seeded blob — it *overwrites*
    // `gmContextBlob.playerEntityIds` with the repository's answer. Without a
    // sheet the answer is `[]`, which disables the `actingEntityId` validation
    // in the tool loop and leaves the run measuring a code path production
    // does not take.
    //
    // **Exactly one row, and the schema is why.** `character_sheet` is unique
    // on `(campaign_id, user_id)`: one sheet per player per campaign, so one
    // player has one entity id. A fixture may *declare* several because the
    // captured adventure refers to the player by two prefixes (`alvarez_*`
    // and `lt_alvarez_*` — a state defect, not a modelling choice), but that
    // ambiguity must not be pushed into the runtime. The first declared id is
    // canonical, and an alias the Warden emits instead gets rejected by the
    // tool loop and corrected in-loop, which is the behaviour we want.
    //
    // The checker stays deliberately more lenient than this: `rollActsFor`
    // resolves against *every* declared id, because it also grades frozen
    // artifacts from runs that predate the validation and legitimately used
    // the alias. Same asymmetry, same reason, as the prose fallback for
    // pre-M7.5 payloads.
    //
    // The id is not guessed: the fixture declares it (see
    // `attributionContext`), which is what makes this seeding possible now
    // and did not before. Unconditional — the precondition at the top of this
    // function has already rejected a fixture that declares none, so an
    // `undefined` here is unreachable rather than tolerated.
    const [canonicalPlayerEntityId] = declaredPlayerEntityIds;
    await tx.insert(schema.characterSheets).values({
      campaignId: campaign.id,
      userId,
      system: 'mothership',
      data: { entityId: canonicalPlayerEntityId },
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
