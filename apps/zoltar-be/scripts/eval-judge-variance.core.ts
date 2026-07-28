import { mkdirSync, writeFileSync } from 'node:fs';
import { z } from 'zod';

import { evalChecks } from '../eval/checks/registry';
import { runCheck } from '../eval/checks/run-check';
import { loadFixtures } from '../eval/fixture-loader';
import { readTurnResultArtifact } from '../eval/runs/artifacts';
import { envOnlyConfigService } from '../eval/runs/env-config-service';
import { judgeVarianceDir, judgeVarianceOutputPath } from '../eval/runs/paths';
import { readVouchedRows, verdictSchema } from '../eval/runs/scores';
import { AnthropicService } from '../src/anthropic/anthropic.service';

import type { AnthropicService as AnthropicServiceType } from '../src/anthropic/anthropic.service';
import type { Verdict } from '../eval/runs/scores';

export const judgeVarianceRowSchema = z.object({
  fixtureId: z.string().min(1),
  checkId: z.string().min(1),
  rubricHash: z.string(),
  sourceRepIndex: z.number().int().positive(),
  trialIndex: z.number().int().positive(),
  verdict: verdictSchema,
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
}

export interface RubricVariance {
  checkId: string;
  rubricHash: string;
  totalInputs: number;
  flippedInputs: number;
  flipRate: number | null;
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
  /** Trials per frozen input. */
  reps: number;
  /** Fixture ids to include. Omitted = every vouched fixture. */
  fixtureIds?: string[];
}

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

  const rows: JudgeVarianceRow[] = [];
  const skippedByKey = new Map<string, SkippedTarget>();
  const skip = (fixtureId: string, checkId: string, reason: string): void => {
    skippedByKey.set(`${fixtureId}::${checkId}`, { fixtureId, checkId, reason });
  };

  for (const input of inputs.values()) {
    for (const checkId of input.checkIds) {
      const check = evalChecks[checkId];
      if (!check) {
        skip(input.fixtureId, checkId, `"${checkId}" is not a registered check`);
        continue;
      }
      if (check.mode !== 'judged') {
        skip(
          input.fixtureId,
          checkId,
          'structural checks are deterministic over fixed input — re-running measures nothing',
        );
        continue;
      }
      const fixture = fixturesById.get(input.fixtureId);
      if (!fixture) {
        skip(
          input.fixtureId,
          checkId,
          `fixture "${input.fixtureId}" not found under ${args.fixturesDir}`,
        );
        continue;
      }

      let turnResult;
      try {
        turnResult = readTurnResultArtifact(
          args.runDir,
          input.repIndex,
          input.fixtureId,
        );
      } catch (err) {
        skip(
          input.fixtureId,
          checkId,
          `no warden-output.json artifact for rep ${input.repIndex} (original turn likely errored): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        continue;
      }

      for (let trialIndex = 1; trialIndex <= args.reps; trialIndex++) {
        const observation = await runCheck(
          check,
          fixture,
          turnResult,
          deps.anthropicService,
        );
        rows.push(
          judgeVarianceRowSchema.parse({
            fixtureId: input.fixtureId,
            checkId,
            rubricHash: observation.rubricHash ?? check.rubricHash?.() ?? '',
            sourceRepIndex: input.repIndex,
            trialIndex,
            verdict: observation.verdict,
            durationMs: observation.durationMs,
          }),
        );
      }
    }
  }

  mkdirSync(judgeVarianceDir(args.runDir), { recursive: true });
  const outputPath = judgeVarianceOutputPath(args.runDir, deps.clock());
  writeFileSync(
    outputPath,
    rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length > 0 ? '\n' : ''),
    'utf-8',
  );

  const { byFixtureCheck, byRubric, headlines } = summarize(rows);

  return {
    outputPath,
    rows,
    skipped: [...skippedByKey.values()].sort(
      (a, b) =>
        a.fixtureId.localeCompare(b.fixtureId) || a.checkId.localeCompare(b.checkId),
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
      };
      inputGroups.set(key, group);
    }
    group.verdicts.push(row.verdict);
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
    }
  >();
  const byRubricMap = new Map<
    string,
    { checkId: string; rubricHash: string; totalInputs: number; flippedInputs: number }
  >();

  for (const group of groups) {
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
      };
      byFixtureCheckMap.set(fcKey, fc);
    }
    fc.totalInputs += 1;
    if (flipped(group.verdicts)) fc.flippedInputs += 1;
    for (const v of group.verdicts) {
      fc.verdictCounts[v] = (fc.verdictCounts[v] ?? 0) + 1;
    }

    let rubric = byRubricMap.get(group.checkId);
    if (!rubric) {
      rubric = {
        checkId: group.checkId,
        rubricHash: group.rubricHash,
        totalInputs: 0,
        flippedInputs: 0,
      };
      byRubricMap.set(group.checkId, rubric);
    }
    rubric.totalInputs += 1;
    if (flipped(group.verdicts)) rubric.flippedInputs += 1;
  }

  const byFixtureCheck = [...byFixtureCheckMap.values()]
    .map((e) => ({
      ...e,
      flipRate: e.totalInputs === 0 ? null : e.flippedInputs / e.totalInputs,
    }))
    .sort(
      (a, b) =>
        a.fixtureId.localeCompare(b.fixtureId) || a.checkId.localeCompare(b.checkId),
    );

  const byRubric = [...byRubricMap.values()]
    .map((e) => ({
      ...e,
      flipRate: e.totalInputs === 0 ? null : e.flippedInputs / e.totalInputs,
    }))
    .sort((a, b) => a.checkId.localeCompare(b.checkId));

  const headlines = byRubric.map(
    (r) =>
      `rubric ${r.checkId} (${r.rubricHash}) flipped on ${r.flippedInputs} of ${r.totalInputs} frozen inputs`,
  );

  return { byFixtureCheck, byRubric, headlines };
}
