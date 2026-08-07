import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

import * as schema from '../src/db/schema';
import {
  getTestDb,
  setupTestDb,
  teardownTestDb,
  truncateAll,
} from '../test/db-test-helper';

import {
  queryCorrections,
  queryHeader,
  queryTurns,
} from './playtest-review.queries';
import { renderReport } from './playtest-review.render';

import type { AdventureTelemetryPayload } from '../src/session/session.telemetry';

// Deterministic UUIDs and timestamps make the snapshot stable across runs.
const SYSTEM_ID = '00000000-0000-0000-0000-000000000010';
const CAMPAIGN_ID = '00000000-0000-0000-0000-000000000020';
const ADVENTURE_ID = '00000000-0000-0000-0000-000000000030';
const BASE_TIME = new Date('2026-04-24T12:00:00Z');

function timestampAt(offsetSeconds: number): Date {
  return new Date(BASE_TIME.getTime() + offsetSeconds * 1000);
}

interface SeedTurnOpts {
  playerActionSeq: number;
  gmResponseSeq: number;
  stateUpdateSeq: number;
  dicePreRollSeqs?: Array<{
    seq: number;
    notation: string;
    purpose: string;
    results: number[];
    total: number;
  }>;
  correction?: { seq: number };
  playerMessage: string;
  narration: string;
  telemetryPayload: AdventureTelemetryPayload;
}

async function seedBaseAdventure(): Promise<void> {
  const db = getTestDb();
  await db.insert(schema.gameSystems).values({
    id: SYSTEM_ID,
    slug: 'mothership',
    name: 'Mothership',
    indexSource: 'user_provided',
  });
  await db.insert(schema.campaigns).values({
    id: CAMPAIGN_ID,
    systemId: SYSTEM_ID,
    name: 'Snapshot Campaign',
    visibility: 'private',
    diceMode: 'soft_accountability',
    createdAt: timestampAt(0),
  });
  await db.insert(schema.adventures).values({
    id: ADVENTURE_ID,
    campaignId: CAMPAIGN_ID,
    status: 'in_progress',
    mode: 'freeform',
    createdAt: timestampAt(0),
  });
}

async function seedTurn(opts: SeedTurnOpts): Promise<void> {
  const db = getTestDb();

  const commonPlayerActionPayload = { content: opts.playerMessage };
  await db.insert(schema.gameEvents).values({
    campaignId: CAMPAIGN_ID,
    adventureId: ADVENTURE_ID,
    sequenceNumber: opts.playerActionSeq,
    eventType: 'player_action',
    actorType: 'player',
    actorId: null,
    payload: commonPlayerActionPayload,
    createdAt: timestampAt(opts.playerActionSeq * 10),
  });

  for (const preRoll of opts.dicePreRollSeqs ?? []) {
    await db.insert(schema.gameEvents).values({
      campaignId: CAMPAIGN_ID,
      adventureId: ADVENTURE_ID,
      sequenceNumber: preRoll.seq,
      eventType: 'dice_roll',
      actorType: 'gm',
      actorId: null,
      rollSource: 'system_generated',
      payload: {
        notation: preRoll.notation,
        purpose: preRoll.purpose,
        results: preRoll.results,
        modifier: 0,
        total: preRoll.total,
      },
      createdAt: timestampAt(preRoll.seq * 10),
    });
  }

  const [gmResponseRow] = await db
    .insert(schema.gameEvents)
    .values({
      campaignId: CAMPAIGN_ID,
      adventureId: ADVENTURE_ID,
      sequenceNumber: opts.gmResponseSeq,
      eventType: 'gm_response',
      actorType: 'gm',
      actorId: null,
      payload: {
        playerText: opts.narration,
        stateChanges: null,
        gmUpdates: opts.telemetryPayload.notes.original
          ? { notes: opts.telemetryPayload.notes.original }
          : null,
        diceRequests: null,
        adventureMode: null,
      },
      createdAt: timestampAt(opts.gmResponseSeq * 10),
    })
    .returning({ id: schema.gameEvents.id });

  if (opts.correction) {
    const [correctionRow] = await db
      .insert(schema.gameEvents)
      .values({
        campaignId: CAMPAIGN_ID,
        adventureId: ADVENTURE_ID,
        sequenceNumber: opts.correction.seq,
        eventType: 'correction',
        actorType: 'gm',
        actorId: null,
        payload: {
          playerText:
            opts.telemetryPayload.correction?.correctionResponse.playerText ??
            opts.narration,
          stateChanges: null,
          gmUpdates: null,
          diceRequests: null,
          adventureMode: null,
        },
        createdAt: timestampAt(opts.correction.seq * 10),
      })
      .returning({ id: schema.gameEvents.id });

    await db.execute(
      sql`UPDATE game_event SET superseded_by = ${correctionRow.id} WHERE id = ${gmResponseRow.id}`,
    );
  }

  await db.insert(schema.gameEvents).values({
    campaignId: CAMPAIGN_ID,
    adventureId: ADVENTURE_ID,
    sequenceNumber: opts.stateUpdateSeq,
    eventType: 'state_update',
    actorType: 'system',
    actorId: null,
    payload: {
      applied: opts.telemetryPayload.applied,
      thresholds: opts.telemetryPayload.thresholds,
    },
    createdAt: timestampAt(opts.stateUpdateSeq * 10),
  });

  await db.insert(schema.adventureTelemetry).values({
    adventureId: ADVENTURE_ID,
    sequenceNumber: opts.gmResponseSeq,
    payload: opts.telemetryPayload,
    createdAt: timestampAt(opts.gmResponseSeq * 10),
  });
}

