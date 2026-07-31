import { existsSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

/**
 * Resolves `ZOLTAR_EVAL_ROOT` — an absolute path to the parent of
 * `eval-runs/`, which lives in the private `automata-codex` artifacts repo,
 * not this one. Deliberately not part of `src/config/env.schema.ts`: that
 * schema validates the *server's* boot-time environment, where every entry
 * is required; this is a CLI-only variable read at the eval-script boundary.
 *
 * Fails fast — unset, relative, or nonexistent are all caller mistakes worth
 * naming precisely rather than surfacing as an ENOENT three calls later.
 */
export function resolveEvalRoot(): string {
  const value = process.env.ZOLTAR_EVAL_ROOT;
  if (!value) {
    throw new Error(
      'ZOLTAR_EVAL_ROOT is not set. Set it in the repo-root .env to an ' +
        'absolute path — the parent of eval-runs/ in the private ' +
        'automata-codex artifacts repo.',
    );
  }
  if (!isAbsolute(value)) {
    throw new Error(
      `ZOLTAR_EVAL_ROOT must be an absolute path, got: "${value}"`,
    );
  }
  if (!existsSync(value) || !statSync(value).isDirectory()) {
    throw new Error(
      `ZOLTAR_EVAL_ROOT does not point at an existing directory: "${value}"`,
    );
  }
  return value;
}

/**
 * `<createdAt>` in the directory-name format: filename-safe ISO8601, second
 * precision. Colons are legal on APFS/ext4 but not on Windows and are
 * miserable to quote in a shell, so they're replaced with hyphens;
 * milliseconds are dropped as noise no one reads at this grain. Shared by
 * `runDirName` and `judgeVarianceOutputPath` — anywhere a timestamp needs
 * to be part of a filename.
 */
export function filenameSafeTimestamp(date: Date): string {
  return date
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/:/g, '-');
}

/**
 * `<model>__<promptHash8>__<createdAt>` — a run directory's name. Directory
 * identity is `(model, promptHash)`; `createdAt` disambiguates directories
 * that would otherwise collide, and is passed in rather than computed here
 * so callers can inject a clock for deterministic tests (and so the same
 * timestamp can be reused for `manifest.createdAt`).
 */
export function runDirName(
  model: string,
  promptHash: string,
  createdAt: Date,
): string {
  return `${model}__${promptHash}__${filenameSafeTimestamp(createdAt)}`;
}

/** `$ZOLTAR_EVAL_ROOT/eval-runs/<dirName>`. */
export function runDirPath(root: string, dirName: string): string {
  return join(root, 'eval-runs', dirName);
}

/**
 * Resolves a `--run-dir`-style CLI argument: an absolute path is used as
 * given, anything else is resolved against `$ZOLTAR_EVAL_ROOT/eval-runs/` —
 * so `--run-dir claude-sonnet-4-6__ab12cd34__2026-07-26T14-32-10Z` works
 * without the caller typing the full path. Shared by every command that
 * takes a run directory argument (`eval:run --run-dir`, `eval:report`,
 * `eval:compare`, `eval:judge-variance`) so they resolve it identically.
 */
export function resolveRunDirArg(root: string, runDirArg: string): string {
  return isAbsolute(runDirArg) ? runDirArg : join(root, 'eval-runs', runDirArg);
}

export function manifestPath(runDir: string): string {
  return join(runDir, 'manifest.json');
}

export function promptTextPath(runDir: string): string {
  return join(runDir, 'prompt.txt');
}

export function rubricPath(runDir: string, rubricHash: string): string {
  return join(runDir, 'rubrics', `${rubricHash}.txt`);
}

/** Zero-padded to 3 digits: `001`. Shared by `repDir` and error messages
 * that need to name a rep without building a full path. */
export function repDirName(index: number): string {
  return String(index).padStart(3, '0');
}

export function repDir(runDir: string, index: number): string {
  return join(runDir, 'reps', repDirName(index));
}

