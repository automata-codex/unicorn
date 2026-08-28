import { mkdirSync } from 'node:fs';

import { findRationaleToolSyntax } from '../eval/checks/judged/judge';
import { selectChecksForFixture } from '../eval/checks/registry';
import { runCheck } from '../eval/checks/run-check';
import { computeCorpusVersion } from '../eval/corpus-version';
import { loadFixtures } from '../eval/fixture-loader';
import {
  readTurnResultArtifact,
  relativeArtifactPath,
  writeJudgeArtifactAt,
} from '../eval/runs/artifacts';
import { envOnlyConfigService } from '../eval/runs/env-config-service';
import { assertJudgeContractGoldenCurrent } from '../eval/preflight';
import { readManifest } from '../eval/runs/manifest';
import {
  listRepDirsOnDisk,
  repDirName,
  rescoreDir,
  rescoreJudgeArtifactPath,
  rescoreOutputPath,
  wardenOutputPath,
} from '../eval/runs/paths';
import { computeRates, summarizeExclusions } from '../eval/runs/rates';
import { RescoreWriter, readVouchedRows } from '../eval/runs/scores';
import { AnthropicService } from '../src/anthropic/anthropic.service';

import { getHarnessVersion } from './harness-version';

import type { EvalCheck } from '../eval/checks/registry';
import type { EvalFixture } from '../eval/fixture.schema';
import type { Manifest } from '../eval/runs/manifest';
import type { ExclusionsSummary, RateEntry } from '../eval/runs/rates';
import type { RescoreRow, ScoreRow, Verdict } from '../eval/runs/scores';
import type { AnthropicService as AnthropicServiceType } from '../src/anthropic/anthropic.service';

export interface RescoreArgs {
  /** Already resolved (absolute) run directory. */
  runDir: string;
  fixturesDir: string;
  /** Fixture ids to include. Omitted = every vouched fixture. */
  fixtureIds?: string[];
  onProgress?: (event: RescoreProgressEvent) => void;
}

export interface RescoreDeps {
  anthropicService: AnthropicServiceType;
  clock: () => Date;
}

/** Real wiring: no database, no Nest DI — `AnthropicService` is constructed
 * directly against the env-only `ConfigService` stub, the same way
 * `eval-judge-variance.core.ts` does, so this stays runnable via plain
 * `tsx`. */
export function defaultRescoreDeps(): RescoreDeps {
  return {
    anthropicService: new AnthropicService(envOnlyConfigService()),
    clock: () => new Date(),
  };
}

export type RescoreProgressEvent =
  | {
      type: 'target-start';
      repIndex: number;
      fixtureId: string;
      targetIndex: number;
      totalTargets: number;
    }
  | {
      type: 'check-done';
      repIndex: number;
      fixtureId: string;
      checkId: string;
      sourceVerdict: Verdict | null;
      verdict: Verdict;
      changed: boolean;
      durationMs: number;
    }
  | {
      type: 'carried-forward';
      repIndex: number;
      fixtureId: string;
      reason: string;
    };

/**
 * One `(fixtureId, checkId)`'s before/after, the review artifact this
 * command exists to produce. `sourceRate`/`rescoredRate` are `null` on a
 * zero denominator, per `RateEntry.rate`'s own convention — an undefined
 * rate must never render as `0.00`.
 */
export interface RateDelta {
  fixtureId: string;
  checkId: string;
  sourceRate: number | null;
  sourceN: number;
  rescoredRate: number | null;
  rescoredN: number;
  /** Reps whose verdict differs between the two passes. */
  changedVerdicts: number;
  /** `pass → fail`-style transitions with counts, most frequent first. */
  transitions: Array<{ from: Verdict; to: Verdict; count: number }>;
}