function makeTelemetryPayload(
  overrides: Partial<AdventureTelemetryPayload>,
): AdventureTelemetryPayload {
  return {
    playerMessage: 'placeholder',
    snapshotSent: '<state_snapshot>…</state_snapshot>',
    originalRequest: {
      model: 'claude-sonnet-4-6',
      systemBlocks: 2,
      messageCount: 3,
      promptTokens: 1500,
      completionTokens: 420,
    },
    originalResponse: {
      playerText: 'placeholder',
      stateChanges: {},
      gmUpdates: {},
      diceRequests: [],
      adventureMode: null,
    },
    notes: { original: null, correction: null },
    applied: {
      resourcePools: {},
      entities: {},
      flags: {},
      scenarioState: {},
      worldFacts: {},
    },
    thresholds: [],
    diceRolls: [],
    rulesLookups: [],
    toolLoopIterations: 1,
    wardenPrompt: { filename: 'mothership-m7.txt', hash: 'testhash' },
    ...overrides,
  };
}

async function runReport(): Promise<string> {
  const db = getTestDb();
  const header = await queryHeader(db, ADVENTURE_ID);
  if (!header) throw new Error('header query returned null');
  const [turns, corrections] = await Promise.all([
    queryTurns(db, ADVENTURE_ID),
    queryCorrections(db, ADVENTURE_ID),
  ]);
  return renderReport({ header, turns, corrections });
}

beforeAll(async () => {
  await setupTestDb();
});

afterAll(async () => {
  await teardownTestDb();
});

beforeEach(async () => {
  await truncateAll();
});

