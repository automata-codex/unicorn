import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeTurnExecutionResult } from '../eval/checks/structural/test-helpers';
import { readManifest } from '../eval/runs/manifest';
import { listRepDirsOnDisk, repDir, scoresPath } from '../eval/runs/paths';
import { ScoreWriter, readVouchedRows } from '../eval/runs/scores';

import { runEval } from './eval-run.core';

import type { RunEvalArgs, RunEvalDeps, TurnExecutor } from './eval-run.core';
import type { HarnessSession } from '../eval/harness-runner';
import type { ScoreRow } from '../eval/runs/scores';

const SEEDED_STATE = {
  campaignState: {},
  gmContextBlob: {},
  pendingCanon: [],
  messages: [],
  pendingDiceRequests: [],
  capturedAt: '2026-07-15T00:00:00.000Z',
};

function writeFixtureFile(
  dir: string,
  opts: { id: string; tag: string; repOverride?: number },
): void {
  writeFileSync(
    join(dir, `${opts.id}.json`),
    JSON.stringify({
      id: opts.id,
      tag: opts.tag,
      sourceAdventureId: '00000000-0000-0000-0000-000000000001',
      sourceSequenceNumber: 1,
      seededState: SEEDED_STATE,
      playerInput: { type: 'message', content: 'test' },
      assertion: { mode: 'structural', check: 'test' },
      ...(opts.repOverride !== undefined
        ? { repOverride: opts.repOverride }
        : {}),
    }),
  );
}

function stubDeps(
  overrides: Partial<{ runTurn: TurnExecutor['runTurn'] }> = {},
): RunEvalDeps {
  const seed = vi.fn(async (_db: unknown, fixture: { id: string }) => ({
    campaignId: `campaign-${fixture.id}`,
    adventureId: `adventure-${fixture.id}`,
    playerUserId: 'user-1',
    warnings: [] as string[],
  }));
  const runTurn =
    overrides.runTurn ?? vi.fn(async () => fakeTurnExecutionResult());
  const teardown = vi.fn(async () => {});

  return {
    turnExecutor: {
      seed: seed as unknown as TurnExecutor['seed'],
      runTurn: runTurn as unknown as TurnExecutor['runTurn'],
      teardown: teardown as unknown as TurnExecutor['teardown'],
    },
    harnessSessionFactory: async () =>
      ({
        db: {} as HarnessSession['db'],
        sessionService: {} as HarnessSession['sessionService'],
        anthropicService: {} as HarnessSession['anthropicService'],
        recorder: undefined,
        close: vi.fn(async () => {}),
      }) satisfies HarnessSession,
    clock: () => new Date(),
  };
}