export interface RescoreSummary {
  outputPath: string;
  manifest: Manifest;
  rows: RescoreRow[];
  /** Recomputed at re-score time — what actually governed these verdicts. */
  corpusVersion: string;
  harnessVersion: string;
  rates: RateEntry[];
  exclusions: ExclusionsSummary;
  deltas: RateDelta[];
  /** Checks the current registry produced for a fixture that the source run
   * has no row for, and vice versa — a registry change between the two
   * passes, named rather than silently absorbed into a rate. */
  unpairedChecks: string[];
  /** Fixture-reps whose verdict was copied because no artifact exists. */
  carriedForward: number;
  notes: string[];
}

function rowKey(repIndex: number, fixtureId: string, checkId: string): string {
  return `${repIndex}::${fixtureId}::${checkId}`;
}

/**
 * Re-grades a run's frozen `warden-output.json` artifacts under the current
 * checker registry, writing one row per `(rep, fixture, check)` to
 * `<run-dir>/rescore/<timestamp>.jsonl` and leaving `reps/<nnn>/scores.jsonl`
 * untouched.
 *
 * Iterates `(repIndex, fixtureId)` pairs and asks `selectChecksForFixture`
 * which checks apply *now*, rather than replaying the source rows' own
 * `checkId`s. A checker migration is exactly when this command is worth
 * running, and a fixture can gain or lose a check across one — replaying the
 * old check list would re-grade a registry that no longer exists. Checks
 * present on only one side are reported in `unpairedChecks`.
 *
 * Judged checks make a real judge call per row; structural ones are pure
 * computation. Nothing here touches the database or the Warden.
 */
