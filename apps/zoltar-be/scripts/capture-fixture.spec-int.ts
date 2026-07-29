import { emptyMothershipState } from '@uv/game-systems';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { evalFixtureSchema } from '../eval/fixture.schema';
import { CanonRepository } from '../src/canon/canon.repository';
import * as schema from '../src/db/schema';
import {
  ReplayError,
  reconstructStateAsOfTurn,
} from '../src/replay/reconstruct-state';
import { SessionRepository } from '../src/session/session.repository';
import { SynthesisRepository } from '../src/synthesis/synthesis.repository';
import {
  getTestDb,
  setupTestDb,
  teardownTestDb,
  truncateAll,
} from '../test/db-test-helper';

import { captureFixture } from './capture-fixture.core';

import type { MothershipCampaignState } from '@uv/game-systems';

let sessionRepo: SessionRepository;
let synthesisRepo: SynthesisRepository;

beforeAll(async () => {
  await setupTestDb();
  const canonRepo = new CanonRepository(getTestDb() as never);
  sessionRepo = new SessionRepository(getTestDb() as never, canonRepo);
  synthesisRepo = new SynthesisRepository(getTestDb() as never, canonRepo);
});

afterAll(async () => {
  await teardownTestDb();
});

beforeEach(async () => {
  await truncateAll();
});

async function seedAdventure(): Promise<{
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
      name: 'Capture Fixture Test Campaign',
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
    .values({ campaignId: campaign.id, callerId: 'u1', status: 'ready' })
    .returning();
  return { campaignId: campaign.id, adventureId: adventure.id };
}

function fakeTelemetry(playerMessage: string) {
  return {
    playerMessage,
    snapshotSent: 'n/a',
    originalRequest: { systemBlocks: [], messages: [] } as never,
    originalResponse: { model: 'n/a', usage: {} } as never,
    originalParsed: { playerText: 'n/a' } as never,
    preTurnPlayerRolls: [],
    rulesLookups: [],
    toolLoopIterations: 1,
    wardenPrompt: { filename: 'n/a', hash: 'n/a' },
  };
}

