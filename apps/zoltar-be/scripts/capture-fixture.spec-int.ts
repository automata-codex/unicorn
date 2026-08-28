import { emptyMothershipState } from '@uv/game-systems';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { tagIndependentCheckIds } from '../eval/checks/registry';
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

import { CaptureError, captureFixture } from './capture-fixture.core';

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

/**
 * `playerEntityId` defaults to a real value because a campaign without a
 * character sheet is not a capturable adventure — `captureFixture` refuses it
 * (`ADR-0103` open item 3). Pass `null` to build that refusal case.
 */
async function seedAdventure(
  playerEntityId: string | null = 'dr_chen',
): Promise<{
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
  if (playerEntityId !== null) {
    await db.insert(schema.characterSheets).values({
      campaignId: campaign.id,
      userId: 'u1',
      system: 'mothership',
      data: { entityId: playerEntityId },
    });
  }
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
    // `content` is required — `buildResponseShape` maps over it to record
    // block types and tool names (`ADR-0097`). Without it the telemetry write
    // throws before the fixture is ever captured.
    originalResponse: {
      model: 'n/a',
      usage: {},
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', name: 'submit_gm_response' }],
    } as never,
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
      resourcePools: { dr_chen: { hp: { current: 10, max: 10 } } },
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
        characterState: {},
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
    // Everything except `playerEntityIds` is the fold's own output; that one
    // field is derived here because synthesis never persists it.
    expect(fixture.seededState.gmContextBlob).toEqual({
      ...direct.gmContextBlob,
      playerEntityIds: ['dr_chen'],
    });
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

    // ...and one for every check that attaches by applicability rather than
    // by tag, which is the only route those have onto a fixture (`ADR-0096`).
    // Asserted here as well as in the unit spec because this is the path that
    // actually writes fixture files.
    for (const checkId of tagIndependentCheckIds) {
      expect(fixture.applicability?.[checkId]).toEqual({
        applies: false,
        situation: expect.stringContaining('TODO'),
      });
    }
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
        characterState: {},
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

  it('derives playerEntityIds from character_sheet, in user_id order', async () => {
    // The field the harness seeds scratch character sheets from. Derived
    // rather than hand-added, because hand-adding it is what everyone forgot:
    // all 21 pre-existing fixtures needed the edit, and the one run that went
    // out without it was voided (`ADR-0103` open item 3).
    const db = getTestDb();
    const { campaignId, adventureId } = await seedAdventure('danny');

    // A second sheet whose `user_id` sorts before `u1`'s, so the expected
    // output below is the sorted order rather than the insertion order.
    //
    // **This pins intent, not the ORDER BY.** Dropping the clause still
    // passes — an unordered Postgres read returned the same order here — so
    // the determinism guarantee lives in the query, not in this assertion.
    // It is worth having anyway: order is not cosmetic, since
    // `harness-runner` seeds its scratch `character_sheet` from the *first*
    // id only, and the file it reads is frozen JSON.
    //
    // Two players in one campaign is not a shape any playtest has produced —
    // every capture so far is solo, one sheet, one id — so nothing here
    // claims which of two players ought to be canonical. A real multi-player
    // capture would need that picked by hand.
    await db
      .insert(schema.users)
      .values({ id: 'a_second_player', email: 'bob@x.test' });
    await db.insert(schema.campaignMembers).values({
      campaignId,
      userId: 'a_second_player',
      role: 'player',
    });
    await db.insert(schema.characterSheets).values({
      campaignId,
      userId: 'a_second_player',
      system: 'mothership',
      data: { entityId: 'mara_odinsen' },
    });

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
        characterState: {},
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
      tag: 'OUT-OF-ORDER-RESOLUTION',
      id: 'turn1-player-entity-ids',
    });

    const blob = fixture.seededState.gmContextBlob as {
      playerEntityIds?: unknown;
    };
    expect(blob.playerEntityIds).toEqual(['mara_odinsen', 'danny']);
    expect(evalFixtureSchema.safeParse(fixture).success).toBe(true);
  });

  it('refuses to capture when no character sheet declares an entityId', async () => {
    // Writing the fixture anyway is the failure this derivation exists to
    // close: it would seed no scratch sheet, resolve `playerEntityIds` to `[]`,
    // and grade a code path production does not take — silently, and only
    // detectable after the run.
    const db = getTestDb();
    const { campaignId, adventureId } = await seedAdventure(null);
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
        characterState: {},
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

    await expect(
      captureFixture(db, {
        adventureId,
        targetSequenceNumber: 1,
        tag: 'OUT-OF-ORDER-RESOLUTION',
        id: 'turn1-no-sheet',
      }),
    ).rejects.toThrow(CaptureError);
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