export async function runRescore(
  args: RescoreArgs,
  deps: RescoreDeps,
): Promise<RescoreSummary> {
  // Before anything is read or re-graded. A re-score spends judge calls on
  // every judged check it touches, and doing that under a contract no commit
  // produces buys a pass whose `judgeContractHash` is a lie. No assembly gate
  // here: `eval:rescore` renders no assembly surface and writes no
  // `assemblyHash`.
  assertJudgeContractGoldenCurrent();

  const manifest = readManifest(args.runDir);
  const { rows: sourceRows, exclusions: sourceExclusions } = readVouchedRows(
    args.runDir,
  );
  const { fixtures, errors: loadErrors } = await loadFixtures(args.fixturesDir);
  const fixturesById = new Map(fixtures.map((f) => [f.id, f]));

  const notes = loadErrors.map((e) => `fixture load error: ${e.message}`);

  const corpusVersion = await computeCorpusVersion(args.fixturesDir);
  const harnessVersion = getHarnessVersion();
  // One clock read for both the filename and every row's `rescoredAt`, so
  // the file always names the pass it contains — two reads could straddle a
  // second boundary and silently disagree.
  const startedAt = deps.clock();
  const rescoredAt = startedAt.toISOString();

  const sourceByKey = new Map<string, ScoreRow>();
  for (const row of sourceRows) {
    sourceByKey.set(rowKey(row.repIndex, row.fixtureId, row.checkId), row);
  }

  // `(repIndex, fixtureId)` pairs, in a stable order so two re-scores of the
  // same run produce diffable files.
  const targets = [
    ...new Map(
      sourceRows
        .filter(
          (row) => !args.fixtureIds || args.fixtureIds.includes(row.fixtureId),
        )
        .map((row) => [
          `${row.repIndex}::${row.fixtureId}`,
          { repIndex: row.repIndex, fixtureId: row.fixtureId },
        ]),
    ).values(),
  ].sort(
    (a, b) => a.repIndex - b.repIndex || a.fixtureId.localeCompare(b.fixtureId),
  );

  mkdirSync(rescoreDir(args.runDir), { recursive: true });
  const outputPath = rescoreOutputPath(args.runDir, startedAt);
  const writer = new RescoreWriter();
  writer.open(outputPath);

  const rows: RescoreRow[] = [];
  const producedKeys = new Set<string>();
  const unpairedChecks: string[] = [];
  let carriedForward = 0;

  const emit = (row: RescoreRow): void => {
    writer.append(row);
    rows.push(row);
    producedKeys.add(rowKey(row.repIndex, row.fixtureId, row.checkId));
  };

  try {
    for (const [targetIndex, target] of targets.entries()) {
      const { repIndex, fixtureId } = target;
      args.onProgress?.({
        type: 'target-start',
        repIndex,
        fixtureId,
        targetIndex: targetIndex + 1,
        totalTargets: targets.length,
      });

      const fixture = fixturesById.get(fixtureId);
      if (!fixture) {
        // Every source row for this fixture is carried forward — the
        // alternative is dropping rows because a fixture was renamed, which
        // would quietly shrink the corpus a re-score is meant to reproduce.
        const reason = `fixture "${fixtureId}" not found under ${args.fixturesDir}`;
        for (const row of sourceRows.filter(
          (r) => r.repIndex === repIndex && r.fixtureId === fixtureId,
        )) {
          emit(carryForward(row, reason, rescoredAt));
          carriedForward += 1;
        }
        args.onProgress?.({
          type: 'carried-forward',
          repIndex,
          fixtureId,
          reason,
        });
        continue;
      }

      let turnResult;
      try {
        turnResult = readTurnResultArtifact(args.runDir, repIndex, fixtureId);
      } catch (err) {
        const reason =
          `no readable reps/${repDirName(repIndex)}/${fixtureId}/warden-output.json ` +
          '(the original turn errored before producing one, so there is nothing ' +
          `to re-grade): ${err instanceof Error ? err.message : String(err)}`;
        for (const row of sourceRows.filter(
          (r) => r.repIndex === repIndex && r.fixtureId === fixtureId,
        )) {
          emit(carryForward(row, reason, rescoredAt));
          carriedForward += 1;
        }
        args.onProgress?.({
          type: 'carried-forward',
          repIndex,
          fixtureId,
          reason,
        });
        continue;
      }

      for (const check of selectChecksForFixture(fixture)) {
        const key = rowKey(repIndex, fixtureId, check.id);
        const sourceRow = sourceByKey.get(key);
        if (!sourceRow) {
          unpairedChecks.push(
            `rep ${repIndex} / ${fixtureId}: check "${check.id}" is produced by ` +
              'the current registry but has no row in the source run — new check, ' +
              'counted in the re-scored rate with nothing to compare against',
          );
        }

        const observation = await runCheck(
          check,
          fixture,
          turnResult,
          deps.anthropicService,
        );

        // A judged verdict is only investigable if its reasoning is kept.
        // `eval:run` writes one of these per judged rep; a re-score that
        // didn't would leave 169 verdicts with no recoverable "why", and the
        // only way to ask would be to pay for the calls again.
        let artifactPath: string;
        if (
          observation.judgeInvoked &&
          (observation.verdict === 'pass' || observation.verdict === 'fail')
        ) {
          const path = rescoreJudgeArtifactPath(
            args.runDir,
            startedAt,
            repIndex,
            fixtureId,
            check.id,
          );
          writeJudgeArtifactAt(path, {
            verdict: observation.verdict,
            rationale: observation.detail,
            rubricHash: observation.rubricHash ?? '',
            judgeContractHash: observation.judgeContractHash,
            rationaleToolSyntax: findRationaleToolSyntax(observation.detail),
            judgeContext: check.judgeContext?.(turnResult, fixture),
          });
          artifactPath = relativeArtifactPath(args.runDir, path);
        } else {
          // Structural verdicts, and judged ones the gate settled, are
          // derived from the frozen turn output. Deliberately not inherited
          // from the source row: for a check that was already judged, that
          // path names the *original* rubric's rationale, so a re-scored row
          // would cite reasoning that produced a different verdict.
          artifactPath = relativeArtifactPath(
            args.runDir,
            wardenOutputPath(args.runDir, repIndex, fixtureId),
          );
        }

        emit(
          buildRescoreRow({
            manifest,
            fixture,
            check,
            observation,
            artifactPath,
            repIndex,
            sourceRow,
            corpusVersion,
            harnessVersion,
            rescoredAt,
          }),
        );

        args.onProgress?.({
          type: 'check-done',
          repIndex,
          fixtureId,
          checkId: check.id,
          sourceVerdict: sourceRow?.verdict ?? null,
          verdict: observation.verdict,
          changed: sourceRow
            ? sourceRow.verdict !== observation.verdict
            : false,
          durationMs: observation.durationMs,
        });
      }
    }
  } finally {
    await writer.close();
  }

  for (const row of sourceRows) {
    if (args.fixtureIds && !args.fixtureIds.includes(row.fixtureId)) continue;
    if (producedKeys.has(rowKey(row.repIndex, row.fixtureId, row.checkId))) {
      continue;
    }
    unpairedChecks.push(
      `rep ${row.repIndex} / ${row.fixtureId}: check "${row.checkId}" has a row ` +
        'in the source run but is not produced by the current registry — retired ' +
        'or renamed check, absent from the re-scored rate',
    );
  }

  const rates = computeRates(rows);
  const exclusions = summarizeExclusions(
    rows,
    sourceExclusions,
    listRepDirsOnDisk(args.runDir),
  );

  return {
    outputPath,
    manifest,
    rows,
    corpusVersion,
    harnessVersion,
    rates,
    exclusions,
    deltas: computeDeltas(sourceRows, rows, args.fixtureIds),
    unpairedChecks,
    carriedForward,
    notes,
  };
}

