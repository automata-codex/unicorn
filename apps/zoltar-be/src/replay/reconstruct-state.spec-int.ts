import { emptyMothershipState } from '@uv/game-systems';
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
import { applyValidatedTurn } from '../session/session.applier';
import { SessionRepository } from '../session/session.repository';
import { SynthesisRepository } from '../synthesis/synthesis.repository';

import { ReplayError, reconstructStateAsOfTurn } from './reconstruct-state';

import type { MothershipCampaignState } from '@uv/game-systems';
import type { ApplyTurnAtomicResult } from '../session/session.repository';

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
      name: 'Replay Test Campaign',
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

/** Fake telemetry input — the fields `applyTurnAtomic` requires but replay
 * never reads back. Values are throwaway. */
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

interface FakeTurnArgs {
  campaignId: string;
  adventureId: string;
  priorCampaignState: MothershipCampaignState;
  priorGmContextBlob: Record<string, unknown>;
  playerMessage: string;
  applied?: Partial<MothershipCampaignState>;
  npcStates?: Record<string, string>;
  correctionNpcStates?: Record<string, string>;
  proposedCanon?: Array<{ summary: string; context: string }>;
}

/**
 * Applies one fake turn through the real `applyTurnAtomic` write path —
 * mirroring what `SessionService.sendMessage` does, minus the Claude call —
 * and returns the merged state so the caller can thread it into the next
 * turn and use it as ground truth to compare replay's fold against.
 */
async function applyFakeTurn(args: FakeTurnArgs): Promise<{
  newCampaignState: MothershipCampaignState;
  newGmContextBlob: Record<string, unknown>;
  result: ApplyTurnAtomicResult;
}> {
  const db = getTestDb();
  const applied = {
    resourcePools: {},
    entities: {},
    flags: {},
    scenarioState: {},
    worldFacts: {},
    ...args.applied,
  };
  const winningNpcStates = args.correctionNpcStates ?? args.npcStates ?? {};
  const { newCampaignState, newGmContextBlob } = applyValidatedTurn({
    priorCampaignState: args.priorCampaignState,
    priorGmContextBlob: args.priorGmContextBlob,
    applied,
    npcStates: winningNpcStates,
  });

  await db.insert(schema.messages).values({
    adventureId: args.adventureId,
    role: 'player',
    content: args.playerMessage,
  });

  const gmResponse = {
    playerText: `GM: ${args.playerMessage}`,
    gmUpdates: { npcStates: args.npcStates ?? {} },
  } as never;
  const correction = args.correctionNpcStates
    ? ({
        playerText: `GM (corrected): ${args.playerMessage}`,
        gmUpdates: { npcStates: args.correctionNpcStates },
      } as never)
    : undefined;

  const result = await sessionRepo.applyTurnAtomic({
    adventureId: args.adventureId,
    campaignId: args.campaignId,
    playerUserId: 'u1',
    campaignStateData: newCampaignState,
    playerAction: { content: args.playerMessage },
    gmResponse,
    correction,
    applied,
    thresholds: [],
    proposedCanon: args.proposedCanon ?? [],
    gmContextBlob: newGmContextBlob,
    gmText: correction
      ? `GM (corrected): ${args.playerMessage}`
      : `GM: ${args.playerMessage}`,
    telemetry: fakeTelemetry(args.playerMessage),
    autoPromoteCanon: false,
  });

  return { newCampaignState, newGmContextBlob, result };
}

