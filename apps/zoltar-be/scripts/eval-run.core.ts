import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { rubricTextFor, selectChecksForFixture } from '../eval/checks/registry';
import { runCheck } from '../eval/checks/run-check';
import { computeCorpusVersion } from '../eval/corpus-version';
import { loadFixtures } from '../eval/fixture-loader';
import {
  relativeArtifactPath,
  writeFixtureArtifacts,
  writeJudgeArtifact,
  writeWardenRequestArtifact,
} from '../eval/runs/artifacts';
import {
  appendCompletedRep,
  assertManifestMatches,
  createRunDirectory,
  nextRepIndex,
  readManifest,
} from '../eval/runs/manifest';
import {
  judgeArtifactPath,
  repDir,
  resolveEvalRoot,
  resolveRunDirArg,
  rubricPath,
  scoresPath,
  wardenOutputPath,
  wardenRequestPath,
} from '../eval/runs/paths';
import { ScoreWriter } from '../eval/runs/scores';
import { hashPromptText, promptsDir } from '../src/wardens/prompt-paths';

import type { EvalCheck } from '../eval/checks/registry';
import type { EvalFixture } from '../eval/fixture.schema';
// Type-only, deliberately — `harness-runner.ts` imports `AppModule`, whose
// `@Module()` decorator eagerly runs `ConfigModule.forRoot()`'s env
// validation the moment the file is loaded (see `turn-result.ts`'s doc
// comment for the same hazard, hit once already in this codebase). A plain
// value import here would mean any file importing `runEval` for its stub-
// deps unit tests — which never touches the real harness session — drags
// in that validation anyway and throws in any environment without real
// DATABASE_URL/ANTHROPIC_API_KEY/VOYAGE_API_KEY, e.g. CI's unit-test job.
// `defaultRunEvalDeps` below loads the real values lazily instead.
import type {
  CreateHarnessSessionOptions,
  HarnessSession,
  ScratchAdventure,
  createHarnessSession,
  runFixtureTurn,
  seedScratchAdventure,
  teardownScratchAdventure,
} from '../eval/harness-runner';
import type { Verdict } from '../eval/runs/scores';

export interface TurnExecutor {
  seed: typeof seedScratchAdventure;
  runTurn: typeof runFixtureTurn;
  teardown: typeof teardownScratchAdventure;
}

export interface RunEvalDeps {
  turnExecutor: TurnExecutor;
  harnessSessionFactory: (
    opts: CreateHarnessSessionOptions,
  ) => Promise<HarnessSession>;
  clock: () => Date;
}

/** The real wiring — `runEval` never constructs these itself, so a test can
 * swap in a stub executor with no DB and no API key. Loads `harness-runner.ts`
 * lazily (see the import comment above) so merely importing this module —
 * as every `eval-run.spec.ts` test does, via `runEval` — never touches it. */
export async function defaultRunEvalDeps(): Promise<RunEvalDeps> {
  const {
    createHarnessSession,
    runFixtureTurn,
    seedScratchAdventure,
    teardownScratchAdventure,
  } = await import('../eval/harness-runner.js');
  return {
    turnExecutor: {
      seed: seedScratchAdventure,
      runTurn: runFixtureTurn,
      teardown: teardownScratchAdventure,
    },
    harnessSessionFactory: createHarnessSession,
    clock: () => new Date(),
  };
}

export interface RunEvalArgs {
  /** Path to a prompt file. Must byte-match a file already present under
   * `src/wardens/prompts/` — see `assertPromptInstalled`. */
  promptPath: string;
  model: string;
  reps: number;
  fixturesDir: string;
  /** Fixture ids to run. Omitted = every fixture in `fixturesDir`. */
  fixtureIds?: string[];
  /** An existing run directory — bare name (resolved against
   * `$ZOLTAR_EVAL_ROOT/eval-runs/`) or absolute path. Omitted creates a new
   * directory. */
  runDir?: string;
  temperature: number;
  decisionRule?: string;
  keepScratch: boolean;
  onProgress?: (event: RunEvalProgressEvent) => void;
}

export interface RunEvalSummary {
  runDir: string;
  repsRun: number[];
  rowCounts: Record<Verdict, number>;
  warnings: string[];
}

/** Fired around each rep and each fixture so a long invocation — a full
 * corpus at `--reps 10` can take a long time, most fixtures making a real,
 * possibly-slow Anthropic call — can report progress instead of appearing
 * to hang. Omitted by tests/callers that don't care. */