interface BuildRescoreRowInput {
  manifest: Manifest;
  fixture: EvalFixture;
  check: EvalCheck;
  observation: Awaited<ReturnType<typeof runCheck>>;
  /** Where this row's verdict came from — computed by the caller, never
   * inherited from the source row. */
  artifactPath: string;
  repIndex: number;
  sourceRow: ScoreRow | undefined;
  corpusVersion: string;
  harnessVersion: string;
  rescoredAt: string;
}

function buildRescoreRow(input: BuildRescoreRowInput): RescoreRow {
  const { manifest, observation, sourceRow } = input;
  return {
    rowKind: 'rescore',
    runId: manifest.runId,
    model: manifest.model,
    promptHash: manifest.promptHash,
    temperature: manifest.temperature,
    // Re-score-time values: these describe what graded the row, not what
    // generated it. See `rescoreRowSchema`'s doc comment.
    corpusVersion: input.corpusVersion,
    harnessVersion: input.harnessVersion,
    sourceCorpusVersion: sourceRow?.corpusVersion ?? manifest.corpusVersion,
    sourceHarnessVersion: sourceRow?.harnessVersion ?? 'unknown',
    // `null`, not the verdict just computed. A check with no source row was
    // never scored before, and copying today's answer into the field that
    // records yesterday's makes a new attachment read as an unchanged one —
    // contradicting the warning this same pass prints for it. See
    // `rescoreRowSchema.sourceVerdict`.
    sourceVerdict: sourceRow?.verdict ?? null,
    rescoredAt: input.rescoredAt,
    carriedForward: false,

    repIndex: input.repIndex,
    fixtureId: input.fixture.id,
    checkId: input.check.id,
    tag: input.check.tag,
    checkMode: input.check.mode,
    applicabilitySource: input.check.applicabilitySource,
    judgeInvoked: observation.judgeInvoked,
    verdict: observation.verdict,
    rubricHash: observation.rubricHash,
    // Re-score-time, like `corpusVersion`/`harnessVersion` above: this row
    // was graded by the contract in the tree now, not the one the source run
    // used. `carryForward` deliberately keeps the source's — see there.
    judgeContractHash: observation.judgeContractHash,
    notApplicableReason: observation.notApplicableReason,
    notApplicableReasonCode: observation.notApplicableReasonCode,
    errorMessage: observation.errorMessage,
    artifactPath: input.artifactPath,
    durationMs: observation.durationMs,
    recordedAt: input.rescoredAt,
  };
}

