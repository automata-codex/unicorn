import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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

import { defaultRunEvalDeps, runEval } from './eval-run.core';

import { readManifest } from '../eval/runs/manifest';
import { listRepDirsOnDisk, repDirName } from '../eval/runs/paths';
import { readVouchedRows } from '../eval/runs/scores';

// Full turns through SessionService.sendMessage make a real, token-costing
// Anthropic call. Gated so `npm run test:integration` stays free and fast
// by default — same convention as `harness-runner.spec-int.ts`. Run
// manually with RUN_LIVE_EVAL_TESTS=1.
const RUN_LIVE = process.env.RUN_LIVE_EVAL_TESTS === '1';

// DATABASE_URL is pointed at zoltar_test by vitest-integration-setup.ts
// before this file's own imports resolve — see that file for why setting
// it here would be too late.

beforeAll(() => setupTestDb());
afterAll(() => teardownTestDb());
beforeEach(() => truncateAll());

async function seedPrereqs(): Promise<void> {
  const db = getTestDb();
  await db.insert(schema.gameSystems).values({
    slug: 'mothership',
    name: 'Mothership',
    indexSource: 'user_provided',
  });
  await db.insert(schema.users).values({ id: 'u1', email: 'alice@x.test' });
}

const PROMPT_PATH = join(
  __dirname,
  '..',
  'src',
  'wardens',
  'prompts',
  'mothership-m7.txt',
);

const FIXTURE_ID = 'eval-run-int-fixture';

const FIXTURE = {
  id: FIXTURE_ID,
  tag: 'SYSTEM-ROLLED-PLAYER-ACTION',
  sourceAdventureId: '00000000-0000-0000-0000-000000000001',
  sourceSequenceNumber: 1,
  seededState: {
    campaignState: {
      schemaVersion: 1,
      resourcePools: { alvarez_hp: { max: 20, current: 20 } },
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
    check: 'player rolls their own action, not the system',
  },
};

describe.skipIf(!RUN_LIVE)(
  'eval:run (integration, LIVE Anthropic calls, gated by RUN_LIVE_EVAL_TESTS=1)',
  () => {
    let evalRoot: string;
    let fixturesDir: string;
    const originalEvalRoot = process.env.ZOLTAR_EVAL_ROOT;

    beforeEach(() => {
      evalRoot = mkdtempSync(join(tmpdir(), 'eval-run-int-root-'));
      fixturesDir = mkdtempSync(join(tmpdir(), 'eval-run-int-fixtures-'));
      writeFileSync(join(fixturesDir, 'fixture.json'), JSON.stringify(FIXTURE));
      process.env.ZOLTAR_EVAL_ROOT = evalRoot;
    });

    afterEach(() => {
      rmSync(evalRoot, { recursive: true, force: true });
      rmSync(fixturesDir, { recursive: true, force: true });
      if (originalEvalRoot === undefined) {
        delete process.env.ZOLTAR_EVAL_ROOT;
      } else {
        process.env.ZOLTAR_EVAL_ROOT = originalEvalRoot;
      }
    });

    it(
      'produces a well-formed artifact tree, valid rows, two vouched reps, and leaves no __eval__ campaigns behind',
      async () => {
        await seedPrereqs();

        const summary = await runEval(
          {
            promptPath: PROMPT_PATH,
            model: 'claude-sonnet-4-6',
            reps: 2,
            fixturesDir,
            temperature: 1.0,
            keepScratch: false,
          },
          defaultRunEvalDeps(),
        );

        expect(listRepDirsOnDisk(summary.runDir)).toEqual([1, 2]);
        const manifest = readManifest(summary.runDir);
        expect(manifest.completedReps.map((r) => r.index)).toEqual([1, 2]);
        expect(manifest.completedReps.every((r) => r.fixtureIds.includes(FIXTURE_ID))).toBe(
          true,
        );

        const { rows, exclusions } = readVouchedRows(summary.runDir);
        expect(exclusions).toEqual([]);
        // 2 reps × 1 fixture × 1 check (one check per fixture today).
        expect(rows).toHaveLength(2);

        for (const row of rows) {
          expect(['pass', 'fail', 'not_applicable', 'error']).toContain(
            row.verdict,
          );
          expect(existsSync(join(summary.runDir, row.artifactPath))).toBe(true);
        }

        for (const repIndex of [1, 2]) {
          const requestPath = join(
            summary.runDir,
            'reps',
            repDirName(repIndex),
            FIXTURE_ID,
            'warden-request.json',
          );
          const outputPath = join(
            summary.runDir,
            'reps',
            repDirName(repIndex),
            FIXTURE_ID,
            'warden-output.json',
          );
          expect(existsSync(requestPath)).toBe(true);
          expect(existsSync(outputPath)).toBe(true);

          const requests = JSON.parse(readFileSync(requestPath, 'utf-8'));
          expect(Array.isArray(requests)).toBe(true);
          expect(requests.length).toBeGreaterThan(0);
          expect(requests[0].request.model).toBe('claude-sonnet-4-6');
          expect(requests[0].request.temperature).toBe(1.0);
        }

        const campaigns = await getTestDb().select().from(schema.campaigns);
        const scratchCampaigns = campaigns.filter((c) =>
          c.name.startsWith(`__eval__${FIXTURE_ID}__`),
        );
        expect(scratchCampaigns).toHaveLength(0);
      },
      180_000,
    );
  },
);
