import { mkdirSync, writeFileSync } from 'node:fs';
import { z } from 'zod';

import { evalChecks } from '../eval/checks/registry';
import { runCheck } from '../eval/checks/run-check';
import { loadFixtures } from '../eval/fixture-loader';
import { assertJudgeContractGoldenCurrent } from '../eval/preflight';
import { readTurnResultArtifact } from '../eval/runs/artifacts';
import { envOnlyConfigService } from '../eval/runs/env-config-service';
import { judgeVarianceDir, judgeVarianceOutputPath } from '../eval/runs/paths';
import { readVouchedRows, verdictSchema } from '../eval/runs/scores';
import { AnthropicService } from '../src/anthropic/anthropic.service';

import type { Verdict } from '../eval/runs/scores';
import type { AnthropicService as AnthropicServiceType } from '../src/anthropic/anthropic.service';

export const judgeVarianceRowSchema = z.object({
  fixtureId: z.string().min(1),
  checkId: z.string().min(1),
  rubricHash: z.string(),
  /**
   * The judge contract this trial was graded under. Load-bearing for a
   * before/after study of the contract itself: the two variance files have to
   * be distinguishable from their contents alone, not from which order they
   * were produced in or what someone named them. Defaults to `''` so a file
   * written before the field existed still parses; empty means unknown.
   */
  judgeContractHash: z.string().default(''),
  sourceRepIndex: z.number().int().positive(),
  trialIndex: z.number().int().positive(),
  verdict: verdictSchema,
  /** Whether this trial actually reached the rubric — see
   * `CheckObservation.judgeInvoked`. Persisted per trial, not just used and
   * discarded, so a stored variance file can be re-read later and still show
   * which rows were graded and which were gated. */
  judgeInvoked: z.boolean().default(true),
  /**
   * The judge's own reasoning for this trial.
   *
   * **Not decorative, and its absence was a hole.** The flip rate answers
   * "does the grader agree with itself"; it cannot answer "does the grader
   * agree with its own stated reasoning", which is a different defect and the
   * one `docs/eval-methodology.md § Before trusting any judged rate from this
   * corpus` documents — six verdicts in 1,341 that contradict their own
   * rationale, every one a `fail` under a rationale arguing the turn was fine.
   * That is checkable by reading one artifact against itself, and until now
   * this command threw away the half you need to do it.
   *
   * Persisted for passes as well as failures. The 2026-08-21 scan established
   * the asymmetry by scanning all 940 passes and finding none; keeping only
   * failures would make that converse check impossible to repeat.
   *
   * Defaults to `''` so a variance file written before the field existed still
   * parses. Empty means the rationale was not recorded, not that there was
   * none.
   */
  rationale: z.string().default(''),
  /**
   * Why the trial errored, when it did. Same omission as `rationale` was and
   * found the same way: the after-side run of spec 020 produced one `error`
   * trial in 114, and the row recorded only `check "hidden-info-leak" threw`
   * — enough to know something failed, not enough to say whether the judge
   * returned malformed input (which a field-order change could plausibly
   * cause) or the API call simply failed. An error a reader cannot attribute
   * is an error they have to re-run to understand.
   */
  errorMessage: z.string().default(''),
  durationMs: z.number().nonnegative(),
});

export type JudgeVarianceRow = z.infer<typeof judgeVarianceRowSchema>;

export interface SkippedTarget {
  fixtureId: string;
  checkId: string;
  reason: string;
}

export interface FixtureCheckVariance {
  fixtureId: string;
  checkId: string;
  rubricHash: string;
  verdictCounts: Partial<Record<Verdict, number>>;
  totalInputs: number;
  flippedInputs: number;
  /** Fraction of frozen inputs whose trials didn't all agree. `null` when
   * no input was tested for this fixture/check. */
  flipRate: number | null;
  /** Inputs excluded from `totalInputs` because a `judgeGate` settled them
   * before the rubric was reached — see `gatedInputs` on `RubricVariance`. */
  gatedInputs: number;
}

export interface RubricVariance {
  checkId: string;
  rubricHash: string;
  totalInputs: number;
  flippedInputs: number;
  flipRate: number | null;
  /**
   * Frozen inputs a `judgeGate` settled structurally, excluded from
   * `totalInputs` rather than counted as non-flips. A gated input is
   * deterministic over fixed input, so including it would add a guaranteed
   * agreement to the denominator and pull the measured flip rate toward
   * zero — flattering exactly the rubric this command exists to be
   * suspicious of. Reported rather than silently dropped, because "most of
   * this check never reached the rubric" is itself worth seeing.
   */
  gatedInputs: number;
}