/**
 * A source row copied verbatim except for the re-score bookkeeping. Used
 * only when re-grading is impossible (no artifact on disk), never as a
 * fallback for a check that merely failed — a thrown checker produces an
 * `error` verdict through `runCheck`, which is a real observation.
 *
 * `corpusVersion`/`harnessVersion` keep the *source* values here, unlike
 * every other row this command writes: no current-code checker ran, so
 * stamping the re-score's versions on this verdict would claim a
 * measurement that never happened. `judgeContractHash` rides the spread for
 * the same reason and must keep doing so — a carried-forward verdict was
 * graded by the contract the source run used, and relabelling it with
 * today's would make every re-score containing one look like it spanned two
 * judge contracts.
 */
function carryForward(
  row: ScoreRow,
  reason: string,
  rescoredAt: string,
): RescoreRow {
  return {
    ...row,
    rowKind: 'rescore',
    sourceCorpusVersion: row.corpusVersion,
    sourceHarnessVersion: row.harnessVersion,
    sourceVerdict: row.verdict,
    rescoredAt,
    carriedForward: true,
    errorMessage:
      row.verdict === 'error' ? (row.errorMessage ?? reason) : row.errorMessage,
  };
}

/** Per `(fixtureId, checkId)`, what the re-score moved. */
export function computeDeltas(
  sourceRows: ScoreRow[],
  rescoreRows: RescoreRow[],
  fixtureIds?: string[],
): RateDelta[] {
  const inScope = (fixtureId: string): boolean =>
    !fixtureIds || fixtureIds.includes(fixtureId);

  const sourceRates = new Map(
    computeRates(sourceRows.filter((r) => inScope(r.fixtureId))).map((e) => [
      `${e.fixtureId}::${e.checkId}`,
      e,
    ]),
  );
  const rescoredRates = computeRates(rescoreRows);

  const transitionsByKey = new Map<string, Map<string, number>>();
  const sourceByKey = new Map(
    sourceRows.map((r) => [rowKey(r.repIndex, r.fixtureId, r.checkId), r]),
  );
  for (const row of rescoreRows) {
    const source = sourceByKey.get(
      rowKey(row.repIndex, row.fixtureId, row.checkId),
    );
    if (!source || source.verdict === row.verdict) continue;
    const key = `${row.fixtureId}::${row.checkId}`;
    const counts = transitionsByKey.get(key) ?? new Map<string, number>();
    const transition = `${source.verdict}→${row.verdict}`;
    counts.set(transition, (counts.get(transition) ?? 0) + 1);
    transitionsByKey.set(key, counts);
  }

  const keys = new Set([
    ...sourceRates.keys(),
    ...rescoredRates.map((e) => `${e.fixtureId}::${e.checkId}`),
  ]);

  return [...keys]
    .map((key) => {
      const [fixtureId, checkId] = key.split('::');
      const source = sourceRates.get(key);
      const rescored = rescoredRates.find(
        (e) => e.fixtureId === fixtureId && e.checkId === checkId,
      );
      const counts = transitionsByKey.get(key) ?? new Map<string, number>();
      return {
        fixtureId,
        checkId,
        sourceRate: source?.rate ?? null,
        sourceN: source?.n ?? 0,
        rescoredRate: rescored?.rate ?? null,
        rescoredN: rescored?.n ?? 0,
        changedVerdicts: [...counts.values()].reduce((a, b) => a + b, 0),
        transitions: [...counts.entries()]
          .map(([transition, count]) => {
            const [from, to] = transition.split('→') as [Verdict, Verdict];
            return { from, to, count };
          })
          .sort((a, b) => b.count - a.count || a.from.localeCompare(b.from)),
      };
    })
    .sort(
      (a, b) =>
        a.fixtureId.localeCompare(b.fixtureId) ||
        a.checkId.localeCompare(b.checkId),
    );
}
