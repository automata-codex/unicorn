import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as schema from '../src/db/schema';
import {
  getTestDb,
  setupTestDb,
  teardownTestDb,
  truncateAll,
} from '../test/db-test-helper';

import {
  createHarnessSession,
  runFixtureTurn,
  seedScratchAdventure,
  teardownScratchAdventure,
} from './harness-runner';

import type { EvalFixture } from './fixture.schema';
import type { HarnessSession } from './harness-runner';

// Full turns through SessionService.sendMessage make a real, token-costing
// Anthropic call. Gated so `npm run test:integration` stays free and fast by
// default; run manually with RUN_LIVE_EVAL_TESTS=1 to exercise it.
const RUN_LIVE = process.env.RUN_LIVE_EVAL_TESTS === '1';

// `createHarnessSession` bootstraps the real AppModule, which reads
// ANTHROPIC_API_KEY/VOYAGE_API_KEY/DATABASE_URL/NODE_ENV via ConfigService —
// unlike every other *.spec-int.ts file, which only ever talks to Postgres
// directly and never needs these. `.env` loading and pointing DATABASE_URL
// at zoltar_test both happen in vitest-integration-setup.ts, before this
// file's own imports resolve — see that file for why it can't be done here.

beforeAll(() => setupTestDb());
afterAll(() => teardownTestDb());
beforeEach(() => truncateAll());

/** `game_system`/`user` rows `seedScratchAdventure` looks up but never
 * creates — `truncateAll()` wipes both every test, so each test re-seeds. */
async function seedPrereqs(): Promise<void> {
  const db = getTestDb();
  await db.insert(schema.gameSystems).values({
    slug: 'mothership',
    name: 'Mothership',
    indexSource: 'user_provided',
  });
  await db.insert(schema.users).values({ id: 'u1', email: 'alice@x.test' });
}

function fixture(overrides: Partial<EvalFixture> = {}): EvalFixture {
  return {
    id: 'harness-runner-test-fixture',
    tag: 'OUT-OF-ORDER-RESOLUTION',
    sourceAdventureId: '00000000-0000-0000-0000-000000000001',
    sourceSequenceNumber: 1,
    seededState: {
      campaignState: {
        schemaVersion: 1,
        resourcePools: { dr_chen_hp: { current: 10, max: 10 } },
        entities: {},
        flags: {},
        scenarioState: {},
        worldFacts: {},
      },
      gmContextBlob: { openingNarration: 'The airlock cycles.' },
      pendingCanon: [],
      messages: [
        {
          role: 'player',
          content: 'I check the airlock seal.',
          createdAt: '2026-07-15T00:00:00.000Z',
        },
      ],
      pendingDiceRequests: [],
      capturedAt: '2026-07-15T00:00:00.000Z',
    },
    playerInput: { type: 'message', content: 'I check the airlock seal.' },
    assertion: {
      mode: 'structural',
      check: 'no damage roll before to-hit roll resolves',
    },
    ...overrides,
  };
}

describe('seedScratchAdventure', () => {
  it('seeds a scratch adventure whose rows match the fixture seededState', async () => {
    await seedPrereqs();
    const db = getTestDb();
    const f = fixture();

    const seeded = await seedScratchAdventure(db, f, { runId: 'run1' });

    const [campaign] = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, seeded.campaignId));
    expect(campaign.name).toBe(`__eval__${f.id}__run1`);

    const [state] = await db
      .select()
      .from(schema.campaignStates)
      .where(eq(schema.campaignStates.campaignId, seeded.campaignId));
    expect(state.data).toEqual(f.seededState.campaignState);

    const [gmContext] = await db
      .select()
      .from(schema.gmContexts)
      .where(eq(schema.gmContexts.adventureId, seeded.adventureId));
    expect(gmContext.blob).toEqual(f.seededState.gmContextBlob);

    const messages = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.adventureId, seeded.adventureId));
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('player');
    expect(messages[0].content).toBe('I check the airlock seal.');
  });

  it('seeds pendingCanon and pendingDiceRequests rows verbatim', async () => {
    await seedPrereqs();
    const db = getTestDb();
    const base = fixture();
    const f = fixture({
      seededState: {
        ...base.seededState,
        pendingCanon: [
          {
            summary: 'Ship has a brig',
            context: 'Cell door found.',
            status: 'promoted',
            sequenceNumber: 4,
          },
        ],
        pendingDiceRequests: [
          { notation: '1d10', purpose: 'Fear save', target: 30 },
        ],
      },
    });

    const seeded = await seedScratchAdventure(db, f, { runId: 'run2' });

    const canon = await db
      .select()
      .from(schema.pendingCanon)
      .where(eq(schema.pendingCanon.adventureId, seeded.adventureId));
    expect(canon).toHaveLength(1);
    expect(canon[0].summary).toBe('Ship has a brig');
    expect(canon[0].status).toBe('promoted');
    expect(canon[0].sequenceNumber).toBe(4);

    const requests = await db
      .select()
      .from(schema.diceRequests)
      .where(eq(schema.diceRequests.adventureId, seeded.adventureId));
    expect(requests).toHaveLength(1);
    expect(requests[0].notation).toBe('1d10');
    expect(requests[0].status).toBe('pending');
  });
});