export interface RunJudgeVarianceSummary {
  outputPath: string;
  rows: JudgeVarianceRow[];
  skipped: SkippedTarget[];
  byFixtureCheck: FixtureCheckVariance[];
  byRubric: RubricVariance[];
  /** "rubric X flipped on N of M frozen inputs" — one per rubric, because
   * finding out whether anything downstream is interpretable at all is the
   * whole reason to run this. */
  headlines: string[];
}

export interface RunJudgeVarianceArgs {
  /** Already resolved (absolute) run directory. */
  runDir: string;
  fixturesDir: string;
  /**
   * Re-grades per frozen input. Every vouched `(repIndex, fixtureId)` pair
   * is one frozen input and that count comes from the run — this does not
   * subsample it. Total judge calls are `frozen inputs × trials`.
   */
  trials: number;
  /** Fixture ids to include. Omitted = every vouched fixture. */
  fixtureIds?: string[];
  onProgress?: (event: RunJudgeVarianceProgressEvent) => void;
}

/** Fired per candidate `(fixtureId, checkId, sourceRepIndex)` and per trial
 * — a judge call can take several seconds, and `--trials` multiplies that
 * across every frozen input, so a long invocation needs visible progress to
 * not look stuck. Omitted by tests/callers that don't care. */
export type RunJudgeVarianceProgressEvent =
  | {
      type: 'input-start';
      fixtureId: string;
      checkId: string;
      sourceRepIndex: number;
      candidateIndex: number;
      totalCandidates: number;
    }
  | {
      type: 'trial-done';
      fixtureId: string;
      checkId: string;
      sourceRepIndex: number;
      trialIndex: number;
      totalTrials: number;
      verdict: Verdict;
      durationMs: number;
    }
  | {
      type: 'skipped';
      fixtureId: string;
      checkId: string;
      candidateIndex: number;
      totalCandidates: number;
      reason: string;
    };

export interface RunJudgeVarianceDeps {
  anthropicService: AnthropicServiceType;
  clock: () => Date;
}

/** Real wiring: no database, no Nest DI — `AnthropicService` is
 * constructed directly against the env-only `ConfigService` stub, the same
 * way `eval-replay.ts` does, so this stays runnable via plain `tsx`. */
export function defaultRunJudgeVarianceDeps(): RunJudgeVarianceDeps {
  return {
    anthropicService: new AnthropicService(envOnlyConfigService()),
    clock: () => new Date(),
  };
}

interface FrozenInput {
  fixtureId: string;
  repIndex: number;
  checkIds: Set<string>;
}

interface Candidate {
  fixtureId: string;
  repIndex: number;
  checkId: string;
}

function flipped(verdicts: Verdict[]): boolean {
  return new Set(verdicts).size > 1;
}

/**
 * Re-runs judged checks N times against frozen `warden-output.json`
 * artifacts already on disk — no Warden calls, no database. Isolates
 * grader variance from generator variance: if a rubric swings against
 * fixed input, the instability is in the rubric, and nothing downstream
 * (prompt comparisons, regression pass rates) is meaningful until it's
 * fixed.
 *
 * Structural checks are skipped — deterministic over fixed input, so
 * re-running one measures nothing. A fixture whose original turn errored
 * (no `warden-output.json` was ever written) is skipped too, named with
 * the reason either way.
 */
