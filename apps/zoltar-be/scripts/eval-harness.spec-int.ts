import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

import { runHarness } from './eval-harness.core';

// `runHarness` bootstraps the real AppModule (ANTHROPIC_API_KEY/VOYAGE_API_KEY/
// DATABASE_URL/NODE_ENV via ConfigService). `.env` loading and pointing
// DATABASE_URL at zoltar_test both happen in vitest-integration-setup.ts,
// before this file's own imports resolve — doing it here would be too late;
// see that file for why.

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

const BASE_SEEDED_STATE = {
  campaignState: {
    schemaVersion: 1,
    resourcePools: {},
    entities: {},
    flags: {},
    scenarioState: {},
    worldFacts: {},
  },
  gmContextBlob: {},
  pendingCanon: [],
  messages: [],
  capturedAt: '2026-07-15T00:00:00.000Z',
};

// Both use the diceResult path (no live Anthropic call — applyDiceResultAtomic
// never touches Claude) so this test file stays free and fast by default,
// same reasoning as harness-runner.spec-int.ts's diceResult-path test.
const PASS_FIXTURE = {
  id: 'pass-fixture',
  tag: 'SYSTEM-ROLLED-PLAYER-ACTION',
  sourceAdventureId: '00000000-0000-0000-0000-000000000001',
  sourceSequenceNumber: 1,
  seededState: {
    ...BASE_SEEDED_STATE,
    pendingDiceRequests: [
      { notation: '1d10', purpose: 'Fear save', target: 30 },
    ],
  },
  playerInput: {
    type: 'diceResult',
    content: JSON.stringify({ results: [7], source: 'player_entered' }),
  },
  assertion: {
    mode: 'structural',
    check: 'player rolls their own action, not the system',
  },
};

const FAIL_FIXTURE = {
  id: 'fail-fixture',
  tag: 'SYSTEM-ROLLED-PLAYER-ACTION',
  sourceAdventureId: '00000000-0000-0000-0000-000000000002',
  sourceSequenceNumber: 1,
  seededState: {
    ...BASE_SEEDED_STATE,
    pendingDiceRequests: [
      { notation: '1d10', purpose: 'Fear save', target: 30 },
    ],
  },
  playerInput: {
    type: 'diceResult',
    content: JSON.stringify({ results: [7], source: 'system_generated' }),
  },
  assertion: {
    mode: 'structural',
    check: 'player rolls their own action, not the system',
  },
};

// Purpose "Fear save" doesn't match UNSURFACED-CHECK's stakes-gating
// heuristic, so this passes regardless of roll source — used only to
// confirm --tag filtering excludes it.
const OTHER_TAG_FIXTURE = {
  id: 'other-tag-fixture',
  tag: 'UNSURFACED-CHECK',
  sourceAdventureId: '00000000-0000-0000-0000-000000000003',
  sourceSequenceNumber: 1,
  seededState: {
    ...BASE_SEEDED_STATE,
    pendingDiceRequests: [
      { notation: '1d10', purpose: 'Fear save', target: 30 },
    ],
  },
  playerInput: {
    type: 'diceResult',
    content: JSON.stringify({ results: [7], source: 'player_entered' }),
  },
  assertion: {
    mode: 'structural',
    check: 'rolls that gate player-visible content are surfaced',
  },
};

describe('runHarness (integration)', () => {
  let fixturesDir: string;

  beforeEach(() => {
    fixturesDir = mkdtempSync(join(tmpdir(), 'eval-harness-'));
  });

  afterEach(() => {
    rmSync(fixturesDir, { recursive: true, force: true });
  });

  it('runs every valid fixture, collects load errors for broken ones, and renders a matching report', async () => {
    await seedPrereqs();
    writeFileSync(join(fixturesDir, 'pass.json'), JSON.stringify(PASS_FIXTURE));
    writeFileSync(join(fixturesDir, 'fail.json'), JSON.stringify(FAIL_FIXTURE));
    writeFileSync(
      join(fixturesDir, 'other-tag.json'),
      JSON.stringify(OTHER_TAG_FIXTURE),
    );
    writeFileSync(join(fixturesDir, 'broken.json'), '{ not valid json');

    const { report, results, loadErrors } = await runHarness({
      fixturesDir,
    });

    expect(loadErrors).toHaveLength(1);
    expect(loadErrors[0].filename).toBe('broken.json');

    expect(results).toHaveLength(3);
    const byId = Object.fromEntries(results.map((r) => [r.fixture.id, r]));
    expect(byId['pass-fixture'].passed).toBe(true);
    expect(byId['fail-fixture'].passed).toBe(false);
    expect(byId['other-tag-fixture'].passed).toBe(true);

    expect(report).toContain('Fixtures: 3  |  Passed: 2  |  Failed: 1');
    expect(report).toContain('SYSTEM-ROLLED-PLAYER-ACTION: 1/2 passed');
    expect(report).toContain('UNSURFACED-CHECK: 1/1 passed');
    expect(report).toContain('### fail-fixture — FAILED');
  });

  it('filters by --tag, excluding fixtures with a different tag', async () => {
    await seedPrereqs();
    writeFileSync(join(fixturesDir, 'pass.json'), JSON.stringify(PASS_FIXTURE));
    writeFileSync(join(fixturesDir, 'fail.json'), JSON.stringify(FAIL_FIXTURE));
    writeFileSync(
      join(fixturesDir, 'other-tag.json'),
      JSON.stringify(OTHER_TAG_FIXTURE),
    );

    const { results } = await runHarness({
      fixturesDir,
      tags: ['SYSTEM-ROLLED-PLAYER-ACTION'],
    });

    expect(results.map((r) => r.fixture.id).sort()).toEqual([
      'fail-fixture',
      'pass-fixture',
    ]);
  });

  it('does not crash the run when one fixture file is invalid JSON', async () => {
    await seedPrereqs();
    writeFileSync(join(fixturesDir, 'pass.json'), JSON.stringify(PASS_FIXTURE));
    writeFileSync(join(fixturesDir, 'broken.json'), '{ not valid json');

    const { results, loadErrors } = await runHarness({ fixturesDir });

    expect(loadErrors).toHaveLength(1);
    expect(results).toHaveLength(1);
    expect(results[0].fixture.id).toBe('pass-fixture');
  });

  it('leaves the scratch campaign in place when keepScratch is true', async () => {
    await seedPrereqs();
    writeFileSync(join(fixturesDir, 'pass.json'), JSON.stringify(PASS_FIXTURE));

    await runHarness({ fixturesDir, keepScratch: true });

    const campaigns = await getTestDb().select().from(schema.campaigns);
    const scratchCampaigns = campaigns.filter((c) =>
      c.name.startsWith('__eval__pass-fixture__'),
    );
    expect(scratchCampaigns).toHaveLength(1);
  });
});