describe('runEval', () => {
  let evalRoot: string;
  let fixturesDir: string;
  let promptsDirPath: string;
  let promptPath: string;

  const originalEnv = {
    ZOLTAR_EVAL_ROOT: process.env.ZOLTAR_EVAL_ROOT,
    WARDENS_PROMPTS_DIR: process.env.WARDENS_PROMPTS_DIR,
    WARDEN_PROMPT_OVERRIDE_MOTHERSHIP: process.env.WARDEN_PROMPT_OVERRIDE_MOTHERSHIP,
  };

  beforeEach(() => {
    evalRoot = mkdtempSync(join(tmpdir(), 'eval-root-'));
    fixturesDir = mkdtempSync(join(tmpdir(), 'eval-fixtures-'));
    promptsDirPath = mkdtempSync(join(tmpdir(), 'eval-prompts-'));
    promptPath = join(promptsDirPath, 'mothership-test.txt');
    writeFileSync(promptPath, 'You are the Warden (test prompt).');

    process.env.ZOLTAR_EVAL_ROOT = evalRoot;
    process.env.WARDENS_PROMPTS_DIR = promptsDirPath;
  });

  afterEach(() => {
    rmSync(evalRoot, { recursive: true, force: true });
    rmSync(fixturesDir, { recursive: true, force: true });
    rmSync(promptsDirPath, { recursive: true, force: true });

    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  function baseArgs(overrides: Partial<RunEvalArgs> = {}): RunEvalArgs {
    return {
      promptPath,
      model: 'claude-sonnet-4-6',
      reps: 1,
      fixturesDir,
      temperature: 1.0,
      keepScratch: false,
      ...overrides,
    };
  }

  it('a 3-rep run produces 3 rep directories, 3 vouched completedReps, and reps × fixtures × checks rows', async () => {
    writeFixtureFile(fixturesDir, {
      id: 'fixture-a',
      tag: 'SYSTEM-ROLLED-PLAYER-ACTION',
    });
    writeFixtureFile(fixturesDir, { id: 'fixture-b', tag: 'UNAUDITABLE-MAPPING' });

    const summary = await runEval(baseArgs({ reps: 3 }), stubDeps());

    expect(listRepDirsOnDisk(summary.runDir)).toEqual([1, 2, 3]);
    const manifest = readManifest(summary.runDir);
    expect(manifest.completedReps.map((r) => r.index)).toEqual([1, 2, 3]);

    const { rows, exclusions } = readVouchedRows(summary.runDir);
    expect(exclusions).toEqual([]);
    // 3 reps × 2 fixtures × 1 check each (one check per fixture today).
    expect(rows).toHaveLength(6);
  });

  it('appending 2 more reps to the same --run-dir continues at index 4 and leaves plannedReps untouched', async () => {
    writeFixtureFile(fixturesDir, {
      id: 'fixture-a',
      tag: 'SYSTEM-ROLLED-PLAYER-ACTION',
    });

    const first = await runEval(baseArgs({ reps: 3 }), stubDeps());
    const second = await runEval(
      baseArgs({ reps: 2, runDir: basename(first.runDir) }),
      stubDeps(),
    );

    expect(second.repsRun).toEqual([4, 5]);
    const manifest = readManifest(first.runDir);
    expect(manifest.completedReps.map((r) => r.index)).toEqual([1, 2, 3, 4, 5]);
    expect(manifest.plannedReps).toBe(3);
  });

  it('aborts before writing anything when --run-dir model/prompt/temperature mismatch', async () => {
    writeFixtureFile(fixturesDir, {
      id: 'fixture-a',
      tag: 'SYSTEM-ROLLED-PLAYER-ACTION',
    });
    const first = await runEval(baseArgs({ reps: 1 }), stubDeps());

    await expect(
      runEval(
        baseArgs({
          reps: 1,
          runDir: basename(first.runDir),
          model: 'claude-opus-5',
        }),
        stubDeps(),
      ),
    ).rejects.toThrow(/does not match the requested run/);

    const manifest = readManifest(first.runDir);
    expect(manifest.completedReps).toHaveLength(1);
    expect(listRepDirsOnDisk(first.runDir)).toEqual([1]);
  });

  it('a stub turn that throws yields error rows, not fail, and does not abort the rep', async () => {
    writeFixtureFile(fixturesDir, {
      id: 'fixture-a',
      tag: 'SYSTEM-ROLLED-PLAYER-ACTION',
    });
    const deps = stubDeps({
      runTurn: vi.fn(async () => {
        throw new Error('boom');
      }),
    });

    const summary = await runEval(baseArgs({ reps: 1 }), deps);

    const { rows } = readVouchedRows(summary.runDir);
    expect(rows).toHaveLength(1);
    expect(rows[0].verdict).toBe('error');
    expect(rows[0].errorMessage).toBe('boom');

    const manifest = readManifest(summary.runDir);
    expect(manifest.completedReps).toHaveLength(1);
    expect(manifest.completedReps[0].fixtureIds).toEqual(['fixture-a']);
  });

  it('vouches the rep for every fixture it covered, even when one fixture errors mid-rep', async () => {
    writeFixtureFile(fixturesDir, {
      id: 'fixture-a',
      tag: 'SYSTEM-ROLLED-PLAYER-ACTION',
    });
    writeFixtureFile(fixturesDir, { id: 'fixture-b', tag: 'UNAUDITABLE-MAPPING' });

    let call = 0;
    const deps = stubDeps({
      runTurn: vi.fn(async () => {
        call += 1;
        if (call === 2) throw new Error('boom on second fixture');
        return fakeTurnExecutionResult();
      }),
    });

    const summary = await runEval(baseArgs({ reps: 1 }), deps);

    const manifest = readManifest(summary.runDir);
    expect(manifest.completedReps[0].fixtureIds.slice().sort()).toEqual([
      'fixture-a',
      'fixture-b',
    ]);

    const { rows } = readVouchedRows(summary.runDir);
    const verdictsByFixture = new Map(rows.map((r) => [r.fixtureId, r.verdict]));
    expect(verdictsByFixture.get('fixture-b')).toBe('error');
  });

  it('a rep written to disk but never vouched is ignored by readVouchedRows and reported', async () => {
    writeFixtureFile(fixturesDir, {
      id: 'fixture-a',
      tag: 'SYSTEM-ROLLED-PLAYER-ACTION',
    });
    const summary = await runEval(baseArgs({ reps: 1 }), stubDeps());

    // Simulate a crashed rep 2: scores.jsonl written, appendCompletedRep
    // never called — the exact "close(), then crash before vouching" case
    // Part 1's manifest.spec.ts covers directly; this confirms it holds
    // true against a real eval:run-created directory too.
    mkdirSync(repDir(summary.runDir, 2), { recursive: true });
    const writer = new ScoreWriter();
    writer.open(scoresPath(summary.runDir, 2));
    writer.append({
      runId: basename(summary.runDir),
      model: 'claude-sonnet-4-6',
      promptHash: 'deadbeef',
      temperature: 1.0,
      corpusVersion: 'abc',
      harnessVersion: 'abc1234',
      repIndex: 2,
      fixtureId: 'fixture-a',
      checkId: 'system-rolled-player-action',
      tag: 'SYSTEM-ROLLED-PLAYER-ACTION',
      checkMode: 'structural',
      verdict: 'pass',
      artifactPath: 'reps/002/fixture-a/warden-output.json',
      durationMs: 1,
      recordedAt: new Date().toISOString(),
    } satisfies ScoreRow);
    await writer.close();

    const { rows, exclusions } = readVouchedRows(summary.runDir);
    expect(rows.every((r) => r.repIndex === 1)).toBe(true);
    expect(exclusions.some((e) => e.includes('002') && e.includes('not vouched'))).toBe(
      true,
    );
  });

  it('repOverride limits a fixture to its override while others run the full --reps', async () => {
    writeFixtureFile(fixturesDir, {
      id: 'fixture-a',
      tag: 'SYSTEM-ROLLED-PLAYER-ACTION',
      repOverride: 1,
    });
    writeFixtureFile(fixturesDir, { id: 'fixture-b', tag: 'UNAUDITABLE-MAPPING' });

    const summary = await runEval(baseArgs({ reps: 3 }), stubDeps());

    const { rows } = readVouchedRows(summary.runDir);
    expect(rows.filter((r) => r.fixtureId === 'fixture-a')).toHaveLength(1);
    expect(rows.filter((r) => r.fixtureId === 'fixture-b')).toHaveLength(3);
  });

  it('warns but completes when appending reps beyond plannedReps', async () => {
    writeFixtureFile(fixturesDir, {
      id: 'fixture-a',
      tag: 'SYSTEM-ROLLED-PLAYER-ACTION',
    });
    const first = await runEval(baseArgs({ reps: 1 }), stubDeps());
    const second = await runEval(
      baseArgs({ reps: 1, runDir: basename(first.runDir) }),
      stubDeps(),
    );

    expect(second.warnings.some((w) => w.includes('exceeds plannedReps'))).toBe(
      true,
    );
    const manifest = readManifest(first.runDir);
    expect(manifest.completedReps).toHaveLength(2);
  });

  it('emits rep-start/fixture-start/fixture-done/rep-done in order for every rep and fixture', async () => {
    writeFixtureFile(fixturesDir, {
      id: 'fixture-a',
      tag: 'SYSTEM-ROLLED-PLAYER-ACTION',
    });
    writeFixtureFile(fixturesDir, { id: 'fixture-b', tag: 'UNAUDITABLE-MAPPING' });

    const events: string[] = [];
    await runEval(
      baseArgs({
        reps: 2,
        onProgress: (event) => {
          events.push(
            event.type === 'fixture-start' || event.type === 'fixture-done'
              ? `${event.type}:${event.repIndex}:${event.fixtureId}`
              : `${event.type}:${event.repIndex}`,
          );
        },
      }),
      stubDeps(),
    );

    expect(events).toEqual([
      'rep-start:1',
      'fixture-start:1:fixture-a',
      'fixture-done:1:fixture-a',
      'fixture-start:1:fixture-b',
      'fixture-done:1:fixture-b',
      'rep-done:1',
      'rep-start:2',
      'fixture-start:2:fixture-a',
      'fixture-done:2:fixture-a',
      'fixture-start:2:fixture-b',
      'fixture-done:2:fixture-b',
      'rep-done:2',
    ]);
  });

  it('fixture-done carries the verdicts recorded for that fixture', async () => {
    writeFixtureFile(fixturesDir, {
      id: 'fixture-a',
      tag: 'SYSTEM-ROLLED-PLAYER-ACTION',
    });

    const doneEvents: Array<{ fixtureId: string; verdicts: string[] }> = [];
    await runEval(
      baseArgs({
        reps: 1,
        onProgress: (event) => {
          if (event.type === 'fixture-done') {
            doneEvents.push({ fixtureId: event.fixtureId, verdicts: event.verdicts });
          }
        },
      }),
      stubDeps(),
    );

    expect(doneEvents).toHaveLength(1);
    expect(doneEvents[0].fixtureId).toBe('fixture-a');
    expect(doneEvents[0].verdicts.length).toBeGreaterThan(0);
  });

  it('a thrown turn still reports fixture-done, with an error verdict', async () => {
    writeFixtureFile(fixturesDir, {
      id: 'fixture-a',
      tag: 'SYSTEM-ROLLED-PLAYER-ACTION',
    });
    const deps = stubDeps({
      runTurn: vi.fn(async () => {
        throw new Error('boom');
      }),
    });

    const doneEvents: Array<{ verdicts: string[] }> = [];
    await runEval(
      baseArgs({
        reps: 1,
        onProgress: (event) => {
          if (event.type === 'fixture-done') doneEvents.push({ verdicts: event.verdicts });
        },
      }),
      deps,
    );

    expect(doneEvents).toEqual([{ verdicts: ['error'] }]);
  });
});

describe('guard: no reconstructStateAsOfTurn import', () => {
  // Production source only — this guard is about the import graph, and a
  // `.spec.ts` file describing the invariant (this one included) is allowed
  // to mention the string without violating it.
  function isSpecFile(filename: string): boolean {
    return /\.spec(-int)?\.ts$/.test(filename);
  }

  function collectTsFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...collectTsFiles(full));
      } else if (entry.name.endsWith('.ts') && !isSpecFile(entry.name)) {
        out.push(full);
      }
    }
    return out;
  }

  it('nothing under eval/ or scripts/eval-* imports src/replay/reconstruct-state', () => {
    const evalDir = join(__dirname, '..', 'eval');
    const scriptsDir = join(__dirname, '..', 'scripts');

    const files = [
      ...collectTsFiles(evalDir),
      ...readdirSync(scriptsDir)
        .filter(
          (f) => f.startsWith('eval-') && f.endsWith('.ts') && !isSpecFile(f),
        )
        .map((f) => join(scriptsDir, f)),
    ];

    const violations = files.filter((f) =>
      readFileSync(f, 'utf-8').includes('reconstruct-state'),
    );
    expect(violations).toEqual([]);
  });
});