export async function runJudgeVariance(
  args: RunJudgeVarianceArgs,
  deps: RunJudgeVarianceDeps,
): Promise<RunJudgeVarianceSummary> {
  // The command whose entire output is a statement about the grader, so
  // grading under an unrecorded contract makes the result uninterpretable
  // rather than merely mislabelled. No assembly gate: no assembly surface is
  // rendered and no `assemblyHash` is written.
  assertJudgeContractGoldenCurrent();

  const { rows: vouchedRows } = readVouchedRows(args.runDir);
  const { fixtures } = await loadFixtures(args.fixturesDir);
  const fixturesById = new Map(fixtures.map((f) => [f.id, f]));

  const inputs = new Map<string, FrozenInput>();
  for (const row of vouchedRows) {
    if (args.fixtureIds && !args.fixtureIds.includes(row.fixtureId)) continue;
    const key = `${row.repIndex}::${row.fixtureId}`;
    let input = inputs.get(key);
    if (!input) {
      input = {
        fixtureId: row.fixtureId,
        repIndex: row.repIndex,
        checkIds: new Set(),
      };
      inputs.set(key, input);
    }
    input.checkIds.add(row.checkId);
  }

  const candidates: Candidate[] = [];
  for (const input of inputs.values()) {
    for (const checkId of input.checkIds) {
      candidates.push({
        fixtureId: input.fixtureId,
        repIndex: input.repIndex,
        checkId,
      });
    }
  }

  const rows: JudgeVarianceRow[] = [];
  const skippedByKey = new Map<string, SkippedTarget>();
  const skip = (
    candidateIndex: number,
    fixtureId: string,
    checkId: string,
    reason: string,
  ): void => {
    skippedByKey.set(`${fixtureId}::${checkId}`, {
      fixtureId,
      checkId,
      reason,
    });
    args.onProgress?.({
      type: 'skipped',
      fixtureId,
      checkId,
      candidateIndex: candidateIndex + 1,
      totalCandidates: candidates.length,
      reason,
    });
  };

  for (const [candidateIndex, candidate] of candidates.entries()) {
    const { fixtureId, repIndex: sourceRepIndex, checkId } = candidate;

    const check = evalChecks[checkId];
    if (!check) {
      skip(
        candidateIndex,
        fixtureId,
        checkId,
        `"${checkId}" is not a registered check`,
      );
      continue;
    }
    if (check.mode !== 'judged') {
      skip(
        candidateIndex,
        fixtureId,
        checkId,
        'structural checks are deterministic over fixed input — re-running measures nothing',
      );
      continue;
    }
    const fixture = fixturesById.get(fixtureId);
    if (!fixture) {
      skip(
        candidateIndex,
        fixtureId,
        checkId,
        `fixture "${fixtureId}" not found under ${args.fixturesDir}`,
      );
      continue;
    }

    let turnResult;
    try {
      turnResult = readTurnResultArtifact(
        args.runDir,
        sourceRepIndex,
        fixtureId,
      );
    } catch (err) {
      skip(
        candidateIndex,
        fixtureId,
        checkId,
        `no warden-output.json artifact for rep ${sourceRepIndex} (original turn likely errored): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      continue;
    }

    args.onProgress?.({
      type: 'input-start',
      fixtureId,
      checkId,
      sourceRepIndex,
      candidateIndex: candidateIndex + 1,
      totalCandidates: candidates.length,
    });

    for (let trialIndex = 1; trialIndex <= args.trials; trialIndex++) {
      const observation = await runCheck(
        check,
        fixture,
        turnResult,
        deps.anthropicService,
      );
      rows.push(
        judgeVarianceRowSchema.parse({
          fixtureId,
          checkId,
          // No fallback to `check.rubricHash()`. `runCheck` omits the hash
          // precisely when the gate settled the rep, and filling it back in
          // here would have the row assert that a rubric graded something it
          // never saw — the contradiction `judgeInvoked` exists to prevent.
          // Empty string means "no rubric graded this"; `summarize` recovers
          // the hash for display from the check's judged rows.
          rubricHash: observation.rubricHash ?? '',
          judgeContractHash: observation.judgeContractHash ?? '',
          sourceRepIndex,
          trialIndex,
          verdict: observation.verdict,
          judgeInvoked: observation.judgeInvoked,
          rationale: observation.detail,
          errorMessage: observation.errorMessage ?? '',
          durationMs: observation.durationMs,
        }),
      );
      args.onProgress?.({
        type: 'trial-done',
        fixtureId,
        checkId,
        sourceRepIndex,
        trialIndex,
        totalTrials: args.trials,
        verdict: observation.verdict,
        durationMs: observation.durationMs,
      });
    }
  }

  mkdirSync(judgeVarianceDir(args.runDir), { recursive: true });
  const outputPath = judgeVarianceOutputPath(args.runDir, deps.clock());
  writeFileSync(
    outputPath,
    rows.map((row) => JSON.stringify(row)).join('\n') +
      (rows.length > 0 ? '\n' : ''),
    'utf-8',
  );

  const { byFixtureCheck, byRubric, headlines } = summarize(rows);

  return {
    outputPath,
    rows,
    skipped: [...skippedByKey.values()].sort(
      (a, b) =>
        a.fixtureId.localeCompare(b.fixtureId) ||
        a.checkId.localeCompare(b.checkId),
    ),
    byFixtureCheck,
    byRubric,
    headlines,
  };
}

function summarize(rows: JudgeVarianceRow[]): {
  byFixtureCheck: FixtureCheckVariance[];
  byRubric: RubricVariance[];
  headlines: string[];
} {
  interface InputGroup {
    fixtureId: string;
    checkId: string;
    rubricHash: string;
    verdicts: Verdict[];
    /** An input is gated only if no trial of it reached the rubric. A
     * partially-gated input would mean the gate itself is non-deterministic
     * over fixed input, which it cannot be — but this reads the trials
     * rather than assuming, so a future gate that consults something
     * non-deterministic shows up as variance instead of being hidden. */
    judgedTrials: number;
  }

  const inputGroups = new Map<string, InputGroup>();
  for (const row of rows) {
    const key = `${row.fixtureId}::${row.checkId}::${row.sourceRepIndex}`;
    let group = inputGroups.get(key);
    if (!group) {
      group = {
        fixtureId: row.fixtureId,
        checkId: row.checkId,
        rubricHash: row.rubricHash,
        verdicts: [],
        judgedTrials: 0,
      };
      inputGroups.set(key, group);
    }
    group.verdicts.push(row.verdict);
    if (row.judgeInvoked) group.judgedTrials += 1;
  }
  const groups = [...inputGroups.values()];

  const byFixtureCheckMap = new Map<
    string,
    {
      fixtureId: string;
      checkId: string;
      rubricHash: string;
      verdictCounts: Partial<Record<Verdict, number>>;
      totalInputs: number;
      flippedInputs: number;
      gatedInputs: number;
    }
  >();
  const byRubricMap = new Map<
    string,
    {
      checkId: string;
      rubricHash: string;
      totalInputs: number;
      flippedInputs: number;
      gatedInputs: number;
    }
  >();

  for (const group of groups) {
    const gated = group.judgedTrials === 0;

    const fcKey = `${group.fixtureId}::${group.checkId}`;
    let fc = byFixtureCheckMap.get(fcKey);
    if (!fc) {
      fc = {
        fixtureId: group.fixtureId,
        checkId: group.checkId,
        rubricHash: group.rubricHash,

        verdictCounts: {},
        totalInputs: 0,
        flippedInputs: 0,
        gatedInputs: 0,
      };
      byFixtureCheckMap.set(fcKey, fc);
    }
    // Verdict counts stay inclusive — they describe what the check did,
    // which is worth seeing whole. Only the flip-rate denominator excludes
    // gated inputs, since that number is a claim about the *rubric*.
    for (const v of group.verdicts) {
      fc.verdictCounts[v] = (fc.verdictCounts[v] ?? 0) + 1;
    }
    // A gated group carries no rubric hash, correctly — but the check does
    // have one, and a report that renders it blank because the first group
    // happened to be gated is just harder to read. Take it from whichever
    // group actually reached the rubric.
    if (!fc.rubricHash && group.rubricHash) fc.rubricHash = group.rubricHash;

    if (gated) fc.gatedInputs += 1;
    else {
      fc.totalInputs += 1;
      if (flipped(group.verdicts)) fc.flippedInputs += 1;
    }

    let rubric = byRubricMap.get(group.checkId);
    if (!rubric) {
      rubric = {
        checkId: group.checkId,
        rubricHash: group.rubricHash,
        totalInputs: 0,
        flippedInputs: 0,
        gatedInputs: 0,
      };
      byRubricMap.set(group.checkId, rubric);
    }
    if (!rubric.rubricHash && group.rubricHash) {
      rubric.rubricHash = group.rubricHash;
    }

    if (gated) rubric.gatedInputs += 1;
    else {
      rubric.totalInputs += 1;
      if (flipped(group.verdicts)) rubric.flippedInputs += 1;
    }
  }

  const byFixtureCheck = [...byFixtureCheckMap.values()]
    .map((e) => ({
      ...e,
      flipRate: e.totalInputs === 0 ? null : e.flippedInputs / e.totalInputs,
    }))
    .sort(
      (a, b) =>
        a.fixtureId.localeCompare(b.fixtureId) ||
        a.checkId.localeCompare(b.checkId),
    );

  const byRubric = [...byRubricMap.values()]
    .map((e) => ({
      ...e,
      flipRate: e.totalInputs === 0 ? null : e.flippedInputs / e.totalInputs,
    }))
    .sort((a, b) => a.checkId.localeCompare(b.checkId));

  const headlines = byRubric.map((r) => {
    const base = `rubric ${r.checkId} (${r.rubricHash}) flipped on ${r.flippedInputs} of ${r.totalInputs} frozen inputs`;
    // Named in the headline, not buried: a rubric validated on two inputs
    // because a gate absorbed the other eighteen has not been validated,
    // and the flip rate alone doesn't say so.
    return r.gatedInputs > 0
      ? `${base} (${r.gatedInputs} further input(s) settled by the structural gate, never reaching the rubric)`
      : base;
  });

  return { byFixtureCheck, byRubric, headlines };
}