export type RunEvalProgressEvent =
  | { type: 'rep-start'; repIndex: number; repNumber: number; totalReps: number }
  | {
      type: 'rep-done';
      repIndex: number;
      repNumber: number;
      totalReps: number;
      durationMs: number;
    }
  | {
      type: 'fixture-start';
      repIndex: number;
      fixtureId: string;
      fixtureIndex: number;
      totalFixtures: number;
    }
  | {
      type: 'fixture-done';
      repIndex: number;
      fixtureId: string;
      fixtureIndex: number;
      totalFixtures: number;
      durationMs: number;
      verdicts: Verdict[];
    };

/**
 * `git rev-parse --short HEAD` plus a `-dirty` suffix from `git status
 * --porcelain .` scoped to this package directory, `unknown` on failure
 * (e.g. running outside a git checkout). Executed once per invocation, not
 * per rep — `harnessVersion` is recorded on every rep and every row, but
 * doesn't change mid-invocation.
 */
function getHarnessVersion(): string {
  const packageRoot = join(__dirname, '..'); // apps/zoltar-be
  try {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: packageRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    const statusOutput = execFileSync('git', ['status', '--porcelain', '.'], {
      cwd: packageRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    return statusOutput.length > 0 ? `${sha}-dirty` : sha;
  } catch {
    return 'unknown';
  }
}

/**
 * Asserts `promptPath` byte-matches a file already present under
 * `src/wardens/prompts/` — `WardenPromptsService` only ever selects among
 * files already in that directory (via `WARDEN_PROMPT_OVERRIDE_MOTHERSHIP`);
 * there is no supported path by which an arbitrary file becomes the live
 * Warden prompt. Returns the text and its hash so the caller doesn't reread
 * the file.
 */
function assertPromptInstalled(promptPath: string): {
  text: string;
  hash: string;
  basename: string;
} {
  const text = readFileSync(promptPath, 'utf-8');
  const hash = hashPromptText(text);
  const base = basename(promptPath);
  const installedPath = join(promptsDir(), base);

  if (!existsSync(installedPath)) {
    throw new Error(
      `--prompt "${promptPath}" (basename "${base}") is not present under ` +
        `${promptsDir()}. Put the prompt variant there first — ` +
        'WardenPromptsService only selects among files already in that directory.',
    );
  }
  const installedText = readFileSync(installedPath, 'utf-8');
  if (installedText !== text) {
    throw new Error(
      `--prompt "${promptPath}" does not byte-match ${installedPath} — the ` +
        'installed copy has diverged from the file you pointed at. Put the ' +
        `exact variant under ${promptsDir()} before running.`,
    );
  }

  return { text, hash, basename: base };
}

/**
 * The integration point: everything Parts 1–4 built is exercised here for
 * the first time. `deps` is the reviewability point of this part — it makes
 * the rep/manifest/commit-protocol orchestration unit-testable with a stub
 * executor, no DB and no API key, while `defaultRunEvalDeps()` keeps the
 * real wiring a thin default.
 */
export async function runEval(
  args: RunEvalArgs,
  deps: RunEvalDeps,
): Promise<RunEvalSummary> {
  const root = resolveEvalRoot();

  const prompt = assertPromptInstalled(args.promptPath);
  // Must be set before any harness session is created —
  // `WardenPromptsService.onModuleInit` resolves the selected prompt once,
  // at that point, and caches it for the process lifetime.
  process.env.WARDEN_PROMPT_OVERRIDE_MOTHERSHIP = prompt.basename;

  // Recomputed fresh every invocation, even one appending to an existing
  // run directory — `manifest.corpusVersion` is fixed at creation time, but
  // each row carries the corpus as it stood for *that* rep, since reps may
  // be appended weeks apart against a changed fixture corpus.
  const corpusVersion = await computeCorpusVersion(args.fixturesDir);

  let runDir: string;
  if (args.runDir) {
    runDir = resolveRunDirArg(root, args.runDir);
    const existing = readManifest(runDir);
    assertManifestMatches(existing, {
      model: args.model,
      promptHash: prompt.hash,
      temperature: args.temperature,
    });
  } else {
    runDir = createRunDirectory({
      root,
      model: args.model,
      promptHash: prompt.hash,
      promptText: prompt.text,
      temperature: args.temperature,
      corpusVersion,
      plannedReps: args.reps,
      decisionRule: args.decisionRule,
      createdAt: deps.clock(),
    });
  }
  const manifest = readManifest(runDir);

  const { fixtures, errors: loadErrors } = await loadFixtures(
    args.fixturesDir,
  );
  const warnings = loadErrors.map((e) => `fixture load error: ${e.message}`);

  const selectedFixtures = args.fixtureIds
    ? fixtures.filter((f) => args.fixtureIds!.includes(f.id))
    : fixtures;
  if (args.fixtureIds) {
    const foundIds = new Set(selectedFixtures.map((f) => f.id));
    const missing = args.fixtureIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      throw new Error(
        `--fixtures references unknown fixture id(s): ${missing.join(', ')}`,
      );
    }
  }
  if (selectedFixtures.length === 0) {
    throw new Error('no fixtures selected to run');
  }

  // Per-fixture rep count, resolved once before rep 1 — nothing writes to
  // this map afterward. This is what makes "no adaptive mode" a structural
  // property of the loop below rather than a promise about it.
  const repsForFixture = new Map<string, number>();
  for (const fixture of selectedFixtures) {
    repsForFixture.set(
      fixture.id,
      fixture.repOverride !== undefined
        ? Math.min(args.reps, fixture.repOverride)
        : args.reps,
    );
  }

  const startIndex = nextRepIndex(manifest);
  const repIndices = Array.from(
    { length: args.reps },
    (_, i) => startIndex + i,
  );
  const harnessVersion = getHarnessVersion();
  const rowCounts: Record<Verdict, number> = {
    pass: 0,
    fail: 0,
    not_applicable: 0,
    error: 0,
  };
  const rubricHashesEverUsed = new Map<string, string>();

  const session = await deps.harnessSessionFactory({
    model: args.model,
    temperature: args.temperature,
  });

  try {
    for (const [repNumber, repIndex] of repIndices.entries()) {
      const repStartedAt = deps.clock().getTime();
      args.onProgress?.({
        type: 'rep-start',
        repIndex,
        repNumber: repNumber + 1,
        totalReps: repIndices.length,
      });

      const relativeRepNumber = repIndex - startIndex + 1;
      const fixturesForThisRep = selectedFixtures.filter(
        (fixture) => relativeRepNumber <= (repsForFixture.get(fixture.id) ?? args.reps),
      );

      mkdirSync(repDir(runDir, repIndex), { recursive: true });
      const writer = new ScoreWriter();
      writer.open(scoresPath(runDir, repIndex));

      const startedAt = deps.clock().toISOString();
      const attemptedFixtureIds: string[] = [];
      const rubricHashesThisRep: Record<string, string> = {};

      for (const [fixtureIndex, fixture] of fixturesForThisRep.entries()) {
        attemptedFixtureIds.push(fixture.id);
        const checks = selectChecksForFixture(fixture);
        session.recorder?.beginFixture();

        const fixtureStartedAt = deps.clock().getTime();
        args.onProgress?.({
          type: 'fixture-start',
          repIndex,
          fixtureId: fixture.id,
          fixtureIndex: fixtureIndex + 1,
          totalFixtures: fixturesForThisRep.length,
        });

        const seeded = await deps.turnExecutor.seed(session.db, fixture, {
          runId: manifest.runId,
        });

        let verdicts: Verdict[];
        try {
          verdicts = await runFixtureAndScore({
            runDir,
            repIndex,
            fixture,
            checks,
            seeded,
            session,
            deps,
            args,
            promptHash: prompt.hash,
            corpusVersion,
            harnessVersion,
            manifestRunId: manifest.runId,
            writer,
            rowCounts,
            rubricHashesThisRep,
          });
        } finally {
          if (!args.keepScratch) {
            await deps.turnExecutor.teardown(session.db, seeded.campaignId);
          }
        }

        args.onProgress?.({
          type: 'fixture-done',
          repIndex,
          fixtureId: fixture.id,
          fixtureIndex: fixtureIndex + 1,
          totalFixtures: fixturesForThisRep.length,
          durationMs: deps.clock().getTime() - fixtureStartedAt,
          verdicts,
        });
      }

      await writer.close();

      for (const [checkId, hash] of Object.entries(rubricHashesThisRep)) {
        rubricHashesEverUsed.set(checkId, hash);
      }

      const warning = appendCompletedRep(runDir, {
        index: repIndex,
        harnessVersion,
        rubricHashes: rubricHashesThisRep,
        fixtureIds: attemptedFixtureIds,
        startedAt,
        completedAt: deps.clock().toISOString(),
      });
      if (warning) warnings.push(warning);

      args.onProgress?.({
        type: 'rep-done',
        repIndex,
        repNumber: repNumber + 1,
        totalReps: repIndices.length,
        durationMs: deps.clock().getTime() - repStartedAt,
      });
    }
  } finally {
    await session.close();
  }

  for (const [checkId, hash] of rubricHashesEverUsed) {
    const path = rubricPath(runDir, hash);
    if (!existsSync(path)) {
      writeFileSync(path, rubricTextFor(checkId) + '\n', 'utf-8');
    }
  }

  return { runDir, repsRun: repIndices, rowCounts, warnings };
}

interface RunFixtureAndScoreInput {
  runDir: string;
  repIndex: number;
  fixture: EvalFixture;
  checks: EvalCheck[];
  seeded: ScratchAdventure;
  session: HarnessSession;
  deps: RunEvalDeps;
  args: RunEvalArgs;
  promptHash: string;
  corpusVersion: string;
  harnessVersion: string;
  manifestRunId: string;
  writer: ScoreWriter;
  rowCounts: Record<Verdict, number>;
  rubricHashesThisRep: Record<string, string>;
}

/**
 * Runs one fixture's turn and every selected check, appending one score row
 * per check. A turn that throws produces one `error` row per selected
 * check instead of aborting the rep — the whole point of the `error`
 * verdict existing is that a transient failure must never be
 * indistinguishable from a regression (see pre-flight: this supersedes
 * `runHarness`'s old "map a thrown turn to FAILED" behavior).
 */
async function runFixtureAndScore(
  input: RunFixtureAndScoreInput,
): Promise<Verdict[]> {
  const {
    runDir,
    repIndex,
    fixture,
    checks,
    seeded,
    session,
    deps,
    args,
    promptHash,
    corpusVersion,
    harnessVersion,
    manifestRunId,
    writer,
    rowCounts,
    rubricHashesThisRep,
  } = input;

  let turnResult;
  try {
    turnResult = await deps.turnExecutor.runTurn(
      session.db,
      session.sessionService,
      fixture,
      seeded,
    );
  } catch (err) {
    const wardenRequests = session.recorder?.takeCaptured() ?? [];
    writeWardenRequestArtifact(runDir, repIndex, fixture.id, wardenRequests);
    const artifactPath = relativeArtifactPath(
      runDir,
      wardenRequestPath(runDir, repIndex, fixture.id),
    );
    const errorMessage = err instanceof Error ? err.message : String(err);

    for (const check of checks) {
      writer.append({
        runId: manifestRunId,
        model: args.model,
        promptHash,
        temperature: args.temperature,
        corpusVersion,
        harnessVersion,
        repIndex,
        fixtureId: fixture.id,
        checkId: check.id,
        tag: check.tag,
        checkMode: check.mode,
        verdict: 'error',
        errorMessage,
        artifactPath,
        durationMs: 0,
        recordedAt: deps.clock().toISOString(),
      });
      rowCounts.error += 1;
    }
    return checks.map(() => 'error' as const);
  }

  const wardenRequests = session.recorder?.takeCaptured() ?? [];
  writeFixtureArtifacts(runDir, repIndex, fixture.id, {
    wardenRequests,
    turnResult,
  });

  const verdicts: Verdict[] = [];
  for (const check of checks) {
    const observation = await runCheck(
      check,
      fixture,
      turnResult,
      session.anthropicService,
    );
    rowCounts[observation.verdict] += 1;

    let artifactPath: string;
    if (
      check.mode === 'judged' &&
      (observation.verdict === 'pass' || observation.verdict === 'fail')
    ) {
      writeJudgeArtifact(runDir, repIndex, fixture.id, check.id, {
        verdict: observation.verdict,
        rationale: observation.detail,
        rubricHash: observation.rubricHash ?? '',
      });
      artifactPath = relativeArtifactPath(
        runDir,
        judgeArtifactPath(runDir, repIndex, fixture.id, check.id),
      );
      if (observation.rubricHash) {
        rubricHashesThisRep[check.id] = observation.rubricHash;
      }
    } else {
      artifactPath = relativeArtifactPath(
        runDir,
        wardenOutputPath(runDir, repIndex, fixture.id),
      );
    }

    writer.append({
      runId: manifestRunId,
      model: args.model,
      promptHash,
      temperature: args.temperature,
      corpusVersion,
      harnessVersion,
      repIndex,
      fixtureId: fixture.id,
      checkId: check.id,
      tag: check.tag,
      checkMode: check.mode,
      verdict: observation.verdict,
      rubricHash: observation.rubricHash,
      notApplicableReason: observation.notApplicableReason,
      errorMessage: observation.errorMessage,
      artifactPath,
      durationMs: observation.durationMs,
      recordedAt: deps.clock().toISOString(),
    });
    verdicts.push(observation.verdict);
  }

  return verdicts;
}