describe('captureFixture (integration)', () => {
  it('matches reconstructStateAsOfTurn and fills in valid placeholders for a structural tag', async () => {
    const db = getTestDb();
    const { campaignId, adventureId } = await seedAdventure();

    const turn0CampaignState: MothershipCampaignState = {
      ...emptyMothershipState(),
      resourcePools: { dr_chen_hp: { current: 10, max: 10 } },
    };
    const turn0GmContextBlob = { openingNarration: 'The airlock cycles.' };
    await synthesisRepo.writeGmContextAtomic({
      adventureId,
      campaignId,
      gmContextBlob: turn0GmContextBlob,
      campaignStateData: turn0CampaignState,
      gridEntities: [],
    });

    const playerMessage = 'I check the airlock seal.';
    await db.insert(schema.messages).values({
      adventureId,
      role: 'player',
      content: playerMessage,
    });
    await sessionRepo.applyTurnAtomic({
      adventureId,
      campaignId,
      playerUserId: 'u1',
      campaignStateData: turn0CampaignState,
      playerAction: { content: playerMessage },
      gmResponse: {
        playerText: 'GM: The seal holds.',
        gmUpdates: { npcStates: {} },
      } as never,
      applied: {
        resourcePools: {},
        entities: {},
        flags: {},
        scenarioState: {},
        worldFacts: {},
      },
      thresholds: [],
      proposedCanon: [],
      gmContextBlob: turn0GmContextBlob,
      gmText: 'GM: The seal holds.',
      telemetry: fakeTelemetry(playerMessage),
      autoPromoteCanon: false,
    });

    const targetSequenceNumber = 1; // the turn's player_action.
    const direct = await reconstructStateAsOfTurn(
      db,
      adventureId,
      targetSequenceNumber,
    );

    const fixture = await captureFixture(db, {
      adventureId,
      targetSequenceNumber,
      tag: 'OUT-OF-ORDER-RESOLUTION',
      id: 'turn1-out-of-order-resolution',
    });

    expect(fixture.id).toBe('turn1-out-of-order-resolution');
    expect(fixture.tag).toBe('OUT-OF-ORDER-RESOLUTION');
    expect(fixture.sourceAdventureId).toBe(adventureId);
    expect(fixture.sourceSequenceNumber).toBe(targetSequenceNumber);
    expect(fixture.seededState.campaignState).toEqual(direct.campaignState);
    expect(fixture.seededState.gmContextBlob).toEqual(direct.gmContextBlob);
    expect(fixture.seededState.pendingCanon).toEqual(direct.pendingCanon);
    expect(fixture.seededState.messages).toHaveLength(direct.messages.length);
    expect(fixture.seededState.capturedAt).toBeTruthy();

    // Placeholder assertion mode matches what a structural tag requires —
    // the written fixture must already pass `loadFixtures` validation.
    expect(fixture.assertion.mode).toBe('structural');
    expect(fixture.playerInput.type).toBe('message');

    // Placeholder applicability defaults fail-closed (applies: false) —
    // a check reading it via `requiresFixtureSchema` must never assume the
    // situation applies just because the fixture was captured after v2.
    expect(fixture.applicability?.['out-of-order-resolution']).toEqual({
      applies: false,
      situation: expect.stringContaining('TODO'),
    });
    expect(evalFixtureSchema.safeParse(fixture).success).toBe(true);
  });

  it('fills in a judged-mode placeholder for a judged tag', async () => {
    const db = getTestDb();
    const { campaignId, adventureId } = await seedAdventure();
    await synthesisRepo.writeGmContextAtomic({
      adventureId,
      campaignId,
      gmContextBlob: { openingNarration: 'n/a' },
      campaignStateData: emptyMothershipState(),
      gridEntities: [],
    });
    await db.insert(schema.messages).values({
      adventureId,
      role: 'player',
      content: 'A turn.',
    });
    await sessionRepo.applyTurnAtomic({
      adventureId,
      campaignId,
      playerUserId: 'u1',
      campaignStateData: emptyMothershipState(),
      playerAction: { content: 'A turn.' },
      gmResponse: {
        playerText: 'GM: ok.',
        gmUpdates: { npcStates: {} },
      } as never,
      applied: {
        resourcePools: {},
        entities: {},
        flags: {},
        scenarioState: {},
        worldFacts: {},
      },
      thresholds: [],
      proposedCanon: [],
      gmContextBlob: { openingNarration: 'n/a' },
      gmText: 'GM: ok.',
      telemetry: fakeTelemetry('A turn.'),
      autoPromoteCanon: false,
    });

    const fixture = await captureFixture(db, {
      adventureId,
      targetSequenceNumber: 1,
      tag: 'HIDDEN-INFO-LEAK',
      id: 'turn1-hidden-info-leak',
    });

    expect(fixture.assertion.mode).toBe('judged');
    if (fixture.assertion.mode === 'judged') {
      expect(fixture.assertion.rubric).toBe('HIDDEN-INFO-LEAK');
      expect(Object.keys(fixture.assertion.facts).length).toBeGreaterThan(0);
    }
  });

  it('propagates ReplayError for an invalid targetSequenceNumber', async () => {
    const db = getTestDb();
    const { campaignId, adventureId } = await seedAdventure();
    await synthesisRepo.writeGmContextAtomic({
      adventureId,
      campaignId,
      gmContextBlob: { openingNarration: 'n/a' },
      campaignStateData: emptyMothershipState(),
      gridEntities: [],
    });

    await expect(
      captureFixture(db, {
        adventureId,
        targetSequenceNumber: 999,
        tag: 'OUT-OF-ORDER-RESOLUTION',
        id: 'bad',
      }),
    ).rejects.toThrow(ReplayError);
  });
});