export function scoresPath(runDir: string, index: number): string {
  return join(repDir(runDir, index), 'scores.jsonl');
}

export function fixtureArtifactDir(
  runDir: string,
  index: number,
  fixtureId: string,
): string {
  return join(repDir(runDir, index), fixtureId);
}

export function judgeArtifactPath(
  runDir: string,
  index: number,
  fixtureId: string,
  checkId: string,
): string {
  return join(
    fixtureArtifactDir(runDir, index, fixtureId),
    `judge-${checkId}.json`,
  );
}

export function wardenRequestPath(
  runDir: string,
  index: number,
  fixtureId: string,
): string {
  return join(
    fixtureArtifactDir(runDir, index, fixtureId),
    'warden-request.json',
  );
}

export function wardenOutputPath(
  runDir: string,
  index: number,
  fixtureId: string,
): string {
  return join(
    fixtureArtifactDir(runDir, index, fixtureId),
    'warden-output.json',
  );
}

/** `eval:judge-variance` writes here, never into `reps/` — a grader-only
 * re-run is a different measurement than a `scores.jsonl` row and would
 * corrupt every pass-rate denominator if appended there. */
export function judgeVarianceDir(runDir: string): string {
  return join(runDir, 'judge-variance');
}

export function judgeVarianceOutputPath(
  runDir: string,
  createdAt: Date,
): string {
  return join(
    judgeVarianceDir(runDir),
    `${filenameSafeTimestamp(createdAt)}.jsonl`,
  );
}

/**
 * `eval:rescore` writes here, never into `reps/` — same argument as
 * `judgeVarianceDir`: a `reps/<nnn>/scores.jsonl` row means "one observation of
 * generator and grader together," and a re-grade of frozen output under
 * changed checker code is a different measurement that would corrupt every
 * pass-rate denominator if appended there.
 */
export function rescoreDir(runDir: string): string {
  return join(runDir, 'rescore');
}

/**
 * Keyed by timestamp, deliberately NOT by `corpusVersion`. A checker change
 * doesn't touch any fixture file, so it doesn't move the corpus hash — two
 * successive re-scores under different checker code would collide on a
 * `<corpusVersion>.jsonl` name and the second would silently overwrite the
 * first. The corpus and harness versions that actually governed each
 * re-score go on the rows instead, where they can differ row to row.
 */
export function rescoreOutputPath(runDir: string, createdAt: Date): string {
  return join(rescoreDir(runDir), `${filenameSafeTimestamp(createdAt)}.jsonl`);
}

/**
 * Judge reasoning for one re-score pass, in a directory named for the same
 * timestamp as that pass's `.jsonl` — so a run accumulating several
 * re-scores keeps each pass's rationales with the rows they explain rather
 * than overwriting them.
 *
 * A re-score cannot reuse `reps/<nnn>/<fixture>/judge-<check>.json`: that
 * file holds the *original* run's rationale, written under whatever rubric
 * was current then. Overwriting it would destroy the record the run was
 * scored against, and pointing at it would attribute one rubric's reasoning
 * to another's verdict.
 */
export function rescoreJudgeArtifactPath(
  runDir: string,
  createdAt: Date,
  index: number,
  fixtureId: string,
  checkId: string,
): string {
  return join(
    rescoreDir(runDir),
    filenameSafeTimestamp(createdAt),
    repDirName(index),
    fixtureId,
    `judge-${checkId}.json`,
  );
}

/**
 * The independent cross-check the spec calls for: rep directories that
 * exist on disk, regardless of what `manifest.json` vouches for. A crashed
 * rep leaves a directory here that `nextRepIndex` and `readVouchedRows`
 * both deliberately ignore — this is how `eval:report` can still name it.
 */
export function listRepDirsOnDisk(runDir: string): number[] {
  const repsDir = join(runDir, 'reps');
  if (!existsSync(repsDir)) return [];

  return readdirSync(repsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{3}$/.test(entry.name))
    .map((entry) => Number(entry.name))
    .sort((a, b) => a - b);
}