describe('playtest-review CLI — snapshot', () => {
  let promptsDirOverride: string;
  let prevOverride: string | undefined;

  beforeEach(() => {
    // Seed a temp prompts dir that matches the recorded hash so the appendix
    // embeds without a mismatch warning. The recorded hash must equal the
    // sha256-8-char prefix of the fixture text.
    promptsDirOverride = mkdtempSync(
      join(tmpdir(), 'playtest-review-prompts-'),
    );
    writeFileSync(
      join(promptsDirOverride, 'mothership-m7.txt'),
      'Fixture Warden prompt.\n\nBody paragraph.',
    );
    prevOverride = process.env.WARDENS_PROMPTS_DIR;
    process.env.WARDENS_PROMPTS_DIR = promptsDirOverride;
  });

  afterEach(() => {
    rmSync(promptsDirOverride, { recursive: true, force: true });
    if (prevOverride === undefined) delete process.env.WARDENS_PROMPTS_DIR;
    else process.env.WARDENS_PROMPTS_DIR = prevOverride;
  });

  it('produces a stable markdown report for a 3-turn adventure with a correction, zero-result lookup, and system roll', async () => {
    await seedBaseAdventure();

    // Turn 1 — zero-result rules lookup.
    await seedTurn({
      playerActionSeq: 1,
      gmResponseSeq: 2,
      stateUpdateSeq: 3,
      playerMessage: 'I check the airlock.',
      narration: 'You approach the inner hatch. The indicator panel is dark.',
      telemetryPayload: makeTelemetryPayload({
        playerMessage: 'I check the airlock.',
        originalResponse: {
          playerText:
            'You approach the inner hatch. The indicator panel is dark.',
          stateChanges: {},
          gmUpdates: {
            notes: 'Player is circling — hint next turn if they stall.',
          },
          diceRequests: [],
          adventureMode: null,
        },
        notes: {
          original: 'Player is circling — hint next turn if they stall.',
          correction: null,
        },
        applied: {
          resourcePools: {},
          entities: {},
          flags: {
            airlock_inspected: {
              value: true,
              trigger: 'Player examined the airlock controls',
            },
          },
          scenarioState: {},
          worldFacts: {},
        },
        thresholds: [],
        rulesLookups: [
          {
            query: 'airlock operation procedure',
            limit: 3,
            resultCount: 0,
            topSimilarity: null,
            sources: [],
          },
        ],
        toolLoopIterations: 2,
        wardenPrompt: {
          filename: 'mothership-m7.txt',
          hash: hashOf('Fixture Warden prompt.\n\nBody paragraph.'),
        },
      }),
    });

    // Turn 2 — correction fires.
    await seedTurn({
      playerActionSeq: 4,
      gmResponseSeq: 5,
      stateUpdateSeq: 7,
      correction: { seq: 6 },
      playerMessage: 'I force the door.',
      narration: 'The lock shatters under your palm.',
      telemetryPayload: makeTelemetryPayload({
        playerMessage: 'I force the door.',
        originalRequest: {
          model: 'claude-sonnet-4-6',
          systemBlocks: 2,
          messageCount: 5,
          promptTokens: 1900,
          completionTokens: 510,
        },
        originalResponse: {
          playerText: 'The lock shatters under your palm.',
          stateChanges: {},
          gmUpdates: {},
          diceRequests: [],
          adventureMode: null,
        },
        notes: {
          original: null,
          correction: 'Post-correction ruling: door is reinforced, not locked.',
        },
        correction: {
          rejections: [
            {
              path: 'stateChanges.resourcePools.ghost_hp',
              reason: 'unknown resource pool',
              received: { delta: -3 },
            },
          ],
          correctionRequest: { promptTokens: 2100, completionTokens: 220 },
          correctionResponse: {
            playerText:
              'You throw your shoulder into the door — it flexes but holds. Reinforced.',
            stateChanges: {},
            gmUpdates: {
              notes: 'Post-correction ruling: door is reinforced, not locked.',
            },
            diceRequests: [],
            adventureMode: null,
          },
        },
        applied: {
          resourcePools: { dr_chen_hp: { current: 8, max: 10 } },
          entities: {},
          flags: {},
          scenarioState: {},
          worldFacts: {
            inner_door: 'reinforced composite, not a standard airlock latch',
          },
        },
        thresholds: [],
        rulesLookups: [],
        toolLoopIterations: 1,
        wardenPrompt: {
          filename: 'mothership-m7.txt',
          hash: hashOf('Fixture Warden prompt.\n\nBody paragraph.'),
        },
      }),
    });

    // Turn 3 — system-generated panic roll executed by Claude.
    await seedTurn({
      playerActionSeq: 8,
      gmResponseSeq: 11,
      stateUpdateSeq: 12,
      dicePreRollSeqs: [
        {
          seq: 9,
          notation: '1d100',
          purpose: 'Panic check — stress threshold crossed',
          results: [73],
          total: 73,
        },
        {
          seq: 10,
          notation: '1d10',
          purpose: 'Panic table roll',
          results: [6],
          total: 6,
        },
      ],
      playerMessage: 'I try to calm myself.',
      narration:
        'Your breathing hitches. The hum of the fluorescents feels like it is inside your skull.',
      telemetryPayload: makeTelemetryPayload({
        playerMessage: 'I try to calm myself.',
        originalResponse: {
          playerText:
            'Your breathing hitches. The hum of the fluorescents feels like it is inside your skull.',
          stateChanges: {},
          gmUpdates: {},
          diceRequests: [],
          adventureMode: null,
        },
        notes: { original: null, correction: null },
        originalRequest: {
          model: 'claude-sonnet-4-6',
          systemBlocks: 2,
          messageCount: 7,
          promptTokens: 2400,
          completionTokens: 310,
        },
        applied: {
          resourcePools: { dr_chen_stress: { current: 4, max: 20 } },
          entities: {},
          flags: {},
          scenarioState: {},
          worldFacts: {},
        },
        thresholds: [
          {
            pool: 'dr_chen_stress',
            finalValue: 4,
            effect: 'Panic check required — 1d100 vs stress',
          },
        ],
        diceRolls: [
          {
            source: 'system_generated',
            sequenceNumber: 9,
            notation: '1d100',
            purpose: 'Panic check — stress threshold crossed',
            results: [73],
            modifier: 0,
            total: 73,
          },
          {
            source: 'system_generated',
            sequenceNumber: 10,
            notation: '1d10',
            purpose: 'Panic table roll',
            results: [6],
            modifier: 0,
            total: 6,
          },
        ],
        rulesLookups: [
          {
            query: 'panic table result 6',
            limit: 3,
            resultCount: 2,
            topSimilarity: 0.89,
            sources: ['PSG p.42', 'PSG p.43'],
          },
        ],
        toolLoopIterations: 4,
        wardenPrompt: {
          filename: 'mothership-m7.txt',
          hash: hashOf('Fixture Warden prompt.\n\nBody paragraph.'),
        },
      }),
    });

    const markdown = await runReport();
    await expect(markdown).toMatchFileSnapshot(
      './__snapshots__/playtest-review.snapshot.md',
    );
  });
});