describe('teardownScratchAdventure', () => {
  it('deletes the campaign and everything cascaded under it', async () => {
    await seedPrereqs();
    const db = getTestDb();
    const f = fixture();
    const seeded = await seedScratchAdventure(db, f, { runId: 'run3' });

    await teardownScratchAdventure(db, seeded.campaignId);

    const [campaign] = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, seeded.campaignId));
    expect(campaign).toBeUndefined();

    const [adventure] = await db
      .select()
      .from(schema.adventures)
      .where(eq(schema.adventures.id, seeded.adventureId));
    expect(adventure).toBeUndefined();
  });
});

describe('runFixtureTurn — diceResult path (no live Anthropic call)', () => {
  let harness: HarnessSession;

  beforeAll(async () => {
    // DATABASE_URL is pointed at zoltar_test by vitest-integration-setup.ts
    // (a setupFiles entry, run before this file's own imports resolve) —
    // setting it here would be too late; see that file for why.
    harness = await createHarnessSession();
  });

  afterAll(async () => {
    if (harness) await harness.close();
  });

  it('resolves the seeded pending dice_request and writes a dice_roll event, with no telemetry row', async () => {
    await seedPrereqs();
    const base = fixture();
    const f = fixture({
      playerInput: {
        type: 'diceResult',
        content: JSON.stringify({ results: [7] }),
      },
      seededState: {
        ...base.seededState,
        pendingDiceRequests: [
          { notation: '1d10', purpose: 'Fear save', target: 30 },
        ],
      },
    });
    const seeded = await seedScratchAdventure(harness.db, f, {
      runId: 'run-dice',
    });

    const result = await runFixtureTurn(
      harness.db,
      harness.sessionService,
      f,
      seeded,
    );

    expect(result.serviceResult.kind).toBe('diceResult');
    expect(result.gameEvents).toHaveLength(1);
    expect(result.gameEvents[0].eventType).toBe('dice_roll');
    expect(result.gameEvents[0].rollSource).toBe('player_entered');
    expect(result.diceRequests).toHaveLength(1);
    expect(result.diceRequests[0].status).toBe('resolved');
    // applyDiceResultAtomic (no autoAdvance) never reaches applyTurnAtomic,
    // so no telemetry row exists for this turn.
    expect(result.telemetry).toBeNull();

    await teardownScratchAdventure(harness.db, seeded.campaignId);
  });

  it('throws a clear error when the scratch adventure has no pending dice_request', async () => {
    await seedPrereqs();
    const f = fixture({
      playerInput: {
        type: 'diceResult',
        content: JSON.stringify({ results: [7] }),
      },
    });
    const seeded = await seedScratchAdventure(harness.db, f, {
      runId: 'run-dice-no-pending',
    });

    await expect(
      runFixtureTurn(harness.db, harness.sessionService, f, seeded),
    ).rejects.toThrow(/expected exactly 1/);

    await teardownScratchAdventure(harness.db, seeded.campaignId);
  });
});

describe.skipIf(!RUN_LIVE)(
  'runFixtureTurn — message path (LIVE Anthropic call, gated by RUN_LIVE_EVAL_TESTS=1)',
  () => {
    let harness: HarnessSession;

    beforeAll(async () => {
      harness = await createHarnessSession();
    });

    afterAll(async () => {
      if (harness) await harness.close();
    });

    it('runs a real turn through SessionService.sendMessage and produces a non-empty game_events sequence', async () => {
      await seedPrereqs();
      const f = fixture();
      const seeded = await seedScratchAdventure(harness.db, f, {
        runId: 'run-live',
      });

      const result = await runFixtureTurn(
        harness.db,
        harness.sessionService,
        f,
        seeded,
      );

      expect(result.serviceResult.kind).toBe('message');
      expect(result.gameEvents.length).toBeGreaterThan(0);
      expect(result.telemetry).not.toBeNull();

      await teardownScratchAdventure(harness.db, seeded.campaignId);
    }, 120_000);
  },
);
