import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  getTestDb,
  setupTestDb,
  teardownTestDb,
  truncateAll,
} from '../../test/db-test-helper';
import { CanonRepository } from '../canon/canon.repository';
import * as schema from '../db/schema';

import { GM_CONTEXT_SCHEMA_VERSION } from './gm-context.migration';
import { SessionRepository } from './session.repository';

let repo: SessionRepository;

beforeAll(async () => {
  await setupTestDb();
  const canonRepo = new CanonRepository(getTestDb() as never);
  repo = new SessionRepository(getTestDb() as never, canonRepo);
});

afterAll(async () => {
  await teardownTestDb();
});

beforeEach(async () => {
  await truncateAll();
});

async function seedFixture(): Promise<{
  campaignId: string;
  adventureId: string;
}> {
  const db = getTestDb();
  const [system] = await db
    .insert(schema.gameSystems)
    .values({
      slug: 'mothership',
      name: 'Mothership',
      indexSource: 'user_provided',
    })
    .returning();
  const [campaign] = await db
    .insert(schema.campaigns)
    .values({
      systemId: system.id,
      name: 'Test Campaign',
      visibility: 'private',
      diceMode: 'soft_accountability',
    })
    .returning();
  await db.insert(schema.users).values({ id: 'u1', email: 'alice@x.test' });
  await db.insert(schema.campaignMembers).values({
    campaignId: campaign.id,
    userId: 'u1',
    role: 'owner',
  });
  const [adventure] = await db
    .insert(schema.adventures)
    .values({
      campaignId: campaign.id,
      callerId: 'u1',
      status: 'in_progress',
    })
    .returning();
  return { campaignId: campaign.id, adventureId: adventure.id };
}