describe('reconstructStateAsOfTurn (integration)', () => {
  it('reconstructs a multi-turn adventure at several points, matching the real DB state at each', async () => {
    const db = getTestDb();
    const { campaignId, adventureId } = await seedAdventure();

    const turn0CampaignState: MothershipCampaignState = {
      ...emptyMothershipState(),
      resourcePools: { dr_chen: { hp: { current: 10, max: 10 } } },
    };
    const turn0GmContextBlob = {
      openingNarration: 'The airlock cycles.',
      narrative: {
        location: 'Corridor 7',
        atmosphere: 'stale',
        npcAgendas: { corporate_spy_1: 'Watch the player' },
        hiddenTruth: 'The manifest is forged',
        oracleConnections: 'none',
      },
    };

    // Synthesis: writes gm_context/campaign_state AND (M7.3 Part 2) the
    // adventure_synthesis_snapshots turn-0 baseline, in one real call.
    await synthesisRepo.writeGmContextAtomic({
      adventureId,
      campaignId,
      gmContextBlob: turn0GmContextBlob,
      campaignStateData: turn0CampaignState,
      gridEntities: [],
    });

    // Turn A (seq 1-3): resourcePools delta only — no npcStates change, no
    // canon. Exercises "one turn with no npcStates change."
    const turnA = await applyFakeTurn({
      campaignId,
      adventureId,
      priorCampaignState: turn0CampaignState,
      priorGmContextBlob: turn0GmContextBlob,
      playerMessage: 'I check the airlock seal.',
      applied: { resourcePools: { dr_chen: { hp: { current: 8, max: 10 } } } },
    });

    // Turn B (seq 4-6): npcStates change + multiple proposed canon entries.
    // Exercises "one turn proposing multiple canon entries."
    const turnB = await applyFakeTurn({
      campaignId,
      adventureId,
      priorCampaignState: turnA.newCampaignState,
      priorGmContextBlob: turnA.newGmContextBlob,
      playerMessage: 'I radio the bridge.',
      applied: { worldFacts: { bridge_status: 'unresponsive' } },
      npcStates: { corporate_spy_1: 'Grows suspicious' },
      proposedCanon: [
        { summary: 'Ship has a brig', context: 'Cell door found.' },
        { summary: 'Bridge crew missing', context: 'No response on comms.' },
      ],
    });

    // Turn C (seq 7-10): a correction fires. The original gm_response
    // proposes one npcStates value; the correction proposes a different
    // one. Replay must fold the correction's value, not the original's.
    // Exercises "one turn with a correction."
    const turnC = await applyFakeTurn({
      campaignId,
      adventureId,
      priorCampaignState: turnB.newCampaignState,
      priorGmContextBlob: turnB.newGmContextBlob,
      playerMessage: 'I confront the spy.',
      applied: {
        entities: { corporate_spy_1: { visible: true, status: 'unknown' } },
      },
      npcStates: { corporate_spy_1: 'Rejected — invalid pool' },
      correctionNpcStates: { corporate_spy_1: 'Panics and flees' },
    });

    // --- Ground truth from the live tables, captured right here ---------
    // "State as of turn D" == state as it stood right after turn C, before
    // turn D is applied below. Comparing against the live DB rows (not
    // against the fold's own inputs) keeps this test from just
    // re-implementing the function under test.
    const [liveStateAfterC] = await db
      .select()
      .from(schema.campaignStates)
      .where(eq(schema.campaignStates.campaignId, campaignId));
    const [liveBlobAfterC] = await db
      .select()
      .from(schema.gmContexts)
      .where(eq(schema.gmContexts.adventureId, adventureId));

    // Turn D (seq 11-13): the target turn. Proposes its own canon entry —
    // reconstructing state "as of" turn D must exclude both this canon
    // entry and turn D's own GM response message.
    const turnDPlayerMessage = "I demand the spy's identity.";
    await db.insert(schema.messages).values({
      adventureId,
      role: 'player',
      content: turnDPlayerMessage,
    });
    const turnDApplied = {
      resourcePools: {},
      entities: {},
      flags: {},
      scenarioState: {},
      worldFacts: { spy_identity: 'revealed' },
    };
    const turnDMerge = applyValidatedTurn({
      priorCampaignState: turnC.newCampaignState,
      priorGmContextBlob: turnC.newGmContextBlob,
      applied: turnDApplied,
      npcStates: {},
    });
    const turnDResult = await sessionRepo.applyTurnAtomic({
      adventureId,
      campaignId,
      playerUserId: 'u1',
      campaignStateData: turnDMerge.newCampaignState,
      playerAction: { content: turnDPlayerMessage },
      gmResponse: {
        playerText: 'GM: The spy breaks down and confesses.',
        gmUpdates: { npcStates: {} },
      } as never,
      applied: turnDApplied,
      thresholds: [],
      proposedCanon: [
        { summary: "Spy's real name is Voss", context: 'Confession.' },
      ],
      gmContextBlob: turnDMerge.newGmContextBlob,
      gmText: 'GM: The spy breaks down and confesses.',
      telemetry: fakeTelemetry(turnDPlayerMessage),
      autoPromoteCanon: false,
    });

    // Turn A's player_action is sequence 1 (first event ever written).
    const turnAPlayerActionSeq = 1;
    // Turn D's player_action sequence — 3 events/turn, turn D is 4th turn.
    const turnDPlayerActionSeq = turnDResult.gmResponseSequence - 1;

    // --- Assertion 1: reconstructing at turn A's start = pure turn-0 -----
    const asOfTurnA = await reconstructStateAsOfTurn(
      db,
      adventureId,
      turnAPlayerActionSeq,
    );
    expect(asOfTurnA.campaignState).toEqual(turn0CampaignState);
    expect(asOfTurnA.gmContextBlob).toEqual(turn0GmContextBlob);
    expect(asOfTurnA.pendingCanon).toEqual([]);
    expect(asOfTurnA.messages).toHaveLength(1);
    expect(asOfTurnA.messages[0].content).toBe('I check the airlock seal.');

    // --- Assertion 2: reconstructing at turn D's start matches live DB ---
    const asOfTurnD = await reconstructStateAsOfTurn(
      db,
      adventureId,
      turnDPlayerActionSeq,
    );
    expect(asOfTurnD.campaignState).toEqual(liveStateAfterC.data);
    expect(asOfTurnD.gmContextBlob).toEqual(liveBlobAfterC.blob);

    // Correction wins: folded npcAgendas reflects the correction's value.
    const narrative = asOfTurnD.gmContextBlob.narrative as {
      npcAgendas: Record<string, string>;
    };
    expect(narrative.npcAgendas.corporate_spy_1).toBe('Panics and flees');

    // pendingCanon: turn B's two entries (all prior canon), turn D's own
    // proposal excluded.
    expect(asOfTurnD.pendingCanon).toHaveLength(2);
    expect(asOfTurnD.pendingCanon.map((c) => c.summary).sort()).toEqual(
      ['Bridge crew missing', 'Ship has a brig'].sort(),
    );
    expect(
      asOfTurnD.pendingCanon.every(
        (c) => c.sequenceNumber === turnB.result.gmResponseSequence,
      ),
    ).toBe(true);

    // messages: turn A/B/C/D player messages + turn A/B/C GM messages (7
    // total) — turn D's own GM response is excluded.
    expect(asOfTurnD.messages).toHaveLength(7);
    expect(
      asOfTurnD.messages.some((m) => m.content === turnDPlayerMessage),
    ).toBe(true);
    expect(
      asOfTurnD.messages.some(
        (m) => m.content === 'GM: The spy breaks down and confesses.',
      ),
    ).toBe(false);
  });

  it('throws ReplayError when targetSequenceNumber is not a player_action sequence', async () => {
    const db = getTestDb();
    const { campaignId, adventureId } = await seedAdventure();

    await synthesisRepo.writeGmContextAtomic({
      adventureId,
      campaignId,
      gmContextBlob: { openingNarration: 'n/a' },
      campaignStateData: emptyMothershipState(),
      gridEntities: [],
    });
    await applyFakeTurn({
      campaignId,
      adventureId,
      priorCampaignState: emptyMothershipState(),
      priorGmContextBlob: { openingNarration: 'n/a' },
      playerMessage: 'A turn.',
    });

    // Sequence 2 is the turn's gm_response, not its player_action.
    await expect(reconstructStateAsOfTurn(db, adventureId, 2)).rejects.toThrow(
      ReplayError,
    );
    // Sequence with no matching event at all.
    await expect(
      reconstructStateAsOfTurn(db, adventureId, 999),
    ).rejects.toThrow(ReplayError);
  });

  it('throws ReplayError when the adventure has no synthesis snapshot', async () => {
    const db = getTestDb();
    const { campaignId, adventureId } = await seedAdventure();
    // No writeGmContextAtomic call — no snapshot exists. Seed a lone
    // player_action event directly so the precondition check passes and
    // the snapshot check is what actually fails.
    await db.insert(schema.gameEvents).values({
      adventureId,
      campaignId,
      sequenceNumber: 1,
      eventType: 'player_action',
      actorType: 'player',
      actorId: 'u1',
      payload: { content: 'x' },
    });

    await expect(reconstructStateAsOfTurn(db, adventureId, 1)).rejects.toThrow(
      ReplayError,
    );
  });
});