describe('guard: only eval-run.default-deps.ts value-imports harness-runner.ts', () => {
  // `harness-runner.ts` imports `AppModule`, whose `@Module()` decorator
  // eagerly calls `ConfigModule.forRoot()` — an *async* method, so a
  // synchronous `validate()` throw inside it becomes a rejected promise,
  // not a direct exception. Nothing in a plain `.spec.ts` unit test ever
  // awaits that promise (it never bootstraps the real Nest DI container),
  // so the rejection is genuinely unhandled — and *when* Vitest reports an
  // unhandled rejection relative to "which test is currently running" is a
  // timing race, not something a single local re-run reliably reproduces.
  // This is a *static* guard instead: it doesn't matter whether the race
  // happens to fire on any given run, because the only way to eliminate
  // the hazard entirely is to never call `ConfigModule.forRoot()` from a
  // file a `.spec.ts` test can reach in the first place. This regression
  // (`eval-run.core.ts` had exactly this value import once already) is
  // exactly what this test exists to catch, deterministically, every time.
  //
  // `eval-run.default-deps.ts` is the one deliberate exception — see its
  // own doc comment — and `*.spec-int.ts` files are excluded from the
  // default Vitest config already, so a value import there is fine too.
  const ALLOWED_VALUE_IMPORTERS = new Set(['eval-run.default-deps.ts']);

  function isSpecIntFile(filename: string): boolean {
    return /\.spec-int\.ts$/.test(filename);
  }

  function collectTsFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...collectTsFiles(full));
      } else if (entry.name.endsWith('.ts') && !isSpecIntFile(entry.name)) {
        out.push(full);
      }
    }
    return out;
  }

  it('no other scripts/ or eval/ file does', () => {
    const evalDir = join(__dirname, '..', 'eval');
    const scriptsDir = join(__dirname, '..', 'scripts');
    // Anchored to line-start (real import statements in this codebase's
    // style always start at column 0) so a comment that happens to contain
    // the word "import" can never produce a false positive.
    const valueImportPattern =
      /^import\s+(?!type\b)[^;]*?\bfrom\s+['"](\.\.\/)*(eval\/)?harness-runner['"]/m;

    const files = [...collectTsFiles(evalDir), ...collectTsFiles(scriptsDir)].filter(
      (f) => f.endsWith('harness-runner.ts') === false,
    );

    const violations = files.filter((f) => {
      if (ALLOWED_VALUE_IMPORTERS.has(basename(f))) return false;
      return valueImportPattern.test(readFileSync(f, 'utf-8'));
    });
    expect(violations).toEqual([]);
  });
});