describe('playtest-review CLI — prompt appendix warnings', () => {
  let promptsDirOverride: string;
  let prevOverride: string | undefined;

  beforeEach(() => {
    promptsDirOverride = mkdtempSync(join(tmpdir(), 'playtest-review-warn-'));
    prevOverride = process.env.WARDENS_PROMPTS_DIR;
    process.env.WARDENS_PROMPTS_DIR = promptsDirOverride;
  });

  afterEach(() => {
    rmSync(promptsDirOverride, { recursive: true, force: true });
    if (prevOverride === undefined) delete process.env.WARDENS_PROMPTS_DIR;
    else process.env.WARDENS_PROMPTS_DIR = prevOverride;
  });

  async function seedSingleTurn(recordedHash: string): Promise<void> {
    await seedBaseAdventure();
    await seedTurn({
      playerActionSeq: 1,
      gmResponseSeq: 2,
      stateUpdateSeq: 3,
      playerMessage: 'x',
      narration: 'x',
      telemetryPayload: makeTelemetryPayload({
        playerMessage: 'x',
        originalResponse: {
          playerText: 'x',
          stateChanges: {},
          gmUpdates: {},
          diceRequests: [],
          adventureMode: null,
        },
        wardenPrompt: { filename: 'mothership-m7.txt', hash: recordedHash },
      }),
    });
  }

  it('emits a hash-mismatch warning when the on-disk file differs from the recorded hash', async () => {
    // Current on-disk content hashes differently from the recorded `oldhash`.
    writeFileSync(
      join(promptsDirOverride, 'mothership-m7.txt'),
      'Edited prompt body.',
    );
    await seedSingleTurn('oldhash1');
    const markdown = await runReport();

    expect(markdown).toContain('⚠️ **Prompt hash mismatch.**');
    expect(markdown).toContain('recorded hash `oldhash1`');
    const currentHash = hashOf('Edited prompt body.');
    expect(markdown).toContain(`on disk currently hashes to`);
    expect(markdown).toContain(currentHash);
    // The current file text is still embedded after the warning.
    expect(markdown).toContain('Edited prompt body.');
  });

  it('emits a missing-file warning when the named prompt no longer exists on disk', async () => {
    // No file written to promptsDirOverride — directory is empty.
    await seedSingleTurn('ghosthash');
    const markdown = await runReport();

    expect(markdown).toContain('⚠️ **Prompt file missing.**');
    expect(markdown).toContain('Telemetry recorded hash `ghosthash`');
    // No fenced code block following the warning — there's no text to embed.
    const warningIdx = markdown.indexOf('⚠️ **Prompt file missing.**');
    const afterWarning = markdown.slice(warningIdx);
    expect(afterWarning).not.toMatch(/^```/m);
  });
});

describe('playtest-review CLI — zero-turn guard', () => {
  it('queryHeader reports turn_count=0 for an adventure with no gm_response events', async () => {
    await seedBaseAdventure();
    const header = await queryHeader(getTestDb(), ADVENTURE_ID);
    expect(header).not.toBeNull();
    expect(header!.turnCount).toBe(0);
  });
});

// Helper — duplicates `hashPromptText` from src/wardens/prompt-paths.ts. Inlined
// here so the fixture is self-contained and a reader can verify the recorded
// hashes match their source text without jumping modules.
import { createHash } from 'node:crypto';

function hashOf(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 8);
}