describe('SessionRepository (integration)', () => {
  describe('listDiceRollEvents', () => {
    it('returns createdAt as a real Date, not a driver string', async () => {
      // Regression test: this method reads via raw `db.execute`, which
      // bypasses Drizzle's column-type mapping — node-postgres hands back
      // timestamptz as Postgres's text representation, not a Date, unless
      // explicitly parsed. Downstream code (SessionService.listDiceRolls)
      // calls `.toISOString()` on this field and crashed in production
      // once an adventure had at least one dice_roll event.
      const { campaignId, adventureId } = await seedFixture();
      const request = await getTestDb().transaction(async (tx) =>
        repo.insertDiceRequest({
          tx,
          adventureId,
          issuedAtSequence: 1,
          notation: '1d100',
          purpose: 'test prompt',
          target: 65,
        }),
      );
      await repo.applyDiceResultAtomic({
        adventureId,
        campaignId,
        requestId: request.id,
        actorUserId: 'u1',
        source: 'player_entered',
        payload: {
          notation: '1d100',
          purpose: 'test prompt',
          results: [34],
          modifier: 0,
          total: 34,
        },
      });

      const [roll] = await repo.listDiceRollEvents(adventureId);

      expect(roll).toBeDefined();
      expect(roll.createdAt).toBeInstanceOf(Date);
      expect(() => roll.createdAt.toISOString()).not.toThrow();
    });

    it('excludes GM/NPC rolls from the inner tool loop', async () => {
      // GM rolls are written by `writeTurnEvents` with actor_type 'gm' and
      // no `requestId` in the payload (they don't resolve a dice_request).
      // They're mechanical/narrative-support rolls, not something the
      // player submitted, and shouldn't appear in the chat log.
      const { campaignId, adventureId } = await seedFixture();
      const request = await getTestDb().transaction(async (tx) =>
        repo.insertDiceRequest({
          tx,
          adventureId,
          issuedAtSequence: 1,
          notation: '1d100',
          purpose: 'test prompt',
          target: 65,
        }),
      );
      await repo.applyDiceResultAtomic({
        adventureId,
        campaignId,
        requestId: request.id,
        actorUserId: 'u1',
        source: 'player_entered',
        payload: {
          notation: '1d100',
          purpose: 'test prompt',
          results: [34],
          modifier: 0,
          total: 34,
        },
      });
      await getTestDb()
        .insert(schema.gameEvents)
        .values({
          adventureId,
          campaignId,
          sequenceNumber: 2,
          eventType: 'dice_roll',
          actorType: 'gm',
          actorId: null,
          rollSource: 'system_generated',
          payload: {
            notation: '2d6',
            purpose: 'ambush check',
            results: [4, 5],
            modifier: 0,
            total: 9,
          },
        });

      const rolls = await repo.listDiceRollEvents(adventureId);

      expect(rolls).toHaveLength(1);
      expect(rolls[0].notation).toBe('1d100');
    });
  });

  describe('listMessagesWithTurnNumber', () => {
    // These tests seed `created_at` explicitly to reproduce the real write
    // path's timestamp relationships, which the assignment rule depends on:
    // the player message is persisted *before* the turn transaction opens
    // (so it is strictly earlier), and the gm message is inserted *inside*
    // it alongside the gm_response event (so both take the same
    // transaction `now()` and are exactly equal). See
    // `docs/plans/015-play-view-turn-number.md`.
    async function seedTurn(args: {
      campaignId: string;
      adventureId: string;
      seq: number;
      at: string;
      playerMessages?: Array<{ content: string; at: string }>;
      gmText?: string;
      corrected?: boolean;
    }): Promise<void> {
      const db = getTestDb();
      for (const pm of args.playerMessages ?? []) {
        await db.insert(schema.messages).values({
          adventureId: args.adventureId,
          role: 'player',
          content: pm.content,
          createdAt: new Date(pm.at),
        });
      }
      await db.insert(schema.gameEvents).values({
        adventureId: args.adventureId,
        campaignId: args.campaignId,
        sequenceNumber: args.seq - 1,
        eventType: 'player_action',
        actorType: 'player',
        actorId: 'u1',
        payload: { content: args.playerMessages?.at(-1)?.content ?? '' },
        createdAt: new Date(args.at),
      });
      const [gmEvent] = await db
        .insert(schema.gameEvents)
        .values({
          adventureId: args.adventureId,
          campaignId: args.campaignId,
          sequenceNumber: args.seq,
          eventType: 'gm_response',
          actorType: 'gm',
          actorId: null,
          payload: { gmUpdates: null },
          createdAt: new Date(args.at),
        })
        .returning();
      if (args.corrected) {
        const [correction] = await db
          .insert(schema.gameEvents)
          .values({
            adventureId: args.adventureId,
            campaignId: args.campaignId,
            sequenceNumber: args.seq + 1,
            eventType: 'correction',
            actorType: 'gm',
            actorId: null,
            payload: { gmUpdates: null },
            createdAt: new Date(args.at),
          })
          .returning();
        await getTestDb()
          .update(schema.gameEvents)
          .set({ supersededBy: correction.id })
          .where(eq(schema.gameEvents.id, gmEvent.id));
      }
      await db.insert(schema.messages).values({
        adventureId: args.adventureId,
        role: 'gm',
        content: args.gmText ?? `gm ${args.seq}`,
        createdAt: new Date(args.at),
      });
    }

    it('numbers both messages of a turn with the same ordinal', async () => {
      const { campaignId, adventureId } = await seedFixture();
      await seedTurn({
        campaignId,
        adventureId,
        seq: 3,
        at: '2026-08-01T10:00:10.000Z',
        playerMessages: [{ content: 'p1', at: '2026-08-01T10:00:00.000Z' }],
      });
      await seedTurn({
        campaignId,
        adventureId,
        seq: 8,
        at: '2026-08-01T10:01:10.000Z',
        playerMessages: [{ content: 'p2', at: '2026-08-01T10:01:00.000Z' }],
      });

      const rows = await repo.listMessagesWithTurnNumber(adventureId);

      expect(rows.map((r) => [r.content, r.turnNumber])).toEqual([
        ['p1', 1],
        ['gm 3', 1],
        ['p2', 2],
        ['gm 8', 2],
      ]);
      // The ordinal is not the sequence number — that's the whole point.
      expect(rows[3].turnNumber).not.toBe(8);
    });

    it('returns createdAt as a real Date, not a driver string', async () => {
      // Same hazard as `listDiceRollEvents` above: this reads via raw
      // `db.execute`, which bypasses Drizzle's column-type mapping, and
      // `SessionService.listMessages` calls `.toISOString()` on the result.
      const { campaignId, adventureId } = await seedFixture();
      await seedTurn({
        campaignId,
        adventureId,
        seq: 3,
        at: '2026-08-01T10:00:10.000Z',
        playerMessages: [{ content: 'p1', at: '2026-08-01T10:00:00.000Z' }],
      });

      const rows = await repo.listMessagesWithTurnNumber(adventureId);

      expect(rows[0].createdAt).toBeInstanceOf(Date);
      expect(() => rows[0].createdAt.toISOString()).not.toThrow();
    });

    it('keeps counting through a turn that has no player message', async () => {
      // Regression guard for the undercounting bug. A dice auto-advance turn
      // writes a player_action event but skips the message insert
      // (`session.service.ts`, guarded on `playerMessage.length > 0`), so
      // counting player messages client-side would number this adventure
      // 1, 2 instead of 1, 3 — and stay wrong for every later turn.
      const { campaignId, adventureId } = await seedFixture();
      await seedTurn({
        campaignId,
        adventureId,
        seq: 3,
        at: '2026-08-01T10:00:10.000Z',
        playerMessages: [{ content: 'p1', at: '2026-08-01T10:00:00.000Z' }],
      });
      await seedTurn({
        campaignId,
        adventureId,
        seq: 8,
        at: '2026-08-01T10:01:10.000Z',
        playerMessages: [],
      });
      await seedTurn({
        campaignId,
        adventureId,
        seq: 14,
        at: '2026-08-01T10:02:10.000Z',
        playerMessages: [{ content: 'p3', at: '2026-08-01T10:02:00.000Z' }],
      });

      const rows = await repo.listMessagesWithTurnNumber(adventureId);

      expect(rows.map((r) => [r.content, r.turnNumber])).toEqual([
        ['p1', 1],
        ['gm 3', 1],
        ['gm 8', 2],
        ['p3', 3],
        ['gm 14', 3],
      ]);
    });

    it('gives an orphaned player message the turn its retry produced', async () => {
      // The player message is persisted outside the turn transaction so a
      // failed turn can be retried without re-typing. A failure therefore
      // leaves an orphan, and the retry inserts a second copy. Both belong
      // to the turn that eventually succeeded.
      const { campaignId, adventureId } = await seedFixture();
      await seedTurn({
        campaignId,
        adventureId,
        seq: 3,
        at: '2026-08-01T10:00:10.000Z',
        playerMessages: [
          { content: 'shoot the contractor', at: '2026-08-01T09:59:00.000Z' },
          { content: 'shoot the contractor', at: '2026-08-01T10:00:00.000Z' },
        ],
      });

      const rows = await repo.listMessagesWithTurnNumber(adventureId);

      expect(rows.map((r) => r.turnNumber)).toEqual([1, 1, 1]);
    });

    it('leaves a message with no turn after it unnumbered', async () => {
      const { campaignId, adventureId } = await seedFixture();
      await seedTurn({
        campaignId,
        adventureId,
        seq: 3,
        at: '2026-08-01T10:00:10.000Z',
        playerMessages: [{ content: 'p1', at: '2026-08-01T10:00:00.000Z' }],
      });
      // Turn in flight, or one that never completed: no gm_response follows.
      await getTestDb()
        .insert(schema.messages)
        .values({
          adventureId,
          role: 'player',
          content: 'p2',
          createdAt: new Date('2026-08-01T10:01:00.000Z'),
        });

      const rows = await repo.listMessagesWithTurnNumber(adventureId);

      expect(rows.map((r) => [r.content, r.turnNumber])).toEqual([
        ['p1', 1],
        ['gm 3', 1],
        ['p2', null],
      ]);
    });

    it('does not spend an ordinal on a correction', async () => {
      // A corrected turn is still one turn: `writeTurnEvents` writes one
      // gm_response plus a `correction` event that supersedes it.
      // `playtest-review.render.ts` numbers it the same way, so filtering
      // superseded rows here would drift the UI off the review report by
      // one per correction.
      const { campaignId, adventureId } = await seedFixture();
      await seedTurn({
        campaignId,
        adventureId,
        seq: 3,
        at: '2026-08-01T10:00:10.000Z',
        playerMessages: [{ content: 'p1', at: '2026-08-01T10:00:00.000Z' }],
        corrected: true,
      });
      await seedTurn({
        campaignId,
        adventureId,
        seq: 8,
        at: '2026-08-01T10:01:10.000Z',
        playerMessages: [{ content: 'p2', at: '2026-08-01T10:01:00.000Z' }],
      });

      const rows = await repo.listMessagesWithTurnNumber(adventureId);

      expect(rows.map((r) => r.turnNumber)).toEqual([1, 1, 2, 2]);
    });

    it('returns an empty list for an adventure with no messages', async () => {
      const { adventureId } = await seedFixture();
      await expect(
        repo.listMessagesWithTurnNumber(adventureId),
      ).resolves.toEqual([]);
    });
  });
});

/**
 * `ADR-0118`'s read migration, end to end against a real row.
 *
 * The unit tests in `gm-context.migration.spec.ts` cover the chain itself.
 * What only an integration test can show is that the version actually
 * *reaches* it: `getGmContextBlob` has to keep `schemaVersion` in its
 * projection, and a v1 row has to come back renamed. This is the read that
 * builds the Warden's prompt on every turn, so the failure it guards against —
 * `scenario_premise: undefined`, silently, for the whole adventure — is the
 * one worth a live row.
 */
describe('SessionRepository.getGmContextBlob — gm_context migration', () => {
  it('migrates a genuine v1 row on read', async () => {
    const db = getTestDb();
    const { adventureId } = await seedFixture();

    await db.insert(schema.gmContexts).values({
      adventureId,
      schemaVersion: 1,
      blob: {
        openingNarration: 'The airlock cycles.',
        narrative: {
          location: 'Derelict freighter Persephone.',
          atmosphere: 'Dim corridors.',
          npcAgendas: { dr_chen: 'wants out' },
        },
      },
    });

    const blob = await repo.getGmContextBlob(adventureId);

    expect(blob?.narrative).toEqual({
      scenarioPremise: 'Derelict freighter Persephone.',
      atmosphere: 'Dim corridors.',
      npcAgendas: { dr_chen: 'wants out' },
    });
    expect(blob?.openingNarration).toBe('The airlock cycles.');
  });

  it('leaves a current row alone', async () => {
    const db = getTestDb();
    const { adventureId } = await seedFixture();
    const narrative = { scenarioPremise: 'A relay station gone quiet.' };

    await db.insert(schema.gmContexts).values({
      adventureId,
      schemaVersion: GM_CONTEXT_SCHEMA_VERSION,
      blob: { narrative },
    });

    const blob = await repo.getGmContextBlob(adventureId);
    expect(blob?.narrative).toEqual(narrative);
  });

  /**
   * The tripwire, against a real row. A v1 row that was written by the current
   * write path — i.e. one whose version was never stamped — is the shape this
   * catches, and silently repairing it is what the shape-keyed first draft did.
   */
  it('throws on a row whose declared version and blob disagree', async () => {
    const db = getTestDb();
    const { adventureId } = await seedFixture();

    await db.insert(schema.gmContexts).values({
      adventureId,
      schemaVersion: GM_CONTEXT_SCHEMA_VERSION,
      blob: { narrative: { location: 'never migrated' } },
    });

    await expect(repo.getGmContextBlob(adventureId)).rejects.toThrow(
      /retired key `narrative\.location`/,
    );
  });

  it('returns null when the adventure has no gm_context row', async () => {
    const { adventureId } = await seedFixture();
    expect(await repo.getGmContextBlob(adventureId)).toBeNull();
  });
});
